import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {MockPromptRefiner,OpenAICompatiblePromptRefiner,buildFinalPrompt} from '@orchestrator/core';

test('mock prompt refiner returns structured output without inventing stack details',async()=>{
  const result=await new MockPromptRefiner().refine({request:'melhora a tela',workspaceName:'demo'});
  assert.equal(result.needsClarification,true);
  assert.equal(result.context[0],'Workspace: demo');
  assert.match(result.finalPrompt,/## Acceptance criteria/);
  assert.doesNotMatch(JSON.stringify(result),/React|Vue|PHP|PostgreSQL|MySQL/i);
});

test('final prompt is assembled deterministically by the application',()=>{
  const value={title:'T',summary:'S',objective:'O',context:[],scope:[],constraints:['C'],acceptanceCriteria:['A'],validation:['V'],outOfScope:['X'],warnings:[]};
  assert.equal(buildFinalPrompt(value),buildFinalPrompt(value));
  assert.match(buildFinalPrompt(value),/## Objective\nO/);
});

test('OpenAI-compatible result is mocked and never trusts model finalPrompt',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'Model title',summary:'Summary',objective:'Do exactly this',context:[],scope:['requested'],constraints:[],acceptanceCriteria:['done'],validation:[],outOfScope:[],warnings:[],finalPrompt:'unsafe model prompt'})}}]}),{status:200,headers:{'content-type':'application/json'}});
  try {const refiner=new OpenAICompatiblePromptRefiner('safe-model',{baseUrl:'https://example.invalid/v1',apiKey:'test-secret',timeoutMs:1000,maxOutputChars:6000,maxRetries:0});const result=await refiner.refine({request:'Do exactly this'});assert.equal(result.title,'Model title');assert.doesNotMatch(result.finalPrompt,/unsafe model prompt/);}
  finally {globalThis.fetch=previous;}
});

test('OpenAI-compatible timeout is bounded and error does not expose secrets',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async(_input,_init)=>await new Promise<Response>((_,reject)=>setTimeout(()=>reject(new Error('late')),100));
  try {const refiner=new OpenAICompatiblePromptRefiner('safe-model',{baseUrl:'https://example.invalid/v1',apiKey:'test-secret',timeoutMs:5,maxOutputChars:6000,maxRetries:0});await assert.rejects(refiner.refine({request:'x'}),error=>{assert.equal((error as Error).message,'Prompt refiner provider failed: unavailable');return true;});}
  finally {globalThis.fetch=previous;}
});
