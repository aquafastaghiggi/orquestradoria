import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateMission,formatDuration,DEFAULT_TASK_MS} from '@orchestrator/shared';

const t=(status:string,durationMs?:number)=>({status,durationMs});

test('mission estimate uses the default per-step time until a step finishes',()=>{
  const e=estimateMission({tasks:[t('running'),t('approved'),t('approved'),t('approved')],current:{index:0,stage:'developer',stageElapsedMs:0}});
  assert.equal(e.basis,'default');assert.equal(e.percent,0);assert.equal(e.currentTaskPercent,0);
  assert.equal(e.totalMs,DEFAULT_TASK_MS*4);assert.equal(e.remainingMs,DEFAULT_TASK_MS*4);
});

test('mission estimate is measured from completed steps and grows the percentage with elapsed time',()=>{
  const e=estimateMission({tasks:[t('completed',100000),t('completed',200000),t('running'),t('approved')],current:{index:2,stage:'developer',stageElapsedMs:52500}});
  assert.equal(e.basis,'measured');assert.equal(e.averageTaskMs,150000);
  // developer ocupa 70% da etapa; 52,5 s de ~105 s esperados = metade => 35%
  assert.equal(e.currentTaskPercent,35);
  assert.equal(e.percent,Math.round((100+100+35+0)/4));
  assert.equal(e.elapsedMs,300000+52500);
  assert.equal(e.remainingMs,Math.round(150000*0.65+150000));
});

test('stage progress never reaches 100% on its own and prefers the provider percent when given',()=>{
  const slow=estimateMission({tasks:[t('running')],current:{index:0,stage:'developer',stageElapsedMs:99999999}});
  assert.ok(slow.currentTaskPercent!<100&&slow.currentTaskPercent!>=60);
  const given=estimateMission({tasks:[t('running')],current:{index:0,stage:'reviewer',stageElapsedMs:1,progressPercent:50}});
  assert.equal(given.currentTaskPercent,90);
});

test('formatDuration is short and readable',()=>{
  assert.equal(formatDuration(45000),'45s');assert.equal(formatDuration(150000),'2min 30s');assert.equal(formatDuration(25*60000),'25 min');assert.equal(formatDuration(80*60000),'1h 20min');
});