import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createRuntimeConfig} from './task-config.js';

test('runtime config uses the same provider snapshot logic as task creation',()=>{
  const previous={...process.env};
  try {Object.assign(process.env,{DEVELOPER_PROVIDER:'claude-code',CLAUDE_MODEL:'sonnet',TESTER_PROVIDER:'command-tester',REVIEWER_PROVIDER:'codex-cli',CODEX_MODEL:'gpt-5.6-luna',TESTER_REQUIRED:'true',PROMPT_REFINER_PROVIDER:'mock',PROMPT_REFINER_MODEL:'mock-fast'});const config=createRuntimeConfig(process.env);assert.deepEqual(config.stages,{planner:{provider:'mock',model:'mock-fast'},developer:{provider:'claude-code',model:'sonnet'},tester:{provider:'command-tester',model:'local-command-runner'},reviewer:{provider:'codex-cli',model:'gpt-5.6-luna'}});assert.equal(config.testerRequired,true);}
  finally {for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];for(const [key,value] of Object.entries(previous))process.env[key]=value;}
});

test('runtime config exposes Anthropic Prompt Refiner without exposing the key',()=>{
  const previous={...process.env};
  try {Object.assign(process.env,{PROMPT_REFINER_PROVIDER:'anthropic',PROMPT_REFINER_MODEL:'claude-haiku-4-5-20251001',PROMPT_REFINER_API_KEY:'test-key'});const config=createRuntimeConfig(process.env);assert.deepEqual(config.promptRefiner,{provider:'anthropic',model:'claude-haiku-4-5-20251001',mode:'api'});assert.equal(JSON.stringify(config).includes('test-key'),false);}
  finally {for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];for(const [key,value] of Object.entries(previous))process.env[key]=value;}
});
