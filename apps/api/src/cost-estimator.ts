import type Database from 'better-sqlite3';
import {computeCost,type ModelPrice,type PriceTier,type TokenBreakdown} from '@orchestrator/shared';

export type CostRole='planner'|'developer'|'reviewer';
export type TaskSize='small'|'medium'|'large';
export type CliProvider='claude-code'|'codex-cli'|'cursor';

/** Perfil de consumo (tokens) de UMA execução de agente via CLI. Cada CLI gasta de um jeito: o Claude Code carrega ~40-53 mil tokens de sistema em cache a cada sessão. */
export interface TokenProfile extends TokenBreakdown{requests:number;
  /** Custo fixo por execução que não depende do modelo escolhido (ex.: chamadas auxiliares do Claude Code em Haiku 4.5). */
  fixedUsd?:number;}

const PROFILE_VERSION='2026-10-13';
export {PROFILE_VERSION};

/**
 * Perfis iniciais do Claude Code: 3 execuções REAIS medidas em 2026-10-13 com Claude Haiku 5.5 (task de 1 linha, lista de tarefas com 3 arquivos e
 * evolução de 4 arquivos). Escrita de cache de 1 h = pior caso (cache frio); com cache quente (sessão anterior < 1 h) cai para ~22 mil.
 * O custo fixo ~US$ 0,0019 é a chamada auxiliar do próprio Claude Code em Haiku 4.5. O histórico real (`profileFromHistory`) substitui estes valores.
 */
const CLAUDE_CODE:Record<TaskSize,TokenProfile>={
  small:{inputTokens:10,cacheWrite1hTokens:52_000,cacheReadTokens:153_000,outputTokens:1_200,requests:5,fixedUsd:0.0019},
  medium:{inputTokens:10,cacheWrite1hTokens:50_000,cacheReadTokens:250_000,outputTokens:9_500,requests:8,fixedUsd:0.0019},
  large:{inputTokens:24,cacheWrite1hTokens:50_000,cacheReadTokens:790_000,outputTokens:30_000,requests:15,fixedUsd:0.0019},
};
/** Codex Reviewer: 4 revisões REAIS medidas em 2026-10-13 (gpt-5.6-luna, US$ 0,0030 a 0,0052): entrada sem cache 6,4k–10,6k, cache 41k–95k (o Codex lê arquivos em vários turnos), saída 0,5k–1k. */
const CODEX:Record<TaskSize,TokenProfile>={
  small:{inputTokens:6_400,cacheReadTokens:41_000,outputTokens:800,requests:1},
  medium:{inputTokens:9_000,cacheReadTokens:60_000,outputTokens:1_000,requests:1},
  large:{inputTokens:10_600,cacheReadTokens:95_000,outputTokens:1_000,requests:1},
};

export function defaultProfile(provider:CliProvider,role:CostRole,size:TaskSize):TokenProfile{
  const base=provider==='codex-cli'?CODEX[size]:CLAUDE_CODE[size];
  // Reviewer e planner leem e escrevem bem menos que o developer (sem laço de edição/teste).
  // Os perfis do Codex já são de Reviewer (medidos); como Developer seria um trabalho bem maior.
  const factor=provider==='codex-cli'?(role==='developer'?4:1):role==='developer'?1:role==='reviewer'?0.35:0.3;
  if(factor===1)return{...base};
  if(factor>1)return{...base,inputTokens:Math.round(base.inputTokens*factor),cacheReadTokens:Math.round((base.cacheReadTokens||0)*factor),outputTokens:Math.round(base.outputTokens*factor)};
  const k=(value?:number)=>value===undefined?undefined:Math.round(value*factor);
  return{inputTokens:k(base.inputTokens)!,cacheWrite5mTokens:k(base.cacheWrite5mTokens),cacheWrite1hTokens:base.cacheWrite1hTokens,cacheReadTokens:k(base.cacheReadTokens),outputTokens:k(base.outputTokens)!,requests:Math.max(1,Math.round(base.requests*factor))};
}

export function scaleProfile(profile:TokenProfile,factor:number):TokenProfile{
  const k=(value?:number)=>value===undefined?undefined:Math.round(value*factor);
  // A escrita de cache da sessão (prompt do sistema) não cresce com o tamanho do trabalho.
  return{...profile,inputTokens:k(profile.inputTokens)!,cacheWrite5mTokens:profile.cacheWrite5mTokens,cacheWrite1hTokens:profile.cacheWrite1hTokens,cacheReadTokens:k(profile.cacheReadTokens),outputTokens:k(profile.outputTokens)!,requests:Math.max(1,Math.round(profile.requests*Math.max(0.5,factor)))};
}

export interface Estimate{expectedUsd:number;lowUsd:number;highUsd:number;longContextRisk:boolean;}

export function estimateProfileCost(price:ModelPrice,profile:TokenProfile,spread:{low:TokenProfile;high:TokenProfile}):Estimate{
  const expected=computeCost(price,profile),low=computeCost(price,spread.low),high=computeCost(price,spread.high);
  const avgPrompt=(profile.inputTokens+(profile.cacheWrite5mTokens||0)+(profile.cacheWrite1hTokens||0)+(profile.cacheReadTokens||0))/Math.max(1,profile.requests);
  const threshold=price.longContext?.thresholdTokens;
  const fixed=profile.fixedUsd||0;
  return{expectedUsd:expected.usd+fixed,lowUsd:Math.min(low.usd,expected.usd)+(spread.low.fixedUsd??fixed),highUsd:Math.max(high.usd,expected.usd)+(spread.high.fixedUsd??fixed),longContextRisk:Boolean(threshold&&avgPrompt>threshold*0.8)};
}

// ───────── Histórico real ─────────
export interface HistoryProfile{samples:number;median:TokenProfile;low:TokenProfile;high:TokenProfile;}

const median=(values:number[])=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const percentile=(values:number[],p:number)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))];};

/** Perfil de tokens real (mediana, p25 e p90) a partir das execuções concluídas do mesmo provider/papel. Exige ≥ 3 amostras. */
export function profileFromHistory(db:Database.Database,provider:string,role:string,minSamples=3):HistoryProfile|null{
  const rows=db.prepare("SELECT usageDetails FROM executions WHERE provider=? AND role=? AND status='completed' AND usageDetails IS NOT NULL AND usageDetails<>'[]' ORDER BY startedAt DESC LIMIT 60").all(provider,role) as {usageDetails:string}[];
  const samples:TokenProfile[]=[];
  for(const row of rows){
    try{
      const details=JSON.parse(row.usageDetails) as {breakdown:TokenBreakdown}[];
      let input=0,write5m=0,write1h=0,read=0,output=0,requests=1;
      for(const detail of details){const b=detail.breakdown;input+=b.inputTokens||0;write5m+=b.cacheWrite5mTokens||0;write1h+=b.cacheWrite1hTokens||0;read+=b.cacheReadTokens||0;output+=b.outputTokens||0;requests=Math.max(requests,b.requests||1);}
      if(input+output+read>0)samples.push({inputTokens:input,cacheWrite5mTokens:write5m,cacheWrite1hTokens:write1h,cacheReadTokens:read,outputTokens:output,requests});
    }catch{/* linha inválida: ignora */}
  }
  if(samples.length<minSamples)return null;
  const pick=(fn:(values:number[])=>number):TokenProfile=>({inputTokens:fn(samples.map(s=>s.inputTokens)),cacheWrite5mTokens:fn(samples.map(s=>s.cacheWrite5mTokens||0)),cacheWrite1hTokens:fn(samples.map(s=>s.cacheWrite1hTokens||0)),cacheReadTokens:fn(samples.map(s=>s.cacheReadTokens||0)),outputTokens:fn(samples.map(s=>s.outputTokens)),requests:Math.max(1,Math.round(fn(samples.map(s=>s.requests))))});
  return{samples:samples.length,median:pick(median),low:pick(v=>percentile(v,0.25)),high:pick(v=>percentile(v,0.9))};
}

/** O tamanho escolhe a parte da distribuição real: pequeno ≈ p25, médio ≈ mediana, grande ≈ p90. */
export function profileForSize(history:HistoryProfile,size:TaskSize):{profile:TokenProfile;spread:{low:TokenProfile;high:TokenProfile}}{
  if(size==='small')return{profile:history.low,spread:{low:scaleProfile(history.low,0.6),high:history.median}};
  if(size==='large')return{profile:history.high,spread:{low:history.median,high:scaleProfile(history.high,1.5)}};
  return{profile:history.median,spread:{low:history.low,high:history.high}};
}

// ───────── Candidatos e comparação ─────────
export interface Candidate{provider:'claude-code'|'codex-cli'|'cursor';price:ModelPrice;}

export function candidatesFor(table:ModelPrice[],providers:CliProvider[],role:CostRole,includeLegacy=false):Candidate[]{
  const out:Candidate[]=[];
  for(const provider of providers){
    const vendor=provider==='claude-code'?'anthropic':provider==='codex-cli'?'openai':'cursor';
    for(const price of table){
      if(price.vendor!==vendor)continue;
      if(!includeLegacy&&price.status==='legacy')continue;
      if(price.suitableFor&&!price.suitableFor.includes(role))continue;
      out.push({provider,price});
    }
  }
  return out;
}

export interface ComparisonRow{provider:string;modelId:string;displayName:string;tier:PriceTier;executable:boolean;verified:boolean;expectedUsd:number;lowUsd:number;highUsd:number;longContextRisk:boolean;note?:string;savingsVsCurrentPct:number|null;isCurrent:boolean;isCheapest:boolean;}

export function compareCandidates(input:{candidates:Candidate[];role:CostRole;size:TaskSize;current?:{provider:string;modelId?:string};history:(provider:string)=>HistoryProfile|null;fixedProfile?:TokenProfile}):ComparisonRow[]{
  const rows=input.candidates.map(({provider,price})=>{
    const history=input.fixedProfile?null:input.history(provider);
    const picked=history?profileForSize(history,input.size):null;
    const profile=input.fixedProfile||(picked?picked.profile:defaultProfile(provider,input.role,input.size));
    const spread=picked?picked.spread:{low:scaleProfile(profile,0.5),high:scaleProfile(profile,2.5)};
    const estimate=estimateProfileCost(price,profile,spread);
    return{provider,modelId:price.id,displayName:price.displayName,tier:price.tier,executable:price.executable,verified:Boolean(price.verified),expectedUsd:estimate.expectedUsd,lowUsd:estimate.lowUsd,highUsd:estimate.highUsd,longContextRisk:estimate.longContextRisk,note:price.note,savingsVsCurrentPct:null as number|null,isCurrent:false,isCheapest:false};
  }).sort((a,b)=>a.expectedUsd-b.expectedUsd);
  const current=rows.find(row=>row.provider===input.current?.provider&&row.modelId===input.current?.modelId);
  for(const row of rows){
    row.isCurrent=row===current;
    if(current&&current.expectedUsd>0)row.savingsVsCurrentPct=Math.round((1-row.expectedUsd/current.expectedUsd)*100);
  }
  const cheapest=rows.find(row=>row.executable);
  if(cheapest)cheapest.isCheapest=true;
  return rows;
}

// ───────── Resumo de gastos ─────────
export interface CostSummary{
  since:string;days:number;
  totalUsd:number;executions:number;
  unknownCostExecutions:number;mismatchExecutions:number;
  byModel:{model:string;provider:string;usd:number;executions:number;tokens:number}[];
  byRole:{role:string;usd:number;executions:number}[];
  byDay:{day:string;usd:number}[];
  expensive:{taskId:string;title:string;usd:number}[];
}

export function buildCostSummary(db:Database.Database,input:{workspaceId?:string;days:number;now?:Date}):CostSummary{
  const now=input.now||new Date();
  const since=new Date(now.getTime()-input.days*86_400_000).toISOString();
  const rows=db.prepare(`SELECT e.taskId,t.title,e.provider,e.role,e.model,e.actualModel,e.estimatedCost,e.costSource,e.tokenUsage,e.startedAt FROM executions e JOIN tasks t ON t.id=e.taskId WHERE e.startedAt>=? ${input.workspaceId?'AND t.workspaceId=?':''} AND e.status='completed'`).all(...(input.workspaceId?[since,input.workspaceId]:[since])) as any[];
  // Planner de missão e Refinador (fora do pipeline de tasks) ficam em ai_usage.
  const hasAiUsage=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_usage'").get());
  if(hasAiUsage){const extra=db.prepare(`SELECT NULL AS taskId,kind AS title,provider,kind AS role,model,actualModel,estimatedCost,costSource,tokenUsage,createdAt AS startedAt FROM ai_usage WHERE createdAt>=? ${input.workspaceId?'AND workspaceId=?':''}`).all(...(input.workspaceId?[since,input.workspaceId]:[since])) as any[];rows.push(...extra);}
  const summary:CostSummary={since,days:input.days,totalUsd:0,executions:rows.length,unknownCostExecutions:0,mismatchExecutions:0,byModel:[],byRole:[],byDay:[],expensive:[]};
  const model=new Map<string,any>(),role=new Map<string,any>(),day=new Map<string,number>(),task=new Map<string,{title:string;usd:number}>();
  for(const row of rows){
    const usd=typeof row.estimatedCost==='number'?row.estimatedCost:0;
    if(row.costSource==='unknown'||(row.costSource==null&&row.provider!=='mock'&&row.estimatedCost==null))summary.unknownCostExecutions++;
    summary.totalUsd+=usd;
    const modelKey=`${row.provider}|${String(row.actualModel||row.model).split(',').pop()}`;
    const m=model.get(modelKey)||{model:String(row.actualModel||row.model).split(',').pop(),provider:row.provider,usd:0,executions:0,tokens:0};m.usd+=usd;m.executions++;m.tokens+=Number(row.tokenUsage)||0;model.set(modelKey,m);
    const r=role.get(row.role)||{role:row.role,usd:0,executions:0};r.usd+=usd;r.executions++;role.set(row.role,r);
    const d=String(row.startedAt).slice(0,10);day.set(d,(day.get(d)||0)+usd);
    if(row.taskId){const t=task.get(row.taskId)||{title:row.title,usd:0};t.usd+=usd;task.set(row.taskId,t);}
  }
  summary.byModel=[...model.values()].sort((a,b)=>b.usd-a.usd);
  summary.byRole=[...role.values()].sort((a,b)=>b.usd-a.usd);
  summary.byDay=[...day.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([d,usd])=>({day:d,usd}));
  summary.expensive=[...task.entries()].map(([taskId,value])=>({taskId,...value})).sort((a,b)=>b.usd-a.usd).slice(0,5);
  const mismatch=db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='execution.cost_mismatch' AND timestamp>=?").get(since) as any;
  summary.mismatchExecutions=Number(mismatch?.c)||0;
  return summary;
}
