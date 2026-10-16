import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import {buildDiagnosisBundle,redact,type DiagnosisBundle} from './self-repair.js';

/**
 * Detecção de problemas do PRÓPRIO Orquestradoria a partir do que ele já registra (tasks, execuções, eventos, auditoria).
 * Não chama IA nem consome créditos. Cada achado tem causa provável, gravidade e evidências, e é marcado como
 * "confirmed" (há evidência direta: o provider/pipeline registrou a falha) ou "suspected" (padrão que sugere um problema,
 * mas não o prova). Achados iguais são agrupados por assinatura (sem alertas duplicados).
 *
 * Falhas do projeto do usuário (por exemplo testes dele reprovando) não são problemas do Orquestradoria e não entram aqui.
 */
export type Severity='high'|'medium'|'low';
export interface Evidence{taskId:string;taskTitle:string;source:string;text:string;at:string}
export interface Problem{
  id:string;category:string;title:string;severity:Severity;status:'confirmed'|'suspected';
  probableCause:string;evidence:Evidence[];occurrences:number;taskIds:string[];firstSeen:string;lastSeen:string;
  investigation?:{taskId:string;status:string;decision:string|null};
}
export interface DetectOptions{now?:Date;running?:{has:(id:string)=>boolean};orphanMinutes?:number;lookbackDays?:number}

const HEALTHY=new Set(['approved','applied','discarded','completed','cancelled']);
const norm=(text:string)=>String(text||'').toLowerCase().replace(/[a-z]:\\[^\s'"]+|\/[^\s'"]{3,}/g,'<path>').replace(/[a-z0-9_-]{16,}/g,'<id>').replace(/\d+/g,'#').replace(/\s+/g,' ').trim().slice(0,90);
const idOf=(...parts:string[])=>createHash('sha1').update(parts.join('|')).digest('hex').slice(0,12);
const parse=(value:unknown)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return undefined;}};
const clip=(value:string,max=260)=>redact(String(value||'')).replace(/\s+/g,' ').trim().slice(0,max);

interface Cause{category:string;title:string;severity:Severity;cause:string}
function classify(error:string,role:string):Cause{
  const e=error.toLowerCase();
  if(/timed out|timeout|tempo esgotado/.test(e))return{category:'timeout',title:`Timeout do provider (${role})`,severity:'medium',cause:'O provider demorou mais que o limite de tempo configurado (CLAUDE_TIMEOUT_MS / CODEX_TIMEOUT_MS) ou travou; o limite pode estar baixo para este tipo de task.'};
  if(/enoent|not found|não encontrad|is not recognized|command not found|spawn .* (?:failed|enoent)/.test(e))return{category:'cli_missing',title:`CLI do provider indisponível (${role})`,severity:'high',cause:'O executável do provider (Claude Code ou Codex CLI) não foi encontrado ou não pôde ser iniciado: caminho, PATH ou instalação.'};
  if(/auth|login|unauthori[sz]ed|\b40[13]\b|api[_ -]?key|credential/.test(e))return{category:'auth',title:`Falha de autenticação do provider (${role})`,severity:'high',cause:'O provider recusou as credenciais ou a sessão expirou; é preciso autenticar novamente a CLI ou conferir a chave.'};
  if(/validation|schema|structured|json|parse|unexpected token/.test(e))return{category:'structured_output',title:`Saída estruturada inválida (${role})`,severity:'medium',cause:'O provider devolveu uma resposta fora do formato JSON esperado; o parser/recuperação de saída estruturada pode estar rígido demais ou o prompt do papel pede um formato que o modelo não segue.'};
  if(/budget|orçamento|limit(?:e)? (?:di[aá]rio|mensal)|quota|rate limit|429/.test(e))return{category:'budget',title:`Limite de orçamento ou taxa atingido (${role})`,severity:'low',cause:'Um limite de gasto ou de taxa interrompeu a execução; é o controle funcionando, mas convém conferir se o teto está adequado.'};
  if(/worktree|git |branch|lock busy|checkout/.test(e))return{category:'isolation',title:`Falha no ambiente isolado (${role})`,severity:'high',cause:'O worktree ou a branch da task não pôde ser preparado ou mantido (estado do repositório, lock ou conflito).'};
  return{category:'execution_failure',title:`Falha de execução do ${role} sem causa classificada`,severity:'medium',cause:'A execução falhou com uma mensagem que as regras não reconhecem; a causa só aparece lendo a evidência.'};
}

export function detectProblems(db:Database.Database,options:DetectOptions={}):Problem[]{
  const now=options.now||new Date();
  const since=new Date(now.getTime()-(options.lookbackDays??30)*86400000).toISOString();
  const orphanMs=(options.orphanMinutes??15)*60000;
  const tasks=new Map<string,any>();
  try{for(const t of db.prepare('SELECT id,title,status,environmentStatus,updatedAt FROM tasks').all() as any[])tasks.set(t.id,t);}catch{return[];}
  const unresolved=(taskId:string)=>{const t=tasks.get(taskId);return Boolean(t)&&!HEALTHY.has(String(t.status))&&!['applied','discarded'].includes(String(t.environmentStatus));};

  const groups=new Map<string,Problem&{taskSet:Set<string>}>();
  const add=(key:string,base:{category:string;title:string;severity:Severity;status:'confirmed'|'suspected';cause:string},ev:Evidence)=>{
    let g=groups.get(key);
    if(!g){g={id:key,category:base.category,title:base.title,severity:base.severity,status:base.status,probableCause:base.cause,evidence:[],occurrences:0,taskIds:[],firstSeen:ev.at,lastSeen:ev.at,taskSet:new Set()};groups.set(key,g);}
    g.occurrences++;g.taskSet.add(ev.taskId);
    if(ev.at<g.firstSeen)g.firstSeen=ev.at;if(ev.at>g.lastSeen)g.lastSeen=ev.at;
    if(!g.evidence.some(e=>e.taskId===ev.taskId&&e.text===ev.text))g.evidence.push(ev);
  };
  const ev=(taskId:string,source:string,text:string,at:string):Evidence=>({taskId,taskTitle:String(tasks.get(taskId)?.title||taskId).slice(0,80),source,text:clip(text),at});

  // 1) execuções que falharam ou foram marcadas como paradas pelo watchdog (evidência direta → confirmado)
  try{
    for(const e of db.prepare("SELECT taskId,role,provider,model,status,error,startedAt,finishedAt FROM executions WHERE status IN ('failed','stalled','timed_out') AND COALESCE(startedAt,'')>=? ORDER BY startedAt DESC LIMIT 400").all(since) as any[]){
      if(!tasks.has(e.taskId)||!unresolved(e.taskId))continue;
      const message=String(e.error||(e.status==='stalled'?'execução parada: sem sinal de vida do provider':'falha sem mensagem'));
      const cause=e.status==='stalled'?{category:'stalled',title:`Execução parada sem sinal de vida (${e.role})`,severity:'high' as Severity,cause:'O watchdog marcou a execução como parada: o provider parou de enviar sinais de vida (processo preso, rede ou o servidor reiniciou durante a execução).'}:classify(message,e.role);
      add(idOf(cause.category,e.role,e.provider,norm(message)),{...cause,status:'confirmed'},ev(e.taskId,`execução ${e.role} (${e.provider}/${e.model}) → ${e.status}`,message,e.finishedAt||e.startedAt));
    }
  }catch{/* sem execuções */}

  // 2) banco de teste indisponível (auditoria do preflight) → confirmado, recente
  try{
    for(const a of db.prepare("SELECT taskId,metadata,timestamp FROM audit_logs WHERE action='project_database.unavailable' AND timestamp>=? ORDER BY timestamp DESC LIMIT 100").all(since) as any[]){
      if(!a.taskId||!tasks.has(a.taskId))continue;
      const message=String(parse(a.metadata)?.error||'banco de teste indisponível');
      add(idOf('db_unavailable',norm(message)),{category:'db_unavailable',title:'Banco MySQL de teste indisponível',severity:'medium',status:'confirmed',cause:'O preflight não conseguiu usar o banco de teste: MySQL desligado, login de teste (pnpm db:setup) ausente ou credencial inválida. O Developer fica sem banco para verificar o trabalho.'},ev(a.taskId,'auditoria project_database.unavailable',message,a.timestamp));
    }
  }catch{/* sem auditoria */}

  // 3) padrões que sugerem problema, sem prová-lo → suspeita
  const denials=new Map<string,Evidence[]>();const noProgress:Evidence[]=[];const unvalidated:Evidence[]=[];
  try{
    for(const e of db.prepare("SELECT taskId,role,structuredResult,startedAt FROM executions WHERE status='completed' AND COALESCE(startedAt,'')>=? ORDER BY startedAt DESC LIMIT 400").all(since) as any[]){
      if(!tasks.has(e.taskId)||!unresolved(e.taskId))continue;
      const r:any=parse(e.structuredResult)||{};
      if(e.role==='developer'&&Array.isArray(r.permissionDenials)&&r.permissionDenials.length){
        const command=String(r.permissionDenials[0].command||'').slice(0,120);
        const key=norm(String(r.permissionDenials[0].tool||'')+' '+command.split(/\s+/)[0]);
        denials.set(key,[...(denials.get(key)||[]),ev(e.taskId,'developer: comando recusado pela política',`${r.permissionDenials[0].tool}: ${command}`,e.startedAt)]);
      }
      if(e.role==='tester'&&r.blockReason==='required_flow_unvalidated')unvalidated.push(ev(e.taskId,'tester: fluxo obrigatório não validado',String(r.summary||r.blockReason),e.startedAt));
    }
    for(const a of db.prepare("SELECT taskId,metadata,timestamp FROM audit_logs WHERE action IN ('execution.failed','task.needs_input','task.attention') AND timestamp>=? ORDER BY timestamp DESC LIMIT 200").all(since) as any[]){
      const m=parse(a.metadata)||{};if(!a.taskId||!tasks.has(a.taskId))continue;
      if(['repeated_issue','no_progress'].includes(String(m.stopKind)))noProgress.push(ev(a.taskId,'ciclo de correção interrompido',`${m.stopKind}: ${m.reason||''}`,a.timestamp));
    }
  }catch{/* sem dados */}
  for(const [key,list] of denials){
    const tasksHit=new Set(list.map(e=>e.taskId));
    if(tasksHit.size<2)continue; // um caso isolado é ruído; o padrão é a suspeita
    for(const item of list)add(idOf('denials',key),{category:'permission_denials',title:'Comandos do Developer recusados repetidamente pela política',severity:'low',status:'suspected',cause:'O Developer insiste em comandos que a política de permissões recusa (por exemplo ler variáveis de ambiente ou encadear comandos). Pode ser falta de orientação no prompt ou uma permissão segura que está faltando; não é um erro confirmado.'},item);
  }
  if(new Set(unvalidated.map(e=>e.taskId)).size>=2)for(const item of unvalidated)add(idOf('flow_unvalidated'),{category:'flow_unvalidated',title:'Fluxos obrigatórios ficam sem validação em várias tasks',severity:'medium',status:'suspected',cause:'O Developer não está declarando testes funcionais que provem os fluxos exigidos, ou a análise de fluxo exige mais do que o pedido pretendia. Pode ser comportamento correto do bloqueio.'},item);
  for(const item of noProgress)add(idOf('no_progress'),{category:'no_progress',title:'Ciclo de correção automática sem progresso',severity:'medium',status:'suspected',cause:'O pipeline interrompeu o ciclo porque o mesmo problema se repetiu ou nada mudou. Sugere que o contexto passado ao Developer não basta para corrigir, mas também pode ser uma task realmente difícil.'},item);

  // execuções "ativas" sem processo vivo e sem atualização há muito tempo → suspeita de órfã
  for(const t of tasks.values()){
    if(!['planning','implementing','testing','reviewing','analyzing'].includes(String(t.status)))continue;
    if(options.running?.has(t.id))continue;
    const age=now.getTime()-Date.parse(String(t.updatedAt||''));
    if(!Number.isFinite(age)||age<orphanMs)continue;
    add(idOf('orphan'),{category:'orphan_execution',title:'Task marcada como em execução, mas sem processo ativo',severity:'medium',status:'suspected',cause:'A task parece em andamento, porém não há execução viva nem atualização recente: o servidor pode ter sido reiniciado no meio da execução. Não está confirmado até conferir os eventos.'},ev(t.id,`task ${t.status}`,`sem atualização há ${Math.round(age/60000)} min e sem execução ativa`,String(t.updatedAt)));
  }

  // investigações já abertas (evita investigar duas vezes o mesmo problema)
  let links:any[]=[];
  try{links=db.prepare("SELECT r.problemId,r.taskId,r.decision,t.status FROM self_repairs r JOIN tasks t ON t.id=r.taskId WHERE r.problemId IS NOT NULL AND COALESCE(r.decision,'')<>'discarded' ORDER BY r.createdAt DESC").all() as any[];}catch{/* coluna ausente */}
  const severityRank:Record<Severity,number>={high:0,medium:1,low:2};
  const out:Problem[]=[...groups.values()].map(g=>{
    const {taskSet,...problem}=g;
    const evidence=problem.evidence.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5);
    const severity:Severity=problem.severity==='medium'&&taskSet.size>=3&&problem.status==='confirmed'?'high':problem.severity;
    const link=links.find(l=>l.problemId===problem.id);
    return{...problem,severity,evidence,taskIds:[...taskSet],...(link?{investigation:{taskId:link.taskId,status:link.status,decision:link.decision}}:{})};
  });
  return out.sort((a,b)=>(a.status===b.status?0:a.status==='confirmed'?-1:1)||severityRank[a.severity]-severityRank[b.severity]||b.lastSeen.localeCompare(a.lastSeen));
}

/** Prompt de correção e diagnóstico montados a partir do achado, sem pedir que o usuário explique de novo. */
export function buildProblemPrompt(db:Database.Database,problem:Problem):{prompt:string;sourceTaskId:string|null;bundle:DiagnosisBundle|null}{
  const sourceTaskId=problem.evidence[0]?.taskId||problem.taskIds[0]||null;
  const lines=[
    `Investigar e corrigir no Orquestradoria: ${problem.title}.`,
    `Situação: ${problem.status==='confirmed'?'problema CONFIRMADO por evidência direta':'SUSPEITA ainda não confirmada — primeiro confirme a causa lendo o código e as evidências; se não houver defeito, não altere nada e explique'}. Gravidade: ${problem.severity}. Ocorrências: ${problem.occurrences} em ${problem.taskIds.length} task(s).`,
    `Causa provável (hipótese, não certeza): ${problem.probableCause}`,
    'Evidências:',...problem.evidence.map(e=>`- [${e.at}] ${e.source} — task "${e.taskTitle}": ${e.text}`),
    'Resultado esperado: a causa raiz corrigida com a menor mudança possível, com um teste de regressão que reproduza a falha e passe depois da correção.'
  ];
  return{prompt:lines.join('\n'),sourceTaskId,bundle:sourceTaskId?buildDiagnosisBundle(db,sourceTaskId):null};
}
