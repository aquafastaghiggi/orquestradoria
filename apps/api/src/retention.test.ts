import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {DEFAULT_RETENTION_DAYS,applyRetention,planRetention,readRetention,saveRetention} from './retention.js';

const NOW=new Date('2026-10-14T12:00:00Z');
const daysAgo=(days:number)=>new Date(NOW.getTime()-days*86_400_000).toISOString();

function seed(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE retention_config (id INTEGER PRIMARY KEY CHECK(id=1),eventsDays INTEGER NOT NULL,logsDays INTEGER NOT NULL,artifactsDays INTEGER NOT NULL,rawProviderResponsesDays INTEGER NOT NULL);
  INSERT INTO retention_config VALUES (1,30,30,90,14);
  CREATE TABLE tasks(id TEXT,status TEXT,environmentStatus TEXT);
  CREATE TABLE events(id TEXT,type TEXT,taskId TEXT,payload TEXT,createdAt TEXT);
  CREATE TABLE executions(id TEXT,taskId TEXT,startedAt TEXT,logs TEXT,stdout TEXT,stderr TEXT,progressEvents TEXT,rawProviderResponse TEXT);
  CREATE TABLE artifacts(id TEXT,taskId TEXT,createdAt TEXT,content TEXT);
  CREATE TABLE audit_logs(id TEXT,timestamp TEXT);`);
  const task=db.prepare('INSERT INTO tasks VALUES (?,?,?)');
  task.run('applied','approved','applied');task.run('discarded','approved','discarded');task.run('cancelled','cancelled','failed_preserved');
  task.run('waiting','approved','approved_waiting_action');task.run('preserved','failed','failed_preserved');task.run('running','implementing','active');
  const event=db.prepare('INSERT INTO events VALUES (?,?,?,?,?)'),exec=db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?)'),art=db.prepare('INSERT INTO artifacts VALUES (?,?,?,?)');
  for(const id of ['applied','discarded','cancelled','waiting','preserved','running']){
    event.run(`e-old-${id}`,'x',id,'0123456789',daysAgo(60));event.run(`e-new-${id}`,'x',id,'0123456789',daysAgo(5));
    exec.run(`x-old-${id}`,id,daysAgo(60),'log','out','err','[]','raw');exec.run(`x-new-${id}`,id,daysAgo(5),'log','out','err','[]','raw');
    art.run(`a-old-${id}`,id,daysAgo(120),'conteudo');art.run(`a-new-${id}`,id,daysAgo(10),'conteudo');
  }
  event.run('e-system-old','sys',null,'0123456789',daysAgo(60));event.run('e-system-new','sys',null,'0123456789',daysAgo(1));
  db.prepare('INSERT INTO audit_logs VALUES (?,?)').run('audit-old',daysAgo(500));
  return db;
}

test('config is readable, defaults to the documented values and rejects invalid days',()=>{
  const db=seed();
  assert.deepEqual(readRetention(db),DEFAULT_RETENTION_DAYS);
  assert.equal(saveRetention(db,{eventsDays:7}).eventsDays,7);
  assert.equal(readRetention(db).logsDays,30);
  for(const bad of [0,-1,1.5,'x',99999])assert.throws(()=>saveRetention(db,{logsDays:bad}),/inválido/);
  assert.deepEqual(readRetention(new Database(':memory:')),DEFAULT_RETENTION_DAYS);
});

test('plan counts only old data of finished tasks (+ system events)',()=>{
  const plan=planRetention(seed(),DEFAULT_RETENTION_DAYS,NOW);
  assert.equal(plan.events,3+1);          // applied, discarded, cancelled (60d) + evento de sistema
  assert.equal(plan.logExecutions,3);
  assert.equal(plan.rawExecutions,3);
  assert.equal(plan.artifacts,3);
  assert.ok(plan.estimatedBytes>0);
});

test('apply prunes exactly the plan and never touches active/waiting/preserved tasks, recent data or the audit trail',()=>{
  const db=seed();
  const plan=applyRetention(db,DEFAULT_RETENTION_DAYS,NOW);
  assert.equal(plan.events,4);
  const count=(sql:string)=>(db.prepare(sql).get() as any).c;
  for(const id of ['waiting','preserved','running']){
    assert.equal(count(`SELECT COUNT(*) AS c FROM events WHERE taskId='${id}'`),2);
    assert.equal(count(`SELECT COUNT(*) AS c FROM artifacts WHERE taskId='${id}'`),2);
    assert.equal(count(`SELECT COUNT(*) AS c FROM executions WHERE taskId='${id}' AND stdout IS NOT NULL AND rawProviderResponse IS NOT NULL`),2);
  }
  for(const id of ['applied','discarded','cancelled']){
    assert.equal(count(`SELECT COUNT(*) AS c FROM events WHERE taskId='${id}'`),1);          // só o recente
    assert.equal(count(`SELECT COUNT(*) AS c FROM artifacts WHERE taskId='${id}'`),1);
    assert.equal(count(`SELECT COUNT(*) AS c FROM executions WHERE taskId='${id}' AND stdout IS NOT NULL`),1); // execuções ficam, blobs antigos somem
    assert.equal(count(`SELECT COUNT(*) AS c FROM executions WHERE taskId='${id}'`),2);
  }
  assert.equal(count("SELECT COUNT(*) AS c FROM events WHERE id='e-system-old'"),0);
  assert.equal(count("SELECT COUNT(*) AS c FROM events WHERE id='e-system-new'"),1);
  assert.equal(count('SELECT COUNT(*) AS c FROM audit_logs'),1);
  assert.deepEqual(planRetention(db,DEFAULT_RETENTION_DAYS,NOW),{events:0,logExecutions:0,rawExecutions:0,artifacts:0,estimatedBytes:0});
});
