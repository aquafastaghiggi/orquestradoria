import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewerOutcome,wasWronglyMarkedNeedsFix} from './review-outcome.js';

test('the LAST review decides: APPROVED after an auto-fix cycle cancels the earlier NEEDS_FIX',()=>{
  let status=reviewerOutcome(undefined);
  for(const review of ['NEEDS_FIX','APPROVED'])status=reviewerOutcome(review);
  assert.equal(status,'approved');
  for(const review of ['APPROVED','NEEDS_FIX'])status=reviewerOutcome(review);
  assert.equal(status,'needs_fix');
  assert.equal(reviewerOutcome('NEEDS_FIX'),'needs_fix');
  assert.equal(reviewerOutcome('APPROVED'),'approved');
});

test('server uses the helper instead of the sticky needs_fix assignment',()=>{
  const source=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.ok(source.includes("if(role==='reviewer')reviewerTaskStatus=reviewerOutcome(result.structuredResult?.status);"));
  assert.equal(source.includes("reviewerTaskStatus='needs_fix';console.info('stage.complete'"),false);
});

const exec=(role:string,at:number,status='completed',result:any={})=>({role,status,startedAt:new Date(2026,9,13,19,0,at).toISOString(),structuredResult:result});

test('repair only fits a needs_fix task whose LAST execution is an approved review',()=>{
  const base=[exec('planner',1),exec('developer',2),exec('tester',3,'completed',{status:'PASSED'}),exec('reviewer',4,'completed',{status:'NEEDS_FIX'}),exec('developer',5),exec('tester',6),exec('reviewer',7,'completed',{status:'APPROVED'})];
  assert.equal(wasWronglyMarkedNeedsFix({status:'needs_fix',executions:base}),true);
  assert.equal(wasWronglyMarkedNeedsFix({status:'approved',executions:base}),false);
  assert.equal(wasWronglyMarkedNeedsFix({status:'failed',executions:base}),false);
  // a revisão aprovada não é a última: houve novo Developer depois
  assert.equal(wasWronglyMarkedNeedsFix({status:'needs_fix',executions:[...base,exec('developer',8)]}),false);
  // última revisão realmente pediu correção
  assert.equal(wasWronglyMarkedNeedsFix({status:'needs_fix',executions:[...base.slice(0,6),exec('reviewer',7,'completed',{status:'NEEDS_FIX'})]}),false);
  // revisão aprovada que não terminou
  assert.equal(wasWronglyMarkedNeedsFix({status:'needs_fix',executions:[...base.slice(0,6),exec('reviewer',7,'running',{status:'APPROVED'})]}),false);
  assert.equal(wasWronglyMarkedNeedsFix({status:'needs_fix',executions:[]}),false);
});
