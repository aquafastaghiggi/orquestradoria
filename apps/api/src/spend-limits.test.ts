import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {DEFAULT_BUDGET_SETTINGS,checkSpendLimits,effectiveTaskBudget,loadBudgetSettings,saveBudgetSettings,spendSince} from './spend-limits.js';

function seed(){
  const db=new Database(':memory:');
  db.exec('CREATE TABLE executions(id TEXT,startedAt TEXT,estimatedCost REAL);CREATE TABLE ai_usage(id TEXT,createdAt TEXT,estimatedCost REAL);');
  return db;
}
const NOW=new Date(2026,9,13,15,0,0); // 13/10/2026 15:00 local
const at=(day:number,hour=10)=>new Date(2026,9,day,hour,0,0).toISOString();

test('defaults are conservative, env overrides them and saved values win; invalid input is rejected',()=>{
  const db=seed();
  assert.deepEqual(loadBudgetSettings(db,{} as NodeJS.ProcessEnv),DEFAULT_BUDGET_SETTINGS);
  assert.equal(loadBudgetSettings(db,{ORQ_DAILY_BUDGET_USD:'5'} as NodeJS.ProcessEnv).dailyUsd,5);
  assert.equal(loadBudgetSettings(db,{ORQ_DAILY_BUDGET_USD:'abc'} as NodeJS.ProcessEnv).dailyUsd,DEFAULT_BUDGET_SETTINGS.dailyUsd);
  saveBudgetSettings(db,{dailyUsd:1,monthlyUsd:0});
  const saved=loadBudgetSettings(db,{ORQ_DAILY_BUDGET_USD:'99'} as NodeJS.ProcessEnv);
  assert.equal(saved.dailyUsd,1);assert.equal(saved.monthlyUsd,0);assert.equal(saved.defaultTaskUsd,DEFAULT_BUDGET_SETTINGS.defaultTaskUsd);
  for(const bad of [-1,'x',1e9,NaN])assert.throws(()=>saveBudgetSettings(db,{dailyUsd:bad}),/inválido/);
});

test('spend counts task executions and Planner/Refiner usage by local day and month',()=>{
  const db=seed();
  const exec=db.prepare('INSERT INTO executions VALUES (?,?,?)'),ai=db.prepare('INSERT INTO ai_usage VALUES (?,?,?)');
  exec.run('1',at(13,9),0.5);exec.run('2',at(13,11),0.25);exec.run('3',at(10),1);exec.run('4',at(1),2);exec.run('5',new Date(2026,8,30,10).toISOString(),9);exec.run('6',at(13,12),null as any);
  ai.run('a',at(13,8),0.1);ai.run('b',at(2),0.4);
  const status=checkSpendLimits(db,{dailyUsd:0,monthlyUsd:0,defaultTaskUsd:0},NOW);
  assert.ok(Math.abs(status.todayUsd-0.85)<1e-9,String(status.todayUsd));
  assert.ok(Math.abs(status.monthUsd-4.25)<1e-9,String(status.monthUsd));
  assert.equal(spendSince(db,new Date(2026,9,13)),status.todayUsd);
});

test('blocks when the daily or monthly limit is reached, 0 means unlimited',()=>{
  const db=seed();
  db.prepare('INSERT INTO executions VALUES (?,?,?)').run('1',at(13,9),2);
  const daily=checkSpendLimits(db,{dailyUsd:2,monthlyUsd:20,defaultTaskUsd:0.5},NOW);
  assert.equal(daily.blocked,true);assert.equal(daily.reason,'daily');assert.match(daily.message!,/diário/);
  assert.equal(checkSpendLimits(db,{dailyUsd:2.01,monthlyUsd:20,defaultTaskUsd:0.5},NOW).blocked,false);
  const monthly=checkSpendLimits(db,{dailyUsd:0,monthlyUsd:2,defaultTaskUsd:0.5},NOW);
  assert.equal(monthly.reason,'monthly');
  assert.equal(checkSpendLimits(db,{dailyUsd:0,monthlyUsd:0,defaultTaskUsd:0},NOW).blocked,false);
});

test('default task cap applies only to paid providers and only when none was requested',()=>{
  const settings={dailyUsd:2,monthlyUsd:20,defaultTaskUsd:0.5};
  assert.equal(effectiveTaskBudget(0,true,settings),0.5);
  assert.equal(effectiveTaskBudget(undefined,true,settings),0.5);
  assert.equal(effectiveTaskBudget(0,false,settings),0);
  assert.equal(effectiveTaskBudget(0.1,true,settings),0.1);
  assert.equal(effectiveTaskBudget('abc',true,settings),0.5);
});
