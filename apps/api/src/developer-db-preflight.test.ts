import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeCodeAdapter,CommandTesterAdapter,planVerification} from '@orchestrator/adapters';
import {preflightTaskDatabase,type MysqlRunner,type ProjectDbConfig} from './project-database.js';

const cfg:ProjectDbConfig={host:'127.0.0.1',port:3306,user:'orquestradoria',password:'s3cret-pass-value-xyz',mysqlBin:'mysql'};

test('preflight: one attempt, success or a friendly error, never the password',async()=>{
  const calls:string[]=[];
  const ok:MysqlRunner=async(_c,sql)=>{calls.push(sql);return{ok:true,stdout:''};};
  assert.deepEqual(await preflightTaskDatabase(cfg,'orq_abc',ok),{ok:true,message:'Banco de teste disponível.'});
  assert.equal(calls.length,2,'SELECT 1 + CREATE DATABASE');assert.match(calls[0],/SELECT 1/);assert.match(calls[1],/CREATE DATABASE IF NOT EXISTS `orq_abc`/);

  const down:MysqlRunner=async(_c,sql)=>{calls.push(sql);return{ok:false,stdout:'',error:`ERROR 2002 (HY000): Can't connect to MySQL server (${cfg.password})`};};
  calls.length=0;
  const result=await preflightTaskDatabase(cfg,'orq_abc',down);
  assert.equal(result.ok,false);assert.match(result.message,/XAMPP/);assert.equal(result.message.includes(cfg.password),false);
  assert.equal(calls.length,1,'no CREATE DATABASE and no retry when the connection already failed');

  const denied:MysqlRunner=async()=>({ok:false,stdout:'',error:"ERROR 1045 (28000): Access denied for user 'orquestradoria'"});
  assert.match((await preflightTaskDatabase(cfg,'orq_abc',denied)).message,/recusados/);
});

const REAL_HELP='Claude Code - starts an interactive session by default, use -p/--print for non-interactive output\n  -p, --print                           Print response and exit (useful for pipes).\n--model <model>\n--allowedTools, --allowed-tools <tools...>\n--disallowedTools, --disallowed-tools <tools...>\n--output-format <format>\n--permission-mode <mode>\n--permission-prompts <target>';
const GOOD=JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[],browserScenarios:[]})});
const seenArgs:string[]=[];
async function developerPrompt(config:Record<string,unknown>,env:Record<string,string>){
  const dir=mkdtempSync(join(tmpdir(),'orq-preflight-'));let prompt='';seenArgs.length=0;
  const spawn=(_c:string,args:string[])=>{const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(data?:string){if(!args.includes('--version')&&!args.includes('--help')){prompt=String(data||'');seenArgs.push(...args);}child.stdout.emit('data',Buffer.from(args.includes('--version')?'2.1.287 (Claude Code)':args.includes('--help')?REAL_HELP:GOOD));child.emit('close',0);}};child.kill=()=>child.emit('close',null);return child;};
  try{await new ClaudeCodeAdapter({executable:'claude.cmd',platform:'win32',model:'claude-haiku-5-5',spawn:spawn as any,env:{...process.env,...env} as any,...config}).execute({stage:'developer',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location:dir},previousArtifacts:[]} as any);return prompt;}
  finally{rmSync(dir,{recursive:true,force:true});}
}

test('Developer is told the database was verified and to read ORQ_DB_* directly, without printenv/env/echo',async()=>{
  const prompt=await developerPrompt({databasePreflight:{ok:true}},{ORQ_DB_NAME:'orq_abc',ORQ_DB_PASSWORD:cfg.password});
  assert.match(prompt,/already verified/);assert.match(prompt,/getenv\('ORQ_DB_HOST'\)/);assert.match(prompt,/process\.env\.ORQ_DB_HOST/);
  assert.match(prompt,/never run printenv, env, set or echo/);assert.equal(prompt.includes(cfg.password),false);assert.equal(prompt.includes('UNAVAILABLE'),false);
});

test('unavailable database: clear diagnosis, no retries, checks listed as skipped, no connection details',async()=>{
  const prompt=await developerPrompt({databasePreflight:{ok:false,message:'Não consegui conectar. O MySQL está ligado no painel do XAMPP?'}},{ORQ_DB_NAME:'orq_abc',ORQ_DB_PASSWORD:cfg.password});
  assert.match(prompt,/TEST DATABASE UNAVAILABLE/);assert.match(prompt,/XAMPP/);assert.match(prompt,/do not retry/);assert.match(prompt,/"skipped"/);
  assert.equal(prompt.includes('TEST DATABASE\nA throwaway'),false,'the usable-database instructions are not sent');assert.equal(prompt.includes(cfg.password),false);
});

// Regressão: os comandos que o Developer tentou para descobrir ORQ_DB_*.
const REFUSED=['printenv ORQ_DB_NAME','printenv ORQ_DB_HOST','echo $ORQ_DB_NAME'];
/** Casa uma regra "Bash(prefixo:*)" da lista de permissões pelo prefixo do comando (mesma semântica do Claude Code). */
const allowedByPolicy=(allowed:string[],command:string)=>allowed.some(rule=>{const m=/^Bash\((.+):\*\)$/.exec(rule);return!!m&&(command===m[1]||command.startsWith(m[1]+' '));});

test('regression: printenv is refused by the policy; echo is allowed by it and only discouraged by the prompt',async()=>{
  const prompt=await developerPrompt({databasePreflight:{ok:true}},{ORQ_DB_NAME:'orq_abc'});
  const allowed=seenArgs[seenArgs.indexOf('--allowedTools')+1].split(',');
  // POLÍTICA (obrigatória): printenv não está na lista de permitidos, então é recusado.
  assert.equal(allowedByPolicy(allowed,'printenv ORQ_DB_NAME'),false);
  assert.equal(allowedByPolicy(allowed,'printenv ORQ_DB_HOST'),false);
  // POLÍTICA: echo está permitido (comando de leitura comum); a política sozinha NÃO impede "echo $ORQ_DB_NAME".
  assert.equal(allowedByPolicy(allowed,'echo $ORQ_DB_NAME'),true);
  // PROMPT (apenas orientação, não é barreira): ele desencoraja os três.
  assert.match(prompt,/never run printenv, env, set or echo/);
  assert.match(prompt,/do not look for credentials/);
  // O Tester nunca reexecuta nenhum deles.
  assert.equal(planVerification(REFUSED.map(command=>({command,status:'passed'})),{location:tmpdir(),env:{}}).commands.length,0);
});

test('Tester evidence separates what was executed from what was not',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orq-evidence-'));mkdirSync(join(root,'scripts'),{recursive:true});writeFileSync(join(root,'scripts','ok.js'),'console.log("ok")');
  try{
    const tester=new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,verification:{env:{},developerTests:()=>[{command:'node scripts/ok.js',status:'passed'},{command:'php database/page.php http://127.0.0.1:8099',status:'passed'},{command:'node scripts/ok.js && node scripts/ok.js',status:'passed'}]}});
    const result:any=(await tester.execute({stage:'tester',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location:root},previousArtifacts:[],projectRules:[]} as any)).structuredResult;
    assert.equal(result.status,'PASSED');assert.equal(result.commands.length,1);
    const notes:string[]=result.notes;
    assert.ok(notes.some(n=>/^Verificação reexecutada com sucesso: verificar: node scripts\/ok\.js$/.test(n)),'executed');
    assert.ok(notes.some(n=>/^Verificação não reexecutada \(.*\): php database\/page\.php/.test(n)),'not executed: HTTP needs a running server');
    assert.ok(notes.some(n=>/não reexecutada \(comando composto/.test(n)),'not executed: compound command');
  }finally{rmSync(root,{recursive:true,force:true});}
});
