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

test('Claude Developer recovers balanced embedded JSON without confusing nested braces',()=>{
  const value={status:'COMPLETED',summary:'value with { braces } and escaped \\"quotes\\"',filesChanged:[],testsRun:[],notes:[],nested:{items:[{ok:true}]}};
  assert.deepEqual(parseClaudeStructuredText('Resultado final:\n'+JSON.stringify(value)+'\nPronto.'),value);
  assert.deepEqual(parseClaudeStructuredText('```json\n'+JSON.stringify(value)+'\n```'),value);
  assert.throws(()=>parseClaudeStructuredText('{"status":"COMPLETED",}'),/not valid JSON/);
});

test('Claude Developer resolves one auxiliary object plus one developer object safely',()=>{
  const value={status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[]};
  assert.deepEqual(parseClaudeStructuredText('Metadata: {"requestId":"safe"}\nResult: '+JSON.stringify(value)),value);
  assert.throws(()=>parseClaudeStructuredText(JSON.stringify(value)+'\n'+JSON.stringify({...value,summary:'second'})),/multiple developer JSON candidates/);
});

test('Claude Developer recursively parses result and content envelopes with noisy text',()=>{
  const value={status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[]};
  assert.deepEqual(parseClaudeStructuredText(JSON.stringify({type:'result',result:'texto '+JSON.stringify(value)})),value);
  assert.deepEqual(parseClaudeStructuredText(JSON.stringify({content:[{type:'text',text:'parte 1 '},{type:'text',text:JSON.stringify(value)}]})),value);
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
  assert.match(server,/developer\.structured_output_recovered/);
});

test('task overview neutralizes invalidated historical approval while preserving real approval',()=>{
  const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
  assert.match(main,/historicalReviewInvalid/);
  assert.match(main,/Revisão anterior invalidada/);
  assert.match(main,/retomada necessária/);
  assert.match(main,/review\.status==='APPROVED'/s);
});
