import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {recoverInterruptedWork} from './startup-recovery.js';

function seed(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE tasks(id TEXT,status TEXT,resumable INTEGER,isolationMode TEXT,environmentStatus TEXT,updatedAt TEXT,missionId TEXT);
  CREATE TABLE executions(id TEXT,taskId TEXT,status TEXT,error TEXT,finishedAt TEXT);
  CREATE TABLE missions(id TEXT,status TEXT,environmentWarning TEXT,updatedAt TEXT,environmentStatus TEXT);
  CREATE TABLE mission_tasks(id TEXT,missionId TEXT,status TEXT,updatedAt TEXT);
  CREATE TABLE locks(key TEXT,owner TEXT,at TEXT);`);
  return db;
}

test('interrupted tasks, executions, missions and stale locks are recovered; finished work is untouched',()=>{
  const db=seed();
  const task=db.prepare('INSERT INTO tasks (id,status,resumable,isolationMode,environmentStatus,updatedAt) VALUES (?,?,?,?,?,?)');
  task.run('t-impl','implementing',0,'worktree','active','x');
  task.run('t-rev','reviewing',0,'current-workspace',null,'x');
  task.run('t-ok','approved',0,'worktree','approved_waiting_action','x');
  task.run('t-fail','failed',1,'worktree','failed_preserved','x');
  task.run('t-pending','pending',1,'worktree',null,'x');
  const exec=db.prepare('INSERT INTO executions VALUES (?,?,?,?,?)');
  exec.run('e1','t-impl','running',null,null);exec.run('e2','t-ok','completed',null,'2026-01-01');
  db.prepare('INSERT INTO missions (id,status,environmentWarning,updatedAt) VALUES (?,?,?,?)').run('m-run','running',null,'x');
  db.prepare('INSERT INTO missions (id,status,environmentWarning,updatedAt) VALUES (?,?,?,?)').run('m-done','completed',null,'x');
  const step=db.prepare('INSERT INTO mission_tasks VALUES (?,?,?,?)');
  step.run('s1','m-run','completed','x');step.run('s2','m-run','running','x');step.run('s3','m-run','approved','x');
  db.prepare('INSERT INTO locks VALUES (?,?,?)').run('workspace:1','owner','x');

  const report=recoverInterruptedWork(db,new Date('2026-10-14T10:00:00Z'));
  assert.deepEqual(report.tasks.map(item=>item.id).sort(),['t-impl','t-rev']);
  assert.equal(report.executions,1);
  assert.deepEqual(report.missions,[{id:'m-run',steps:1}]);
  assert.equal(report.locksCleared,1);

  const get=(table:string,id:string)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as any;
  assert.equal(get('tasks','t-impl').status,'stalled');
  assert.equal(get('tasks','t-impl').resumable,1);
  assert.equal(get('tasks','t-impl').environmentStatus,'failed_preserved'); // worktree preservado
  assert.equal(get('tasks','t-rev').environmentStatus,null);               // sem worktree: não inventa ambiente
  assert.equal(get('tasks','t-ok').status,'approved');
  assert.equal(get('tasks','t-fail').status,'failed');
  assert.equal(get('tasks','t-pending').status,'pending');
  assert.equal(get('executions','e1').status,'stalled');
  assert.match(get('executions','e1').error,/reiniciada/);
  assert.equal(get('executions','e2').status,'completed');
  assert.equal(get('missions','m-run').status,'waiting_human');
  assert.equal(get('missions','m-done').status,'completed');
  assert.equal(get('mission_tasks','s2').status,'blocked');
  assert.equal(get('mission_tasks','s1').status,'completed');
  assert.equal(get('mission_tasks','s3').status,'approved');
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM locks').get() as any).c,0);
});

test('recovery is idempotent and safe on databases without the tables yet',()=>{
  const db=seed();
  db.prepare('INSERT INTO tasks (id,status,resumable,isolationMode,environmentStatus,updatedAt) VALUES (?,?,?,?,?,?)').run('t','testing',0,'worktree','active','x');
  assert.equal(recoverInterruptedWork(db).tasks.length,1);
  assert.equal(recoverInterruptedWork(db).tasks.length,0);
  assert.deepEqual(recoverInterruptedWork(new Database(':memory:')),{tasks:[],executions:0,missions:[],locksCleared:0,missionTasksSynced:0});
});

test('child tasks of an applied/undone/discarded mission stop showing stale "waiting" environments',()=>{
  const db=seed();
  const mission=db.prepare('INSERT INTO missions (id,status,updatedAt,environmentStatus) VALUES (?,?,?,?)');
  mission.run('m-undone','completed','x','undone');mission.run('m-applied','completed','x','applied');mission.run('m-waiting','completed','x','approved_waiting_action');
  const child=db.prepare('INSERT INTO tasks (id,status,resumable,isolationMode,environmentStatus,updatedAt,missionId) VALUES (?,?,?,?,?,?,?)');
  child.run('c1','approved',0,'worktree','approved_waiting_action','x','m-undone');
  child.run('c2','approved',0,'worktree','approved_waiting_action','x','m-applied');
  child.run('c3','approved',0,'worktree','approved_waiting_action','x','m-waiting');   // missão ainda aguarda: não mexe
  child.run('c4','approved',0,'worktree','applied','x',null);                          // task avulsa: não mexe
  const report=recoverInterruptedWork(db);
  assert.equal(report.missionTasksSynced,2);
  const env=(id:string)=>(db.prepare('SELECT environmentStatus AS e FROM tasks WHERE id=?').get(id) as any).e;
  assert.equal(env('c1'),'undone');assert.equal(env('c2'),'applied');assert.equal(env('c3'),'approved_waiting_action');assert.equal(env('c4'),'applied');
});