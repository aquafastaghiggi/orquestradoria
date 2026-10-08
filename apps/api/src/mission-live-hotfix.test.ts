import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {parseClaudeStructuredText} from '@orchestrator/adapters';

test('Claude Developer accepts one JSON fence in a textual preamble and rejects multiples',()=>{
  const value={status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[]};
  const fence=String.fromCharCode(96).repeat(3);
  assert.deepEqual(parseClaudeStructuredText('Here is the result:\n'+fence+'json\n'+JSON.stringify(value)+'\n'+fence),value);
  assert.deepEqual(parseClaudeStructuredText(JSON.stringify({type:'result',result:'Here:\n'+fence+'json\n'+JSON.stringify(value)+'\n'+fence})),value);
  assert.throws(()=>parseClaudeStructuredText(fence+'json\n'+JSON.stringify(value)+'\n'+fence+'\n'+fence+'json\n'+JSON.stringify(value)+'\n'+fence),error=>{assert.equal((error as any).kind,'validation_error');return true;});
});

test('mission detail refreshes from mission SSE events and exposes current execution data',()=>{
  const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
  assert.match(main,/mission\.started/);
  assert.match(main,/mission\.task_started/);
  assert.match(main,/mission\.task_completed/);
  assert.match(main,/mission\.waiting_human/);
  assert.match(main,/mission\.completed/);
  assert.match(main,/mission\.failed/);
  assert.match(main,/setInterval\(\(\)=>void refresh\(\),1000\)/);
  assert.match(main,/Etapa da missão:/);
  assert.match(main,/Pipeline:/);
  assert.match(main,/Provider: \{providerLabel\(current\.execution\.provider\)\}/);
});

test('developer validation failures are audited with bounded safe diagnostics',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.match(server,/developer\.structured_output_invalid/);
  assert.match(server,/stdoutLength/);
  assert.match(server,/slice\(0,500\)/);
  assert.match(server,/preview/);
});
