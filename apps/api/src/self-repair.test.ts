import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import Database from 'better-sqlite3';
import express from 'express';
import {SELF_REPAIR_PIPELINE,SELF_REPAIR_WORKSPACE_NAME,buildDiagnosisBundle,composeRepairDescription,ensureSelfWorkspace,ensureSelfRepairTables,isSelfRepairTask,isSelfRepairWorkspace,redact,registerSelfRepairRoutes,repairInstructions} from './self-repair.js';

/** Esquema mínimo das tabelas lidas pelo diagnóstico (o servidor real cria as completas). */
function memoryDb(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,location TEXT NOT NULL,branch TEXT,status TEXT NOT NULL,taskBudgetUsd REAL NOT NULL DEFAULT 0,monthlyBudgetUsd REAL NOT NULL DEFAULT 0,tokenUsageLimit INTEGER NOT NULL DEFAULT 0,enforceTokenUsageLimit INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE tasks (id TEXT PRIMARY KEY,workspaceId TEXT,title TEXT,description TEXT,status TEXT,currentStage TEXT,lastSuccessfulStage TEXT,environmentStatus TEXT,environmentWarning TEXT,configSnapshot TEXT,updatedAt TEXT,isolationMode TEXT,worktreePath TEXT,taskBranch TEXT,baseBranch TEXT,baseCommitSha TEXT);
  CREATE TABLE executions (id TEXT PRIMARY KEY,taskId TEXT,role TEXT,provider TEXT,model TEXT,status TEXT,startedAt TEXT,finishedAt TEXT,error TEXT,progressMessage TEXT,structuredResult TEXT,stderr TEXT);
  CREATE TABLE events (id TEXT PRIMARY KEY,type TEXT,taskId TEXT,payload TEXT,createdAt TEXT);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY,actor TEXT,action TEXT,taskId TEXT,metadata TEXT,timestamp TEXT);`);
  return db;
}

test('redact: remove senhas, tokens, chaves e cookies do texto que vai para o prompt',()=>{
  const text=[
    'ORQ_DB_PASSWORD=super-secreta-123',
    '{"password":"abc123","token":"xyz","ok":"visivel"}',
    "api_key: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX'",
    'Authorization: Bearer abcdefghijklmnop12345',
    'cookie=PHPSESSID=deadbeef',
    'erro normal sem segredo'
  ].join('\n');
  const clean=redact(text);
  for(const secret of ['super-secreta-123','abc123','xyz"','ABCDEFGHIJKLMNOPQRSTUVWX','abcdefghijklmnop12345','deadbeef'])assert.equal(clean.includes(secret),false,secret);
  assert.match(clean,/visivel/);assert.match(clean,/erro normal sem segredo/);assert.match(clean,/\[REDACTED\]/);
});

test('diagnóstico automático: reúne task, execuções, erros, eventos e auditoria, sem segredos e dentro do limite',()=>{
  const db=memoryDb();
  db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('w1','Projeto X','local','C:/x','main','active','t','t');
  db.prepare('INSERT INTO tasks (id,workspaceId,title,description,status,currentStage,environmentStatus,configSnapshot,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)').run('t1','w1','Criar login','Crie o login do motorista','failed','tester','failed_preserved',JSON.stringify({agentConfigs:[{role:'developer',provider:'claude-code',model:'m1'}]}),'t');
  db.prepare('INSERT INTO executions (id,taskId,role,provider,model,status,startedAt,error,structuredResult,stderr) VALUES (?,?,?,?,?,?,?,?,?,?)').run('e1','t1','tester','command-tester','local','failed','2026-01-01T00:00:01Z','php: erro de conexão com ORQ_DB_PASSWORD=segredo-do-banco',JSON.stringify({status:'FAILED',summary:'Command QA failed',commands:[{label:'php -l login.php',status:'failed',exitCode:255,stderr:'Parse error: syntax error'}],notes:['falhou']}),'trace final do erro');
  db.prepare('INSERT INTO events (id,type,taskId,payload,createdAt) VALUES (?,?,?,?,?)').run('v1','execution.failed','t1',JSON.stringify({data:{reason:'tester_failed',token:'tok-secreto-1234567890'}}),'2026-01-01T00:00:02Z');
  db.prepare('INSERT INTO audit_logs (id,actor,action,taskId,metadata,timestamp) VALUES (?,?,?,?,?,?)').run('a1','system','task.failed','t1','{"why":"tester"}','2026-01-01T00:00:03Z');
  const bundle=buildDiagnosisBundle(db,'t1')!;
  assert.deepEqual(bundle.sections.map(s=>s.name),['Task','Execuções','Eventos recentes','Auditoria']);
  for(const expected of [/Criar login/,/Projeto X/,/failed_preserved/,/claude-code\/m1/,/\[tester\] command-tester\/local → failed/,/php -l login\.php=failed \(código 255; Parse error/,/trace final do erro/,/execution\.failed/,/task\.failed/])assert.match(bundle.text,expected);
  for(const secret of ['segredo-do-banco','tok-secreto-1234567890'])assert.equal(bundle.text.includes(secret),false,secret);
  assert.equal(buildDiagnosisBundle(db,'inexistente'),null);
  const small=buildDiagnosisBundle(db,'t1',400)!;assert.equal(small.truncated,true);assert.ok(small.text.length<=700);
});

test('descrição da autocorreção: regras de segurança, pedido e diagnóstico anexado',()=>{
  const description=composeRepairDescription({prompt:'O botão Aplicar não respeita o estado',bundle:{text:'### Task\nid: t1',sections:[],truncated:true},sourceTitle:'Criar login',repo:{root:'C:/orq',branch:'main'}});
  for(const expected of [/AUTOCORREÇÃO DO ORQUESTRADORIA/,/worktree isolado/,/NÃO deve ser alterada, parada nem reiniciada/,/não faça commit, push, merge, deploy/,/O botão Aplicar não respeita o estado/,/Diagnóstico automático/,/### Task/,/truncado/])assert.match(description,expected);
  assert.match(composeRepairDescription({prompt:'',bundle:null,sourceTitle:'Criar login',repo:{root:'r',branch:'main'}}),/Diagnosticar e corrigir a falha da task "Criar login"/);
  assert.deepEqual(SELF_REPAIR_PIPELINE,['planner','developer','tester','reviewer']);
});

test('instruções de aprovação: só texto para o humano (revisar, verificar, mesclar), nunca executado',()=>{
  const info=repairInstructions({taskBranch:'orchestrator/task-abc',worktreePath:'C:/wt/abc',baseBranch:'main'},'C:/orq');
  assert.match(info.note,/Nada foi mesclado/);
  assert.deepEqual(info.review,['git -C "C:/orq" diff main...orchestrator/task-abc','git -C "C:/orq" log main..orchestrator/task-abc --stat']);
  assert.deepEqual(info.merge,['git -C "C:/orq" switch main','git -C "C:/orq" merge --no-ff orchestrator/task-abc']);
  assert.ok(info.verify.every(line=>line.startsWith('(no worktree C:/wt/abc)')));
  assert.match(info.afterMerge,/manualmente/);
});

// ---------- rotas com um express real em memória e handlers falsos (sem provider, sem custo) ----------
function tempRepo(){
  const root=mkdtempSync(join(tmpdir(),'orq-self-unit-'));
  const run=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
  run('init','-q','-b','main');run('config','user.email','t@example.test');run('config','user.name','t');
  writeFileSync(join(root,'a.txt'),'x');run('add','.');run('commit','-q','-m','init');
  return root;
}
async function withRoutes<T>(options:{mode:'mock'|'real';spendBlocked?:boolean;defaultTaskUsd?:number},fn:(ctx:{base:string;calls:Record<string,any[]>;db:Database.Database;root:string})=>Promise<T>):Promise<T>{
  const root=tempRepo(),db=memoryDb(),app=express();app.use(express.json());
  const calls:Record<string,any[]>={create:[],run:[],changes:[],discard:[]};
  let counter=0;
  const handlers={
    mode:(_req:any,res:any)=>res.json(options.mode==='real'?{mode:'real',costly:[{label:'Developer',provider:'claude-code',model:'claude-sonnet'}],summary:'Developer: Claude Code (claude-sonnet)',forced:false}:{mode:'mock',costly:[],summary:'Nenhum provider pago em uso',forced:true}),
    costEstimate:(_req:any,res:any)=>res.json({estimate:{expectedUsd:0.4,lowUsd:0.2,highUsd:0.9}}),
    createTask:(req:any,res:any)=>{calls.create.push(req);const id=`task${++counter}`;db.prepare('INSERT INTO tasks (id,workspaceId,title,description,status,isolationMode,environmentStatus,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run(id,req.params.workspaceId,req.body.title,req.body.description,'pending','worktree','active','t');res.status(201).json({id,isolationMode:'worktree',title:req.body.title});},
    runTask:(req:any,res:any)=>{calls.run.push(req);res.status(202).json({accepted:true,taskId:req.params.id});},
    requestChanges:(req:any,res:any)=>{calls.changes.push(req);res.status(202).json({accepted:true});},
    discard:(req:any,res:any)=>{calls.discard.push(req);res.json({ok:true});}
  };
  registerSelfRepairRoutes({app,db,repoRoot:()=>root,now:()=>new Date().toISOString(),emit:()=>{},audit:()=>{},handlers,diff:()=>({files:[]}),canRequestAdjustment:()=>({ok:true}),attention:()=>null,running:{has:()=>false},
    budget:{load:()=>({dailyUsd:2,monthlyUsd:20,defaultTaskUsd:options.defaultTaskUsd??0.5}),spend:()=>({todayUsd:0,monthUsd:0,dailyLimitUsd:2,monthlyLimitUsd:20,blocked:Boolean(options.spendBlocked),reason:options.spendBlocked?'daily':null,message:options.spendBlocked?'Limite diário atingido.':null}),effectiveTaskBudget:(requested,paid)=>{const n=Number(requested);return Number.isFinite(n)&&n>0?n:paid?(options.defaultTaskUsd??0.5):0;}}});
  const server:Server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{return await fn({base:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,calls,db,root});}
  finally{await new Promise<void>(r=>server.close(()=>r()));db.close();rmSync(root,{recursive:true,force:true});}
}
const post=(base:string,path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json().catch(()=>({}))}));

test('créditos reais exigem confirmação explícita: sem ela nada é criado nem executado',async()=>{
  await withRoutes({mode:'real'},async({base,calls,db})=>{
    const blocked=await post(base,'/api/self-repair/repairs',{prompt:'corrigir o bug do apply'});
    assert.equal(blocked.status,409);assert.equal(blocked.body.code,'spend_confirmation_required');
    assert.equal(blocked.body.mode,'real');assert.match(blocked.body.summary,/Claude Code/);assert.equal(blocked.body.estimate.estimate.expectedUsd,0.4);assert.equal(blocked.body.budget.taskBudgetUsd,0.5);
    assert.equal(calls.create.length,0);assert.equal(calls.run.length,0);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n,0);
    const falsy=await post(base,'/api/self-repair/repairs',{prompt:'x',confirmSpend:'true'});
    assert.equal(falsy.status,409,'só o booleano true confirma');assert.equal(calls.create.length,0);
    const ok=await post(base,'/api/self-repair/repairs',{prompt:'corrigir o bug do apply',confirmSpend:true,taskBudgetUsd:0.3});
    assert.equal(ok.status,202);assert.equal(calls.create.length,1);assert.equal(calls.run.length,1);
    assert.equal(calls.create[0].body.taskBudgetUsd,0.3);assert.deepEqual(calls.create[0].body.pipeline,['planner','developer','tester','reviewer']);
    assert.match(calls.create[0].body.description,/worktree isolado/);
    const row:any=db.prepare('SELECT * FROM self_repairs').get();assert.equal(row.mode,'real');assert.ok(row.spendConfirmedAt);
  });
});

test('orçamento: sem teto positivo ou com limite diário/mensal atingido, o gasto real é bloqueado mesmo com confirmação',async()=>{
  await withRoutes({mode:'real',defaultTaskUsd:0},async({base,calls})=>{
    const noBudget=await post(base,'/api/self-repair/repairs',{prompt:'x',confirmSpend:true});
    assert.equal(noBudget.status,409);assert.equal(noBudget.body.code,'task_budget_required');assert.equal(calls.create.length,0);
  });
  await withRoutes({mode:'real',spendBlocked:true},async({base,calls})=>{
    const blocked=await post(base,'/api/self-repair/repairs',{prompt:'x',confirmSpend:true,taskBudgetUsd:0.3});
    assert.equal(blocked.status,409);assert.equal(blocked.body.code,'budget_blocked');assert.match(blocked.body.error,/Limite diário/);assert.equal(calls.create.length,0);
  });
});

test('modo mock não pede confirmação (custo zero) e valida o pedido',async()=>{
  await withRoutes({mode:'mock'},async({base,calls})=>{
    assert.equal((await post(base,'/api/self-repair/repairs',{})).body.code,'prompt_required');
    assert.equal((await post(base,'/api/self-repair/repairs',{prompt:'x'.repeat(8001)})).body.code,'prompt_too_long');
    assert.equal((await post(base,'/api/self-repair/repairs',{prompt:'x',sourceTaskId:'nao-existe'})).body.code,'source_task_not_found');
    assert.equal(calls.create.length,0);
    const ok=await post(base,'/api/self-repair/repairs',{prompt:'corrigir X'});
    assert.equal(ok.status,202);assert.equal(ok.body.mode,'mock');assert.match(ok.body.safety,/nada é mesclado/);
  });
});

test('estimativa: informa modo, custo, orçamento e o que seria anexado, sem criar nada',async()=>{
  await withRoutes({mode:'real'},async({base,calls,db})=>{
    db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('w1','Projeto X','local','C:/x','main','active','t','t');
    db.prepare('INSERT INTO tasks (id,workspaceId,title,description,status,updatedAt) VALUES (?,?,?,?,?,?)').run('src1','w1','Task com erro','d','failed','t');
    const r=await post(base,'/api/self-repair/estimate',{sourceTaskId:'src1'});
    assert.equal(r.status,200);assert.equal(r.body.requiresConfirmation,true);assert.equal(r.body.mode,'real');assert.ok(r.body.diagnosis.chars>0);assert.ok(r.body.diagnosis.sections.some((s:any)=>s.name==='Task'));
    assert.equal(calls.create.length,0);
    assert.equal((await post(base,'/api/self-repair/estimate',{sourceTaskId:'zzz'})).status,404);
  });
});

test('ajuste e retomada também exigem confirmação de gasto; aprovar não consome nada nem aplica',async()=>{
  await withRoutes({mode:'real'},async({base,calls,db})=>{
    const created=await post(base,'/api/self-repair/repairs',{prompt:'corrigir',confirmSpend:true,taskBudgetUsd:0.3});
    const id=created.body.taskId;
    const noConfirm=await post(base,`/api/self-repair/repairs/${id}/request-changes`,{feedback:'ajuste'});
    assert.equal(noConfirm.body.code,'spend_confirmation_required');assert.equal(calls.changes.length,0);
    assert.equal((await post(base,`/api/self-repair/repairs/${id}/resume`,{})).body.code,'spend_confirmation_required');assert.equal(calls.run.length,1);
    const confirmed=await post(base,`/api/self-repair/repairs/${id}/request-changes`,{feedback:'ajuste',confirmSpend:true,taskBudgetUsd:0.3});
    assert.equal(confirmed.status,202);assert.equal(calls.changes.length,1);assert.equal(calls.changes[0].body.feedback,'ajuste');
    // aprovar só vale com a task aprovada pelo pipeline e aguardando ação; nunca chama o handler de apply (nem existe no contexto)
    assert.equal((await post(base,`/api/self-repair/repairs/${id}/approve`,{})).body.code,'not_approvable');
    db.prepare("UPDATE tasks SET status='approved',environmentStatus='approved_waiting_action',taskBranch='orchestrator/task-1',baseBranch='main',worktreePath='C:/wt/1' WHERE id=?").run(id);
    const approved=await post(base,`/api/self-repair/repairs/${id}/approve`,{note:'ok'});
    assert.equal(approved.status,200);assert.equal(approved.body.merged,false);assert.equal(approved.body.deployed,false);assert.equal(approved.body.restarted,false);
    assert.match(approved.body.instructions.merge.join(' '),/git -C ".*" merge --no-ff orchestrator\/task-1/);
    assert.equal((await post(base,`/api/self-repair/repairs/${id}/approve`,{})).body.code,'already_decided');
    assert.equal(calls.create.length,1,'aprovar não cria nem executa nada');
  });
});

test('workspace da autocorreção: criado uma vez para o repositório do Orquestradoria e identificado como tal',()=>{
  const db=memoryDb();ensureSelfRepairTables(db);const root=tempRepo();
  try{
    const first=ensureSelfWorkspace(db,root,'main','t1'),second=ensureSelfWorkspace(db,root,'feature/x','t2');
    assert.equal(first.id,second.id);assert.equal(second.branch,'feature/x');assert.equal(second.name,SELF_REPAIR_WORKSPACE_NAME);
    assert.equal(isSelfRepairWorkspace(db,first.id),true);assert.equal(isSelfRepairWorkspace(db,'outro'),false);assert.equal(isSelfRepairTask(db,'t'),false);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as any).n,1);
  }finally{rmSync(root,{recursive:true,force:true});db.close();}
});

// ---------- interface e salvaguardas estáticas ----------
import {readFileSync} from 'node:fs';
test('interface: menu Autocorreção, confirmação de gasto e ações de aprovar/ajustar/descartar, sem caminho de aplicar',()=>{
  const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
  const page=readFileSync(new URL('../../web/src/SelfRepairPage.tsx',import.meta.url),'utf8');
  const nav=readFileSync(new URL('../../web/src/navigation.ts',import.meta.url),'utf8');
  assert.match(nav,/'selfrepair'/);assert.match(main,/onClick=\{\(\)=>openSelfRepair\(\)\}><Wrench size=\{17\}\/>Autocorreção<\/button>/);assert.match(main,/view==='selfrepair'&&<SelfRepairPage notify=\{notify\} focusTaskId=\{selfRepairFocus\}\/>/);assert.match(main,/onInvestigate&&\(failed\|\|task\.status==='needs_input'\)&&<button className="secondary" onClick=\{\(\)=>onInvestigate\(task\.id\)\}>Investigar na Autocorreção<\/button>/);assert.match(page,/Problemas detectados/);assert.match(page,/Suspeita \(não confirmada\)/);assert.match(page,/Causa provável/);assert.match(page,/Evidências/);assert.match(page,/Investigar na Autocorreção/);assert.match(page,/Nenhum crédito foi usado/);
  for(const expected of [/Planner → Developer → Tester → Reviewer/,/worktree isolado/,/Confirmar uso de créditos reais/,/Confirmo que posso consumir créditos reais/,/Aprovar/,/Solicitar ajustes/,/Descartar/,/Console/,/Arquivos e diff/,/Testes e revisão/,/Histórico/,/Nada foi mesclado/,/sem merge\/deploy\/restart/])assert.match(page,expected);
  assert.doesNotMatch(page,/\/apply/);assert.doesNotMatch(page,/\/api\/tasks\/\$\{[^}]+\}\/(?:apply|run)/);
  assert.match(page,/confirmSpend:confirm/);
});

test('servidor: Apply genérico e missões bloqueados no workspace da autocorreção; execução exige worktree isolado; seam de teste só em NODE_ENV=test',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.match(server,/isSelfRepairWorkspace\(db,task\.workspaceId\)\)return res\.status\(409\)\.json\(\{code:'self_repair_apply_blocked'/);
  assert.match(server,/isSelfRepairWorkspace\(db,task\.workspaceId\)&&\(!isolatedExecution\|\|resolve\(executionWorkspace\.location\)===resolve\(workspace\.location\)\)\)throw/);
  assert.match(server,/process\.env\.NODE_ENV==='test'&&process\.env\.ORQ_TEST_FIXTURE_EDITS\)providers\.developer=new FixtureDeveloperAdapter/);
  const module=readFileSync(new URL('./self-repair.ts',import.meta.url),'utf8');
  for(const forbidden of [/\bapply\b.*isolation/i,/git\s+merge/,/git\s+push/,/restart/i])assert.equal(forbidden.test(module.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(l=>!/^\s*(\/\/|\*)/.test(l)&&!/instruc|afterMerge|merge:\[|review:\[|verify:\[|note:|Reinicie|autoRestart|restarted|reiniciad|reiniciar|merge --no-ff|git -C/.test(l)).join('\n')),false,String(forbidden));
});

// =====================================================================================================
// Problemas detectados (sem IA, sem créditos)
// =====================================================================================================
import {buildProblemPrompt,detectProblems} from './self-repair-detect.js';

function detectDb(){
  const db=memoryDb();ensureSelfRepairTables(db);
  db.exec("ALTER TABLE audit_logs ADD COLUMN dummy TEXT");
  return db;
}
let seq=0;
const addTask=(db:Database.Database,id:string,status:string,extra:{title?:string;updatedAt?:string;environmentStatus?:string}={})=>db.prepare('INSERT INTO tasks (id,workspaceId,title,description,status,environmentStatus,updatedAt) VALUES (?,?,?,?,?,?,?)').run(id,'w1',extra.title||`Task ${id}`,'d',status,extra.environmentStatus||'failed_preserved',extra.updatedAt||new Date().toISOString());
const addExec=(db:Database.Database,taskId:string,role:string,status:string,error:string|null,structured?:unknown,at=new Date().toISOString())=>db.prepare('INSERT INTO executions (id,taskId,role,provider,model,status,startedAt,finishedAt,error,structuredResult) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`e${++seq}`,taskId,role,'claude-code','m1',status,at,at,error,structured?JSON.stringify(structured):null);
const addAudit=(db:Database.Database,taskId:string,action:string,metadata:unknown,at=new Date().toISOString())=>db.prepare('INSERT INTO audit_logs (id,actor,action,taskId,metadata,timestamp) VALUES (?,?,?,?,?,?)').run(`a${++seq}`,'system',action,taskId,JSON.stringify(metadata),at);

test('detecção: a mesma falha em várias tasks vira UM problema confirmado, agrupado e sem segredos',()=>{
  const db=detectDb();
  for(const [i,id] of ['t1','t2','t3'].entries()){addTask(db,id,'failed');addExec(db,id,'developer','failed',`Claude Code timed out after ${180000+i}ms em C:\\Users\\x\\worktrees\\${id} ORQ_DB_PASSWORD=segredo-${i}`);}
  const found=detectProblems(db);
  assert.equal(found.length,1,JSON.stringify(found.map(p=>p.title)));
  const [problem]=found;
  assert.equal(problem.category,'timeout');assert.equal(problem.status,'confirmed');assert.equal(problem.occurrences,3);assert.deepEqual(problem.taskIds.sort(),['t1','t2','t3']);
  assert.equal(problem.severity,'high','gravidade média sobe para alta quando afeta 3+ tasks');
  assert.match(problem.probableCause,/limite de tempo/);assert.ok(problem.evidence.length>=1&&problem.evidence.length<=5);
  assert.equal(JSON.stringify(problem).includes('segredo-'),false);
  assert.deepEqual(detectProblems(db).map(p=>p.id),found.map(p=>p.id),'idempotente: mesmos ids, sem duplicar');
});

test('detecção: falhas já resolvidas, falhas do projeto do usuário e casos isolados não viram problema',()=>{
  const db=detectDb();
  addTask(db,'ok','approved',{environmentStatus:'approved_waiting_action'});addExec(db,'ok','developer','failed','Claude Code timed out after 180000ms');          // falhou, foi retomada e aprovou
  addTask(db,'tf','failed');addExec(db,'tf','tester','completed',null,{status:'FAILED',commands:[{label:'php -l a.php',status:'failed'}]});               // testes do próprio projeto reprovaram
  addTask(db,'solo','needs_input');addExec(db,'solo','developer','completed',null,{permissionDenials:[{tool:'Bash',command:'echo "$X"; cat a'}]});         // um caso isolado é ruído
  assert.deepEqual(detectProblems(db),[]);
});

test('detecção: padrões sem prova são SUSPEITA, nunca confirmados; confirmados vêm primeiro',()=>{
  const db=detectDb();
  for(const id of ['d1','d2']){addTask(db,id,'needs_input');addExec(db,id,'developer','completed',null,{permissionDenials:[{tool:'Bash',command:'printenv ORQ_DB_NAME'}]});}
  for(const id of ['f1','f2']){addTask(db,id,'needs_manual_review');addExec(db,id,'tester','completed',null,{status:'BLOCKED',blockReason:'required_flow_unvalidated',summary:'Fluxo obrigatório não validado'});}
  addTask(db,'c1','failed');addExec(db,'c1','developer','failed','spawn claude ENOENT');
  const found=detectProblems(db);
  const byCategory=Object.fromEntries(found.map(p=>[p.category,p]));
  assert.equal(byCategory.permission_denials.status,'suspected');assert.equal(byCategory.flow_unvalidated.status,'suspected');assert.equal(byCategory.cli_missing.status,'confirmed');
  assert.equal(byCategory.cli_missing.severity,'high');assert.equal(byCategory.permission_denials.severity,'low');
  assert.equal(found[0].status,'confirmed','confirmados antes das suspeitas');
  for(const p of found.filter(item=>item.status==='suspected'))assert.match(p.probableCause,/Pode ser|pode ser|não é um erro confirmado|não está confirmado|também pode/,p.category);
});

test('detecção: execução órfã é só suspeita, e some quando há processo vivo ou atualização recente',()=>{
  const db=detectDb();const now=new Date('2026-10-16T12:00:00Z');
  addTask(db,'old','implementing',{updatedAt:'2026-10-16T09:00:00Z',environmentStatus:'active'});addTask(db,'fresh','testing',{updatedAt:'2026-10-16T11:58:00Z',environmentStatus:'active'});
  const found=detectProblems(db,{now,running:{has:()=>false}});
  assert.equal(found.length,1);assert.equal(found[0].category,'orphan_execution');assert.equal(found[0].status,'suspected');assert.deepEqual(found[0].taskIds,['old']);
  assert.deepEqual(detectProblems(db,{now,running:{has:id=>id==='old'}}),[]);
});

test('detecção: banco de teste indisponível (auditoria) é confirmado; investigação aberta aparece no problema',()=>{
  const db=detectDb();
  addTask(db,'t1','failed');addAudit(db,'t1','project_database.unavailable',{error:'Não consegui conectar. O MySQL está ligado no painel do XAMPP?'});
  const [problem]=detectProblems(db);
  assert.equal(problem.category,'db_unavailable');assert.equal(problem.status,'confirmed');
  assert.equal(problem.investigation,undefined);
  addTask(db,'fix1','approved',{environmentStatus:'approved_waiting_action'});
  db.prepare('INSERT INTO self_repairs (taskId,workspaceId,prompt,mode,createdAt,problemId) VALUES (?,?,?,?,?,?)').run('fix1','w1','p','mock','t',problem.id);
  assert.deepEqual(detectProblems(db)[0].investigation,{taskId:'fix1',status:'approved',decision:null});
  db.prepare("UPDATE self_repairs SET decision='discarded' WHERE taskId='fix1'").run();
  assert.equal(detectProblems(db)[0].investigation,undefined,'descartada: pode investigar de novo');
});

test('prompt do problema: evidências, grau de certeza e task de origem, sem segredos',()=>{
  const db=detectDb();
  addTask(db,'t1','failed');addExec(db,'t1','developer','failed','spawn claude ENOENT token=abc123456789');
  addTask(db,'d1','needs_input');addTask(db,'d2','needs_input');
  for(const id of ['d1','d2'])addExec(db,id,'developer','completed',null,{permissionDenials:[{tool:'Bash',command:'printenv X'}]});
  const found=detectProblems(db);
  const confirmed=buildProblemPrompt(db,found.find(p=>p.status==='confirmed')!),suspected=buildProblemPrompt(db,found.find(p=>p.status==='suspected')!);
  assert.match(confirmed.prompt,/problema CONFIRMADO por evidência direta/);assert.match(confirmed.prompt,/spawn claude ENOENT/);assert.match(confirmed.prompt,/teste de regressão/);
  assert.equal(confirmed.prompt.includes('abc123456789'),false);assert.equal(confirmed.sourceTaskId,'t1');assert.ok(confirmed.bundle&&confirmed.bundle.text.includes('Execuções'));
  assert.match(suspected.prompt,/SUSPEITA ainda não confirmada/);assert.match(suspected.prompt,/não altere nada e explique/);
});

test('rotas de problemas: leitura e prompt não criam task nem gastam; investigar duas vezes é recusado',async()=>{
  await withRoutes({mode:'real'},async({base,calls,db})=>{
    db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('w1','Projeto X','local','C:/x','main','active','t','t');
    addTask(db,'t1','failed');addTask(db,'t2','failed');
    for(const id of ['t1','t2'])addExec(db,id,'developer','failed','Claude Code timed out after 180000ms');
    const before=(db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n;
    const list=await (await fetch(`${base}/api/self-repair/problems`)).json() as any;
    assert.equal(list.credits,'none');assert.equal(list.confirmed,1);assert.equal(list.problems[0].occurrences,2);
    assert.equal((await (await fetch(`${base}/api/self-repair/problems?taskId=t1`)).json() as any).problems.length,1);
    assert.equal((await (await fetch(`${base}/api/self-repair/problems?taskId=zzz`)).json() as any).problems.length,0);
    const id=list.problems[0].id;
    const prompt=await post(base,`/api/self-repair/problems/${id}/prompt`,{});
    assert.equal(prompt.status,200);assert.equal(prompt.body.credits,'none');assert.match(prompt.body.prompt,/Timeout do provider/);assert.ok(prompt.body.sourceTaskId);assert.ok(prompt.body.diagnosis.chars>0);
    assert.equal((await post(base,'/api/self-repair/problems/naoexiste/prompt',{})).body.code,'problem_not_found');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as any).n,before,'nada foi criado');assert.equal(calls.create.length,0);assert.equal(calls.run.length,0);
    // execução com IA só depois da confirmação (modo real)
    const noConfirm=await post(base,'/api/self-repair/repairs',{prompt:prompt.body.prompt,sourceTaskId:prompt.body.sourceTaskId,problemId:id});
    assert.equal(noConfirm.body.code,'spend_confirmation_required');assert.equal(calls.create.length,0);
    const ok=await post(base,'/api/self-repair/repairs',{prompt:prompt.body.prompt,sourceTaskId:prompt.body.sourceTaskId,problemId:id,confirmSpend:true,taskBudgetUsd:0.3});
    assert.equal(ok.status,202);assert.equal(calls.create.length,1);
    const again=await post(base,'/api/self-repair/repairs',{prompt:'x',problemId:id,confirmSpend:true,taskBudgetUsd:0.3});
    assert.equal(again.status,409);assert.equal(again.body.code,'already_investigating');assert.equal(again.body.taskId,ok.body.taskId);assert.equal(calls.create.length,1);
    const shown=(await (await fetch(`${base}/api/self-repair/problems`)).json() as any).problems[0];
    assert.equal(shown.investigation.taskId,ok.body.taskId);
  });
});
