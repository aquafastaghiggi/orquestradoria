import type Database from 'better-sqlite3';

export interface RetentionConfig{eventsDays:number;logsDays:number;artifactsDays:number;rawProviderResponsesDays:number;}
export const DEFAULT_RETENTION_DAYS:RetentionConfig={eventsDays:30,logsDays:30,artifactsDays:90,rawProviderResponsesDays:14};

export interface RetentionPlan{events:number;logExecutions:number;rawExecutions:number;artifacts:number;estimatedBytes:number;}

/**
 * Somente dados de tasks TERMINADAS (aplicada, descartada, desfeita ou cancelada) são elegíveis. Tasks aguardando decisão, com
 * falha preservada, rodando ou pendentes nunca são tocadas. Eventos sem task (sistema) também podem ser podados.
 * O audit_logs (trilha de auditoria) nunca é podado aqui.
 */
const ELIGIBLE_TASKS="SELECT id FROM tasks WHERE environmentStatus IN ('applied','discarded','undone') OR status='cancelled'";

export function readRetention(db:Database.Database):RetentionConfig{
  try{
    const row=db.prepare('SELECT eventsDays,logsDays,artifactsDays,rawProviderResponsesDays FROM retention_config WHERE id=1').get() as RetentionConfig|undefined;
    if(row)return{eventsDays:row.eventsDays,logsDays:row.logsDays,artifactsDays:row.artifactsDays,rawProviderResponsesDays:row.rawProviderResponsesDays};
  }catch{/* tabela ainda não existe */}
  return{...DEFAULT_RETENTION_DAYS};
}

export function saveRetention(db:Database.Database,input:Partial<Record<keyof RetentionConfig,unknown>>):RetentionConfig{
  const current=readRetention(db);
  const next={...current};
  for(const key of Object.keys(current) as (keyof RetentionConfig)[]){
    if(input[key]===undefined)continue;
    const n=Number(input[key]);
    if(!Number.isInteger(n)||n<1||n>3650)throw Object.assign(new Error(`Valor inválido para ${key}: use um número inteiro de dias entre 1 e 3650.`),{status:400});
    next[key]=n;
  }
  db.prepare('UPDATE retention_config SET eventsDays=?,logsDays=?,artifactsDays=?,rawProviderResponsesDays=? WHERE id=1').run(next.eventsDays,next.logsDays,next.artifactsDays,next.rawProviderResponsesDays);
  return next;
}

const cutoff=(now:Date,days:number)=>new Date(now.getTime()-days*86_400_000).toISOString();
const n=(value:unknown)=>Number(value)||0;

export function planRetention(db:Database.Database,config:RetentionConfig,now=new Date()):RetentionPlan{
  const eventsCut=cutoff(now,config.eventsDays),logsCut=cutoff(now,config.logsDays),rawCut=cutoff(now,config.rawProviderResponsesDays),artCut=cutoff(now,config.artifactsDays);
  const ev=db.prepare(`SELECT COUNT(*) AS c,COALESCE(SUM(LENGTH(payload)),0) AS b FROM events WHERE createdAt<? AND (taskId IS NULL OR taskId IN (${ELIGIBLE_TASKS}))`).get(eventsCut) as any;
  const logs=db.prepare(`SELECT COUNT(*) AS c,COALESCE(SUM(LENGTH(COALESCE(logs,''))+LENGTH(COALESCE(stdout,''))+LENGTH(COALESCE(stderr,''))),0) AS b FROM executions WHERE startedAt<? AND taskId IN (${ELIGIBLE_TASKS}) AND (logs IS NOT NULL OR stdout IS NOT NULL OR stderr IS NOT NULL)`).get(logsCut) as any;
  const raw=db.prepare(`SELECT COUNT(*) AS c,COALESCE(SUM(LENGTH(COALESCE(rawProviderResponse,''))),0) AS b FROM executions WHERE startedAt<? AND taskId IN (${ELIGIBLE_TASKS}) AND rawProviderResponse IS NOT NULL`).get(rawCut) as any;
  const art=db.prepare(`SELECT COUNT(*) AS c,COALESCE(SUM(LENGTH(content)),0) AS b FROM artifacts WHERE createdAt<? AND taskId IN (${ELIGIBLE_TASKS})`).get(artCut) as any;
  return{events:n(ev.c),logExecutions:n(logs.c),rawExecutions:n(raw.c),artifacts:n(art.c),estimatedBytes:n(ev.b)+n(logs.b)+n(raw.b)+n(art.b)};
}

export function applyRetention(db:Database.Database,config:RetentionConfig,now=new Date()):RetentionPlan{
  const plan=planRetention(db,config,now);
  const eventsCut=cutoff(now,config.eventsDays),logsCut=cutoff(now,config.logsDays),rawCut=cutoff(now,config.rawProviderResponsesDays),artCut=cutoff(now,config.artifactsDays);
  db.transaction(()=>{
    db.prepare(`DELETE FROM events WHERE createdAt<? AND (taskId IS NULL OR taskId IN (${ELIGIBLE_TASKS}))`).run(eventsCut);
    db.prepare(`UPDATE executions SET logs=NULL,stdout=NULL,stderr=NULL,progressEvents=NULL WHERE startedAt<? AND taskId IN (${ELIGIBLE_TASKS})`).run(logsCut);
    db.prepare(`UPDATE executions SET rawProviderResponse=NULL WHERE startedAt<? AND taskId IN (${ELIGIBLE_TASKS})`).run(rawCut);
    db.prepare(`DELETE FROM artifacts WHERE createdAt<? AND taskId IN (${ELIGIBLE_TASKS})`).run(artCut);
  })();
  return plan;
}
