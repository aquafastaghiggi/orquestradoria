import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Validação do módulo Autocorreção com Mock e um bug simulado, contra o servidor REAL (processo separado, banco temporário):
 * a correção só pode mexer no worktree isolado; o repositório (a "instância em execução"), a main e o servidor ficam intactos.
 * Nenhum provider real roda (ORQ_FORCE_MOCK=1; o Developer é o fixture de teste, que só edita dentro do worktree).
 */
const apiDir=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise<number>(resolvePort=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=(s.address() as any).port;s.close(()=>resolvePort(port));});});
const sha256=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

/** "Orquestradoria" de mentira: um repositório git com um bug simulado (sum subtrai em vez de somar) e o teste que o revela. */
function fakeOrquestradoria(){
  const root=mkdtempSync(join(tmpdir(),'orq-selfrepo-'));
  mkdirSync(join(root,'src'));mkdirSync(join(root,'test'));
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fake-orquestradoria',version:'0.0.0',scripts:{test:'node --test'}}));
  writeFileSync(join(root,'src','sum.js'),'export const sum=(a,b)=>a - b; // BUG simulado: deveria somar\n');
  writeFileSync(join(root,'test','sum.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {sum} from '../src/sum.js';test('sum',()=>assert.equal(sum(2,3),5));\n");
  git(root,'init','-q','-b','main');git(root,'config','user.email','selfrepair@example.test');git(root,'config','user.name','selfrepair');
  git(root,'add','.');git(root,'commit','-q','-m','initial');
  return root;
}
const snapshotOf=(root:string)=>({head:git(root,'rev-parse','HEAD'),branch:git(root,'branch','--show-current'),status:git(root,'status','--porcelain'),sum:sha256(join(root,'src','sum.js')),test:sha256(join(root,'test','sum.test.js')),branches:git(root,'branch','--format=%(refname:short)').split(/\r?\n/).sort()});

interface Server{base:string;pid:number;log:()=>string;stop:()=>Promise<void>}
async function startServer(tmp:string,extra:Record<string,string>):Promise<Server>{
  const port=await freePort();
  const env:Record<string,string|undefined>={...process.env,NODE_TEST_CONTEXT:undefined,PORT:String(port),DB_PATH:join(tmp,'self.db'),TASK_WORKTREE_ROOT:join(tmp,'worktrees'),ORQ_BACKUP_DIR:join(tmp,'backups'),
    ORQ_PROJECT_DB_DISABLED:'1',PROMPT_REFINER_PROVIDER:'mock',MISSION_PLANNER_PROVIDER:'mock',FLOW_VALIDATION:'0',NODE_ENV:'test',...extra};
  delete env.NODE_TEST_CONTEXT;
  const child:ChildProcess=spawn(process.execPath,['--import','tsx','src/server.ts'],{cwd:apiDir,env:env as NodeJS.ProcessEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';child.stdout!.on('data',c=>{log+=c;});child.stderr!.on('data',c=>{log+=c;});
  const base=`http://127.0.0.1:${port}`;
  const deadline=Date.now()+60000;let up=false;
  while(Date.now()<deadline&&!up){try{up=(await fetch(`${base}/health`)).ok;}catch{await sleep(300);}}
  assert.equal(up,true,`API não iniciou:\n${log.slice(-1500)}`);
  return{base,pid:child.pid!,log:()=>log,stop:async()=>{child.kill();await new Promise<void>(r=>{if(child.exitCode!==null)return r();(child as unknown as NodeJS.EventEmitter).once('exit',()=>r());setTimeout(r,3000);});}};
}
const api=(server:Server,method:string,path:string,body?:unknown)=>fetch(server.base+path,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json().catch(()=>({}))}));
async function until<T>(read:()=>Promise<T>,done:(value:T)=>boolean,what:string,ms=90000):Promise<T>{
  const end=Date.now()+ms;let value=await read();
  while(!done(value)&&Date.now()<end){await sleep(500);value=await read();}
  assert.equal(done(value),true,`tempo esgotado: ${what}\n${JSON.stringify(value).slice(0,800)}`);return value;
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

const MOCK_ENV={ORQ_FORCE_MOCK:'1',DEVELOPER_PROVIDER:'mock',REVIEWER_PROVIDER:'mock',TESTER_PROVIDER:'mock'};

test('autocorreção com Mock e um bug simulado: só o worktree isolado muda; a instância, a main e o servidor ficam intactos',{timeout:240000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orq-selfrepair-'));
  const orq=fakeOrquestradoria();
  const other=mkdtempSync(join(tmpdir(),'orq-other-'));
  git(other,'init','-q','-b','main');git(other,'config','user.email','o@example.test');git(other,'config','user.name','o');writeFileSync(join(other,'README.md'),'projeto qualquer');git(other,'add','.');git(other,'commit','-q','-m','init');
  const before=snapshotOf(orq);
  const server=await startServer(tmp,{...MOCK_ENV,ORQ_SELF_REPO:orq,ORQ_TEST_FIXTURE_EDITS:JSON.stringify([{file:'src/sum.js',find:'a - b; // BUG simulado: deveria somar',replace:'a + b;'}])});
  try{
    // ---- visão geral: a instância em execução e o isolamento
    const overview=(await api(server,'GET','/api/self-repair')).body;
    assert.equal(overview.available,true);assert.equal(resolve(overview.workspace.location),resolve(orq));assert.equal(overview.mode.mode,'mock');
    assert.equal(overview.instance.headSha,before.head);assert.equal(overview.isolation.worktreeRequired,true);
    const livePid=overview.instance.pid;assert.equal(livePid,server.pid);

    // ---- uma task existente (com erro simulado) para diagnosticar
    const ws=(await api(server,'POST','/api/workspaces',{name:'Projeto qualquer',location:other})).body;
    const sourceTask=(await api(server,'POST',`/api/workspaces/${ws.id}/tasks`,{title:'Somar valores',description:'Implementar sum(a,b)'})).body;
    assert.ok(sourceTask.id);
    const estimate=(await api(server,'POST','/api/self-repair/estimate',{sourceTaskId:sourceTask.id})).body;
    assert.equal(estimate.requiresConfirmation,false);assert.equal(estimate.mode,'mock');assert.ok(estimate.diagnosis.chars>0);

    // ---- cria a autocorreção (modo mock: sem confirmação de gasto)
    const created=await api(server,'POST','/api/self-repair/repairs',{prompt:'A função sum() subtrai em vez de somar. Corrija e mantenha o teste.',sourceTaskId:sourceTask.id});
    assert.equal(created.status,202,JSON.stringify(created.body));assert.equal(created.body.mode,'mock');
    const id=created.body.taskId;

    const done=await until(async()=>(await api(server,'GET',`/api/self-repair/repairs/${id}`)).body,d=>d?.task?.status==='approved'||d?.task?.status==='failed','pipeline do Mock concluir');
    assert.equal(done.task.status,'approved',JSON.stringify(done.stages));
    assert.deepEqual(done.stages.map((s:any)=>s.role),['planner','developer','tester','reviewer']);
    assert.ok(done.stages.every((s:any)=>!s.error),'sem erro em nenhuma etapa');

    // ---- a correção existe SÓ no worktree isolado
    const worktree=resolve(done.task.worktreePath);
    assert.ok(worktree.startsWith(resolve(join(tmp,'worktrees'))),'o worktree fica na raiz de worktrees da instância, fora do repositório');
    assert.notEqual(worktree,resolve(orq));
    assert.equal(readFileSync(join(worktree,'src','sum.js'),'utf8').trim(),'export const sum=(a,b)=>a + b;');
    assert.deepEqual(done.files.files,['src/sum.js']);assert.deepEqual(done.files.modified,['src/sum.js']);
    const diff=(await api(server,'GET',`/api/tasks/${id}/diff`)).body.diff as string;
    assert.match(diff,/-export const sum=\(a,b\)=>a - b/);assert.match(diff,/\+export const sum=\(a,b\)=>a \+ b;/);

    // ---- a instância em execução (o repositório) ficou exatamente como estava
    const after=snapshotOf(orq);
    assert.equal(after.head,before.head,'nenhum commit foi feito na instância');assert.equal(after.branch,'main');
    assert.equal(after.status,'','árvore de trabalho da instância limpa');assert.equal(after.sum,before.sum,'src/sum.js da instância intacto (ainda com o bug)');assert.equal(after.test,before.test);
    assert.match(readFileSync(join(orq,'src','sum.js'),'utf8'),/a - b/);
    assert.equal(done.safety.isolated,true);assert.equal(done.safety.taskBranchCheckedOutInLive,false);assert.equal(done.safety.repoHeadUnchanged,true);
    assert.deepEqual([done.safety.autoMerge,done.safety.autoDeploy,done.safety.autoRestart],[false,false,false]);
    const taskBranch=done.task.taskBranch as string;
    assert.ok(after.branches.includes(taskBranch)&&after.branches.includes('main'),'a branch da task existe, mas não é a atual');
    assert.equal(git(orq,'rev-parse','main'),before.head,'a main não andou');

    // ---- o sistema em execução continua de pé
    assert.equal((await fetch(`${server.base}/health`)).ok,true);assert.equal(alive(server.pid),true);
    assert.equal((await api(server,'GET','/api/self-repair')).body.instance.pid,livePid,'o mesmo processo continua servindo');

    // ---- aplicar pelo caminho genérico é bloqueado (nunca altera a main automaticamente)
    const apply=await api(server,'POST',`/api/tasks/${id}/apply`,{});
    assert.equal(apply.status,409);assert.equal(apply.body.code,'self_repair_apply_blocked');
    assert.equal(snapshotOf(orq).head,before.head);

    // ---- solicitar ajustes: volta ao Developer no MESMO worktree, e a aprovação anterior deixa de valer
    assert.equal(done.actions.canRequestChanges,true);assert.equal(done.actions.canApprove,true);
    const adjust=await api(server,'POST',`/api/self-repair/repairs/${id}/request-changes`,{feedback:'Mantenha o comentário explicando a correção.'});
    assert.equal(adjust.status,202,JSON.stringify(adjust.body));
    const readjusted=await until(async()=>(await api(server,'GET',`/api/self-repair/repairs/${id}`)).body,d=>d?.task?.status==='approved'&&d.history.some((h:any)=>h.action==='task.adjustment_requested'),'ajuste concluir');
    assert.equal(readjusted.adjustments.length,1,JSON.stringify({adjustments:readjusted.adjustments,history:readjusted.history}));
    assert.equal(resolve(readjusted.task.worktreePath),worktree,'o ajuste reutiliza o mesmo worktree');
    assert.equal(snapshotOf(orq).sum,before.sum,'a instância continua intacta depois do ajuste');

    // ---- aprovar: só registra a decisão e mostra os comandos; nada é mesclado
    const approved=await api(server,'POST',`/api/self-repair/repairs/${id}/approve`,{});
    assert.equal(approved.status,200,JSON.stringify(approved.body));
    assert.deepEqual([approved.body.merged,approved.body.deployed,approved.body.restarted],[false,false,false]);
    assert.match(approved.body.instructions.merge.join(' '),new RegExp(`merge --no-ff ${taskBranch.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')}`));
    const final=snapshotOf(orq);
    assert.equal(final.head,before.head);assert.equal(final.branch,'main');assert.equal(final.status,'');assert.equal(final.sum,before.sum);
    assert.equal((await api(server,'GET',`/api/self-repair/repairs/${id}`)).body.repair.decision,'approved');
    assert.equal((await fetch(`${server.base}/health`)).ok,true);assert.equal(alive(server.pid),true);

    // ---- descartar uma segunda correção remove o worktree e a branch, sem tocar na instância
    const second=await api(server,'POST','/api/self-repair/repairs',{prompt:'Outra melhoria qualquer'});
    assert.equal(second.status,202);
    const secondDone=await until(async()=>(await api(server,'GET',`/api/self-repair/repairs/${second.body.taskId}`)).body,d=>d?.task?.status==='approved','segunda correção concluir');
    const secondWorktree=resolve(secondDone.task.worktreePath);assert.equal(existsSync(secondWorktree),true);
    const discarded=await api(server,'POST',`/api/self-repair/repairs/${second.body.taskId}/discard`,{});
    assert.equal(discarded.status,200,JSON.stringify(discarded.body));
    assert.equal(existsSync(secondWorktree),false,'o worktree descartado foi removido');
    assert.equal((await api(server,'GET',`/api/self-repair/repairs/${second.body.taskId}`)).body.repair.decision,'discarded');
    assert.equal(snapshotOf(orq).sum,before.sum);assert.equal(snapshotOf(orq).head,before.head);

    // ---- histórico e auditoria
    const list=(await api(server,'GET','/api/self-repair')).body.repairs;
    assert.equal(list.length,2);assert.deepEqual(list.map((r:any)=>r.decision).sort(),['approved','discarded']);
    const history=(await api(server,'GET',`/api/self-repair/repairs/${id}`)).body.history.map((h:any)=>h.action);
    for(const action of ['self_repair.created','task.adjustment_requested','self_repair.approved'])assert.ok(history.includes(action),action);
    assert.equal(history.includes('task.applied'),false);
    assert.equal(alive(server.pid),true);
  }finally{
    await server.stop();
    for(const dir of [tmp,orq,other])try{rmSync(dir,{recursive:true,force:true});}catch{/* Windows pode segurar o diretório por instantes */}
  }
});

test('modo real sem confirmação: nada é criado nem executado no servidor real, e o repositório fica intacto',{timeout:120000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orq-selfrepair-real-'));
  const orq=fakeOrquestradoria();const before=snapshotOf(orq);
  // providers pagos configurados, mas NUNCA executados: a confirmação é exigida antes de criar qualquer task
  const server=await startServer(tmp,{ORQ_SELF_REPO:orq,DEVELOPER_PROVIDER:'claude-code',CLAUDE_MODEL:'claude-sonnet-4-5',REVIEWER_PROVIDER:'codex-cli',CODEX_MODEL:'gpt-5',TESTER_PROVIDER:'mock',ORQ_DEFAULT_TASK_BUDGET_USD:'0.5'});
  try{
    const overview=(await api(server,'GET','/api/self-repair')).body;
    assert.equal(overview.mode.mode,'real');assert.ok(overview.mode.costly.length>=1);
    const noConfirm=await api(server,'POST','/api/self-repair/repairs',{prompt:'Corrigir algo no Orquestradoria'});
    assert.equal(noConfirm.status,409);assert.equal(noConfirm.body.code,'spend_confirmation_required');
    assert.equal(noConfirm.body.requiresConfirmation,true);assert.ok(noConfirm.body.budget.taskBudgetUsd>0);
    assert.equal((await api(server,'GET','/api/self-repair')).body.repairs.length,0,'nenhuma task foi criada');
    assert.equal(existsSync(join(tmp,'worktrees'))?(execFileSync('node',['-e',`console.log(require('fs').readdirSync(${JSON.stringify(join(tmp,'worktrees'))}).length)`],{encoding:'utf8'}).trim()):'0','0','nenhum worktree foi criado');
    assert.deepEqual(snapshotOf(orq),before);
    assert.equal(alive(server.pid),true);
  }finally{
    await server.stop();
    for(const dir of [tmp,orq])try{rmSync(dir,{recursive:true,force:true});}catch{/* melhor esforço */}
  }
});

test('problemas detectados: falha simulada → detecção sem créditos → diagnóstico e prompt automáticos → correção só no worktree → aprovação manual',{timeout:240000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orq-selfrepair-prob-'));
  const orq=fakeOrquestradoria();const other=mkdtempSync(join(tmpdir(),'orq-other-'));
  git(other,'init','-q','-b','main');git(other,'config','user.email','o@example.test');git(other,'config','user.name','o');writeFileSync(join(other,'README.md'),'x');git(other,'add','.');git(other,'commit','-q','-m','init');
  const before=snapshotOf(orq);
  const server=await startServer(tmp,{...MOCK_ENV,ORQ_SELF_REPO:orq,ORQ_TEST_FIXTURE_EDITS:JSON.stringify([{file:'src/sum.js',find:'a - b; // BUG simulado: deveria somar',replace:'a + b;'}])});
  const {default:Database}=await import('better-sqlite3');
  try{
    // ---- falha simulada: duas tasks falham com o mesmo timeout do provider; uma terceira falhou mas foi retomada e aprovada
    const ws=(await api(server,'POST','/api/workspaces',{name:'Projeto qualquer',location:other})).body;
    const mk=async(title:string)=>(await api(server,'POST',`/api/workspaces/${ws.id}/tasks`,{title,description:'d'})).body.id as string;
    const [a,b,healthy]=[await mk('Criar tela A'),await mk('Criar tela B'),await mk('Criar tela C')];
    const sqlite=new Database(join(tmp,'self.db'));
    const fail=(taskId:string,status:string,env:string)=>{sqlite.prepare('UPDATE tasks SET status=?,environmentStatus=?,updatedAt=? WHERE id=?').run(status,env,new Date().toISOString(),taskId);sqlite.prepare("INSERT INTO executions (id,taskId,role,provider,model,status,startedAt,finishedAt,error) VALUES (?,?,'developer','claude-code','claude-sonnet',?,?,?,?)").run(`sim-${taskId}`,taskId,'failed',new Date().toISOString(),new Date().toISOString(),`Claude Code timed out after 180000ms (token=segredo-${taskId})`);};
    fail(a,'failed','failed_preserved');fail(b,'failed','failed_preserved');fail(healthy,'approved','approved_waiting_action');
    sqlite.close();
    const tasksBefore=(await api(server,'GET','/api/self-repair')).body.diagnosableTasks.length;

    // ---- detecção: sem IA, sem créditos, sem criar nada
    const list=(await api(server,'GET','/api/self-repair/problems')).body;
    assert.equal(list.credits,'none');assert.equal(list.problems.length,1,JSON.stringify(list.problems.map((p:any)=>p.title)));
    const problem=list.problems[0];
    assert.equal(problem.category,'timeout');assert.equal(problem.status,'confirmed');assert.equal(problem.occurrences,2);assert.deepEqual(problem.taskIds.sort(),[a,b].sort());
    assert.equal(problem.taskIds.includes(healthy),false,'task aprovada não conta');assert.match(problem.probableCause,/limite de tempo/);
    assert.equal(JSON.stringify(list).includes('segredo-'),false);
    assert.equal((await api(server,'GET',`/api/self-repair/problems?taskId=${a}`)).body.problems.length,1,'a task com problema aponta para ele (botão Investigar)');
    assert.equal((await api(server,'GET',`/api/self-repair/problems?taskId=${healthy}`)).body.problems.length,0);
    assert.equal((await api(server,'GET','/api/self-repair')).body.repairs.length,0);
    assert.equal(existsSync(join(tmp,'worktrees'))?1:0,0,'nenhum worktree criado só por detectar');

    // ---- diagnóstico e prompt montados automaticamente (também sem créditos)
    const built=(await api(server,'POST',`/api/self-repair/problems/${problem.id}/prompt`,{})).body;
    assert.equal(built.credits,'none');assert.ok([a,b].includes(built.sourceTaskId));assert.ok(built.diagnosis.chars>0);
    assert.match(built.prompt,/Timeout do provider \(developer\)/);assert.match(built.prompt,/problema CONFIRMADO por evidência direta/);assert.match(built.prompt,/Claude Code timed out after/);
    assert.equal(built.prompt.includes('segredo-'),false);
    assert.equal((await api(server,'GET','/api/self-repair')).body.repairs.length,0,'montar o prompt não executa nada');

    // ---- execução (mock, sem custo) a partir do problema, só no worktree isolado
    const created=await api(server,'POST','/api/self-repair/repairs',{prompt:built.prompt,sourceTaskId:built.sourceTaskId,problemId:problem.id});
    assert.equal(created.status,202,JSON.stringify(created.body));const id=created.body.taskId;
    const done=await until(async()=>(await api(server,'GET',`/api/self-repair/repairs/${id}`)).body,d=>d?.task?.status==='approved'||d?.task?.status==='failed','pipeline do Mock concluir');
    assert.equal(done.task.status,'approved');assert.equal(done.repair.problemId,problem.id);assert.equal(done.safety.isolated,true);
    assert.equal(snapshotOf(orq).sum,before.sum,'a instância continua intacta');assert.equal(snapshotOf(orq).head,before.head);
    assert.match(readFileSync(join(resolve(done.task.worktreePath),'src','sum.js'),'utf8'),/a \+ b/);

    // ---- sem alerta duplicado e sem investigação repetida
    const after=(await api(server,'GET','/api/self-repair/problems')).body.problems;
    assert.equal(after.length,1,'o problema continua sendo um só');assert.equal(after[0].investigation.taskId,id);
    const again=await api(server,'POST','/api/self-repair/repairs',{prompt:built.prompt,sourceTaskId:built.sourceTaskId,problemId:problem.id});
    assert.equal(again.status,409);assert.equal(again.body.code,'already_investigating');assert.equal((await api(server,'GET','/api/self-repair')).body.repairs.length,1);
    assert.equal((await api(server,'POST',`/api/tasks/${id}/apply`,{})).body.code,'self_repair_apply_blocked');

    // ---- histórico, aprovação e merge manual preservados
    const approved=await api(server,'POST',`/api/self-repair/repairs/${id}/approve`,{});
    assert.equal(approved.status,200);assert.equal(approved.body.merged,false);assert.match(approved.body.instructions.merge.join(' '),/merge --no-ff/);
    {const now=snapshotOf(orq);assert.deepEqual({...now,branches:[]},{...before,branches:[]},'repositório idêntico depois de aprovar (a branch da task existe, mas não é a atual)');assert.ok(now.branches.length===before.branches.length+1);}
    assert.equal((await api(server,'GET',`/api/self-repair/repairs/${id}`)).body.repair.decision,'approved');
    assert.equal((await api(server,'GET','/api/self-repair')).body.diagnosableTasks.length>=tasksBefore,true);
    assert.equal(alive(server.pid),true);assert.equal((await fetch(`${server.base}/health`)).ok,true);
  }finally{
    await server.stop();
    for(const dir of [tmp,orq,other])try{rmSync(dir,{recursive:true,force:true});}catch{/* melhor esforço */}
  }
});

// =====================================================================================================
// Infraestrutura: Tester roda o typecheck do repositório no worktree e mostra o erro; o worktree é preservado
// =====================================================================================================
function fakeOrqWithTypecheck(){
  const root=fakeOrquestradoria();
  mkdirSync(join(root,'scripts'),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fake-orquestradoria',version:'0.0.0',private:true,scripts:{test:'node --test',typecheck:'node scripts/typecheck.js'}}));
  writeFileSync(join(root,'scripts','typecheck.js'),[
    "const {readFileSync}=require('node:fs');",
    "process.stdout.write('verificando '+'.'.repeat(30000)+'\\nFIM-DA-SAIDA-PADRAO\\n');",
    "if(readFileSync('src/sum.js','utf8').includes('a - b')){process.stderr.write('\\u001b[31merror TS2362\\u001b[0m: src/sum.js(1,29): o operador - foi usado onde + era esperado\\nFound 1 error in src/sum.js:1\\n');process.exit(2);}",
    "console.log('typecheck ok');"].join('\n'));
  git(root,'add','.');git(root,'commit','-q','-m','typecheck script');
  return root;
}

test('autocorreção: o Tester roda o typecheck real no worktree, mostra comando/stdout/stderr, e o trabalho do Developer é preservado',{timeout:240000},async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'orq-selfrepair-tc-'));
  const orq=fakeOrqWithTypecheck();const before=snapshotOf(orq);
  // O Developer de teste só altera um comentário (não corrige o bug): o typecheck real precisa falhar.
  const server=await startServer(tmp,{...MOCK_ENV,TESTER_PROVIDER:'command-tester',ORQ_SELF_REPO:orq,ORQ_TEST_FIXTURE_EDITS:JSON.stringify([{file:'src/sum.js',find:'// BUG simulado: deveria somar',replace:'// revisado, ainda sem corrigir'}])});
  try{
    const created=await api(server,'POST','/api/self-repair/repairs',{prompt:'Corrigir o bug de soma. Contexto antigo: login e upload em PHP com listagem na conferência.\nCritérios de aceite:\n- O motorista entra com login'});
    assert.equal(created.status,202,JSON.stringify(created.body));const id=created.body.taskId;
    const settled=await until(async()=>(await api(server,'GET',`/api/self-repair/repairs/${id}`)).body,d=>Boolean(d?.task)&&!d.task.running&&['approved','failed','needs_input','needs_manual_review','stalled'].includes(d.task.status),'pipeline terminar',150000);
    assert.notEqual(settled.task.status,'approved','o typecheck real reprovou, então não pode aprovar');

    // erro detalhado do typecheck: comando completo, código, stdout e stderr (sem cores, com o fim da saída)
    const typecheck=settled.tests.commands.find((c:any)=>c.label==='typecheck');
    assert.ok(typecheck,JSON.stringify(settled.tests));
    assert.equal(typecheck.status,'failed');assert.equal(typecheck.command,'npm run typecheck');assert.ok(typecheck.exitCode===1||typecheck.exitCode===2);
    assert.equal(resolve(typecheck.cwd),resolve(settled.task.worktreePath),'o typecheck rodou no worktree, não na instância');
    assert.match(typecheck.stderr,/error TS2362: src\/sum\.js\(1,29\): o operador - foi usado onde \+ era esperado/);assert.match(typecheck.stderr,/Found 1 error in src\/sum\.js:1/);
    assert.equal(typecheck.stderr.includes('\u001b'),false);assert.match(typecheck.stdout,/FIM-DA-SAIDA-PADRAO\s*$/);

    // preparação de dependências registrada (sem pnpm-lock no repositório de teste, nada a instalar) antes do Tester
    assert.ok(settled.dependencies,'evento de dependências registrado');assert.equal(settled.dependencies.status,'skipped');assert.match(settled.dependencies.reason,/pnpm-lock\.yaml/);

    // o logs/requisitos antigos do pedido não viraram validação de fluxo PHP: a única reprovação é o typecheck
    assert.equal(settled.tests.functionalFlows,undefined);assert.equal(settled.tests.notes.some((n:string)=>/Fluxo obrigatório/.test(n)),false);

    // o worktree e o trabalho do Developer foram preservados (nada descartado automaticamente)
    const worktree=resolve(settled.task.worktreePath);
    assert.equal(existsSync(worktree),true);assert.match(readFileSync(join(worktree,'src','sum.js'),'utf8'),/revisado, ainda sem corrigir/);
    assert.match(String(settled.task.environmentStatus),/preserved|active/);assert.notEqual(settled.task.environmentStatus,'discarded');assert.equal(settled.repair.decision,null);
    assert.equal(settled.actions.canDiscard,true,'descartar continua sendo escolha do usuário');

    // a instância em execução e o servidor intactos
    const after=snapshotOf(orq);
    assert.equal(after.sum,before.sum);assert.equal(after.head,before.head);assert.equal(after.status,'');assert.equal(after.branch,'main');
    assert.equal(alive(server.pid),true);assert.equal((await fetch(`${server.base}/health`)).ok,true);
  }finally{
    await server.stop();
    for(const dir of [tmp,orq])try{rmSync(dir,{recursive:true,force:true});}catch{/* melhor esforço */}
  }
});
