import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {DEFAULT_PRICING,computeCost,findPrice} from '@orchestrator/shared';
import {buildCostSummary,candidatesFor,compareCandidates,defaultProfile,estimateProfileCost,profileFromHistory,scaleProfile} from './cost-estimator.js';

const price=(id:string)=>findPrice(DEFAULT_PRICING,id)!;

test('default Claude Code "small" profile is calibrated against the real measured run (US$ 0.1023 on Haiku 4.5)',()=>{
  const cost=computeCost(price('claude-haiku-4-5'),defaultProfile('claude-code','developer','small')).usd;
  assert.ok(Math.abs(cost-0.1023)/0.1023<0.05,`estimated ${cost}`);
});

test('Haiku 5.5 is roughly 10x cheaper than the Haiku 4.5 alias and 20x cheaper than Sonnet 5.5 for the same session',()=>{
  const profile=defaultProfile('claude-code','developer','small');
  const h55=computeCost(price('claude-haiku-5-5'),profile).usd,h45=computeCost(price('claude-haiku-4-5'),profile).usd,s55=computeCost(price('claude-sonnet-5-5'),profile).usd;
  assert.ok(h45/h55>8&&h45/h55<12,`h45/h55=${h45/h55}`);
  assert.ok(s55/h55>15,`s55/h55=${s55/h55}`);
});

test('spread is a real range and flags prompts close to the long-context tier',()=>{
  const profile=defaultProfile('claude-code','developer','medium');
  const estimate=estimateProfileCost(price('claude-haiku-5-5'),profile,{low:scaleProfile(profile,0.5),high:scaleProfile(profile,2.5)});
  assert.ok(estimate.lowUsd<estimate.expectedUsd&&estimate.expectedUsd<estimate.highUsd);
  const heavy={...profile,cacheReadTokens:2_000_000,requests:20};
  assert.equal(estimateProfileCost(price('claude-haiku-5-5'),heavy,{low:heavy,high:heavy}).longContextRisk,true);
});

test('comparison finds the cheapest executable model, marks the current one and the savings',()=>{
  const rows=compareCandidates({candidates:candidatesFor(DEFAULT_PRICING,['claude-code'],'developer'),role:'developer',size:'medium',current:{provider:'claude-code',modelId:'claude-sonnet-5-5'},history:()=>null});
  assert.equal(rows[0].modelId,'claude-haiku-5-5');
  assert.equal(rows[0].isCheapest,true);
  const current=rows.find(row=>row.isCurrent)!;
  assert.equal(current.modelId,'claude-sonnet-5-5');
  assert.ok(rows[0].savingsVsCurrentPct!>90);
  assert.equal(rows.some(row=>row.modelId==='claude-sonnet-4-5'),false); // legado fora por padrão
});

test('Cursor models are listed as informational and never picked as cheapest executable',()=>{
  const rows=compareCandidates({candidates:candidatesFor(DEFAULT_PRICING,['claude-code','codex-cli','cursor'],'developer'),role:'developer',size:'medium',history:()=>null});
  const cursor=rows.filter(row=>row.provider==='cursor');
  assert.ok(cursor.length>0&&cursor.every(row=>!row.executable&&!row.isCheapest));
});

function seed(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE tasks(id TEXT,workspaceId TEXT,title TEXT);
  CREATE TABLE executions(id TEXT,taskId TEXT,provider TEXT,role TEXT,model TEXT,actualModel TEXT,status TEXT,estimatedCost REAL,costSource TEXT,tokenUsage INTEGER,usageDetails TEXT,startedAt TEXT);
  CREATE TABLE audit_logs(action TEXT,timestamp TEXT);`);
  return db;
}
const detail=(input:number,write:number,read:number,output:number,requests=5)=>JSON.stringify([{model:'claude-haiku-5-5',breakdown:{inputTokens:input,cacheWrite1hTokens:write,cacheReadTokens:read,outputTokens:output,requests}}]);

test('history profile needs at least 3 real samples and then uses the median and percentiles',()=>{
  const db=seed();
  const insert=db.prepare('INSERT INTO executions (id,taskId,provider,role,model,status,usageDetails,startedAt) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('1','t','claude-code','developer','haiku','completed',detail(1000,40000,100000,1000),'2026-10-01T10:00:00Z');
  insert.run('2','t','claude-code','developer','haiku','completed',detail(2000,40000,200000,2000),'2026-10-02T10:00:00Z');
  assert.equal(profileFromHistory(db,'claude-code','developer'),null);
  insert.run('3','t','claude-code','developer','haiku','completed',detail(9000,40000,900000,9000),'2026-10-03T10:00:00Z');
  insert.run('4','t','claude-code','reviewer','x','completed',detail(1,1,1,1),'2026-10-03T11:00:00Z');
  const history=profileFromHistory(db,'claude-code','developer')!;
  assert.equal(history.samples,3);
  assert.equal(history.median.cacheReadTokens,200000);
  assert.equal(history.high.cacheReadTokens,900000);
  assert.ok(history.low.cacheReadTokens!<=history.median.cacheReadTokens!);
  // o histórico real passa a mandar na comparação
  const rows=compareCandidates({candidates:candidatesFor(DEFAULT_PRICING,['claude-code'],'developer'),role:'developer',size:'medium',history:provider=>profileFromHistory(db,provider,'developer')});
  assert.ok(rows.length>0);
});

test('summary aggregates real cost by model, role and day, and counts unknown costs',()=>{
  const db=seed();
  db.prepare("INSERT INTO tasks VALUES ('t1','w1','Task A'),('t2','w2','Task B')").run();
  const insert=db.prepare('INSERT INTO executions (id,taskId,provider,role,model,actualModel,status,estimatedCost,costSource,tokenUsage,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('1','t1','claude-code','developer','haiku','claude-haiku-5-5','completed',0.0116,'computed',1000,'2026-10-10T10:00:00Z');
  insert.run('2','t1','codex-cli','reviewer','gpt-5.6-luna','gpt-5.6-luna','completed',0.0008,'computed',500,'2026-10-10T11:00:00Z');
  insert.run('3','t1','mock','planner','mock-fast',null,'completed',0,'mock',100,'2026-10-11T11:00:00Z');
  insert.run('4','t2','claude-code','developer','haiku','claude-haiku-5-5','completed',0.5,'computed',1,'2026-10-11T12:00:00Z');
  insert.run('5','t1','codex-cli','reviewer','gpt-5.6-luna',null,'completed',null,'unknown',0,'2026-10-12T12:00:00Z');
  insert.run('6','t1','claude-code','developer','haiku',null,'failed',9,'computed',0,'2026-10-12T13:00:00Z');
  insert.run('7','t1','claude-code','developer','haiku','claude-haiku-5-5','completed',99,'computed',0,'2026-01-01T13:00:00Z');
  db.prepare("INSERT INTO audit_logs VALUES ('execution.cost_mismatch','2026-10-10T10:00:01Z')").run();
  const summary=buildCostSummary(db,{workspaceId:'w1',days:30,now:new Date('2026-10-13T00:00:00Z')});
  assert.equal(summary.executions,4);
  assert.ok(Math.abs(summary.totalUsd-0.0124)<1e-9);
  assert.equal(summary.unknownCostExecutions,1);
  assert.equal(summary.mismatchExecutions,1);
  assert.equal(summary.byModel[0].model,'claude-haiku-5-5');
  assert.deepEqual(summary.byDay.map(item=>item.day),['2026-10-10','2026-10-11','2026-10-12']);
  assert.equal(buildCostSummary(db,{days:30,now:new Date('2026-10-13T00:00:00Z')}).totalUsd.toFixed(4),'0.5124');
});
