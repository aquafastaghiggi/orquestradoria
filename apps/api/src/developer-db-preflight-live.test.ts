import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {databaseNameFor,dropTaskDatabase,listManagedDatabases,loadProjectDbConfig,prepareDeveloperDatabase,runMysql,testProjectDb} from './project-database.js';

/**
 * Teste contra o MySQL real do XAMPP, usando SOMENTE um banco descartável orq_* (apagado ao final).
 * Pulado quando o login de teste não está configurado, o MySQL está desligado ou não há PHP.
 */
const PHP=process.platform==='win32'?'C:/xampp/php/php.exe':'php';
const config=loadProjectDbConfig();
const reachable=config&&existsSync(config.mysqlBin)&&existsSync(PHP)?await testProjectDb(config):{ok:false};
const live=reachable.ok?test:test.skip;

const hooks=()=>{const audits:Array<{action:string;metadata:Record<string,unknown>}>=[],events:Array<{type:string;data:Record<string,unknown>}>=[],registered:string[]=[];
  return{audits,events,registered,hooks:{register:(name:string)=>{registered.push(name);},audit:(action:string,metadata:Record<string,unknown>)=>{audits.push({action,metadata});},emit:(type:string,data:Record<string,unknown>)=>{events.push({type,data});}}};};

const PHP_SCRIPT=`<?php
$host=getenv('ORQ_DB_HOST');$port=getenv('ORQ_DB_PORT');$name=getenv('ORQ_DB_NAME');
$pdo=new PDO("mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4",getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE IF NOT EXISTS probe (id INT PRIMARY KEY)');
$pdo->exec('INSERT IGNORE INTO probe (id) VALUES (1)');
echo 'conectado:'.$pdo->query('SELECT DATABASE()')->fetchColumn().' linhas:'.$pdo->query('SELECT COUNT(*) FROM probe')->fetchColumn()."\n";
`;

live('real MySQL: preflight succeeds on a throwaway orq_* database, PHP reads ORQ_DB_* and connects without printing credentials, audit/event recorded',async()=>{
  const key=`pf${randomBytes(6).toString('hex')}`,name=databaseNameFor(key),dir=mkdtempSync(join(tmpdir(),'orq-live-'));
  const {audits,events,registered,hooks:h}=hooks();
  try{
    const prepared=await prepareDeveloperDatabase(config!,key,h);
    assert.deepEqual(prepared.preflight,{ok:true});assert.equal(prepared.env?.ORQ_DB_NAME,name);assert.match(name,/^orq_pf[0-9a-f]{12}$/);
    assert.deepEqual(registered,[name]);assert.deepEqual(events,[],'no failure event on success');
    assert.deepEqual(audits,[{action:'project_database.preflight',metadata:{status:'ok'}}]);
    assert.equal(JSON.stringify(audits).includes(config!.password),false);

    writeFileSync(join(dir,'probe.php'),PHP_SCRIPT);
    const run=spawnSync(PHP,['probe.php'],{cwd:dir,env:{...process.env,...prepared.env},encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.equal(run.stdout.trim(),`conectado:${name} linhas:1`);
    for(const secret of [config!.password,prepared.env!.ORQ_DB_USER])assert.equal(run.stdout.includes(secret)||run.stderr.includes(secret),false,'credentials are never printed');
    assert.ok((await listManagedDatabases(config!))!.includes(name));
  }finally{await dropTaskDatabase(config!,name);rmSync(dir,{recursive:true,force:true});}
  assert.equal((await listManagedDatabases(config!))!.includes(name),false,'throwaway database removed');
});

live('real MySQL: wrong password and wrong port fail once with a friendly diagnosis, audit + event recorded, nothing created',async()=>{
  for(const [label,bad,pattern] of [['password',{...config!,password:'wrong-password-for-test'},/recusados/],['port',{...config!,port:1},/conectar|XAMPP|Tempo|ECONN/i]] as const){
    const key=`pf${randomBytes(6).toString('hex')}`,name=databaseNameFor(key);
    const {audits,events,registered,hooks:h}=hooks();
    let calls=0;const counting=(c:any,sql:string)=>{calls++;return runMysql(c,sql);};
    const prepared=await prepareDeveloperDatabase(bad,key,h,counting);
    assert.equal(prepared.preflight?.ok,false,label);assert.equal(prepared.env,undefined);assert.match(prepared.preflight!.message!,pattern,label);
    assert.equal(calls,1,`${label}: a single attempt, no retry`);assert.deepEqual(registered,[]);
    assert.equal(audits[0].action,'project_database.unavailable');assert.equal(events[0].type,'project_database.unavailable');
    for(const text of [JSON.stringify(audits),JSON.stringify(events)])for(const secret of [config!.password,'wrong-password-for-test'])assert.equal(text.includes(secret),false);
    assert.equal((await listManagedDatabases(config!))!.includes(name),false,`${label}: no database created`);
  }
});

test('without a configured test login nothing is prepared and no preflight is recorded',async()=>{
  const {audits,events,hooks:h}=hooks();
  assert.deepEqual(await prepareDeveloperDatabase(null,'abc',h),{});assert.deepEqual([audits,events],[[],[]]);
});
