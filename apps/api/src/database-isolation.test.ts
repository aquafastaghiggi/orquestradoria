import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkDatabaseIsolation} from '@orchestrator/adapters';
import {fixture,live,runProposed,tester,input,declaredFlows,withDatabase,countRows} from './functional-flow-fixture.js';

/**
 * Isolamento do PHP: o teste funcional só executa quando se COMPROVA que toda conexão usa exclusivamente o MySQL de teste.
 * Estes testes não acessam banco algum (o ambiente é fictício e o PHP do projeto nunca chega a rodar), exceto os marcados
 * com `live`, que usam um banco orq_* descartável do XAMPP para provar que o fluxo legítimo com ORQ_DB_* continua funcionando.
 */
const ISOLATED={ORQ_DB_HOST:'127.0.0.1',ORQ_DB_PORT:'3306',ORQ_DB_USER:'orquestradoria',ORQ_DB_PASSWORD:'senha-falsa-do-teste',ORQ_DB_NAME:'orq_fake1234'};
const MARKER='executado.flag';
const probe=`file_put_contents(__DIR__ . '/${MARKER}', 'x');`;
const STEP={kind:'http',path:'/upload.php'};
const verdictOf=(root:string,env:Record<string,string>=ISOLATED)=>checkDatabaseIsolation(root,{steps:[STEP]},env);
const uploadSteps=()=>[{id:'up',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'a-teste.pdf',content:'x'}},expect:{redirectTo:'x.php'}}];
const flow=()=>({flowId:'flow-completo',steps:uploadSteps()});
const write=(root:string,name:string,code:string)=>{mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),code);};

/** Roda o Tester com o código dado como upload.php e confirma: bloqueado, nenhum PHP executado, motivo informado. */
async function assertBlocked(files:Record<string,string>,reason:RegExp,label:string){
  const root=fixture();
  try{
    for(const [name,code] of Object.entries(files))write(root,name,code);
    for(const env of [{},ISOLATED]){ // com ou sem banco isolado disponível, o código inseguro não roda
      const result:any=await runProposed(root,env,[flow()]);
      assert.equal(result.status,'BLOCKED',label);
      assert.equal(result.functionalFlows.flows[0].steps[0].status,'blocked',label);
      assert.match(result.functionalFlows.flows[0].steps[0].evidence,/bloqueada/,label);
      const impossible=result.functionalFlows.impossible.join(' | ');
      assert.match(impossible,/Execução bloqueada por segurança \(nenhum PHP\/HTTP\/SQL foi executado\)/,label);
      assert.match(impossible,reason,`${label}: o motivo informado`);
      assert.equal(existsSync(join(root,MARKER)),false,`${label}: o PHP do projeto nunca foi executado`);
      assert.equal(JSON.stringify(result).includes('senha-falsa-do-teste'),false);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
}

// ---------- caso 1: lê ORQ_DB_* mas monta o DSN com controle_notas ----------
const readsEverything=`$host=getenv('ORQ_DB_HOST');$user=getenv('ORQ_DB_USER');$pass=getenv('ORQ_DB_PASSWORD');$name=getenv('ORQ_DB_NAME');`;
const dsnCases:Record<string,string>={
  'DSN literal com controle_notas':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO('mysql:host=' . $host . ';dbname=controle_notas', $user, $pass);`,
  'banco em variável intermediária (valor fixo) e ORQ_DB_NAME lido mas não usado':`<?php ${probe}\n${readsEverything}\n$banco='controle_notas';\n$pdo=new PDO("mysql:host=$host;dbname=$banco", $user, $pass);`,
  'banco vindo de constante fixa':`<?php ${probe}\ndefine('BANCO','controle_notas');\n${readsEverything}\n$pdo=new PDO('mysql:host=' . $host . ';dbname=' . BANCO, $user, $pass);`,
  'banco concatenado com sufixo fixo (orq + controle_notas)':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO('mysql:host=' . $host . ';dbname=' . $name . 'controle_notas', $user, $pass);`,
  'DSN sem dbname e USE controle_notas depois':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO('mysql:host=' . $host, $user, $pass);\n$pdo->exec("USE controle_notas");`,
  'mysqli com o banco fixo e o resto vindo de ORQ_DB_*':`<?php ${probe}\n${readsEverything}\n$db=new mysqli($host,$user,$pass,'controle_notas');`,
  'consulta qualificada com outro banco (controle_notas.usuarios)':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO("mysql:host=$host;dbname=$name", $user, $pass);\n$pdo->query('SELECT * FROM controle_notas.usuarios');`,
  'host remoto':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO("mysql:host=10.20.30.40;dbname=$name", $user, $pass);`,
  'senha que não vem de ORQ_DB_PASSWORD':`<?php ${probe}\n${readsEverything}\n$pdo=new PDO("mysql:host=$host;dbname=$name", $user, 'segredo-fixo');`
};
for(const [label,code] of Object.entries(dsnCases)){
  test(`isolamento (caso 1): lê ORQ_DB_* mas ${label} → BLOQUEADO antes de executar PHP`,async()=>{
    await assertBlocked({'upload.php':code},/upload\.php: .*(banco|dbname|senha|host|USE|controle_notas)/,label);
  });
}
test('isolamento (caso 1): o motivo cita o banco fixo e o arquivo',()=>{
  const root=fixture();write(root,'upload.php',`<?php\n${readsEverything}\n$pdo=new PDO('mysql:host=' . $host . ';dbname=controle_notas', $user, $pass);`);
  try{
    const verdict=verdictOf(root);assert.equal(verdict.safe,false);
    assert.ok(verdict.reasons.some(r=>/upload\.php: o banco "controle_notas" está fixo no código \(a conexão new PDO deveria usar ORQ_DB_NAME\)/.test(r)),verdict.reasons.join(' | '));
  }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- caso 2: includes dinâmicos que ocultam a conexão ----------
const hiddenConnection=`<?php ${probe}\n$pdo=new PDO('mysql:host=127.0.0.1;dbname=controle_notas','app','segredo-real');`;
const dynamicCases:Array<[string,Record<string,string>,RegExp]>=[
  ['include a partir de parâmetro da requisição',{'upload.php':`<?php ${probe}\nrequire __DIR__ . '/' . $_GET['cfg'] . '.php';`,'prod.php':hiddenConnection},/include dinâmico/],
  ['include a partir de variável montada com getenv fora de ORQ_DB_*',{'upload.php':`<?php ${probe}\n$arquivo='config/' . getenv('APP_ENV') . '.php';\nrequire $arquivo;`,'config/prod.php':hiddenConnection},/include dinâmico/],
  ['include com interpolação de valor fixo (é resolvido e analisado, e a conexão escondida é bloqueada)',{'upload.php':`<?php ${probe}\n$tipo='prod';\ninclude "conf_{$tipo}.php";`,'conf_prod.php':hiddenConnection},/conf_prod\.php: o banco "controle_notas" está fixo/],
  ['include com interpolação de valor vindo da requisição',{'upload.php':`<?php ${probe}\ninclude "conf_{$_GET['t']}.php";`,'conf_prod.php':hiddenConnection},/include dinâmico/],
  ['include de função (resolve_config())',{'upload.php':`<?php ${probe}\nrequire_once resolve_config();`},/include dinâmico/],
  ['include fora do projeto',{'upload.php':`<?php ${probe}\nrequire '../../outro-sistema/config.php';`},/não resolve para um arquivo do projeto/],
  ['include de arquivo inexistente no projeto',{'upload.php':`<?php ${probe}\nrequire 'config/banco.php';`},/não resolve para um arquivo do projeto/],
  ['include de recurso externo',{'upload.php':`<?php ${probe}\ninclude 'http://exemplo.test/config.php';`},/recurso externo|include dinâmico|não resolve/],
  ['autoload dinâmico',{'upload.php':`<?php ${probe}\nspl_autoload_register(function($c){ require __DIR__ . "/classes/$c.php"; });`},/autoload dinâmico|include dinâmico/],
  ['eval',{'upload.php':`<?php ${probe}\neval(file_get_contents(__DIR__ . '/codigo.txt'));`},/eval\(\)/],
  ['instanciação dinâmica da classe de conexão',{'upload.php':`<?php ${probe}\n$driver='PDO';\n$pdo=new $driver('mysql:host=127.0.0.1;dbname=controle_notas','app','x');`},/instanciação dinâmica/],
  ['conexão escondida num include que também é dinâmico (segundo nível)',{'upload.php':`<?php ${probe}\nrequire __DIR__ . '/boot.php';`,'boot.php':`<?php\nrequire __DIR__ . '/lib/' . basename($_SERVER['PHP_SELF']);`},/boot\.php: include dinâmico/],
  ['camada de banco de terceiros',{'upload.php':`<?php ${probe}\n$conn=\\Doctrine\\DBAL\\DriverManager::getConnection($params);`},/camada de banco de terceiros/],
  ['outro motor de banco',{'upload.php':`<?php ${probe}\n$c=pg_connect("host=prod dbname=erp");`},/não é o MySQL isolado/]
];
for(const [label,files,reason] of dynamicCases){
  test(`isolamento (caso 2): ${label} → BLOQUEADO antes de executar PHP`,async()=>{await assertBlocked(files,reason,label);});
}

// ---------- o fluxo legítimo continua liberado ----------
test('isolamento: formas legítimas com ORQ_DB_* continuam liberadas (inclusive includes literais, comentários e HTML com a palavra include)',()=>{
  const legit:Record<string,string>={
    'fixture padrão (db.php com getenv direto)':'',
    'variáveis intermediárias lidas de ORQ_DB_* e DSN com interpolação':`<?php\n$h=getenv('ORQ_DB_HOST');$n=getenv('ORQ_DB_NAME');$u=getenv('ORQ_DB_USER');$p=getenv('ORQ_DB_PASSWORD');\n$pdo=new PDO("mysql:host=$h;dbname=$n;charset=utf8mb4",$u,$p);`,
    'constantes definidas a partir de ORQ_DB_*':`<?php\ndefine('DB_N',getenv('ORQ_DB_NAME'));define('DB_H',getenv('ORQ_DB_HOST'));define('DB_U',getenv('ORQ_DB_USER'));define('DB_P',getenv('ORQ_DB_PASSWORD'));\n$pdo=new PDO('mysql:host='.DB_H.';dbname='.DB_N,DB_U,DB_P);`,
    'sprintf':`<?php\n$dsn=sprintf('mysql:host=%s;port=%d;dbname=%s',getenv('ORQ_DB_HOST'),getenv('ORQ_DB_PORT'),getenv('ORQ_DB_NAME'));\n$pdo=new PDO($dsn,getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'));`,
    'mysqli com os quatro argumentos de ORQ_DB_*':`<?php\n$db=new mysqli(getenv('ORQ_DB_HOST'),getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'),getenv('ORQ_DB_NAME'),(int)getenv('ORQ_DB_PORT'));`,
    'valor padrão só como fallback do ORQ_DB_*':`<?php\n$n=getenv('ORQ_DB_NAME') ?: 'controle_notas';\n$pdo=new PDO('mysql:host='.getenv('ORQ_DB_HOST').';dbname='.$n,getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'));`,
    'host literal local':`<?php\n$pdo=new PDO('mysql:host=127.0.0.1;dbname='.getenv('ORQ_DB_NAME'),getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'));`,
    'comentários e HTML com a palavra include/require/USE':`<?php\nuse PDO;\n// include the config and require login; USE controle_notas (só comentário)\nrequire_once dirname(__FILE__) . '/db.php';\n/* require $x; */\n?><p>Please include a file and require a login. USE the form.</p>`,
  };
  for(const [label,code] of Object.entries(legit)){
    const root=fixture();
    try{
      if(code)write(root,'upload.php',code.includes('db.php')?code:`${code}`);
      if(code&&!code.includes('db.php'))write(root,'upload.php',code);
      const verdict=verdictOf(root);
      assert.equal(verdict.safe,true,`${label}: ${verdict.reasons.join(' | ')}`);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});

test('isolamento: o valor padrão de ORQ_DB_* é aceito só com nota; sem ORQ_DB_* no ambiente o mesmo código é bloqueado',()=>{
  const root=fixture();
  write(root,'upload.php',`<?php\n$n=getenv('ORQ_DB_NAME') ?: 'controle_notas';\n$pdo=new PDO('mysql:host='.getenv('ORQ_DB_HOST').';dbname='.$n,getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'));`);
  try{
    const ok=verdictOf(root);assert.equal(ok.safe,true);assert.ok(ok.notes.some(n=>/valores padrão para ORQ_DB_\*/.test(n)));
    const without=verdictOf(root,{});assert.equal(without.safe,false);assert.ok(without.reasons.some(r=>/banco de teste isolado .* não está disponível/.test(r)));
  }finally{rmSync(root,{recursive:true,force:true});}
});

live('isolamento (MySQL real): o fluxo legítimo do motorista com ORQ_DB_* continua rodando e validando de ponta a ponta',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const verdict=checkDatabaseIsolation(root,{steps:declaredFlows()[0].steps,cleanup:declaredFlows()[0].cleanup},env);
    assert.equal(verdict.safe,true,verdict.reasons.join(' | '));assert.equal(verdict.connects,true);
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    assert.equal(result.status,'PASSED',JSON.stringify(result.notes));
    assert.equal(result.functionalFlows.required.every((r:any)=>r.validated),true);
    assert.equal(await countRows(env,'documentos'),0);
  });}finally{rmSync(root,{recursive:true,force:true});}
});
