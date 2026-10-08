import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('diff review completeness is enforced by API and exposed by mission UI',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
  assert.match(server,/review\.reviewComplete/);
  assert.match(server,/mission_diff_incomplete/);
  assert.match(server,/A revisão das alterações está incompleta/);
  assert.match(main,/missionDiff\?\.reviewComplete===false/);
  assert.match(main,/O diff foi truncado por tamanho/);
  assert.match(main,/A revisão não contém todos os arquivos/);
  assert.match(main,/missionDiff\.files\.map/);
});
