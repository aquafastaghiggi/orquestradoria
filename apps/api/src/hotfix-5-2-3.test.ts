import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBrowserScenarios} from '@orchestrator/adapters';
import {getResumeControl} from '@orchestrator/core';

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
