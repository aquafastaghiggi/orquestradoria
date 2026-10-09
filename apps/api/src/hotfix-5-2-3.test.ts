import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBrowserScenarios} from '@orchestrator/adapters';
import {assertPipelineApprovalIntegrity,getResumeControl} from '@orchestrator/core';

const scenario=(step:any)=>[{name:'count',route:'/',steps:[step]}];

test('expectCount normalizes canonical and legacy count forms safely',()=>{
  const canonical=validateBrowserScenarios(scenario({action:'expectCount',target:{role:'row',name:'Item'},count:1}))[0].steps[0];
  assert.equal(canonical.count,1);
  assert.equal(canonical.value,undefined);
  assert.equal(validateBrowserScenarios(scenario({action:'expectCount',target:{role:'row'},value:0}))[0].steps[0].count,0);
  assert.equal(validateBrowserScenarios(scenario({action:'expectCount',target:{role:'row'},value:'12'}))[0].steps[0].count,12);
  for(const value of [-1,1.5,'abc',null,true]){
    assert.throws(()=>validateBrowserScenarios(scenario({action:'expectCount',target:{role:'row'},value})),/expectCount requires a non-negative integer/);
  }
});

test('resume chooses the latest failed stage after auto-fix and preserves guard semantics',()=>{
  const pipeline=['planner','developer','tester','reviewer'] as const;
  assert.equal(getResumeControl({pipeline:[...pipeline],status:'failed',failedExecutionRole:'developer',lastSuccessfulStage:'tester',currentStage:'developer',resumable:true}).resumeFromStage,'developer');
  assert.equal(getResumeControl({pipeline:[...pipeline],status:'stalled',currentStage:'tester',lastSuccessfulStage:'developer',resumable:true}).resumeFromStage,'tester');
  assert.equal(getResumeControl({pipeline:[...pipeline],status:'needs_manual_review',workspaceTokenLimitExceeded:{tokenUsage:100},environmentStatus:'manual_review_preserved',lastSuccessfulStage:'developer',failedExecutionRole:'developer',workspaceLimitActive:false}).resumeFromStage,'tester');
});

const chain=(items:any[])=>items.map((item,index)=>({...item,startedAt:`2026-01-01T00:00:${String(index).padStart(2,'0')}.000Z`,finishedAt:`2026-01-01T00:00:${String(index).padStart(2,'0')}.500Z`}));
const approvalTask:any={pipeline:['planner','developer','tester','reviewer'],lastSuccessfulStage:'reviewer',configSnapshot:{}};
const validChain=()=>chain([{role:'planner',status:'completed',structuredResult:{status:'COMPLETED'}},{role:'developer',status:'completed',structuredResult:{status:'COMPLETED'}},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]);

test('approval integrity requires the final ordered developer tester reviewer chain',()=>{
  assert.doesNotThrow(()=>assertPipelineApprovalIntegrity(approvalTask,validChain()));
  const cases=[
    chain([{role:'planner',status:'completed'},{role:'developer',status:'completed'},{role:'tester',status:'completed',structuredResult:{status:'FAILED'}},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]),
    chain([{role:'planner',status:'completed'},{role:'developer',status:'failed'},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]),
    chain([{role:'planner',status:'completed'},{role:'developer',status:'completed'},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'developer',status:'failed'},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]),
    chain([{role:'planner',status:'completed'},{role:'developer',status:'completed'},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'completed',structuredResult:{status:'NEEDS_FIX'}},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}])
  ];
  for(const executions of cases)assert.throws(()=>assertPipelineApprovalIntegrity(approvalTask,executions),/Pipeline approval integrity failed/);
  const reviewerRetry=chain([{role:'planner',status:'completed'},{role:'developer',status:'completed'},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'failed'},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]);
  assert.doesNotThrow(()=>assertPipelineApprovalIntegrity(approvalTask,reviewerRetry));
  const fixedAfterNeedsFix=chain([{role:'planner',status:'completed'},{role:'developer',status:'completed'},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'completed',structuredResult:{status:'NEEDS_FIX'}},{role:'developer',status:'completed',structuredResult:{status:'COMPLETED'}},{role:'tester',status:'completed',structuredResult:{status:'PASSED'}},{role:'reviewer',status:'completed',structuredResult:{status:'APPROVED'}}]);
  assert.doesNotThrow(()=>assertPipelineApprovalIntegrity(approvalTask,fixedAfterNeedsFix));
  const browserRequired={...approvalTask,configSnapshot:{browserQaEnabled:true,browserQaRequired:true}};
  const browserFailed=validChain();browserFailed[2].structuredResult={status:'PASSED',browserQa:{status:'FAILED'}};
  assert.throws(()=>assertPipelineApprovalIntegrity(browserRequired,browserFailed),/Pipeline approval integrity failed/);
});

test('API passes the resolved resume stage into the real task runner',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.match(server,/runTask\(task,\{resumeFromStage\}\)/);
  assert.match(server,/const start=task\.status==='pending'&&executionEvents\.length===0\?0:resumeResolution\.startIndex/);
  assert.match(server,/task\.approval_reconciled_invalid/);
  assert.match(server,/task_approval_integrity_invalid/);
});
