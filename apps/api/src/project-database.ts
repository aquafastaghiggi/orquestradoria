import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';

/**
 * Banco MySQL de TESTE dos projetos. O login "orquestradoria" só enxerga bancos orq_* (descartáveis, um por task/missão),
 * nunca o banco real de nenhum projeto. As credenciais ficam em apps/api/storage (fora do Git).
 */
export interface ProjectDbConfig{host:string;port:number;user:string;password:string;mysqlBin:string}
export interface MysqlResult{ok:boolean;stdout:string;error?:string}
export type MysqlRunner=(config:ProjectDbConfig,sql:string)=>Promise<MysqlResult>;

export const DEFAULT_MYSQL_BIN=process.platform==='win32'?'C:\\xampp\\mysql\\bin\\mysql.exe':'mysql';
export const DEFAULT_PROJECT_DB:Omit<ProjectDbConfig,'password'>={host:'127.0.0.1',port:3306,user:'orquestradoria',mysqlBin:DEFAULT_MYSQL_BIN};
export const MANAGED_DB_PREFIX='orq_';
const MANAGED_NAME=/^orq_[a-z0-9]{1,24}$/;

export const storageDir=()=>process.env.ORQ_STORAGE_DIR||join(process.cwd(),'storage');
export const projectDbConfigPath=()=>join(storageDir(),'project-database.json');

export function loadProjectDbConfig(path=projectDbConfigPath()):ProjectDbConfig|null{
  try{
    if(!existsSync(path))return null;
    const raw=JSON.parse(readFileSync(path,'utf8'));
    if(!raw||typeof raw.password!=='string'||!raw.password)return null;
    return{host:String(raw.host||DEFAULT_PROJECT_DB.host),port:Number(raw.port)||DEFAULT_PROJECT_DB.port,user:String(raw.user||DEFAULT_PROJECT_DB.user),password:raw.password,mysqlBin:String(raw.mysqlBin||DEFAULT_PROJECT_DB.mysqlBin)};
  }catch{return null;}
}

/** Grava de forma atômica. Se `password` vier vazio, mantém a senha já salva (a tela nunca recebe a senha de volta). */
export function saveProjectDbConfig(input:Partial<ProjectDbConfig>,path=projectDbConfigPath()):ProjectDbConfig{
  const current=loadProjectDbConfig(path);
  const next:ProjectDbConfig={
    host:String(input.host||current?.host||DEFAULT_PROJECT_DB.host).trim(),
    port:Number(input.port||current?.port||DEFAULT_PROJECT_DB.port),
    user:String(input.user||current?.user||DEFAULT_PROJECT_DB.user).trim(),
    password:String(input.password||current?.password||''),
    mysqlBin:String(input.mysqlBin||current?.mysqlBin||DEFAULT_PROJECT_DB.mysqlBin).trim()
  };
  if(!/^[A-Za-z0-9_.:-]{1,100}$/.test(next.host))throw new Error('Host inválido.');
  if(!Number.isInteger(next.port)||next.port<1||next.port>65535)throw new Error('Porta inválida.');
  if(!/^[A-Za-z0-9_.-]{1,32}$/.test(next.user))throw new Error('Usuário inválido.');
  if(!next.password)throw new Error('Informe a senha (ou rode pnpm db:setup para criá-la automaticamente).');
  mkdirSync(dirname(path),{recursive:true});
  const tmp=`${path}.${process.pid}.tmp`;
  writeFileSync(tmp,JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600});
  renameSync(tmp,path);
  return next;
}

export const publicProjectDb=(config:ProjectDbConfig|null)=>config
  ?{configured:true,host:config.host,port:config.port,user:config.user,hasPassword:true,mysqlBin:config.mysqlBin}
  :{configured:false,host:DEFAULT_PROJECT_DB.host,port:DEFAULT_PROJECT_DB.port,user:DEFAULT_PROJECT_DB.user,hasPassword:false,mysqlBin:DEFAULT_PROJECT_DB.mysqlBin};

/** Nome do banco descartável de uma task/missão. Determinístico, então retomar uma etapa reencontra o mesmo banco. */
export function databaseNameFor(key:string):string{
  const slug=String(key||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,24);
  if(!slug)throw new Error('Chave inválida para o banco de teste.');
  return `${MANAGED_DB_PREFIX}${slug}`;
}
export const isManagedDatabaseName=(name:string)=>MANAGED_NAME.test(name);

/** Variáveis entregues ao Developer. O projeto deve lê-las no lugar de credenciais fixas. */
export const taskDatabaseEnv=(config:ProjectDbConfig,name:string)=>({ORQ_DB_HOST:config.host,ORQ_DB_PORT:String(config.port),ORQ_DB_USER:config.user,ORQ_DB_PASSWORD:config.password,ORQ_DB_NAME:name});

/** O SQL vai pela entrada padrão e a senha por MYSQL_PWD: nada sensível aparece na linha de comando do processo. */
export const runMysql:MysqlRunner=(config,sql)=>new Promise(resolve=>{
  const args=['-h',config.host,'-P',String(config.port),'-u',config.user,'--protocol=TCP','--connect-timeout=5','--batch','--skip-column-names'];
  let stdout='',stderr='',settled=false;
  const finish=(result:MysqlResult)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
  const clean=(text:string)=>(config.password?text.split(config.password).join('***'):text).trim().slice(0,400);
  let child:ChildProcess;
  try{child=spawn(config.mysqlBin,args,{env:{...process.env,MYSQL_PWD:config.password},windowsHide:true,stdio:['pipe','pipe','pipe']});}
  catch(error){return resolve({ok:false,stdout:'',error:clean(String((error as Error).message))});}
  const timer=setTimeout(()=>{try{child.kill();}catch{}finish({ok:false,stdout,error:'Tempo esgotado falando com o MySQL.'});},20000);
  child.stdout!.on('data',chunk=>{stdout+=chunk.toString();});
  child.stderr!.on('data',chunk=>{stderr+=chunk.toString();});
  const events=child as unknown as NodeJS.EventEmitter;
  events.on('error',(error:Error)=>finish({ok:false,stdout,error:clean(error.message)}));
  events.on('close',(code:number|null)=>finish(code===0?{ok:true,stdout}:{ok:false,stdout,error:clean(stderr)||`mysql terminou com código ${code}`}));
  child.stdin!.on('error',()=>{});
  child.stdin!.end(sql);
});

export async function testProjectDb(config:ProjectDbConfig,run:MysqlRunner=runMysql){
  const result=await run(config,'SELECT 1');
  return result.ok?{ok:true,message:'Conexão com o MySQL funcionando.'}:{ok:false,message:friendlyMysqlError(result.error)};
}

export function friendlyMysqlError(error?:string):string{
  const text=String(error||'');
  if(/ENOENT/i.test(text))return 'Não encontrei o programa mysql. Confira o caminho em "Programa mysql".';
  if(/access denied/i.test(text))return 'Usuário ou senha recusados pelo MySQL.';
  if(/can'?t connect|connection refused|2002|2003/i.test(text))return 'Não consegui conectar. O MySQL está ligado no painel do XAMPP?';
  return text||'Falha ao falar com o MySQL.';
}

const assertManaged=(name:string)=>{if(!isManagedDatabaseName(name))throw new Error(`Nome de banco não gerenciado: ${name}`);};
export async function ensureTaskDatabase(config:ProjectDbConfig,name:string,run:MysqlRunner=runMysql){
  assertManaged(name);
  return run(config,`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}
export async function dropTaskDatabase(config:ProjectDbConfig,name:string,run:MysqlRunner=runMysql){
  assertManaged(name);
  return run(config,`DROP DATABASE IF EXISTS \`${name}\``);
}
export async function listManagedDatabases(config:ProjectDbConfig,run:MysqlRunner=runMysql):Promise<string[]|null>{
  const result=await run(config,"SHOW DATABASES LIKE 'orq\\_%'");
  if(!result.ok)return null;
  return result.stdout.split(/\r?\n/).map(line=>line.trim()).filter(isManagedDatabaseName);
}
/**
 * Apaga bancos de teste que não pertencem mais a nenhuma task/missão com ambiente ativo.
 * `registered` é o registro desta instância: só esses nomes podem ser apagados. Bancos de outra instância
 * (teste automatizado, outro clone) nunca são tocados. `missing` = registrados que já não existem no MySQL.
 */
export async function sweepProjectDatabases(config:ProjectDbConfig,activeNames:Set<string>,registered:Set<string>,run:MysqlRunner=runMysql){
  const existing=await listManagedDatabases(config,run);
  if(!existing)return{ok:false,dropped:[] as string[],kept:[] as string[],missing:[] as string[]};
  const present=new Set(existing);
  const dropped:string[]=[],kept:string[]=[],missing:string[]=[];
  for(const name of registered){
    if(!present.has(name)){missing.push(name);continue;}
    if(activeNames.has(name)){kept.push(name);continue;}
    const result=await dropTaskDatabase(config,name,run);
    (result.ok?dropped:kept).push(name);
  }
  return{ok:true,dropped,kept,missing};
}
export const generatePassword=()=>randomBytes(18).toString('base64url');

/** Cria (ou renova) o login do Orquestradoria usando a senha do root, que só passa por aqui e nunca é gravada. */
export async function provisionProjectLogin(rootPassword:string,options:{host?:string;port?:number;mysqlBin?:string;user?:string;rootUser?:string;password?:string}={},run:MysqlRunner=runMysql){
  const user=options.user||DEFAULT_PROJECT_DB.user;
  if(!/^[A-Za-z0-9_]{1,32}$/.test(user))throw new Error('Usuário inválido.');
  const password=options.password||generatePassword();
  if(!/^[A-Za-z0-9_-]{16,64}$/.test(password))throw new Error('Senha gerada em formato inesperado.');
  const base={host:options.host||DEFAULT_PROJECT_DB.host,port:options.port||DEFAULT_PROJECT_DB.port,mysqlBin:options.mysqlBin||DEFAULT_PROJECT_DB.mysqlBin};
  const root:ProjectDbConfig={...base,user:options.rootUser||'root',password:rootPassword};
  const sql=['localhost','127.0.0.1'].map(host=>`CREATE USER IF NOT EXISTS '${user}'@'${host}' IDENTIFIED BY '${password}'; ALTER USER '${user}'@'${host}' IDENTIFIED BY '${password}'; GRANT ALL PRIVILEGES ON \`orq\\_%\`.* TO '${user}'@'${host}';`).join(' ')+' FLUSH PRIVILEGES;';
  const result=await run(root,sql);
  if(!result.ok)return{ok:false as const,message:friendlyMysqlError(result.error)};
  return{ok:true as const,config:{...base,user,password} as ProjectDbConfig};
}

export {DATABASE_PROMPT_SECTION} from '@orchestrator/shared';
