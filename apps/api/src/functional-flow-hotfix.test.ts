import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {analyzeProjectFlows,phpProcessEnv,runFunctionalFlows,validateFlowTests} from '@orchestrator/adapters';
import {REQUEST,countRows,declaredFlows,fixture,input,live,mysql,runProposed,tester,withDatabase} from './functional-flow-fixture.js';

/**
 * Hotfix: (1) cobertura por provas das etapas executadas, (2) isolamento do banco antes de rodar PHP/HTTP,
 * (3) limpeza só do que o teste criou. Os testes marcados com `live` usam o MySQL do XAMPP (banco orq_* descartável)
 * e são pulados quando ele não está disponível; os demais não precisam de banco.
 */
const proofRequest=(extra:Record<string,unknown>)=>({flowId:'flow-completo',covers:['flow-auth','flow-upload','flow-listing'],...extra});

// ---------- 1. cobertura por provas ----------
test('cobertura falsa: um teste só com GET / HTTP 200 (mesmo declarando covers) NÃO valida login, upload, gravação nem listagem',async()=>{
  const root=fixture();writeFileSync(join(root,'index.php'),'<?php echo "ok";');
  try{
    const result:any=await runProposed(root,{},[proofRequest({steps:[{id:'home',kind:'http',method:'GET',path:'/',expect:{status:200}}]})]);
    assert.equal(result.functionalFlows.flows[0].status,'PASSED','a etapa em si passou…');
    assert.equal(result.status,'BLOCKED','…mas isso não aprova nada');assert.equal(result.blockReason,'required_flow_unvalidated');
    const required=Object.fromEntries(result.functionalFlows.required.map((r:any)=>[r.flowId,r]));
    for(const id of ['flow-auth','flow-upload','flow-listing','flow-completo']){assert.equal(required[id].validated,false,id);assert.match(required[id].reason,/faltam provas das etapas executadas/);}
    assert.match(required['flow-completo'].reason,/login: nenhum POST em \/login\.php/);
    assert.match(required['flow-completo'].reason,/upload: nenhum POST multipart/);
    assert.match(required['flow-completo'].reason,/listagem:/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

live('cobertura falsa (MySQL real): login, upload, SELECT e listagem existem mas não são correlacionados com o valor enviado → não validado',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const result:any=await runProposed(root,env,[proofRequest({steps:[
      {id:'seed',kind:'php',script:'database/setup.php'},
      {id:'login',kind:'http',method:'POST',path:'/login.php',form:{email:'motorista@teste.orq',senha:'senha-de-teste-123'},expect:{status:302,redirectTo:'upload.php'}},
      {id:'upload',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'fraco-teste.pdf',content:'%PDF-1.4',contentType:'application/pdf'}},expect:{status:302,redirectTo:'conferencia.php'}},
      {id:'gravacao',kind:'db',query:'SELECT COUNT(*) FROM documentos',expect:{min:1}},
      {id:'listagem',kind:'http',method:'GET',path:'/conferencia.php',expect:{status:200,bodyIncludes:['<table']}}
    ],cleanup:[{kind:'db-exec',sql:"DELETE FROM documentos WHERE arquivo LIKE '%fraco-teste.pdf'"},{kind:'db-exec',sql:"DELETE FROM motoristas WHERE email='motorista@teste.orq'"}]})]);
    assert.equal(result.functionalFlows.flows[0].status,'PASSED','todas as etapas rodaram e passaram');
    assert.equal(result.status,'BLOCKED');
    const required=Object.fromEntries(result.functionalFlows.required.map((r:any)=>[r.flowId,r]));
    assert.equal(required['flow-auth'].validated,true,'login e acesso autenticado têm prova própria');
    assert.equal(required['flow-upload'].validated,false);assert.match(required['flow-upload'].reason,/gravação: nenhum SELECT em documentos citando o valor enviado/);
    assert.equal(required['flow-listing'].validated,false);assert.match(required['flow-listing'].reason,/listagem: nenhum GET em \/conferencia\.php, depois do upload, esperando o valor enviado/);
    assert.equal(required['flow-completo'].validated,false);
    assert.equal(await countRows(env,'documentos'),0,'o que o teste criou foi limpo');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('cobertura falsa (MySQL real): upload antes do login não vale como upload autenticado',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const result:any=await runProposed(root,env,[proofRequest({steps:[
      {id:'seed',kind:'php',script:'database/setup.php'},
      {id:'upload',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'cedo-teste.pdf',content:'x'}},expect:{redirectTo:'login.php'}},
      {id:'login',kind:'http',method:'POST',path:'/login.php',form:{email:'motorista@teste.orq',senha:'senha-de-teste-123'},expect:{redirectTo:'upload.php'}}
    ],cleanup:[{kind:'db-exec',sql:"DELETE FROM motoristas WHERE email='motorista@teste.orq'"}]})]);
    const required=Object.fromEntries(result.functionalFlows.required.map((r:any)=>[r.flowId,r]));
    assert.equal(required['flow-upload'].validated,false);assert.equal(required['flow-completo'].validated,false);assert.equal(result.status,'BLOCKED');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- 2. isolamento do banco ----------
const marker='executado.flag';
const hardcoded:Record<string,string>={
  'usa um DSN com o banco real fixo':`<?php file_put_contents(__DIR__.'/${marker}','x');\n$pdo=new PDO('mysql:host=127.0.0.1;dbname=controle_notas;charset=utf8mb4','app','segredo-real');`,
  'conecta com o usuário root':`<?php file_put_contents(__DIR__.'/${marker}','x');\n$db=new mysqli('localhost','root','',getenv('ORQ_DB_NAME'));`,
  'não lê nenhuma variável ORQ_DB_*':`<?php file_put_contents(__DIR__.'/${marker}','x');\ndefine('DB_NAME','controle_notas');\n$db=mysqli_connect('localhost','sistema','real','controle_notas');`,
  'lê só o nome do banco e deixa o resto no padrão do projeto':`<?php file_put_contents(__DIR__.'/${marker}','x');\n$name=getenv('ORQ_DB_NAME')?:'controle_notas';\n$pdo=new PDO("mysql:host=localhost;dbname=$name",'sistema','real');`
};
const FAKE_ISOLATED={ORQ_DB_HOST:'127.0.0.1',ORQ_DB_PORT:'3306',ORQ_DB_USER:'orquestradoria',ORQ_DB_PASSWORD:'senha-falsa-do-teste',ORQ_DB_NAME:'orq_fake1234'};
const uploadStep=()=>[{id:'up',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'a-teste.pdf',content:'x'}},expect:{redirectTo:'x.php'}}];

for(const [label,code] of Object.entries(hardcoded)){
  test(`isolamento: configuração PHP que ${label} é BLOQUEADA antes de executar qualquer PHP/HTTP, sem credenciais reais`,async()=>{
    const root=fixture();writeFileSync(join(root,'upload.php'),`${code}\n`);
    try{
      for(const env of [{},FAKE_ISOLATED]){ // com ou sem ORQ_DB_* o código continua inseguro
        const result:any=await runProposed(root,env,[proofRequest({steps:uploadStep()})]);
        assert.equal(result.status,'BLOCKED');assert.equal(result.functionalFlows.flows[0].steps[0].status,'blocked');
        assert.match(result.functionalFlows.flows[0].steps[0].evidence,/bloqueada/);
        assert.ok(result.functionalFlows.impossible.some((m:string)=>/Execução bloqueada por segurança \(nenhum PHP\/HTTP\/SQL foi executado\)/.test(m)),'o motivo é informado');
        assert.equal(existsSync(join(root,marker)),false,'o PHP do projeto nunca foi executado');
        assert.equal(JSON.stringify(result).includes('segredo-real'),false);
      }
    }finally{rmSync(root,{recursive:true,force:true});}
  });
}

test('isolamento: o motivo do bloqueio aponta o arquivo e o problema',async()=>{
  const root=fixture();writeFileSync(join(root,'upload.php'),`<?php\n$pdo=new PDO('mysql:host=127.0.0.1;dbname=controle_notas','app','x');`);
  try{
    const result:any=await runProposed(root,FAKE_ISOLATED,[proofRequest({steps:uploadStep()})]);
    const message=result.functionalFlows.impossible.join(' ');
    assert.match(message,/upload\.php: o banco "controle_notas" está fixo no código/);
    assert.match(message,/não lê ORQ_DB_/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('isolamento: host remoto, banco que não é orq_* ou usuário root nunca contam como banco isolado',async()=>{
  const root=fixture();
  try{
    for(const bad of [{ORQ_DB_HOST:'10.0.0.5'},{ORQ_DB_NAME:'controle_notas'},{ORQ_DB_USER:'root'},{ORQ_DB_NAME:'orq_UPPER'}]){
      const result:any=await runProposed(root,{...FAKE_ISOLATED,...bad},[proofRequest({steps:declaredFlows()[0].steps})]);
      assert.equal(result.status,'BLOCKED',JSON.stringify(bad));
      assert.ok(result.functionalFlows.impossible.some((m:string)=>/banco de teste isolado .* não está disponível/.test(m)),JSON.stringify(bad));
      assert.ok(result.functionalFlows.flows[0].steps.every((s:any)=>s.status!=='passed'),'nada foi executado');
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('isolamento: o ambiente dos processos PHP não herda credenciais de banco do host, só ORQ_DB_*',()=>{
  const env=phpProcessEnv({PATH:'x',DB_PASSWORD:'real',MYSQL_PWD:'real',DB_HOST:'prod',DATABASE_URL:'mysql://root@prod/x',ORQ_DB_PASSWORD:'antigo',HOME:'h'},{ORQ_DB_PASSWORD:'novo',ORQ_DB_NAME:'orq_a',OUTRA:'ignorada'});
  assert.deepEqual(env,{PATH:'x',HOME:'h',ORQ_DB_PASSWORD:'novo',ORQ_DB_NAME:'orq_a'});
});

live('isolamento (MySQL real): código que lê ORQ_DB_* e usa o banco isolado é liberado e nunca vê credenciais do ambiente do host',async()=>{
  const root=fixture();
  writeFileSync(join(root,'database','ambiente.php'),`<?php\nrequire __DIR__ . '/../db.php';\necho orq_pdo()->query('SELECT DATABASE()')->fetchColumn() . ' ' . (getenv('MYSQL_PWD') === false ? 'sem-mysql-pwd' : 'COM-MYSQL-PWD') . ' ' . (getenv('DB_PASSWORD') === false ? 'sem-db-password' : 'COM-DB-PASSWORD');`);
  const before={MYSQL_PWD:process.env.MYSQL_PWD,DB_PASSWORD:process.env.DB_PASSWORD};
  process.env.MYSQL_PWD='senha-real-do-host';process.env.DB_PASSWORD='outra-senha-real';
  try{await withDatabase(async env=>{
    const report=await runFunctionalFlows({location:root,plan:analyzeProjectFlows(root,REQUEST),tests:validateFlowTests([{flowId:'x',steps:[{id:'seed',kind:'php',script:'database/setup.php'},{id:'amb',kind:'php',script:'database/ambiente.php'}],cleanup:[{kind:'db-exec',sql:"DELETE FROM motoristas WHERE email='motorista@teste.orq'"}]}]),env});
    const step=report.flows[0].steps.find(s=>s.id==='amb')!;
    assert.equal(step.status,'passed');assert.match(step.evidence,new RegExp(`${env.ORQ_DB_NAME} sem-mysql-pwd sem-db-password`));
    assert.equal(JSON.stringify(report).includes('senha-real-do-host'),false);
  });}finally{
    for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    rmSync(root,{recursive:true,force:true});
  }
});

// ---------- 3. limpeza precisa ----------
live('limpeza precisa (MySQL real): arquivos e registros preexistentes são preservados; só o que o teste criou é removido',async()=>{
  const root=fixture();
  mkdirSync(join(root,'uploads'),{recursive:true});writeFileSync(join(root,'uploads','preexistente.pdf'),'documento antigo');
  writeFileSync(join(root,'notas.txt'),'não mexa');mkdirSync(join(root,'docs'),{recursive:true});writeFileSync(join(root,'docs','LEIAME.md'),'leia');
  try{await withDatabase(async env=>{
    const pre=await mysql(`USE \`${env.ORQ_DB_NAME}\`;CREATE TABLE motoristas (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(80) UNIQUE, senha_hash VARCHAR(255));CREATE TABLE documentos (id INT AUTO_INCREMENT PRIMARY KEY, motorista_id INT, arquivo VARCHAR(200));INSERT INTO motoristas (email,senha_hash) VALUES ('outro@teste.orq','x');INSERT INTO documentos (motorista_id,arquivo) VALUES (1,'arquivo-antigo.pdf');`);
    assert.equal(pre.ok,true,pre.error);
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    assert.equal(result.status,'PASSED',JSON.stringify(result.notes));
    assert.equal(readFileSync(join(root,'uploads','preexistente.pdf'),'utf8'),'documento antigo');
    assert.equal(readFileSync(join(root,'notas.txt'),'utf8'),'não mexa');assert.equal(readFileSync(join(root,'docs','LEIAME.md'),'utf8'),'leia');
    assert.deepEqual(readdirSync(join(root,'uploads')),['preexistente.pdf'],'o diretório preexistente continua, só com o arquivo antigo');
    assert.ok(result.notes.some((n:string)=>/Arquivos criados pelos fluxos e removidos: uploads\/.*-comprovante-teste\.pdf \(etapa upload\)/.test(n)));
    assert.equal(result.notes.some((n:string)=>/preexistentes sumiram/.test(n)),false);
    assert.equal(await countRows(env,'motoristas'),1);assert.equal(await countRows(env,'documentos'),1);
    assert.equal((await mysql(`SELECT arquivo FROM \`${env.ORQ_DB_NAME}\`.documentos`)).stdout.trim(),'arquivo-antigo.pdf');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('limpeza precisa (MySQL real): diretório criado pelo teste é removido; registro que já existia antes do teste é preservado',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const pre=await mysql(`USE \`${env.ORQ_DB_NAME}\`;CREATE TABLE motoristas (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(80) UNIQUE, senha_hash VARCHAR(255));CREATE TABLE documentos (id INT AUTO_INCREMENT PRIMARY KEY, motorista_id INT, arquivo VARCHAR(200));INSERT INTO motoristas (email,senha_hash) VALUES ('motorista@teste.orq','x');`);
    assert.equal(pre.ok,true,pre.error);
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    const cleanup=result.functionalFlows.flows[0].cleanup;
    assert.equal(cleanup.status,'partial');assert.ok(cleanup.notes.some((n:string)=>/já existiam 1 registro\(s\) em motoristas.*preservados/.test(n)));
    assert.equal(await countRows(env,'motoristas'),1,'o registro preexistente ficou');assert.equal(await countRows(env,'documentos'),0,'o que o teste criou foi removido');
    assert.equal(existsSync(join(root,'uploads')),false,'o diretório criado pelo teste foi removido (estava vazio)');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('limpeza precisa (MySQL real): um arquivo preexistente alterado pelo PHP é preservado e reportado, nunca apagado',async()=>{
  const root=fixture();
  writeFileSync(join(root,'upload.php'),readFileSync(join(root,'upload.php'),'utf8').replace("header('Location: conferencia.php');","file_put_contents(__DIR__ . '/log.txt', \"upload\\n\", FILE_APPEND);\n    header('Location: conferencia.php');"));
  writeFileSync(join(root,'log.txt'),'linha antiga\n');
  try{await withDatabase(async env=>{
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    assert.equal(result.status,'PASSED',JSON.stringify(result.notes));
    assert.match(readFileSync(join(root,'log.txt'),'utf8'),/^linha antiga\nupload\n$/,'o arquivo preexistente continua lá, com o conteúdo que o PHP gravou');
    assert.ok(result.notes.some((n:string)=>/Arquivos preexistentes alterados durante o teste \(preservados, não revertidos\): log\.txt/.test(n)));
  });}finally{rmSync(root,{recursive:true,force:true});}
});

test('limpeza precisa: sem banco isolado nenhum DELETE/DROP é executado, e a validação rejeita DELETE sem WHERE e TRUNCATE',async()=>{
  const flow=(cleanup:any[])=>[{flowId:'f',steps:[{id:'s',kind:'db',query:'SELECT 1'}],cleanup}];
  assert.throws(()=>validateFlowTests(flow([{kind:'db-exec',sql:'DELETE FROM documentos'}])),/limpeza aceita somente/);
  assert.throws(()=>validateFlowTests(flow([{kind:'db-exec',sql:'TRUNCATE TABLE documentos'}])),/limpeza aceita somente/);
  assert.throws(()=>validateFlowTests(flow([{kind:'db-exec',sql:'DROP DATABASE orq_x'}])),/limpeza aceita somente/);
  assert.equal(validateFlowTests(flow([{kind:'db-exec',sql:"DELETE FROM t WHERE email='x@y.z'"},{kind:'db-exec',sql:'DROP TABLE IF EXISTS t'}])).length,1);
  const root=fixture();
  try{
    const report=await runFunctionalFlows({location:root,plan:analyzeProjectFlows(root,REQUEST),tests:validateFlowTests([proofRequest({steps:[{id:'seed',kind:'php',script:'database/setup.php'}],cleanup:[{kind:'db-exec',sql:'DELETE FROM documentos WHERE id>0'},{kind:'db-exec',sql:'DROP TABLE IF EXISTS motoristas'}]})]),env:{}});
    const cleanup=report.flows[0].cleanup;assert.equal(cleanup.status,'partial');
    assert.ok(cleanup.notes.every(n=>/não executada/.test(n)),cleanup.notes.join(' | '));
  }finally{rmSync(root,{recursive:true,force:true});}
});

live('limpeza precisa (MySQL real): DELETE cujo WHERE não cita valor criado pelo teste não é executado',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const result:any=await runProposed(root,env,[{flowId:'x',steps:[{id:'seed',kind:'php',script:'database/setup.php'}],cleanup:[{kind:'db-exec',sql:'DELETE FROM motoristas WHERE id>0'}]}]);
    const cleanup=result.functionalFlows.flows[0].cleanup;assert.equal(cleanup.status,'partial');
    assert.ok(cleanup.notes.some((n:string)=>/não cita um valor criado pelo teste/.test(n)));
    assert.equal(await countRows(env,'motoristas'),1,'o motorista semeado continua porque a limpeza não era comprovável');
  });}finally{rmSync(root,{recursive:true,force:true});}
});
