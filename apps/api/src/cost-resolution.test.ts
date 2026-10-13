import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PRICING,openAiUsageToBreakdown,findPrice} from '@orchestrator/shared';
import {extractClaudeUsage} from '@orchestrator/adapters';
import {loadPricing,resolveExecutionCost} from './cost-resolution.js';

const close=(actual:number|null,expected:number,epsilon=1e-7)=>assert.ok(actual!==null&&Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);

// Envelope REAL do `claude -p --model claude-haiku-5-5 --output-format json` (2026-10-13): o CLI marcou costBasis "unknown"
const HAIKU_55_PROBE=JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,total_cost_usd:0.426401,
  usage:{input_tokens:2,cache_creation_input_tokens:53101,cache_read_input_tokens:0,output_tokens:32,output_tokens_details:{thinking_tokens:28},cache_creation:{ephemeral_1h_input_tokens:53101,ephemeral_5m_input_tokens:0}},
  modelUsage:{'claude-haiku-4-5-20251001':{inputTokens:900,outputTokens:9,cacheReadInputTokens:0,cacheCreationInputTokens:0,costUSD:0.000945,costBasis:'list'},
              'claude-haiku-5-5':{inputTokens:2,outputTokens:32,cacheReadInputTokens:0,cacheCreationInputTokens:53101,costUSD:0.425456,costBasis:'unknown'}},result:'ok'});

// Envelope REAL de uma task de verdade (Haiku 4.5, 5 turnos): o CLI conhecia o preço e a tabela bate
const HAIKU_45_TASK=JSON.stringify({type:'result',num_turns:5,total_cost_usd:0.10229320000000001,
  usage:{input_tokens:42,cache_creation_input_tokens:38912,cache_read_input_tokens:150522,output_tokens:1456,cache_creation:{ephemeral_1h_input_tokens:38912,ephemeral_5m_input_tokens:0}},
  modelUsage:{'claude-haiku-4-5-20251001':{inputTokens:2077,outputTokens:1468,cacheReadInputTokens:150522,cacheCreationInputTokens:38912,costUSD:0.10229320000000001,costBasis:'list'}}});

test('Haiku 5.5: computed cost wins over the inflated CLI value and the mismatch is flagged',()=>{
  const usage=extractClaudeUsage(HAIKU_55_PROBE)!;
  assert.equal(usage.models.length,2);
  const resolved=resolveExecutionCost({provider:'claude-code',model:'claude-haiku-5-5',result:{estimatedCost:usage.costUsd,usageDetails:usage.models.map(item=>({model:item.model,reportedUsd:item.reportedUsd,costBasis:item.costBasis,breakdown:{inputTokens:item.inputTokens,cacheWrite5mTokens:item.cacheWrite5mTokens,cacheWrite1hTokens:item.cacheWrite1hTokens,cacheReadTokens:item.cacheReadTokens,outputTokens:item.outputTokens,requests:usage.numTurns}}))}},DEFAULT_PRICING);
  close(resolved.usd,0.0106364+0.000945);
  close(resolved.reportedUsd,0.426401);
  assert.equal(resolved.source,'computed');
  assert.equal(resolved.mismatch,true);
  assert.deepEqual(resolved.models,['claude-haiku-4-5-20251001','claude-haiku-5-5']);
});

test('Haiku 4.5 real task: tables and CLI agree, so no mismatch is flagged',()=>{
  const usage=extractClaudeUsage(HAIKU_45_TASK)!;
  const resolved=resolveExecutionCost({provider:'claude-code',model:'haiku',result:{estimatedCost:usage.costUsd,usageDetails:usage.models.map(item=>({model:item.model,reportedUsd:item.reportedUsd,costBasis:item.costBasis,breakdown:{inputTokens:item.inputTokens,cacheWrite1hTokens:item.cacheWrite1hTokens,cacheWrite5mTokens:item.cacheWrite5mTokens,cacheReadTokens:item.cacheReadTokens,outputTokens:item.outputTokens,requests:usage.numTurns}}))}},DEFAULT_PRICING);
  close(resolved.usd,0.1022932);
  assert.equal(resolved.mismatch,false);
  assert.equal(resolved.source,'computed');
});

test('Codex Luna: tokens from turn.completed are priced with the OpenAI table',()=>{
  const resolved=resolveExecutionCost({provider:'codex-cli',model:'gpt-5.6-luna',result:{usageDetails:[{model:'gpt-5.6-luna',breakdown:openAiUsageToBreakdown({input_tokens:14010,cached_input_tokens:11008,output_tokens:5})}]}},DEFAULT_PRICING);
  close(resolved.usd,0.00082656,1e-9);
  assert.equal(resolved.source,'computed');
});

test('unknown model falls back to the provider value; no data at all stays unknown (never a fake zero)',()=>{
  const fallback=resolveExecutionCost({provider:'claude-code',model:'x',result:{usageDetails:[{model:'modelo-novo',reportedUsd:0.5,costBasis:'list',breakdown:{inputTokens:10,outputTokens:10}}]}},DEFAULT_PRICING);
  assert.equal(fallback.usd,0.5);assert.equal(fallback.source,'provider_reported');assert.deepEqual(fallback.unknownModels,['modelo-novo']);
  const none=resolveExecutionCost({provider:'codex-cli',model:'gpt-5.6-luna',result:{}},DEFAULT_PRICING);
  assert.equal(none.usd,null);assert.equal(none.source,'unknown');
  const mock=resolveExecutionCost({provider:'mock',model:'mock-fast',result:{}},DEFAULT_PRICING);
  assert.equal(mock.usd,0);assert.equal(mock.source,'mock');
});

test('PRICING_FILE overrides the default table',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pricing-'));
  try{
    const file=join(dir,'pricing.json');
    writeFileSync(file,JSON.stringify([{id:'gpt-5.6-luna',input:1,output:1}]));
    assert.equal(findPrice(loadPricing({PRICING_FILE:file} as NodeJS.ProcessEnv),'gpt-5.6-luna')?.input,1);
    assert.equal(findPrice(loadPricing({} as NodeJS.ProcessEnv),'gpt-5.6-luna')?.input,0.2);
    writeFileSync(file,'{ quebrado');
    assert.equal(findPrice(loadPricing({PRICING_FILE:file} as NodeJS.ProcessEnv),'gpt-5.6-luna')?.input,0.2);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
