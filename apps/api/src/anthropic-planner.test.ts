import test from 'node:test';
import assert from 'node:assert/strict';
import {AnthropicMissionPlanner,buildMissionPlannerPrompt} from '@orchestrator/adapters';
import {resolveExecutionCost} from './cost-resolution.js';
import {DEFAULT_PRICING} from '@orchestrator/shared';

const PLAN=JSON.stringify({summary:'Página de tarefas',assumptions:['HTML puro'],risks:['localStorage cheio'],tasks:[
  {key:'T1',title:'Criar a página',description:'index.html, style.css e app.js',acceptanceCriteria:['Adicionar e excluir tarefas'],dependsOn:[]},
  {key:'T2',title:'Persistência',description:'Salvar no localStorage',acceptanceCriteria:['Recarregar mantém as tarefas'],dependsOn:['T1']},
]});
const input={title:'Lista',request:'Página de lista de tarefas',workspace:{name:'w',branch:'main',location:'C:/x'},projectContext:null,projectRules:[]};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const anthropicBody=(text:string)=>({content:[{type:'text',text}],usage:{input_tokens:1200,output_tokens:420}});

test('plans through the Messages API with the right request and records token usage',async()=>{
  let seen:any;
  const planner=new AnthropicMissionPlanner({model:'claude-haiku-5-5',apiKey:'sk-test',fetchImpl:(async(url:any,init:any)=>{seen={url:String(url),init,body:JSON.parse(init.body)};return reply(anthropicBody(PLAN));}) as any});
  const plan:any=await planner.plan(input);
  assert.equal(seen.url,'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'],'sk-test');
  assert.equal(seen.init.headers['anthropic-version'],'2023-06-01');
  assert.equal(seen.body.model,'claude-haiku-5-5');
  assert.ok(seen.body.max_tokens>=1024);
  assert.equal(seen.body.messages[0].content,buildMissionPlannerPrompt(input));
  assert.match(seen.body.messages[0].content,/MICRO task/);
  assert.equal(plan.tasks.length,2);
  assert.equal(plan.tasks[0].title,'Criar a página');
  assert.deepEqual(planner.lastUsage,{inputTokens:1200,outputTokens:420});
  // custo real desta chamada (Haiku 5.5): ~US$ 0,0003
  const cost=resolveExecutionCost({provider:'anthropic',model:'claude-haiku-5-5',result:{usageDetails:[{model:'claude-haiku-5-5',breakdown:{inputTokens:1200,outputTokens:420}}]}},DEFAULT_PRICING);
  assert.ok(cost.usd!>0&&cost.usd!<0.001,String(cost.usd));
});

test('fenced JSON from the model is accepted',async()=>{
  const planner=new AnthropicMissionPlanner({model:'claude-haiku-5-5',apiKey:'k',fetchImpl:(async()=>reply(anthropicBody('```json\n'+PLAN+'\n```'))) as any});
  assert.equal(((await planner.plan(input)) as any).tasks.length,2);
});

test('failures are classified: missing key, rejected key, server error, garbage and timeout',async()=>{
  let calls=0;
  const kind=async(planner:AnthropicMissionPlanner)=>{try{await planner.plan(input);return 'none';}catch(error:any){return error.kind;}};
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',fetchImpl:(async()=>{calls++;return reply({});}) as any})),'configuration_error');
  assert.equal(calls,0); // sem chave nem tenta a rede
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',apiKey:'k',fetchImpl:(async()=>reply({error:'x'},401)) as any})),'configuration_error');
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',apiKey:'k',fetchImpl:(async()=>reply({error:'x'},500)) as any})),'provider_error');
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',apiKey:'k',fetchImpl:(async()=>reply(anthropicBody('desculpe, não sei'))) as any})),'validation_error');
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',apiKey:'k',fetchImpl:(async()=>reply({content:[],usage:{}})) as any})),'validation_error');
  assert.equal(await kind(new AnthropicMissionPlanner({model:'m',apiKey:'k',fetchImpl:(async()=>{throw Object.assign(new Error('abort'),{name:'AbortError'});}) as any})),'timeout');
});
