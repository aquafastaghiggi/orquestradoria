/** Percentual e estimativa de tempo de uma missão. Puro (sem relógio): quem chama informa os tempos já medidos. */
export interface MissionEstimateTask{status:string;/** tempo já gasto nas execuções concluídas da etapa */durationMs?:number}
export interface MissionEstimateInput{
  tasks:MissionEstimateTask[];
  /** etapa em andamento (a task filha da missão que está rodando agora) */
  current?:{index:number;stage?:string;/** tempo da execução atual, em andamento */stageElapsedMs?:number;/** 0-100 informado pelo provider, se houver */progressPercent?:number|null};
  /** usado enquanto não há nenhuma etapa concluída para medir (Haiku 5.5 + Codex: ~2,5 min por micro etapa) */
  defaultTaskMs?:number;
}
export interface MissionEstimate{percent:number;currentTaskPercent:number|null;elapsedMs:number;remainingMs:number;totalMs:number;basis:'measured'|'default';averageTaskMs:number}
export const DEFAULT_TASK_MS=150000;
/** Peso de cada estágio dentro de uma etapa (soma 100) e fatia do tempo esperado. */
const STAGES:Record<string,{start:number;weight:number;share:number}>={developer:{start:0,weight:70,share:0.7},tester:{start:70,weight:10,share:0.1},reviewer:{start:80,weight:20,share:0.2}};

export function estimateMission(input:MissionEstimateInput):MissionEstimate{
  const done=input.tasks.filter(t=>t.status==='completed');
  const measured=done.map(t=>t.durationMs||0).filter(ms=>ms>0);
  const basis=measured.length?'measured':'default';
  const averageTaskMs=measured.length?measured.reduce((a,b)=>a+b,0)/measured.length:(input.defaultTaskMs||DEFAULT_TASK_MS);
  let currentTaskPercent:number|null=null;
  const stage=input.current?STAGES[String(input.current.stage||'developer')]:undefined;
  if(input.current&&stage){
    const given=input.current.progressPercent;
    const byTime=Math.min(0.95,Math.max(0,(input.current.stageElapsedMs||0)/Math.max(1,averageTaskMs*stage.share)));
    const fraction=typeof given==='number'&&given>0?Math.min(1,given/100):byTime;
    currentTaskPercent=Math.min(99,Math.round(stage.start+stage.weight*fraction));
  }
  const total=Math.max(1,input.tasks.length);
  let sum=0,elapsedMs=0,remainingMs=0;
  input.tasks.forEach((task,index)=>{
    if(task.status==='completed'){sum+=100;elapsedMs+=task.durationMs||0;return;}
    if(input.current&&input.current.index===index&&currentTaskPercent!==null){
      sum+=currentTaskPercent;elapsedMs+=(task.durationMs||0)+(input.current.stageElapsedMs||0);
      remainingMs+=Math.max(averageTaskMs*0.1,averageTaskMs*(1-currentTaskPercent/100));return;
    }
    remainingMs+=averageTaskMs;
  });
  return{percent:Math.min(100,Math.round(sum/total)),currentTaskPercent,elapsedMs:Math.round(elapsedMs),remainingMs:Math.round(remainingMs),totalMs:Math.round(elapsedMs+remainingMs),basis,averageTaskMs:Math.round(averageTaskMs)};
}
export function formatDuration(ms:number):string{const s=Math.max(0,Math.round(ms/1000));if(s<60)return `${s}s`;const m=Math.round(s/60);if(m<60)return s%60&&m<10?`${Math.floor(s/60)}min ${String(s%60).padStart(2,'0')}s`:`${m} min`;const h=Math.floor(m/60);return `${h}h ${String(m%60).padStart(2,'0')}min`;}