import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {nanoid} from 'nanoid';
import type Database from 'better-sqlite3';
import type {Express} from 'express';
import type {BudgetSettings,SpendStatus} from './spend-limits.js';
import {buildProblemPrompt,detectProblems} from './self-repair-detect.js';

/**
 * Centro de Autocorreção: diagnosticar, corrigir e evoluir o PRÓPRIO Orquestradoria.
 *
 * Garantias (todas verificadas por testes):
 *  - toda correção é uma task do pipeline existente (Planner → Developer → Tester → Reviewer) executada num WORKTREE
 *    isolado do repositório do Orquestradoria; a instância em execução (o diretório do repositório) nunca é alterada;
 *  - "aprovar" apenas marca a decisão e mostra os comandos para o humano revisar e mesclar; nada é aplicado, mesclado,
 *    publicado, reiniciado ou alterado na main automaticamente (o Apply genérico fica bloqueado para essas tasks);
 *  - nenhum crédito real é consumido sem confirmação explícita e dentro dos limites de orçamento.
 */
export const SELF_REPAIR_WORKSPACE_NAME='Orquestradoria (autocorreção)';
export const SELF_REPAIR_PIPELINE=['planner','developer','tester','reviewer'];
export const MAX_PROMPT_CHARS=8000;
const MAX_BUNDLE_CHARS=24000;

type Handler=(req:any,res:any)=>unknown;
export interface SelfRepairContext{
  app:Express;db:Database.Database;
  repoRoot:()=>string|null;
  now:()=>string;
  emit:(type:string,data:Record<string,unknown>,taskId?:string)=>void;
  audit:(action:string,metadata:Record<string,unknown>,taskId?:string)=>void;
  handlers:{createTask:Handler;runTask:Handler;requestChanges:Handler;discard:Handler;mode:Handler;costEstimate:Handler};
  diff:(task:any,workspace:any)=>any;
  canRequestAdjustment:(task:any,hasAttention:boolean)=>{ok:boolean;reason?:string};
  attention:(taskId:string)=>unknown;
  running:{has:(id:string)=>boolean};
  budget:{load:()=>BudgetSettings;spend:()=>SpendStatus;effectiveTaskBudget:(requested:unknown,paid:boolean)=>number};
}

// ---------- utilidades ----------
export function callHandler(handler:Handler,req:Record<string,unknown>):Promise<{status:number;body:any}>{
  return new Promise(resolveCall=>{
    let status=200,done=false;
    const finish=(body:unknown)=>{if(done)return;done=true;resolveCall({status,body});};
    const res:any={status(code:number){status=code;return res;},json(body:unknown){finish(body);return res;},send(body:unknown){finish(body);return res;},sendStatus(code:number){status=code;finish({});return res;},setHeader(){return res;},end(){finish({});}};
    Promise.resolve().then(()=>handler({headers:{},query:{},params:{},body:{},...req},res)).then(()=>{setImmediate(()=>finish({}));}).catch(error=>{status=500;finish({error:String((error as Error)?.message||error)});});
  });
}

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
export function selfRepairRepoRoot(env:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):string|null{
  try{return resolve(env.ORQ_SELF_REPO||git(cwd,'rev-parse','--show-toplevel'));}catch{return null;}
}
export function repoState(root:string):{branch:string;headSha:string}{
  let branch='main',headSha='';
  try{branch=git(root,'rev-parse','--abbrev-ref','HEAD')||'main';if(branch==='HEAD')branch='main';}catch{/* sem commits */}
  try{headSha=git(root,'rev-parse','HEAD');}catch{/* sem commits */}
  return{branch,headSha};
}

const SECRET_KEY=/(pass(?:word|wd)?|secret|token|api[_-]?key|authorization|bearer|credential|private[_-]?key|cookie)/i;
/** Remove valores sensíveis do texto que vai para o prompt (chave=valor, "chave":"valor" e tokens longos conhecidos). */
export function redact(text:string):string{
  return String(text)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g,'$1 [REDACTED]')
    .replace(/("?[A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|authorization|credential|private[_-]?key|cookie)[A-Za-z0-9_.-]*"?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;}&]+)/gi,(_m,key)=>`${key}[REDACTED]`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,'Bearer [REDACTED]')
    .replace(/\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/g,'[REDACTED]');
}
const clip=(value:unknown,max:number)=>{const text=typeof value==='string'?value:JSON.stringify(value??'');return text.length>max?`${text.slice(0,max)}…[+${text.length-max} caracteres]`:text;};
const parse=(value:unknown)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return undefined;}};

// ---------- tabelas e workspace ----------
export function ensureSelfRepairTables(db:Database.Database){
  db.exec('CREATE TABLE IF NOT EXISTS self_repairs (taskId TEXT PRIMARY KEY,workspaceId TEXT NOT NULL,sourceTaskId TEXT,prompt TEXT NOT NULL,mode TEXT NOT NULL,spendConfirmedAt TEXT,repoHeadAtCreate TEXT,baseBranch TEXT,decision TEXT,decidedAt TEXT,decisionNote TEXT,createdAt TEXT NOT NULL)');
  if(!(db.prepare('PRAGMA table_info(self_repairs)').all() as any[]).some(column=>column.name==='problemId'))db.exec('ALTER TABLE self_repairs ADD COLUMN problemId TEXT');
}
export function ensureSelfWorkspace(db:Database.Database,root:string,branch:string,now:string):any{
  const location=resolve(root);
  const existing:any=(db.prepare('SELECT * FROM workspaces WHERE name=?').all(SELF_REPAIR_WORKSPACE_NAME) as any[]).find(row=>resolve(String(row.location))===location);
  if(existing){
    if(existing.branch!==branch)db.prepare('UPDATE workspaces SET branch=?,updatedAt=? WHERE id=?').run(branch,now,existing.id);
    return{...existing,branch};
  }
  const id=nanoid();
  db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,taskBudgetUsd,monthlyBudgetUsd,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,SELF_REPAIR_WORKSPACE_NAME,'local',location,branch,'active',0,0,now,now);
  return db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
}
export const isSelfRepairTask=(db:Database.Database,taskId:string)=>{try{return Boolean(db.prepare('SELECT 1 FROM self_repairs WHERE taskId=?').get(taskId));}catch{return false;}};
export const isSelfRepairWorkspace=(db:Database.Database,workspaceId:string)=>{try{return Boolean(db.prepare('SELECT 1 FROM workspaces WHERE id=? AND name=?').get(workspaceId,SELF_REPAIR_WORKSPACE_NAME));}catch{return false;}};

// ---------- diagnóstico automático de uma task ----------
export interface DiagnosisBundle{text:string;sections:Array<{name:string;chars:number}>;truncated:boolean}
export function buildDiagnosisBundle(db:Database.Database,taskId:string,maxChars=MAX_BUNDLE_CHARS):DiagnosisBundle|null{
  const task:any=db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if(!task)return null;
  const workspace:any=db.prepare('SELECT name,location,branch FROM workspaces WHERE id=?').get(task.workspaceId);
  const sections:Array<{name:string;text:string}>=[];
  const snapshot:any=parse(task.configSnapshot)||{};
  sections.push({name:'Task',text:[`id: ${task.id}`,`título: ${task.title}`,`workspace: ${workspace?.name||task.workspaceId} (branch ${workspace?.branch||'?'})`,`status: ${task.status} · etapa atual: ${task.currentStage||'-'} · último estágio concluído: ${task.lastSuccessfulStage||'-'}`,`ambiente: ${task.environmentStatus||'-'}${task.environmentWarning?` (${task.environmentWarning})`:''}`,`providers: ${(snapshot.agentConfigs||[]).map((c:any)=>`${c.role}=${c.provider}/${c.model}`).join(', ')||'-'}`,`descrição: ${clip(task.description,1500)}`].join('\n')});
  try{
    const attention:any=db.prepare('SELECT * FROM task_attention WHERE taskId=?').get(taskId);
    if(attention)sections.push({name:'Atenção pendente',text:clip({reason:attention.reason,questions:parse(attention.questions),details:parse(attention.details)},1500)});
  }catch{/* tabela ausente */}
  try{
    const executions=(db.prepare('SELECT * FROM executions WHERE taskId=? ORDER BY startedAt DESC LIMIT 8').all(taskId) as any[]).reverse();
    sections.push({name:'Execuções',text:executions.map(e=>{
      const result:any=parse(e.structuredResult)||{};
      const parts=[`[${e.role}] ${e.provider}/${e.model} → ${e.status}${e.error?` · erro: ${clip(e.error,400)}`:''}${e.progressMessage?` · ${clip(e.progressMessage,120)}`:''}`];
      if(result.summary)parts.push(`  resumo: ${clip(result.summary,500)}`);
      if(Array.isArray(result.notes)&&result.notes.length)parts.push(`  notas: ${clip(result.notes.slice(0,8),700)}`);
      if(Array.isArray(result.issues)&&result.issues.length)parts.push(`  problemas do revisor: ${clip(result.issues.slice(0,6),900)}`);
      if(Array.isArray(result.commands))parts.push(`  comandos do tester: ${result.commands.slice(0,8).map((c:any)=>`${c.label}=${c.status}${c.status!=='passed'?` (código ${c.exitCode}; ${clip(c.stderr||'',200)})`:''}`).join('; ')}`);
      if(result.functionalFlows?.required)parts.push(`  fluxos obrigatórios: ${clip(result.functionalFlows.required,500)}`);
      if(Array.isArray(result.permissionDenials)&&result.permissionDenials.length)parts.push(`  comandos recusados: ${clip(result.permissionDenials.slice(0,5),400)}`);
      if(e.stderr)parts.push(`  stderr (final): ${clip(String(e.stderr).slice(-1200),1200)}`);
      return parts.join('\n');
    }).join('\n')});
  }catch{/* sem execuções */}
  try{
    const events=(db.prepare('SELECT type,payload,createdAt FROM events WHERE taskId=? ORDER BY createdAt DESC LIMIT 40').all(taskId) as any[]).reverse();
    sections.push({name:'Eventos recentes',text:events.map(e=>`${e.createdAt} ${e.type} ${clip(parse(e.payload)?.data??parse(e.payload),220)}`).join('\n')});
  }catch{/* sem eventos */}
  try{
    const audit=(db.prepare('SELECT action,metadata,timestamp FROM audit_logs WHERE taskId=? ORDER BY timestamp DESC LIMIT 20').all(taskId) as any[]).reverse();
    sections.push({name:'Auditoria',text:audit.map(a=>`${a.timestamp} ${a.action} ${clip(parse(a.metadata),200)}`).join('\n')});
  }catch{/* sem auditoria */}
  let body='',truncated=false;const used:Array<{name:string;chars:number}>=[];
  for(const section of sections){
    const block=`### ${section.name}\n${redact(section.text)}\n\n`;
    if(body.length+block.length>maxChars){const room=Math.max(0,maxChars-body.length);if(room>200){body+=block.slice(0,room)+'\n…[truncado]\n';used.push({name:section.name,chars:room});}truncated=true;break;}
    body+=block;used.push({name:section.name,chars:block.length});
  }
  return{text:body.trim(),sections:used,truncated};
}

export function composeRepairDescription(input:{prompt:string;bundle?:DiagnosisBundle|null;sourceTitle?:string;repo:{root:string;branch:string}}):string{
  const lines=[
    'AUTOCORREÇÃO DO ORQUESTRADORIA',
    `Esta task altera o código do PRÓPRIO Orquestradoria, num worktree isolado do repositório (branch base ${input.repo.branch}). A instância em execução NÃO deve ser alterada, parada nem reiniciada.`,
    'Regras: trabalhe somente neste worktree; não inicie serviços permanentes (pnpm dev, servidores); não faça commit, push, merge, deploy nem altere a main; não leia nem copie segredos; faça a menor mudança que resolva o problema, no lugar dos arquivos existentes (não recrie arquivos); acrescente ou ajuste testes; rode build, typecheck e testes quando possível e descreva o resultado real.',
    '',
    'Pedido:',
    input.prompt.trim()||`Diagnosticar e corrigir a falha da task "${input.sourceTitle||''}".`
  ];
  if(input.bundle){lines.push('','Diagnóstico automático coletado da task analisada (logs, erros, eventos e contexto; segredos removidos):',input.bundle.text);if(input.bundle.truncated)lines.push('(o diagnóstico foi truncado para caber no limite)');}
  return lines.join('\n');
}

export function repairInstructions(task:{taskBranch?:string|null;worktreePath?:string|null;baseBranch?:string|null},root:string){
  const branch=task.taskBranch||'<branch da task>',base=task.baseBranch||'main';
  return{
    note:'Nada foi mesclado, aplicado, publicado ou reiniciado. Os comandos abaixo são para VOCÊ executar, depois de revisar.',
    review:[`git -C "${root}" diff ${base}...${branch}`,`git -C "${root}" log ${base}..${branch} --stat`],
    verify:['pnpm install --frozen-lockfile','pnpm build','pnpm typecheck','pnpm test'].map(command=>`(no worktree ${task.worktreePath||'da task'}) ${command}`),
    merge:[`git -C "${root}" switch ${base}`,`git -C "${root}" merge --no-ff ${branch}`],
    afterMerge:'Reinicie a API e a interface manualmente quando quiser usar a correção.'
  };
}

// ---------- rotas ----------
export function registerSelfRepairRoutes(ctx:SelfRepairContext){
  const {app,db}=ctx;
  ensureSelfRepairTables(db);
  const send=(res:any,status:number,body:unknown)=>res.status(status).json(body);
  const unavailable=(res:any)=>send(res,503,{code:'self_repair_unavailable',error:'Não foi possível localizar o repositório do Orquestradoria (git). Defina ORQ_SELF_REPO com o caminho do repositório.'});

  const context=()=>{
    const root=ctx.repoRoot();if(!root)return null;
    const state=repoState(root);
    if(!state.headSha)return null;
    const workspace=ensureSelfWorkspace(db,root,state.branch,ctx.now());
    return{root,state,workspace};
  };
  const repairOf=(id:string)=>{
    const repair:any=db.prepare('SELECT * FROM self_repairs WHERE taskId=?').get(id);
    const task:any=repair?db.prepare('SELECT * FROM tasks WHERE id=?').get(id):null;
    return repair&&task?{repair,task}:null;
  };

  /** Modo e custo: nada de crédito real sem confirmação, e sempre dentro dos limites. */
  async function spendGate(workspaceId:string,body:any){
    const mode=(await callHandler(ctx.handlers.mode,{query:{workspaceId}})).body||{};
    const paid=mode.mode==='real';
    const settings=ctx.budget.load(),spend=ctx.budget.spend();
    const estimateResponse=paid?await callHandler(ctx.handlers.costEstimate,{query:{workspaceId,size:'medium',steps:'1'}}):null;
    const taskBudgetUsd=ctx.budget.effectiveTaskBudget(body?.taskBudgetUsd,paid);
    const info={mode:paid?'real':'mock',costly:mode.costly||[],summary:mode.summary||'',estimate:estimateResponse?.status===200?estimateResponse.body:null,budget:{...settings,taskBudgetUsd,spend},requiresConfirmation:paid};
    if(!paid)return{ok:true as const,info,paid};
    if(spend.blocked)return{ok:false as const,status:409,body:{code:'budget_blocked',error:spend.message||'Limite de gasto atingido.',...info}};
    if(body?.confirmSpend!==true)return{ok:false as const,status:409,body:{code:'spend_confirmation_required',error:'Esta autocorreção usará providers pagos (créditos reais). Confirme para continuar.',...info}};
    if(!(taskBudgetUsd>0))return{ok:false as const,status:409,body:{code:'task_budget_required',error:'Defina um orçamento maior que zero para a task antes de consumir créditos reais.',...info}};
    return{ok:true as const,info,paid,taskBudgetUsd};
  }

  app.get('/api/self-repair',async(_req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const modeInfo=(await callHandler(ctx.handlers.mode,{query:{workspaceId:c.workspace.id}})).body||{};
    const repairs=(db.prepare('SELECT r.*,t.title,t.status,t.currentStage,t.environmentStatus,t.updatedAt AS taskUpdatedAt FROM self_repairs r JOIN tasks t ON t.id=r.taskId ORDER BY r.createdAt DESC LIMIT 50').all() as any[]);
    const tasks=(db.prepare('SELECT t.id,t.title,t.status,t.updatedAt,w.name AS workspaceName FROM tasks t JOIN workspaces w ON w.id=t.workspaceId WHERE t.workspaceId<>? ORDER BY t.updatedAt DESC LIMIT 40').all(c.workspace.id) as any[]);
    send(res,200,{
      available:true,workspace:{id:c.workspace.id,name:c.workspace.name,location:c.root,branch:c.state.branch},
      instance:{repoRoot:c.root,branch:c.state.branch,headSha:c.state.headSha,pid:process.pid,startedAt:new Date(Date.now()-process.uptime()*1000).toISOString()},
      mode:{mode:modeInfo.mode||'mock',costly:modeInfo.costly||[],summary:modeInfo.summary||'',forced:Boolean(modeInfo.forced)},
      budget:{settings:ctx.budget.load(),spend:ctx.budget.spend()},
      isolation:{worktreeRequired:true,isolationMode:process.env.TASK_ISOLATION_MODE==='current-workspace'?'current-workspace':'worktree'},
      repairs:repairs.map(r=>({taskId:r.taskId,title:r.title,status:r.status,currentStage:r.currentStage,environmentStatus:r.environmentStatus,decision:r.decision,mode:r.mode,sourceTaskId:r.sourceTaskId,createdAt:r.createdAt,updatedAt:r.taskUpdatedAt})),
      diagnosableTasks:tasks,
      problemSummary:(()=>{const list=detectProblems(db,{running:ctx.running});return{confirmed:list.filter(p=>p.status==='confirmed').length,suspected:list.filter(p=>p.status==='suspected').length};})()
    });
  });

  app.post('/api/self-repair/estimate',async(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const sourceTaskId=typeof req.body?.sourceTaskId==='string'&&req.body.sourceTaskId?req.body.sourceTaskId:null;
    const bundle=sourceTaskId?buildDiagnosisBundle(db,sourceTaskId):null;
    if(sourceTaskId&&!bundle)return send(res,404,{code:'source_task_not_found',error:'A task a diagnosticar não foi encontrada.'});
    const gate=await spendGate(c.workspace.id,req.body);
    const info=gate.ok?gate.info:(gate.body as any);
    send(res,200,{...info,diagnosis:bundle?{sections:bundle.sections,chars:bundle.text.length,truncated:bundle.truncated}:null,code:undefined,error:undefined});
  });

  /** Problemas detectados: só leitura do que o Orquestradoria já registrou; nenhuma IA, nenhum crédito. */
  app.get('/api/self-repair/problems',(req,res)=>{
    const taskId=typeof req.query.taskId==='string'&&req.query.taskId?req.query.taskId:null;
    const all=detectProblems(db,{running:ctx.running});
    const problems=taskId?all.filter(problem=>problem.taskIds.includes(taskId)):all;
    send(res,200,{generatedAt:ctx.now(),credits:'none',confirmed:problems.filter(p=>p.status==='confirmed').length,suspected:problems.filter(p=>p.status==='suspected').length,problems});
  });
  app.post('/api/self-repair/problems/:problemId/prompt',(req,res)=>{
    const problem=detectProblems(db,{running:ctx.running}).find(item=>item.id===req.params.problemId);
    if(!problem)return send(res,404,{code:'problem_not_found',error:'Este problema não é mais detectado (talvez já tenha sido resolvido).'});
    const built=buildProblemPrompt(db,problem);
    send(res,200,{credits:'none',problem:{id:problem.id,title:problem.title,status:problem.status,severity:problem.severity},prompt:built.prompt,sourceTaskId:built.sourceTaskId,diagnosis:built.bundle?{sections:built.bundle.sections,chars:built.bundle.text.length,truncated:built.bundle.truncated}:null});
  });

  app.post('/api/self-repair/repairs',async(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    if(process.env.TASK_ISOLATION_MODE==='current-workspace')return send(res,409,{code:'self_repair_requires_worktree',error:'A autocorreção só roda em worktree isolado; TASK_ISOLATION_MODE=current-workspace alteraria a instância em execução.'});
    const prompt=typeof req.body?.prompt==='string'?req.body.prompt.trim():'';
    const sourceTaskId=typeof req.body?.sourceTaskId==='string'&&req.body.sourceTaskId?req.body.sourceTaskId:null;
    if(!prompt&&!sourceTaskId)return send(res,400,{code:'prompt_required',error:'Descreva a correção ou melhoria, ou escolha uma task para diagnosticar.'});
    if(prompt.length>MAX_PROMPT_CHARS)return send(res,400,{code:'prompt_too_long',error:`O pedido deve ter no máximo ${MAX_PROMPT_CHARS} caracteres.`});
    const source:any=sourceTaskId?db.prepare('SELECT id,title FROM tasks WHERE id=?').get(sourceTaskId):null;
    if(sourceTaskId&&!source)return send(res,404,{code:'source_task_not_found',error:'A task a diagnosticar não foi encontrada.'});
    const problemId=typeof req.body?.problemId==='string'&&req.body.problemId?req.body.problemId:null;
    if(problemId){
      const open:any=db.prepare("SELECT taskId FROM self_repairs WHERE problemId=? AND COALESCE(decision,'')<>'discarded' ORDER BY createdAt DESC").get(problemId);
      if(open)return send(res,409,{code:'already_investigating',error:'Este problema já está em investigação. Abra a correção existente ou descarte-a antes de investigar de novo.',taskId:open.taskId});
    }
    const gate=await spendGate(c.workspace.id,req.body);
    if(!gate.ok)return send(res,gate.status,gate.body);
    const bundle=sourceTaskId?buildDiagnosisBundle(db,sourceTaskId):null;
    const description=composeRepairDescription({prompt,bundle,sourceTitle:source?.title,repo:{root:c.root,branch:c.state.branch}});
    const titleBase=(prompt.split(/\r?\n/)[0]||`Diagnóstico de "${source?.title||''}"`).slice(0,90);
    const created=await callHandler(ctx.handlers.createTask,{params:{workspaceId:c.workspace.id},body:{title:`Autocorreção: ${titleBase}`,description,pipeline:SELF_REPAIR_PIPELINE,taskBudgetUsd:gate.paid?(gate as any).taskBudgetUsd:0}});
    if(created.status>=300||!created.body?.id)return send(res,created.status>=400?created.status:500,{code:'self_repair_create_failed',error:created.body?.error||'Não foi possível criar a task de autocorreção.'});
    const task=created.body;
    if(task.isolationMode!=='worktree'){
      db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
      return send(res,409,{code:'self_repair_requires_worktree',error:'A task não foi criada em worktree isolado; a autocorreção foi recusada.'});
    }
    db.prepare('INSERT INTO self_repairs (taskId,workspaceId,sourceTaskId,prompt,mode,spendConfirmedAt,repoHeadAtCreate,baseBranch,createdAt,problemId) VALUES (?,?,?,?,?,?,?,?,?,?)').run(task.id,c.workspace.id,sourceTaskId,prompt||`(diagnóstico de ${source?.title})`,gate.info.mode,gate.paid?ctx.now():null,c.state.headSha,c.state.branch,ctx.now(),problemId);
    ctx.audit('self_repair.created',{taskId:task.id,sourceTaskId,mode:gate.info.mode,spendConfirmed:gate.paid,taskBudgetUsd:gate.paid?(gate as any).taskBudgetUsd:0,repoHead:c.state.headSha,baseBranch:c.state.branch,diagnosisChars:bundle?.text.length||0},task.id);
    ctx.emit('self_repair.created',{mode:gate.info.mode,sourceTaskId},task.id);
    const started=await callHandler(ctx.handlers.runTask,{params:{id:task.id}});
    if(started.status>=300)return send(res,started.status,{code:'self_repair_start_failed',error:started.body?.error||'Não foi possível iniciar a execução.',taskId:task.id});
    send(res,202,{accepted:true,taskId:task.id,mode:gate.info.mode,safety:'A correção roda num worktree isolado; nada é mesclado, aplicado, publicado ou reiniciado automaticamente.'});
  });

  app.get('/api/self-repair/repairs/:id',(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const found=repairOf(req.params.id);if(!found)return res.sendStatus(404);
    const {repair,task}=found;
    const executions=(db.prepare('SELECT * FROM executions WHERE taskId=? ORDER BY startedAt').all(task.id) as any[]).map(e=>({...e,structuredResult:parse(e.structuredResult)}));
    const tester=[...executions].reverse().find(e=>e.role==='tester');const reviewer=[...executions].reverse().find(e=>e.role==='reviewer');
    const audits=(db.prepare('SELECT action,metadata,timestamp FROM audit_logs WHERE taskId=? ORDER BY timestamp').all(task.id) as any[]).map(a=>({action:a.action,at:a.timestamp,metadata:parse(a.metadata)}));
    let files:any={files:[],added:[],modified:[],deleted:[],truncated:false};
    try{const d=ctx.diff(task,c.workspace);files={files:(d.files||[]).map((f:any)=>typeof f==='string'?f:f.path),added:d.added||[],modified:d.modified||[],deleted:d.deleted||[],truncated:Boolean(d.truncated)};}catch{/* worktree ainda não existe ou foi removido */}
    const live=repoState(c.root);
    const testResult:any=tester?.structuredResult;
    const reviewResult:any=reviewer?.structuredResult;
    const adjustable=ctx.canRequestAdjustment(task,Boolean(ctx.attention(task.id)));
    const approvable=!repair.decision&&task.status==='approved'&&task.environmentStatus==='approved_waiting_action';
    send(res,200,{
      repair:{taskId:repair.taskId,problemId:repair.problemId,sourceTaskId:repair.sourceTaskId,prompt:repair.prompt,mode:repair.mode,decision:repair.decision,decidedAt:repair.decidedAt,spendConfirmedAt:repair.spendConfirmedAt,createdAt:repair.createdAt},
      task:{id:task.id,title:task.title,status:task.status,currentStage:task.currentStage,environmentStatus:task.environmentStatus,taskBranch:task.taskBranch,worktreePath:task.worktreePath,baseBranch:task.baseBranch,baseCommitSha:task.baseCommitSha,updatedAt:task.updatedAt,running:ctx.running.has(task.id)},
      stages:executions.map(e=>({role:e.role,status:e.status,provider:e.provider,model:e.model,startedAt:e.startedAt,finishedAt:e.finishedAt,error:e.error||undefined,summary:e.structuredResult?.summary})),
      tests:testResult?{status:testResult.status,summary:testResult.summary,commands:(testResult.commands||[]).map((x:any)=>({label:x.label,status:x.status,exitCode:x.exitCode})),notes:(testResult.notes||[]).slice(0,20),functionalFlows:testResult.functionalFlows?{status:testResult.functionalFlows.status,required:testResult.functionalFlows.required}:undefined}:null,
      review:reviewResult?{status:reviewResult.status,summary:reviewResult.summary,issues:reviewResult.issues||[]}:null,
      files,
      adjustments:audits.filter(a=>a.action==='task.adjustment_requested'&&a.metadata?.feedbackChars!==undefined).map(a=>({at:a.at,round:a.metadata?.round,chars:a.metadata?.feedbackChars})),
      history:audits.filter((a,i,all)=>all.findIndex(b=>b.action===a.action&&b.at.slice(0,19)===a.at.slice(0,19))===i).map(a=>({at:a.at,action:a.action})),
      safety:{
        isolated:task.isolationMode==='worktree'&&Boolean(task.worktreePath)&&resolve(String(task.worktreePath))!==resolve(c.root),
        worktreeOutsideLiveCheckout:Boolean(task.worktreePath)&&resolve(String(task.worktreePath))!==resolve(c.root),
        repoRoot:c.root,liveBranch:live.branch,taskBranchCheckedOutInLive:Boolean(task.taskBranch)&&live.branch===task.taskBranch,
        repoHeadAtCreate:repair.repoHeadAtCreate,repoHeadNow:live.headSha,repoHeadUnchanged:live.headSha===repair.repoHeadAtCreate,
        autoMerge:false,autoDeploy:false,autoRestart:false
      },
      actions:{canApprove:approvable,canRequestChanges:adjustable.ok&&!repair.decision,adjustReason:adjustable.ok?undefined:adjustable.reason,canDiscard:['approved_waiting_action','failed_preserved','manual_review_preserved','cleanup_failed','environment_missing','apply_conflict'].includes(String(task.environmentStatus))&&repair.decision!=='discarded'},
      instructions:repair.decision==='approved'?repairInstructions(task,c.root):undefined
    });
  });

  app.post('/api/self-repair/repairs/:id/approve',(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const found=repairOf(req.params.id);if(!found)return res.sendStatus(404);
    const {repair,task}=found;
    if(repair.decision)return send(res,409,{code:'already_decided',error:`Esta correção já foi ${repair.decision==='approved'?'aprovada':'descartada'}.`});
    if(ctx.running.has(task.id))return send(res,409,{code:'still_running',error:'A correção ainda está em execução.'});
    if(task.status!=='approved'||task.environmentStatus!=='approved_waiting_action')return send(res,409,{code:'not_approvable',error:'Só é possível aprovar uma correção que passou por Tester e Reviewer e está aguardando decisão.'});
    const note=typeof req.body?.note==='string'?req.body.note.slice(0,500):null;
    db.prepare('UPDATE self_repairs SET decision=?,decidedAt=?,decisionNote=? WHERE taskId=?').run('approved',ctx.now(),note,task.id);
    ctx.audit('self_repair.approved',{taskId:task.id,taskBranch:task.taskBranch,merged:false,deployed:false},task.id);
    ctx.emit('self_repair.approved',{taskBranch:task.taskBranch,merged:false},task.id);
    send(res,200,{ok:true,decision:'approved',merged:false,deployed:false,restarted:false,instructions:repairInstructions(task,c.root)});
  });

  app.post('/api/self-repair/repairs/:id/request-changes',async(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const found=repairOf(req.params.id);if(!found)return res.sendStatus(404);
    if(found.repair.decision==='discarded')return send(res,409,{code:'already_decided',error:'Esta correção foi descartada.'});
    const gate=await spendGate(found.task.workspaceId,req.body);
    if(!gate.ok)return send(res,gate.status,gate.body);
    const result=await callHandler(ctx.handlers.requestChanges,{params:{id:found.task.id},body:{feedback:req.body?.feedback}});
    if(result.status<300){
      db.prepare('UPDATE self_repairs SET decision=NULL,decidedAt=NULL WHERE taskId=?').run(found.task.id);
      ctx.audit('self_repair.changes_requested',{taskId:found.task.id,spendConfirmed:gate.paid},found.task.id);
    }
    send(res,result.status,result.body);
  });

  app.post('/api/self-repair/repairs/:id/discard',async(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const found=repairOf(req.params.id);if(!found)return res.sendStatus(404);
    const result=await callHandler(ctx.handlers.discard,{params:{id:found.task.id},body:{}});
    if(result.status<300){
      db.prepare('UPDATE self_repairs SET decision=?,decidedAt=? WHERE taskId=?').run('discarded',ctx.now(),found.task.id);
      ctx.audit('self_repair.discarded',{taskId:found.task.id},found.task.id);
    }
    send(res,result.status,result.body);
  });

  app.post('/api/self-repair/repairs/:id/resume',async(req,res)=>{
    const c=context();if(!c)return unavailable(res);
    const found=repairOf(req.params.id);if(!found)return res.sendStatus(404);
    if(found.repair.decision)return send(res,409,{code:'already_decided',error:'Esta correção já foi decidida.'});
    const gate=await spendGate(found.task.workspaceId,req.body);
    if(!gate.ok)return send(res,gate.status,gate.body);
    const result=await callHandler(ctx.handlers.runTask,{params:{id:found.task.id}});
    if(result.status<300)ctx.audit('self_repair.resumed',{taskId:found.task.id,spendConfirmed:gate.paid},found.task.id);
    send(res,result.status,result.body);
  });
}
