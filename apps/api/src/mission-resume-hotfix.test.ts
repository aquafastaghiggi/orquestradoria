import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('mission resume reuses the failed child task and has one official route',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.equal((server.match(/app\.post\('\/api\/missions\/:id\/start'/g)||[]).length,1);
  assert.equal((server.match(/app\.post\('\/api\/missions\/:id\/resume'/g)||[]).length,1);
  assert.equal((server.match(/async function runMission\(/g)||[]).length,0);
  assert.match(server,/ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'blocked' THEN 1 WHEN 'running' THEN 2/);
  assert.match(server,/resumeControlForTask\(task/);
  assert.match(server,/mission\.resumed/);
  assert.match(server,/mission\.task_resumed/);
  assert.match(server,/void runMissionFixed\(mission\.id\)/);
});

test('mission detail exposes bounded execution errors for a failed current stage',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
  assert.match(server,/progressMessage,status,error FROM executions/);
  assert.match(server,/slice\(0,500\)/);
  assert.match(main,/failed','blocked','running','approved/);
  assert.match(main,/Falhou em:/);
  assert.match(main,/Próxima tentativa:/);
  assert.match(main,/RETOMANDO\.\.\./);
  assert.match(main,/mission\.resumed/);
  assert.match(main,/mission\.task_resumed/);
});
