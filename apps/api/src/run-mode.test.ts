import test from 'node:test';
import assert from 'node:assert/strict';
import {extractClaudeUsage} from '@orchestrator/adapters';
import {forceMockSnapshot,isCostlyProvider,isForceMock,summarizeMode} from './run-mode.js';

test('claude usage is read from the real CLI json envelope (cost and tokens)',()=>{
  const envelope=JSON.stringify({type:'result',subtype:'success',is_error:false,total_cost_usd:0.10229320000000001,usage:{input_tokens:42,cache_creation_input_tokens:38912,cache_read_input_tokens:150522,output_tokens:1456,output_tokens_details:{thinking_tokens:595}},result:'{"status":"COMPLETED"}'});
  const usage=extractClaudeUsage(envelope)!;
  assert.equal(usage.costUsd,0.10229320000000001);
  assert.equal(usage.tokenUsage,42+38912+1456);
  assert.equal(usage.cachedInputTokens,150522);
  assert.equal(usage.outputTokens,1456);
  assert.equal(usage.reasoningTokens,595);
  assert.equal(extractClaudeUsage(`[${JSON.stringify({type:'system'})},${envelope}]`)?.costUsd,0.10229320000000001);
});

test('claude usage never throws on unexpected output',()=>{
  assert.equal(extractClaudeUsage(''),undefined);
  assert.equal(extractClaudeUsage('texto solto'),undefined);
  assert.equal(extractClaudeUsage('{"status":"COMPLETED"}'),undefined);
  assert.equal(extractClaudeUsage('{ quebrado'),undefined);
});

test('mode is real only when a paid provider is in use anywhere',()=>{
  const free={roles:[{role:'planner',provider:'mock',model:'mock-fast'},{role:'developer',provider:'mock',model:'mock-fast'},{role:'tester',provider:'command-tester',model:'local'}],missionPlanner:{provider:'mock',model:'mock-reasoning'},promptRefiner:{provider:'mock',model:'mock-fast'},forced:false};
  assert.equal(summarizeMode(free).mode,'mock');
  assert.equal(summarizeMode({...free,missionPlanner:{provider:'claude-code',model:'sonnet'}}).mode,'real');
  const real=summarizeMode({...free,roles:[...free.roles,{role:'reviewer',provider:'codex-cli',model:'gpt'}]});
  assert.equal(real.mode,'real');
  assert.deepEqual(real.costly.map(entry=>entry.key),['reviewer']);
  assert.match(real.summary,/Reviewer: Codex CLI/);
  assert.equal(isCostlyProvider('mock'),false);
  assert.equal(isCostlyProvider('command-tester'),false);
  assert.equal(isCostlyProvider('claude-code'),true);
});

test('force mock rewrites paid providers in memory and ORQ_FORCE_MOCK enables it',()=>{
  const snapshot={agentConfigs:[{role:'developer',provider:'claude-code',model:'sonnet'},{role:'tester',provider:'command-tester',model:'local'},{role:'reviewer',provider:'codex-cli',model:'x'}],providerSelection:'old'};
  const forced=forceMockSnapshot(snapshot);
  assert.deepEqual(forced.agentConfigs.map((config:any)=>config.provider),['mock','command-tester','mock']);
  assert.equal(snapshot.agentConfigs[0].provider,'claude-code');
  assert.match(forced.providerSelection!,/developer:mock\/mock-fast/);
  assert.equal(isForceMock({ORQ_FORCE_MOCK:'1'} as NodeJS.ProcessEnv),true);
  assert.equal(isForceMock({} as NodeJS.ProcessEnv),false);
});
