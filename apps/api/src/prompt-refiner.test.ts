import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {AnthropicPromptRefiner,MockPromptRefiner,OpenAICompatiblePromptRefiner,buildFinalPrompt} from '@orchestrator/core';

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

test('Anthropic provider uses native Messages API and assembles finalPrompt locally',async()=>{
  const previous=globalThis.fetch;let captured:any;
  globalThis.fetch=async(input,init)=>{captured={input,init};return new Response(JSON.stringify({usage:{input_tokens:12,output_tokens:8},content:[{type:'thinking',thinking:'ignored'},{type:'text',text:'```json\n{"title":"Anthropic title","summary":"Summary","objective":"Do the requested work","context":[],"scope":["requested scope"],"constraints":[],"acceptanceCriteria":["it works"],"validation":[],"outOfScope":[],"warnings":[],"needsClarification":false,"clarifyingQuestions":[]}'},{type:'text',text:''}]}),{status:200});};
  try {const refiner=new AnthropicPromptRefiner('custom-anthropic-model',{baseUrl:'https://api.anthropic.com',apiKey:'secret-key',timeoutMs:1000,maxOutputChars:6000,maxRetries:0,maxTokens:1200});const result=await refiner.refine({request:'Do the requested work',workspaceName:'demo',workspaceBranch:'main'});assert.equal(captured.input,'https://api.anthropic.com/v1/messages');assert.equal(captured.init.headers['x-api-key'],'secret-key');assert.equal(captured.init.headers['anthropic-version'],'2023-06-01');const body=JSON.parse(captured.init.body);assert.equal(body.model,'custom-anthropic-model');assert.equal(body.max_tokens,1200);assert.equal(body.system.includes('Do not invent:'),true);assert.equal(body.tools,undefined);assert.equal(body.messages[0].role,'user');assert.equal(body.messages[0].content.includes('demo'),true);assert.equal(body.messages[0].content.includes('main'),true);assert.deepEqual(refiner.getUsage(),{inputTokens:12,outputTokens:8});assert.equal(result.title,'Anthropic title');assert.match(result.finalPrompt,/## Objective\nDo the requested work/);assert.doesNotMatch(result.finalPrompt,/Anthropic title.*unsafe/s);}
  finally {globalThis.fetch=previous;}
});

test('Anthropic provider concatenates text blocks and ignores non-text blocks',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({content:[{type:'tool_use',id:'ignored'},{type:'text',text:'{"title":"A",'},{type:'text',text:'"summary":"B","objective":"C","acceptanceCriteria":["D"]}'}]}),{status:200});
  try {const result=await new AnthropicPromptRefiner('claude-haiku-4-5-20251001',{baseUrl:'https://proxy.example',apiKey:'secret-key',timeoutMs:1000,maxOutputChars:6000,maxRetries:0,maxTokens:1200}).refine({request:'C'});assert.equal(result.title,'A');assert.equal(result.objective,'C');assert.deepEqual(result.context,[]);assert.deepEqual(result.constraints,[]);assert.deepEqual(result.validation,[]);assert.equal(result.needsClarification,false);}
  finally {globalThis.fetch=previous;}
});

test('Anthropic factory selects configured model without requiring a hardcoded key',async()=>{
  const previous=globalThis.fetch;let request:any;globalThis.fetch=async(input,init)=>{request={input,init};return new Response(JSON.stringify({content:[{type:'text',text:'{"title":"A","objective":"B","acceptanceCriteria":["C"]}'}]}),{status:200});};
  try {const {createPromptRefiner}=await import('@orchestrator/core');const refiner=createPromptRefiner({provider:'anthropic',model:'claude-haiku-4-5-20251001',apiKey:'secret-key'});assert.equal(refiner.model,'claude-haiku-4-5-20251001');await refiner.refine({request:'B'});assert.equal(request.input,'https://api.anthropic.com/v1/messages');}
  finally {globalThis.fetch=previous;}
});

test('Anthropic without an API key selects a safe fallback descriptor',async()=>{
  const {createPromptRefiner}=await import('@orchestrator/core');const refiner=createPromptRefiner({provider:'anthropic',model:'claude-haiku-4-5-20251001'});assert.equal(refiner.providerId,'anthropic');assert.equal(refiner.mode,'fallback');assert.equal(refiner.model,'claude-haiku-4-5-20251001');
});

test('Anthropic retries one transient 429 but does not retry 401 or invalid JSON',async()=>{
  const previous=globalThis.fetch;let transientCalls=0;globalThis.fetch=async()=>{transientCalls++;return transientCalls===1?new Response('{}',{status:429}):new Response(JSON.stringify({content:[{type:'text',text:'{"title":"A","objective":"B","acceptanceCriteria":["C"]}'}]}),{status:200});};
  try {const refiner=new AnthropicPromptRefiner('model',{baseUrl:'https://api.anthropic.com',apiKey:'secret-key',timeoutMs:1000,maxOutputChars:6000,maxRetries:1,maxTokens:1200});await refiner.refine({request:'B'});assert.equal(transientCalls,2);}
  finally {globalThis.fetch=previous;}
  let authCalls=0;globalThis.fetch=async()=>{authCalls++;return new Response('{}',{status:401});};
  try {const refiner=new AnthropicPromptRefiner('model',{baseUrl:'https://api.anthropic.com',apiKey:'secret-key',timeoutMs:1000,maxOutputChars:6000,maxRetries:1,maxTokens:1200});await assert.rejects(refiner.refine({request:'B'}));assert.equal(authCalls,1);}
  finally {globalThis.fetch=previous;}
  let invalidCalls=0;globalThis.fetch=async()=>{invalidCalls++;return new Response(JSON.stringify({content:[{type:'text',text:'not json'}]}),{status:200});};
  try {const refiner=new AnthropicPromptRefiner('model',{baseUrl:'https://api.anthropic.com',apiKey:'secret-key',timeoutMs:1000,maxOutputChars:6000,maxRetries:1,maxTokens:1200});await assert.rejects(refiner.refine({request:'B'}));assert.equal(invalidCalls,1);}
  finally {globalThis.fetch=previous;}
});
