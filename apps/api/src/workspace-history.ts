import type Database from 'better-sqlite3';

export type HistoryGroup='running'|'waiting'|'attention'|'done'|'queued';
export interface HistoryPhase{group:HistoryGroup;label:string;}
export interface HistoryStage{role:string;status:string;}
export interface HistoryItem{
  kind:'task'|'mission';id:string;title:string;request:string;status:string;environmentStatus:string|null;
  phase:HistoryPhase;createdAt:string;updatedAt:string;
  durationMs:number;tokens:number;costUsd:number;filesChanged:number;adjustments:number;fixCycles:number;
  stages:HistoryStage[];baseBranch:string|null;progress?:{done:number;total:number};
}

const RUNNING=['analyzing','planning','implementing','testing','reviewing','running'];
const ATTENTION=['failed','stalled','needs_fix','needs_manual_review','cancelled','blocked'];
const ATTENTION_ENV=['failed_preserved','manual_review_preserved','apply_conflict','cleanup_failed','preparation_failed','environment_missing'];

/** Traduz status técnico + status do ambiente em uma fase que o usuário entende ("o que eu preciso fazer?"). */
export function classifyPhase(status:string,environmentStatus?:string|null):HistoryPhase{
  if(environmentStatus==='applied')return{group:'done',label:'Aplicada na branch principal'};
  if(environmentStatus==='discarded')return{group:'done',label:'Descartada'};
  if(RUNNING.includes(status))return{group:'running',label:'Em execução'};
  if(environmentStatus==='approved_waiting_action'||(status==='approved'&&!environmentStatus))return{group:'waiting',label:'Aguardando sua decisão'};
  if(ATTENTION.includes(status)||ATTENTION_ENV.includes(String(environmentStatus)))return{group:'attention',label:status==='cancelled'?'Cancelada':'Precisa de atenção'};
  if(status==='completed')return{group:'waiting',label:'Concluída · aguardando sua decisão'};
  return{group:'queued',label:'Não iniciada'};
}

export function classifyMissionPhase(status:string,environmentStatus?:string|null):HistoryPhase{
  if(['draft','plan_ready'].includes(status))return{group:'waiting',label:'Plano aguardando aprovação'};
  if(status==='planning')return{group:'running',label:'Planejando'};
  if(status==='approved')return{group:'queued',label:'Aprovada · aguardando execução'};
  if(status==='waiting_human')return{group:'waiting',label:'Aguardando você'};
  if(status==='completed'&&!environmentStatus)return{group:'waiting',label:'Concluída · aguardando sua decisão'};
  return classifyPhase(status==='completed'?'approved':status,environmentStatus);
}

const num=(value:unknown)=>Number(value)||0;
const countAdjustments=(description:string)=>(String(description).match(/ajuste solicitado pelo usuário \(rodada \d+\)/g)||[]).length;

interface Aggregate{durationMs:number;tokens:number;costUsd:number;filesChanged:number;stages:Map<string,string>;}
const emptyAggregate=():Aggregate=>({durationMs:0,tokens:0,costUsd:0,filesChanged:0,stages:new Map()});

export function buildWorkspaceHistory(db:Database.Database,workspaceId:string):HistoryItem[]{
  const executions=db.prepare('SELECT e.taskId,e.role,e.status,e.tokenUsage,e.estimatedCost,e.duration,e.structuredResult FROM executions e JOIN tasks t ON t.id=e.taskId WHERE t.workspaceId=? ORDER BY e.startedAt ASC').all(workspaceId) as any[];
  const byTask=new Map<string,Aggregate>();
  for(const execution of executions){
    const aggregate=byTask.get(execution.taskId)||emptyAggregate();
    aggregate.durationMs+=num(execution.duration);aggregate.tokens+=num(execution.tokenUsage);aggregate.costUsd+=num(execution.estimatedCost);
    aggregate.stages.set(execution.role,execution.status);
    if(execution.role==='developer'&&execution.structuredResult){
      try{const files=JSON.parse(execution.structuredResult)?.actualChangedFiles;if(Array.isArray(files))aggregate.filesChanged=files.length;}catch{}
    }
    byTask.set(execution.taskId,aggregate);
  }
  const stagesOf=(aggregate:Aggregate,pipeline:string[])=>pipeline.map(role=>({role,status:aggregate.stages.get(role)||'pending'}));

  const items:HistoryItem[]=[];
  const tasks=db.prepare('SELECT * FROM tasks WHERE workspaceId=?').all(workspaceId) as any[];
  const missionTasks=new Map<string,Aggregate>();
  for(const task of tasks){
    const aggregate=byTask.get(task.id)||emptyAggregate();
    if(task.missionId){
      const total=missionTasks.get(task.missionId)||emptyAggregate();
      total.durationMs+=aggregate.durationMs;total.tokens+=aggregate.tokens;total.costUsd+=aggregate.costUsd;total.filesChanged+=aggregate.filesChanged;
      missionTasks.set(task.missionId,total);
      continue;
    }
    let pipeline:string[]=[];try{pipeline=JSON.parse(task.pipeline);}catch{}
    items.push({kind:'task',id:task.id,title:task.title,request:task.description,status:task.status,environmentStatus:task.environmentStatus||null,phase:classifyPhase(task.status,task.environmentStatus),createdAt:task.createdAt,updatedAt:task.updatedAt,durationMs:aggregate.durationMs,tokens:aggregate.tokens,costUsd:aggregate.costUsd,filesChanged:aggregate.filesChanged,adjustments:countAdjustments(task.description),fixCycles:num(task.fixCycle),stages:stagesOf(aggregate,pipeline),baseBranch:task.baseBranch||null});
  }

  const missions=db.prepare('SELECT id,title,request,status,environmentStatus,baseBranch,createdAt,updatedAt FROM missions WHERE workspaceId=?').all(workspaceId) as any[];
  for(const mission of missions){
    const steps=db.prepare('SELECT status FROM mission_tasks WHERE missionId=?').all(mission.id) as any[];
    const total=missionTasks.get(mission.id)||emptyAggregate();
    items.push({kind:'mission',id:mission.id,title:mission.title,request:mission.request,status:mission.status,environmentStatus:mission.environmentStatus||null,phase:classifyMissionPhase(mission.status,mission.environmentStatus),createdAt:mission.createdAt,updatedAt:mission.updatedAt,durationMs:total.durationMs,tokens:total.tokens,costUsd:total.costUsd,filesChanged:total.filesChanged,adjustments:0,fixCycles:0,stages:[],baseBranch:mission.baseBranch||null,progress:{done:steps.filter(step=>step.status==='completed').length,total:steps.length}});
  }
  return items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
