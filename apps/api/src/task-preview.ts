import {existsSync} from 'node:fs';
import {RuntimeDetector,RuntimeSessionManager,type RuntimeSession} from '@orchestrator/workspace';

export interface TaskPreviewView{status:'stopped'|'ready'|'failed';runtime?:string;url?:string;error?:string;startedAt?:string;errors?:string[];}

const ADJUSTABLE_TASK_STATUS=['approved','needs_fix'];
const ADJUSTABLE_ENVIRONMENT=['approved_waiting_action','manual_review_preserved'];
export const MAX_ADJUSTMENT_CHARS=4000;

export function previewView(session?:RuntimeSession):TaskPreviewView{
  if(!session||session.status==='stopped')return{status:'stopped'};
  if(session.status==='failed')return{status:'failed',runtime:session.profile.type,error:session.stderr||'Runtime indisponível'};
  return{status:'ready',runtime:session.profile.type,errors:extractPreviewErrors(session.stderr,6,Boolean(session.profile.entryPath&&session.profile.entryPath!=='/')),url:session.baseUrl+(session.profile.entryPath&&session.profile.entryPath!=='/'?session.profile.entryPath:''),startedAt:session.startedAt};
}

/** Mantém um runtime local por task, sempre apontando para o worktree isolado (nunca para a branch principal). */
export class TaskPreviewManager{
  private readonly sessions=new Map<string,RuntimeSession>();
  constructor(private readonly runtime=new RuntimeSessionManager(new RuntimeDetector({phpFallback:true}))){}
  get(taskId:string){
    const session=this.sessions.get(taskId);
    if(session&&session.status!=='ready'&&session.status!=='starting')this.sessions.delete(taskId);
    return previewView(this.sessions.get(taskId));
  }
  async start(taskId:string,worktreePath:string,onEvent?:(type:string,payload:Record<string,unknown>)=>void,env?:Record<string,string>):Promise<TaskPreviewView>{
    const current=this.sessions.get(taskId);
    if(current?.status==='ready')return previewView(current);
    if(!worktreePath||!existsSync(worktreePath))return{status:'failed',error:'O ambiente isolado da task não existe mais.'};
    const session=await this.runtime.start(worktreePath,{id:`preview-${taskId}`,onEvent,env,anyResponseIsReady:true});
    if(session.status!=='ready')return previewView(session);
    this.sessions.set(taskId,session);
    return previewView(session);
  }
  async stop(taskId:string,onEvent?:(type:string,payload:Record<string,unknown>)=>void){
    const session=this.sessions.get(taskId);
    this.sessions.delete(taskId);
    if(session)await this.runtime.stop(session,{onEvent});
    return previewView(undefined);
  }
  async stopAll(){await Promise.all([...this.sessions.keys()].map(id=>this.stop(id)));}
}

export function canRequestAdjustment(task:{status?:string;environmentStatus?:string|null;isolationMode?:string|null;worktreePath?:string|null;missionId?:string|null},hasAttention=false){
  if(task.missionId)return{ok:false,reason:'Esta task pertence a uma missão; peça o ajuste pela missão.'};
  if(task.isolationMode!=='worktree')return{ok:false,reason:'Ajustes exigem uma task com worktree isolado.'};
  if(!(hasAttention?[...ADJUSTABLE_TASK_STATUS,'needs_manual_review','failed']:ADJUSTABLE_TASK_STATUS).includes(String(task.status)))return{ok:false,reason:'Só é possível solicitar ajuste de uma task aprovada ou com correções pendentes.'};
  if(!(hasAttention?[...ADJUSTABLE_ENVIRONMENT,'failed_preserved']:ADJUSTABLE_ENVIRONMENT).includes(String(task.environmentStatus)))return{ok:false,reason:'O ambiente da task não está aguardando decisão.'};
  if(!task.worktreePath||!existsSync(task.worktreePath))return{ok:false,reason:'O worktree da task não existe mais.'};
  return{ok:true as const};
}

/**
 * Anexa o ajuste à descrição da task usando o heading "Observações:", que o extrator de critérios de aceite
 * trata como fim da lista — assim o texto livre nunca vira um critério AC novo.
 */
export function appendAdjustmentRequest(description:string,feedback:string,round:number){
  return `${description.trimEnd()}\n\nObservações: ajuste solicitado pelo usuário (rodada ${round}). Aplique sobre o trabalho já existente neste worktree, preservando o que já estava correto:\n${feedback.trim()}\n`;
}

export function adjustmentRound(description:string){
  return (String(description).match(/ajuste solicitado pelo usuário \(rodada \d+\)/g)||[]).length+1;
}

/**
 * Lê o stderr do servidor do preview (PHP imprime Fatal error/Warning e respostas 4xx/5xx) e devolve as últimas ocorrências
 * distintas, já sem data e sem a pasta temporária longa, para o usuário transformar em um pedido de correção.
 */
export function extractPreviewErrors(stderr:string|undefined,limit=6,ignoreRoot=false):string[]{
  const text=String(stderr||'');
  if(!text.trim())return[];
  const entries:string[]=[];
  for(const part of text.split(/^\[[A-Z][a-z]{2} [A-Z][a-z]{2} +\d+ \d\d:\d\d:\d\d \d{4}\] /m)){
    const entry=part.trim();
    if(/^PHP (Fatal error|Parse error|Warning|Notice|Deprecated)/.test(entry)){entries.push(entry);continue;}
    const request=entry.match(/^[\d.]+:\d+ \[([45]\d\d)\]: (\w+) (\S+)/);
    if(request&&!(ignoreRoot&&request[3]==='/'))entries.push(`HTTP ${request[1]} ${request[2]} ${request[3]}`);
  }
  const seen=new Set<string>();
  const unique=entries.filter(item=>seen.has(item)?false:(seen.add(item),true));
  return unique.slice(-limit).map(item=>item.replace(/\s*\n\s*/g,' ').slice(0,500));
}