import type Database from 'better-sqlite3';

const RUNNING_TASK_STATUSES=['analyzing','planning','implementing','testing','reviewing','running'];

export interface RecoveryReport{
  tasks:{id:string;from:string;worktree:boolean}[];
  executions:number;
  missions:{id:string;steps:number}[];
  locksCleared:number;
  /** Tasks filhas de missão cujo status de ambiente ficou para trás depois de aplicar/desfazer/descartar a missão. */
  missionTasksSynced:number;
}

const hasTable=(db:Database.Database,name:string)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));

/**
 * Chamado na inicialização: nada está executando de fato (o mapa de execuções em memória está vazio), então tudo que o banco ainda
 * marca como "em execução" é resto de uma API que caiu ou foi reiniciada. Em vez de ficar preso para sempre, vira `stalled`
 * (task, retomável com o ambiente preservado) / `waiting_human` (missão), e o usuário usa Retomar.
 */
export function recoverInterruptedWork(db:Database.Database,now=new Date()):RecoveryReport{
  const stamp=now.toISOString();
  const report:RecoveryReport={tasks:[],executions:0,missions:[],locksCleared:0,missionTasksSynced:0};
  const message='A API foi reiniciada durante a execução. O trabalho feito até aqui foi preservado; use Retomar.';
  db.transaction(()=>{
    if(hasTable(db,'tasks')){
      const marks=RUNNING_TASK_STATUSES.map(()=>'?').join(',');
      const tasks=db.prepare(`SELECT id,status,isolationMode FROM tasks WHERE status IN (${marks})`).all(...RUNNING_TASK_STATUSES) as {id:string;status:string;isolationMode:string|null}[];
      for(const task of tasks){
        const worktree=task.isolationMode==='worktree';
        db.prepare('UPDATE tasks SET status=?,resumable=1,environmentStatus=CASE WHEN ?=1 THEN ? ELSE environmentStatus END,updatedAt=? WHERE id=?').run('stalled',worktree?1:0,'failed_preserved',stamp,task.id);
        report.tasks.push({id:task.id,from:task.status,worktree});
      }
    }
    if(hasTable(db,'executions')){
      report.executions=db.prepare("UPDATE executions SET status='stalled',error=?,finishedAt=COALESCE(finishedAt,?) WHERE status='running'").run(message,stamp).changes;
    }
    if(hasTable(db,'missions')){
      const missions=db.prepare("SELECT id FROM missions WHERE status='running'").all() as {id:string}[];
      for(const mission of missions){
        let steps=0;
        if(hasTable(db,'mission_tasks'))steps=db.prepare("UPDATE mission_tasks SET status='blocked',updatedAt=? WHERE missionId=? AND status='running'").run(stamp,mission.id).changes;
        db.prepare("UPDATE missions SET status='waiting_human',environmentWarning=?,updatedAt=? WHERE id=?").run(message,stamp,mission.id);
        report.missions.push({id:mission.id,steps});
      }
    }
    if(hasTable(db,'tasks')&&hasTable(db,'missions')){
      report.missionTasksSynced=db.prepare("UPDATE tasks SET environmentStatus=(SELECT environmentStatus FROM missions WHERE missions.id=tasks.missionId),updatedAt=? WHERE missionId IS NOT NULL AND environmentStatus IN ('approved_waiting_action','active','manual_review_preserved','failed_preserved') AND (SELECT environmentStatus FROM missions WHERE missions.id=tasks.missionId) IN ('applied','undone','discarded')").run(stamp).changes;
    }
    if(hasTable(db,'locks'))report.locksCleared=db.prepare('DELETE FROM locks').run().changes;
  })();
  return report;
}
