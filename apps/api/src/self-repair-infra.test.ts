import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {CommandTesterAdapter,analyzeProjectFlows} from '@orchestrator/adapters';
import {testerIssues} from '@orchestrator/core';
import {extractExplicitAcceptanceCriteria} from '@orchestrator/shared';
import {SELF_REPAIR_WORKSPACE_NAME,buildDiagnosisBundle,composeRepairDescription,ensureSelfRepairTables,flowValidationApplies} from './self-repair.js';
import {INSTALL_ARGS,SELF_REPAIR_TOOL_ENV,describeDepsFailure,prepareWorktreeDependencies,stripAnsi,type DepsRunner} from './self-repair-deps.js';

/** Infraestrutura da Autocorreção: sem requisitos herdados dos logs, dependências no worktree, erro do typecheck detalhado. */
const tmpDir=(prefix:string)=>mkdtempSync(join(tmpdir(),prefix));

// ---------- 1. o diagnóstico nunca vira requisito funcional ----------
const PHP_LOGS_DESCRIPTION=['Corrigir o login do motorista e o upload do comprovante em PHP, com listagem na conferência.','Critérios de aceite:','- O motorista entra com login e senha','- O upload grava no MySQL e aparece na conferência','Contexto: arquivos database/criar_usuario.php e login.php'].join('\n');
function dbWithPhpTask(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,location TEXT NOT NULL,branch TEXT,status TEXT NOT NULL,taskBudgetUsd REAL NOT NULL DEFAULT 0,monthlyBudgetUsd REAL NOT NULL DEFAULT 0,tokenUsageLimit INTEGER NOT NULL DEFAULT 0,enforceTokenUsageLimit INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE tasks (id TEXT PRIMARY KEY,workspaceId TEXT,title TEXT,description TEXT,status TEXT,currentStage TEXT,lastSuccessfulStage TEXT,environmentStatus TEXT,environmentWarning TEXT,configSnapshot TEXT,updatedAt TEXT);
  CREATE TABLE executions (id TEXT PRIMARY KEY,taskId TEXT,role TEXT,provider TEXT,model TEXT,status TEXT,startedAt TEXT,finishedAt TEXT,error TEXT,progressMessage TEXT,structuredResult TEXT,stderr TEXT);
  CREATE TABLE events (id TEXT PRIMARY KEY,type TEXT,taskId TEXT,payload TEXT,createdAt TEXT);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY,actor TEXT,action TEXT,taskId TEXT,metadata TEXT,timestamp TEXT);`);
  ensureSelfRepairTables(db);
  db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('proj','Controle de notas','local','C:/controle','main','active','t','t');
  db.prepare('INSERT INTO workspaces (id,name,type,location,branch,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('self',SELF_REPAIR_WORKSPACE_NAME,'local','C:/orq','main','active','t','t');
  db.prepare('INSERT INTO tasks (id,workspaceId,title,description,status,environmentStatus,updatedAt) VALUES (?,?,?,?,?,?,?)').run('php1','proj','Login do motorista',PHP_LOGS_DESCRIPTION,'failed','failed_preserved','t');
  db.prepare('INSERT INTO executions (id,taskId,role,provider,model,status,startedAt,error,structuredResult) VALUES (?,?,?,?,?,?,?,?,?)').run('e1','php1','developer','claude-code','m','failed','2026-01-01T00:00:00Z','php database/criar_usuario.php: PDOException login upload falhou',JSON.stringify({summary:'login.php e upload.php falharam; a listagem na conferência não abriu'}));
  return db;
}

test('regressão: logs PHP no diagnóstico não exigem fluxos PHP (nem critérios de aceite) na task de autocorreção',()=>{
  const db=dbWithPhpTask();
  const bundle=buildDiagnosisBundle(db,'php1')!;
  assert.match(bundle.text,/Critérios de aceite:/,'o texto do diagnóstico preserva a evidência original');
  const description=composeRepairDescription({prompt:'Comandos do Developer recusados repetidamente pela política',bundle,sourceTitle:'Login do motorista',repo:{root:'C:/orq',branch:'main'}});
  // a) o cabeçalho "Critérios de aceite:" dos logs não vira critério da task de autocorreção
  assert.deepEqual(extractExplicitAcceptanceCriteria(description),[],'critérios da task investigada não são critérios da autocorreção');
  assert.match(description,/APENAS EVIDÊNCIA/);assert.match(description,/Valide o repositório do Orquestradoria: build, typecheck e testes/);
  assert.ok(description.split('\n').filter(line=>line.includes('Critérios de aceite:')).every(line=>line.startsWith('> ')));
  // b) o perigo era real: lido como pedido, o texto exigiria login, upload e listagem
  const empty=tmpDir('orq-empty-');
  try{
    const hazard=analyzeProjectFlows(empty,description).flows.filter(flow=>flow.required).map(flow=>flow.id);
    assert.ok(hazard.includes('flow-auth')&&hazard.includes('flow-upload'),`sem a proteção, os logs gerariam fluxos obrigatórios: ${hazard.join(',')}`);
  }finally{rmSync(empty,{recursive:true,force:true});}
  // c) a proteção: a validação de fluxos nunca se aplica ao workspace da autocorreção
  assert.equal(flowValidationApplies(db,'self','claude-code',{}),false);
  assert.equal(flowValidationApplies(db,'proj','claude-code',{}),true,'projetos comuns continuam validados');
  assert.equal(flowValidationApplies(db,'proj','mock',{}),false);assert.equal(flowValidationApplies(db,'proj','claude-code',{FLOW_VALIDATION:'0'}),false);
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.match(server,/const flowPlan=flowValidationApplies\(db,task\.workspaceId,developerConfig\.provider\)\?analyzeProjectFlows\(/);
});

// ---------- 2. dependências do monorepo no worktree isolado ----------
function fakeRunner(outcome:{code:number|null;stdout?:string;stderr?:string;timedOut?:boolean}){
  const calls:Array<{command:string;args:string[];cwd:string;env:NodeJS.ProcessEnv}>=[];
  const run:DepsRunner=async(command,args,options)=>{calls.push({command,args,cwd:options.cwd,env:options.env});return{stdout:'',stderr:'',...outcome};};
  return{run,calls};
}
function worktreeWithLock(lock='lockfileVersion: 9\n'){
  const root=tmpDir('orq-deps-root-'),worktree=tmpDir('orq-deps-wt-');
  writeFileSync(join(worktree,'package.json'),'{"name":"x","private":true}');writeFileSync(join(worktree,'pnpm-lock.yaml'),lock);
  return{root,worktree,done:()=>{rmSync(root,{recursive:true,force:true});rmSync(worktree,{recursive:true,force:true});}};
}

test('dependências: instala só no worktree, com o ambiente que contorna o pnpm do Corepack, e fica idempotente',async()=>{
  const {root,worktree,done}=worktreeWithLock();
  try{
    const {run,calls}=fakeRunner({code:0,stdout:'Done in 3s'});
    const first=await prepareWorktreeDependencies(worktree,root,{run});
    assert.equal(first.status,'prepared');assert.equal(first.command,'pnpm install --frozen-lockfile --prefer-offline');assert.deepEqual(INSTALL_ARGS,['install','--frozen-lockfile','--prefer-offline']);
    assert.equal(calls.length,1);assert.equal(calls[0].command,'pnpm');assert.equal(calls[0].cwd,worktree.replace(/\//g,'\\').length?calls[0].cwd:worktree);
    assert.notEqual(calls[0].cwd,root,'nunca no diretório da instância em execução');
    for(const [key,value] of Object.entries(SELF_REPAIR_TOOL_ENV))assert.equal(calls[0].env[key],value,key);
    assert.equal(calls[0].env.npm_config_pm_on_fail,'ignore');assert.equal(calls[0].env.COREPACK_ENABLE_STRICT,'0');
    assert.equal(existsSync(join(worktree,'node_modules','.orq-deps-lock-hash')),true,'marcador gravado só no worktree');
    assert.equal(existsSync(join(root,'node_modules')),false,'a instância não ganhou node_modules');
    const second=await prepareWorktreeDependencies(worktree,root,{run});
    assert.equal(second.status,'skipped');assert.match(second.reason!,/já preparadas/);assert.equal(calls.length,1,'não reinstala');
    writeFileSync(join(worktree,'pnpm-lock.yaml'),'lockfileVersion: 9\n# mudou\n');
    assert.equal((await prepareWorktreeDependencies(worktree,root,{run})).status,'prepared');assert.equal(calls.length,2,'lock novo reinstala');
  }finally{done();}
});

test('dependências: recusa o diretório da instância e pula quando não há o que instalar',async()=>{
  const {root,done}=worktreeWithLock();const bare=tmpDir('orq-deps-bare-');
  try{
    const {run,calls}=fakeRunner({code:0});
    await assert.rejects(prepareWorktreeDependencies(root,root,{run}),/recusada: o diretório é a instância em execução/);
    assert.equal(calls.length,0);
    assert.equal((await prepareWorktreeDependencies(bare,root,{run})).reason,'o worktree não tem package.json');
    writeFileSync(join(bare,'package.json'),'{}');
    assert.match((await prepareWorktreeDependencies(bare,root,{run})).reason!,/pnpm-lock\.yaml/);assert.equal(calls.length,0);
  }finally{done();rmSync(bare,{recursive:true,force:true});}
});

test('dependências: a falha mostra comando completo, diretório, código e o fim de stdout/stderr sem cores',async()=>{
  const {root,worktree,done}=worktreeWithLock();
  try{
    const noise='x'.repeat(9000);
    const {run}=fakeRunner({code:1,stdout:`${noise}\nfim do stdout`,stderr:`\u001b[31mERR_PNPM_FETCH_404\u001b[0m não achei o pacote\nfim do stderr`});
    const result=await prepareWorktreeDependencies(worktree,root,{run});
    assert.equal(result.status,'failed');assert.equal(result.exitCode,1);assert.match(result.reason!,/código 1/);
    assert.match(result.stdout,/fim do stdout$/);assert.match(result.stderr,/ERR_PNPM_FETCH_404 não achei o pacote\nfim do stderr/);assert.equal(result.stderr.includes('\u001b'),false);
    assert.ok(result.stdout.length<7000,'saída limitada ao fim');
    const message=describeDepsFailure(result);
    for(const expected of ['Comando: pnpm install --frozen-lockfile --prefer-offline',`Diretório: ${worktree}`,'Código de saída: 1','stdout:','stderr:','fim do stderr'])assert.ok(message.includes(expected),expected);
    assert.equal(existsSync(join(worktree,'node_modules','.orq-deps-lock-hash')),false,'falhou: sem marcador');
    const timeout=await prepareWorktreeDependencies(worktree,root,{run:fakeRunner({code:null,timedOut:true}).run});
    assert.equal(timeout.status,'failed');assert.match(timeout.reason!,/tempo esgotado/);
  }finally{done();}
});

const pnpmOk=spawnSync('pnpm',['--version'],{encoding:'utf8',shell:process.platform==='win32'}).status===0;
(pnpmOk?test:test.skip)('dependências (pnpm real): instala num worktree de verdade e não toca na "instância"',async()=>{
  const root=tmpDir('orq-deps-live-root-'),worktree=tmpDir('orq-deps-live-wt-');
  try{
    writeFileSync(join(worktree,'package.json'),JSON.stringify({name:'live-deps',version:'0.0.0',private:true}));
    const lock=spawnSync('pnpm',['install','--lockfile-only'],{cwd:worktree,encoding:'utf8',shell:process.platform==='win32',env:{...process.env,...SELF_REPAIR_TOOL_ENV}});
    assert.equal(lock.status,0,lock.stderr);assert.equal(existsSync(join(worktree,'pnpm-lock.yaml')),true);
    const result=await prepareWorktreeDependencies(worktree,root);
    assert.equal(result.status,'prepared',`${result.stdout}\n${result.stderr}`);assert.equal(result.exitCode,0);
    assert.equal(existsSync(join(worktree,'node_modules','.orq-deps-lock-hash')),true);assert.equal(existsSync(join(root,'node_modules')),false);
    assert.equal((await prepareWorktreeDependencies(worktree,root)).status,'skipped');
  }finally{rmSync(root,{recursive:true,force:true});rmSync(worktree,{recursive:true,force:true});}
});

// ---------- 3. typecheck real e erro detalhado ----------
function typecheckProject(manager:'npm'|'pnpm'){
  const dir=tmpDir('orq-typecheck-');mkdirSync(join(dir,'src'));mkdirSync(join(dir,'scripts'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({name:'fake-orq',version:'0.0.0',private:true,scripts:{typecheck:'node scripts/typecheck.js'}}));
  if(manager==='pnpm')writeFileSync(join(dir,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\n");
  writeFileSync(join(dir,'src','sum.js'),'export const sum=(a,b)=>a - b;\n');
  writeFileSync(join(dir,'scripts','typecheck.js'),[
    "const {readFileSync}=require('node:fs');",
    "process.stdout.write('compilando '+'.'.repeat(30000)+'\\nFIM-DA-SAIDA-PADRAO\\n');",
    "if(readFileSync('src/sum.js','utf8').includes('a - b')){process.stderr.write('\\u001b[31merror TS2362\\u001b[0m: src/sum.js(1,29): o operador - foi usado onde + era esperado\\nFound 1 error in src/sum.js:1\\n');process.exit(2);}",
    "console.log('typecheck ok');"].join('\n'));
  return dir;
}
const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location},previousArtifacts:[],projectRules:[]});

for(const manager of ['npm','pnpm'] as const){
  (manager==='npm'||pnpmOk?test:test.skip)(`Tester executa o typecheck de verdade (${manager}) e apresenta o erro detalhado: comando completo, stdout e stderr`,async()=>{
    const dir=typecheckProject(manager);
    try{
      const tester=new CommandTesterAdapter({env:{...process.env,...SELF_REPAIR_TOOL_ENV} as NodeJS.ProcessEnv,timeoutMs:60000});
      const result:any=(await tester.execute(input(dir))).structuredResult;
      assert.equal(result.status,'FAILED');
      const command=result.commands.find((item:any)=>item.label==='typecheck');
      assert.ok(command,JSON.stringify(result.commands.map((c:any)=>c.label)));
      assert.equal(command.status,'failed');assert.ok(command.exitCode===1||command.exitCode===2,`código de saída real e não nulo: ${command.exitCode}`);
      assert.equal(command.command,`${manager} run typecheck`,'linha de comando completa');assert.equal(command.cwd,dir);
      assert.match(command.stderr,/error TS2362: src\/sum\.js\(1,29\): o operador - foi usado onde \+ era esperado/);assert.match(command.stderr,/Found 1 error in src\/sum\.js:1/);
      assert.equal(command.stderr.includes('\u001b'),false,'sem códigos de cor');
      assert.match(command.stdout,/FIM-DA-SAIDA-PADRAO\s*$/,'a saída é cortada no meio, nunca no fim (onde está o erro)');assert.match(command.stdout,/truncated \d+ chars/);
      // o ciclo de correção recebe o mesmo detalhe
      const issue=testerIssues({structuredResult:result} as any).join('\n');
      assert.match(issue,new RegExp(`Command line: ${manager} run typecheck \\(cwd `));assert.match(issue,/stderr \(end\): .*Found 1 error in src\/sum\.js:1/s);assert.match(issue,/stdout \(end\): .*FIM-DA-SAIDA-PADRAO/s);
      // corrigido o código, o mesmo comando passa
      writeFileSync(join(dir,'src','sum.js'),'export const sum=(a,b)=>a + b;\n');
      const fixed:any=(await tester.execute(input(dir))).structuredResult;
      assert.equal(fixed.commands.find((item:any)=>item.label==='typecheck').status,'passed');
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}

test('stripAnsi remove cores e sequências de controle',()=>{
  assert.equal(stripAnsi('\u001b[31mErro\u001b[0m \u001b[1;33maviso\u001b[0m'),'Erro aviso');
});

import {prepareCliInvocation} from '@orchestrator/adapters';
test('Windows: comandos .cmd (pnpm/npm) chegam ao cmd.exe com os argumentos verbatim, sem virar ""run""',()=>{
  const prepared=prepareCliInvocation('pnpm.cmd',['run','typecheck'],{stdio:['pipe','pipe','pipe']},'win32');
  assert.equal(prepared.command,'cmd.exe');assert.deepEqual(prepared.args,['/d','/c','call pnpm.cmd "run" "typecheck"']);
  assert.equal((prepared.options as any).windowsVerbatimArguments,true,'sem isso o Node reescapa as aspas e o pnpm recebe ""run""');assert.equal(prepared.options.shell,false);
  const posix=prepareCliInvocation('pnpm',['run','typecheck'],{stdio:['pipe','pipe','pipe']},'linux');
  assert.equal(posix.command,'pnpm');assert.equal((posix.options as any).windowsVerbatimArguments,undefined);
});
