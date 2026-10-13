import type Database from 'better-sqlite3';

/** Tetos de gasto (USD). 0 = sem limite. O padrão é conservador de propósito: dá para subir, mas nunca nasce "sem teto". */
export interface BudgetSettings{dailyUsd:number;monthlyUsd:number;defaultTaskUsd:number;}
export const DEFAULT_BUDGET_SETTINGS:BudgetSettings={dailyUsd:2,monthlyUsd:20,defaultTaskUsd:0.5};

const KEY='budget';
const MAX_USD=10_000;

export function ensureSettingsTable(db:Database.Database){
  db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updatedAt TEXT NOT NULL)');
}

const clean=(value:unknown,fallback:number)=>{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=MAX_USD?Math.round(n*10_000)/10_000:fallback;};

/** Ordem de prioridade: valor salvo na tela > variável de ambiente > padrão. */
export function loadBudgetSettings(db:Database.Database,env:NodeJS.ProcessEnv=process.env):BudgetSettings{
  ensureSettingsTable(db);
  const base:BudgetSettings={
    dailyUsd:clean(env.ORQ_DAILY_BUDGET_USD,DEFAULT_BUDGET_SETTINGS.dailyUsd),
    monthlyUsd:clean(env.ORQ_MONTHLY_BUDGET_USD,DEFAULT_BUDGET_SETTINGS.monthlyUsd),
    defaultTaskUsd:clean(env.ORQ_DEFAULT_TASK_BUDGET_USD,DEFAULT_BUDGET_SETTINGS.defaultTaskUsd),
  };
  const row=db.prepare('SELECT value FROM app_settings WHERE key=?').get(KEY) as {value:string}|undefined;
  if(!row)return base;
  try{const saved=JSON.parse(row.value);return{dailyUsd:clean(saved.dailyUsd,base.dailyUsd),monthlyUsd:clean(saved.monthlyUsd,base.monthlyUsd),defaultTaskUsd:clean(saved.defaultTaskUsd,base.defaultTaskUsd)};}catch{return base;}
}

export function saveBudgetSettings(db:Database.Database,input:Partial<Record<keyof BudgetSettings,unknown>>,now=new Date()):BudgetSettings{
  const current=loadBudgetSettings(db);
  for(const key of ['dailyUsd','monthlyUsd','defaultTaskUsd'] as const){
    if(input[key]===undefined)continue;
    const n=Number(input[key]);
    if(!Number.isFinite(n)||n<0||n>MAX_USD)throw Object.assign(new Error(`Valor inválido para ${key}: use um número entre 0 e ${MAX_USD} (0 = sem limite).`),{status:400});
  }
  const next:BudgetSettings={dailyUsd:clean(input.dailyUsd,current.dailyUsd),monthlyUsd:clean(input.monthlyUsd,current.monthlyUsd),defaultTaskUsd:clean(input.defaultTaskUsd,current.defaultTaskUsd)};
  db.prepare('INSERT INTO app_settings (key,value,updatedAt) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run(KEY,JSON.stringify(next),now.toISOString());
  return next;
}

export const startOfLocalDay=(now:Date)=>new Date(now.getFullYear(),now.getMonth(),now.getDate());
export const startOfLocalMonth=(now:Date)=>new Date(now.getFullYear(),now.getMonth(),1);

/** Soma do custo CALCULADO (tabela de preços) de execuções de tasks + Planner de missão/Refinador desde `since`. */
export function spendSince(db:Database.Database,since:Date):number{
  const iso=since.toISOString();
  let total=0;
  const exec=db.prepare("SELECT COALESCE(SUM(estimatedCost),0) AS usd FROM executions WHERE startedAt>=? AND estimatedCost IS NOT NULL").get(iso) as {usd:number};
  total+=Number(exec?.usd)||0;
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_usage'").get()){
    const ai=db.prepare('SELECT COALESCE(SUM(estimatedCost),0) AS usd FROM ai_usage WHERE createdAt>=? AND estimatedCost IS NOT NULL').get(iso) as {usd:number};
    total+=Number(ai?.usd)||0;
  }
  return total;
}

export interface SpendStatus{todayUsd:number;monthUsd:number;dailyLimitUsd:number;monthlyLimitUsd:number;blocked:boolean;reason:'daily'|'monthly'|null;message:string|null;}

export function checkSpendLimits(db:Database.Database,settings:BudgetSettings,now=new Date()):SpendStatus{
  const todayUsd=spendSince(db,startOfLocalDay(now)),monthUsd=spendSince(db,startOfLocalMonth(now));
  const fmt=(value:number)=>`US$ ${value.toFixed(2)}`;
  let reason:SpendStatus['reason']=null,message:string|null=null;
  if(settings.dailyUsd>0&&todayUsd>=settings.dailyUsd){reason='daily';message=`Limite diário de gasto atingido (${fmt(todayUsd)} de ${fmt(settings.dailyUsd)}). Aumente o limite em Configurações para continuar.`;}
  else if(settings.monthlyUsd>0&&monthUsd>=settings.monthlyUsd){reason='monthly';message=`Limite mensal de gasto atingido (${fmt(monthUsd)} de ${fmt(settings.monthlyUsd)}). Aumente o limite em Configurações para continuar.`;}
  return{todayUsd,monthUsd,dailyLimitUsd:settings.dailyUsd,monthlyLimitUsd:settings.monthlyUsd,blocked:reason!==null,reason,message};
}

/** Limite por task aplicado quando o usuário não informou um e a task usa algum provider pago. */
export function effectiveTaskBudget(requested:unknown,usesPaidProvider:boolean,settings:BudgetSettings){
  const value=Number(requested);
  if(Number.isFinite(value)&&value>0)return value;
  return usesPaidProvider?settings.defaultTaskUsd:0;
}
