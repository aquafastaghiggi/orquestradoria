import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnoseSqlite} from './sqlite-diagnostics.js';

test('SQLite runtime available keeps Doctor healthy even without CLI',()=>{
  let closed=false;
  const result=diagnoseSqlite({cliCheck:()=>false,createDatabase:()=>({prepare:()=>({get:()=>({ok:1})}),close:()=>{closed=true;}})});
  assert.equal(result.available,true);
  assert.equal(result.driver,'better-sqlite3');
  assert.equal(result.mode,'Node.js embedded');
  assert.equal(result.cliAvailable,false);
  assert.equal(closed,true);
});

test('SQLite runtime failure is reported without hiding the error',()=>{
  const result=diagnoseSqlite({cliCheck:()=>false,createDatabase:()=>{throw new Error('binding unavailable');}});
  assert.equal(result.available,false);
  assert.match(result.error||'',/binding unavailable/);
  assert.equal(result.cliAvailable,false);
});

test('SQLite smoke diagnostic uses an isolated connection and closes it',()=>{
  let sql='';let closed=false;
  const result=diagnoseSqlite({cliCheck:()=>true,createDatabase:()=>({prepare:(value)=>{sql=value;return {get:()=>({ok:1})};},close:()=>{closed=true;}})});
  assert.equal(result.available,true);
  assert.equal(sql,'SELECT 1 AS ok');
  assert.equal(closed,true);
  assert.equal(result.cliAvailable,true);
});
