import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PRICING,computeCost,findPrice,mergePricing,openAiUsageToBreakdown} from '@orchestrator/shared';

const close=(actual:number,expected:number,epsilon=1e-9)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);
const price=(id:string)=>findPrice(DEFAULT_PRICING,id)!;

test('table reproduces the cost reported by the Claude CLI for a real Haiku 4.5 run (US$ 0.10229)',()=>{
  // modelUsage real: inputTokens 2077, cache create 38912 (1h), cache read 150522, output 1468 -> costUSD 0.10229320000000001
  const result=computeCost(price('claude-haiku-4-5'),{inputTokens:2077,cacheWrite1hTokens:38912,cacheReadTokens:150522,outputTokens:1468,requests:5});
  close(result.usd,0.1022932,1e-7);
});

test('table reproduces the auxiliary Haiku 4.5 call seen in the Haiku 5.5 probe (US$ 0.000945)',()=>{
  close(computeCost(price('claude-haiku-4-5'),{inputTokens:900,outputTokens:9}).usd,0.000945);
});

test('Haiku 5.5 probe costs about US$ 0.0106, not the US$ 0.425 the CLI reported with costBasis unknown',()=>{
  const result=computeCost(price('claude-haiku-5-5'),{inputTokens:2,cacheWrite1hTokens:53101,outputTokens:32});
  close(result.usd,0.0106364,1e-7);
  assert.ok(result.usd<0.426/30);
});

test('Codex Luna probe: cached input is part of input_tokens and billed at the cached rate',()=>{
  const breakdown=openAiUsageToBreakdown({input_tokens:14010,cached_input_tokens:11008,output_tokens:5});
  assert.equal(breakdown.inputTokens,3002);
  assert.equal(breakdown.cacheReadTokens,11008);
  close(computeCost(price('gpt-5.6-luna'),breakdown).usd,0.00082656,1e-9);
});

test('long context tiers apply above the threshold only',()=>{
  const small=computeCost(price('claude-haiku-5-5'),{inputTokens:50_000,outputTokens:1000});
  const large=computeCost(price('claude-haiku-5-5'),{inputTokens:150_000,outputTokens:1000});
  assert.equal(small.longContextApplied,false);
  assert.equal(large.longContextApplied,true);
  close(small.usd,50_000*0.10/1e6+1000*0.50/1e6);
  close(large.usd,150_000*0.50/1e6+1000*2.50/1e6);
  // contexto longo da OpenAI só acima de 272k
  assert.equal(computeCost(price('gpt-5.6-luna'),openAiUsageToBreakdown({input_tokens:300_000,output_tokens:10})).longContextApplied,true);
  assert.equal(computeCost(price('gpt-5.6-luna'),openAiUsageToBreakdown({input_tokens:100_000,output_tokens:10})).longContextApplied,false);
});

test('model lookup accepts ids, aliases and dated ids; unknown models return undefined',()=>{
  assert.equal(findPrice(DEFAULT_PRICING,'claude-haiku-4-5-20251001')?.id,'claude-haiku-4-5');
  assert.equal(findPrice(DEFAULT_PRICING,'haiku')?.id,'claude-haiku-4-5');
  assert.equal(findPrice(DEFAULT_PRICING,'CLAUDE-HAIKU-5-5')?.id,'claude-haiku-5-5');
  assert.equal(findPrice(DEFAULT_PRICING,'modelo-inexistente'),undefined);
  assert.equal(findPrice(DEFAULT_PRICING,''),undefined);
});

test('economy picks are really the cheapest per vendor and Cursor is informational only',()=>{
  const cost=(item:{id:string})=>computeCost(price(item.id),{inputTokens:2000,cacheWrite1hTokens:45000,cacheReadTokens:150000,outputTokens:1500,requests:5}).usd;
  const claude=DEFAULT_PRICING.filter(item=>item.vendor==='anthropic'&&item.status==='current').sort((a,b)=>cost(a)-cost(b));
  assert.equal(claude[0].id,'claude-haiku-5-5');
  assert.ok(cost(price('claude-sonnet-5-5'))/cost(price('claude-haiku-5-5'))>10);
  assert.ok(DEFAULT_PRICING.filter(item=>item.vendor==='cursor').every(item=>!item.executable));
});

test('override file merges by id and rejects invalid entries',()=>{
  const merged=mergePricing(DEFAULT_PRICING,[{id:'gpt-5.6-luna',output:9},{id:'novo-modelo',vendor:'openai',displayName:'Novo',input:1,output:2},{id:'invalido',input:'x',output:1},{semId:true},null]);
  assert.equal(findPrice(merged,'gpt-5.6-luna')?.output,9);
  assert.equal(findPrice(merged,'gpt-5.6-luna')?.input,0.2);
  assert.equal(findPrice(merged,'novo-modelo')?.output,2);
  assert.equal(findPrice(merged,'invalido'),undefined);
  assert.equal(mergePricing(DEFAULT_PRICING,'lixo').length,DEFAULT_PRICING.length);
});
