import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DATABASE_PROMPT_SECTION,DEFAULT_MYSQL_BIN,databaseNameFor,dropTaskDatabase,ensureTaskDatabase,friendlyMysqlError,isManagedDatabaseName,loadProjectDbConfig,provisionProjectLogin,publicProjectDb,runMysql,saveProjectDbConfig,sweepProjectDatabases,taskDatabaseEnv,testProjectDb,type MysqlRunner,type ProjectDbConfig} from './project-database.js';

const cfg:ProjectDbConfig={host:'127.0.0.1',port:3306,user:'orquestradoria',password:'Sup3r-Secret_pw-123456',mysqlBin:'mysql'};
const recorder=()=>{const calls:Array<{user:string;sql:string}>=[];const run:MysqlRunner=async(config,sql)=>{calls.push({user:config.user,sql});return{ok:true,stdout:''};};return{calls,run};};

test('database names are deterministic, safe and only managed names can be touched',async()=>{
  assert.equal(databaseNameFor('r6gy0xa6HAIIPr5smfHnR'),'orq_r6gy0xa6haiipr5smfhnr');
  assert.equal(databaseNameFor('0aGz-dku_R!'),'orq_0agzdkur');
  assert.throws(()=>databaseNameFor('---'));
  assert.ok(isManagedDatabaseName('orq_abc123'));
  for(const bad of ['mysql','information_schema','controle_notas','orq_','orq_a;drop','orq_A','orq_'+'a'.repeat(30)])assert.equal(isManagedDatabaseName(bad),false,bad);
  const {run}=recorder();
  await assert.rejects(()=>dropTaskDatabase(cfg,'controle_notas',run),/não gerenciado/);
  await assert.rejects(()=>ensureTaskDatabase(cfg,'mysql',run),/não gerenciado/);
});

test('create/drop statements target only the managed database',async()=>{
  const {calls,run}=recorder();
  await ensureTaskDatabase(cfg,'orq_abc',run);await dropTaskDatabase(cfg,'orq_abc',run);
  assert.match(calls[0].sql,/^CREATE DATABASE IF NOT EXISTS `orq_abc` CHARACTER SET utf8mb4/);
  assert.equal(calls[1].sql,'DROP DATABASE IF EXISTS `orq_abc`');
});

test('config is stored outside git-tracked paths, keeps the password on partial updates and never leaks it',()=>{
  const dir=mkdtempSync(join(tmpdir(),'orq-pdb-'));const path=join(dir,'sub','project-database.json');
  try{
    assert.equal(loadProjectDbConfig(path),null);
    assert.deepEqual(publicProjectDb(null).configured,false);
    saveProjectDbConfig({password:'abc-DEF_1234567890xyz',port:3307},path);
    const kept=saveProjectDbConfig({host:'localhost',password:''},path);
    assert.equal(kept.password,'abc-DEF_1234567890xyz');assert.equal(kept.port,3307);assert.equal(kept.host,'localhost');
    const view=publicProjectDb(loadProjectDbConfig(path));
    assert.equal(view.hasPassword,true);assert.equal(JSON.stringify(view).includes('abc-DEF'),false);
    assert.throws(()=>saveProjectDbConfig({port:99999},path),/Porta/);
    assert.throws(()=>saveProjectDbConfig({user:"x'; DROP"},path),/Usuário/);
    assert.equal(existsSync(path+'.tmp'),false);
    assert.ok(readFileSync(path,'utf8').includes('"password"'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('provisioning grants only orq_* databases, uses the root password only for the call and never returns it',async()=>{
  const {calls,run}=recorder();
  const result=await provisionProjectLogin('ROOT-pass',{},run);
  assert.equal(result.ok,true);
  assert.equal(calls.length,1);assert.equal(calls[0].user,'root');
  const sql=calls[0].sql;
  assert.match(sql,/GRANT ALL PRIVILEGES ON `orq\\_%`\.\* TO 'orquestradoria'@'localhost'/);
  assert.match(sql,/GRANT ALL PRIVILEGES ON `orq\\_%`\.\* TO 'orquestradoria'@'127\.0\.0\.1'/);
  assert.equal(/ON \*\.\*|WITH GRANT OPTION|SUPER|FILE/i.test(sql),false);
  if(result.ok){assert.equal(result.config.password.length>=20,true);assert.equal(JSON.stringify(result.config).includes('ROOT-pass'),false);assert.ok(sql.includes(result.config.password));}
  const failing:MysqlRunner=async()=>({ok:false,stdout:'',error:"ERROR 1045 (28000): Access denied for user 'root'@'localhost'"});
  const denied=await provisionProjectLogin('wrong',{},failing);
  assert.equal(denied.ok,false);if(!denied.ok)assert.match(denied.message,/recusados/);
  await assert.rejects(()=>provisionProjectLogin('x',{user:"a'b"},run),/Usuário/);
  await assert.rejects(()=>provisionProjectLogin('x',{password:"short'pw"},run),/formato/);
});

test('sweep only drops databases registered by THIS instance (another instance or the smoke test can never wipe them)',async()=>{
  const dropped:string[]=[];
  const run:MysqlRunner=async(config,sql)=>{
    if(sql.startsWith('SHOW DATABASES'))return{ok:true,stdout:'orq_mineactive\norq_mineold\norq_foreign\ninformation_schema\nmysql\n'};
    const match=sql.match(/DROP DATABASE IF EXISTS `([^`]+)`/);if(match)dropped.push(match[1]);return{ok:true,stdout:''};
  };
  const registered=new Set(['orq_mineactive','orq_mineold','orq_minegone']);
  const result=await sweepProjectDatabases(cfg,new Set(['orq_mineactive']),registered,run);
  assert.deepEqual(dropped,['orq_mineold']);assert.deepEqual(result.dropped,['orq_mineold']);
  assert.deepEqual(result.kept,['orq_mineactive']);assert.deepEqual(result.missing,['orq_minegone']);
  assert.equal(dropped.includes('orq_foreign'),false,'a database nobody registered must survive');
  const empty=await sweepProjectDatabases(cfg,new Set(),new Set(),run);
  assert.deepEqual(empty.dropped,[]);assert.equal(dropped.length,1);
  const down:MysqlRunner=async()=>({ok:false,stdout:'',error:'ERROR 2002'});
  assert.deepEqual((await sweepProjectDatabases(cfg,new Set(),registered,down)).dropped,[]);
});
test('environment, errors and prompt section',async()=>{
  assert.deepEqual(taskDatabaseEnv(cfg,'orq_x'),{ORQ_DB_HOST:'127.0.0.1',ORQ_DB_PORT:'3306',ORQ_DB_USER:'orquestradoria',ORQ_DB_PASSWORD:cfg.password,ORQ_DB_NAME:'orq_x'});
  assert.match(friendlyMysqlError("ERROR 2002 (HY000): Can't connect to MySQL server"),/XAMPP/);
  assert.match(friendlyMysqlError('spawn mysql ENOENT'),/programa mysql/);
  const section=DATABASE_PROMPT_SECTION('orq_x');
  assert.match(section,/ORQ_DB_NAME/);assert.match(section,/RUN them/);assert.equal(section.includes(cfg.password),false);
});

test('runMysql against a missing executable returns a friendly failure instead of throwing',async()=>{
  const result=await testProjectDb({...cfg,mysqlBin:join(tmpdir(),'definitely-not-mysql.exe')});
  assert.equal(result.ok,false);assert.match(result.message,/programa mysql|ENOENT|spawn/i);
});

test('runMysql against the local MySQL with a wrong login is refused (skipped when MySQL is not installed)',async()=>{
  if(!existsSync(DEFAULT_MYSQL_BIN))return;
  const result=await runMysql({...cfg,mysqlBin:DEFAULT_MYSQL_BIN,user:'orq_no_such_user',password:'wrong-password-123456'},'SELECT 1');
  assert.equal(result.ok,false);
  assert.equal(String(result.error).includes('wrong-password-123456'),false);
  assert.match(friendlyMysqlError(result.error),/recusados|XAMPP/);
});