import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {buildWorkspaceHistory,classifyMissionPhase,classifyPhase} from './workspace-history.js';

test('phase tells the user what to do next',()=>{
  assert.equal(classifyPhase('approved','applied').group,'done');
  assert.equal(classifyPhase('approved','discarded').group,'done');
  assert.equal(classifyPhase('implementing','active').group,'running');
  assert.equal(classifyPhase('approved','approved_waiting_action').group,'waiting');
  assert.equal(classifyPhase('failed','failed_preserved').group,'attention');
  assert.equal(classifyPhase('needs_manual_review','manual_review_preserved').group,'attention');
  assert.equal(classifyPhase('cancelled','failed_preserved').label,'Cancelada');
  assert.equal(classifyPhase('pending',null).group,'queued');
  assert.equal(classifyMissionPhase('plan_ready').group,'waiting');
  assert.equal(classifyMissionPhase('waiting_human').group,'waiting');
  assert.equal(classifyMissionPhase('running').group,'running');
  assert.equal(classifyMissionPhase('completed','applied').group,'done');
});

test('history aggregates executions per task and folds mission child tasks into the mission',()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE tasks(id TEXT,workspaceId TEXT,title TEXT,description TEXT,pipeline TEXT,status TEXT,environmentStatus TEXT,missionId TEXT,baseBranch TEXT,fixCycle INTEGER,createdAt TEXT,updatedAt TEXT);
  CREATE TABLE executions(id TEXT,taskId TEXT,role TEXT,status TEXT,tokenUsage INTEGER,estimatedCost REAL,duration INTEGER,startedAt TEXT,structuredResult TEXT);
  CREATE TABLE missions(id TEXT,workspaceId TEXT,title TEXT,request TEXT,status TEXT,environmentStatus TEXT,baseBranch TEXT,createdAt TEXT,updatedAt TEXT);
  CREATE TABLE mission_tasks(id TEXT,missionId TEXT,status TEXT);`);
  const task=db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  task.run('t1','w','Ajustar botão','Critérios de aceite:\n- x\n\nObservações: ajuste solicitado pelo usuário (rodada 1). foo','["developer","tester"]','approved','approved_waiting_action',null,'master',1,'2026-01-01T10:00:00Z','2026-01-01T11:00:00Z');
  task.run('t2','w','Outra workspace','d','[]','approved','approved_waiting_action',null,'master',0,'2026-01-01','2026-01-01');
  task.run('c1','w','Etapa 1','d','["developer"]','approved','approved_waiting_action','m1','master',0,'2026-01-02','2026-01-02');
  db.prepare("UPDATE tasks SET workspaceId='other' WHERE id='t2'").run();
  const exec=db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?)');
  exec.run('e1','t1','developer','completed',1000,0.5,60000,'2026-01-01T10:00:01Z',JSON.stringify({actualChangedFiles:['a.php','b.php']}));
  exec.run('e2','t1','tester','running',200,0.1,5000,'2026-01-01T10:02:00Z','{}');
  exec.run('e3','c1','developer','completed',300,0.2,10000,'2026-01-02T10:00:00Z',JSON.stringify({actualChangedFiles:['c.php']}));
  db.prepare('INSERT INTO missions VALUES (?,?,?,?,?,?,?,?,?)').run('m1','w','Missão grande','pedido','running',null,'master','2026-01-02','2026-01-03');
  db.prepare('INSERT INTO mission_tasks VALUES (?,?,?)').run('s1','m1','completed');
  db.prepare('INSERT INTO mission_tasks VALUES (?,?,?)').run('s2','m1','pending');

  const history=buildWorkspaceHistory(db,'w');
  assert.equal(history.length,2);
  const mission=history.find(item=>item.kind==='mission')!;
  assert.deepEqual(mission.progress,{done:1,total:2});
  assert.equal(mission.tokens,300);
  assert.equal(mission.filesChanged,1);
  const first=history.find(item=>item.id==='t1')!;
  assert.equal(first.tokens,1200);
  assert.equal(first.durationMs,65000);
  assert.equal(first.filesChanged,2);
  assert.equal(first.adjustments,1);
  assert.equal(first.fixCycles,1);
  assert.deepEqual(first.stages,[{role:'developer',status:'completed'},{role:'tester',status:'running'}]);
  assert.equal(first.phase.group,'waiting');
  assert.equal(history.some(item=>item.id==='c1'||item.id==='t2'),false);
});
