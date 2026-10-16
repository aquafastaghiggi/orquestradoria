import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CommandTesterAdapter,validateFlowTests} from '@orchestrator/adapters';
import {databaseNameFor,dropTaskDatabase,ensureTaskDatabase,loadProjectDbConfig,runMysql,taskDatabaseEnv,testProjectDb} from './project-database.js';

/**
 * Fixture isolado de motorista: login -> upload -> gravação no MySQL -> listagem na conferência.
 * Os testes que precisam de banco usam o MySQL do XAMPP com um banco descartável orq_* (apagado ao final) e são pulados
 * quando o login de teste, o MySQL ou o PHP não estão disponíveis. Nenhum Claude/Codex é executado.
 */
export const REQUEST='Quero o fluxo do motorista: login, upload do comprovante e a listagem dele na conferência.';
export const DB_PHP=`<?php
function orq_pdo(): PDO {
    return new PDO('mysql:host=' . getenv('ORQ_DB_HOST') . ';port=' . getenv('ORQ_DB_PORT') . ';dbname=' . getenv('ORQ_DB_NAME') . ';charset=utf8mb4', getenv('ORQ_DB_USER'), getenv('ORQ_DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}
`;
export const SETUP_PHP=`<?php
require __DIR__ . '/../db.php';
$pdo = orq_pdo();
$pdo->exec('CREATE TABLE IF NOT EXISTS motoristas (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(80) UNIQUE, senha_hash VARCHAR(255))');
$pdo->exec('CREATE TABLE IF NOT EXISTS documentos (id INT AUTO_INCREMENT PRIMARY KEY, motorista_id INT, arquivo VARCHAR(200))');
$pdo->prepare('INSERT IGNORE INTO motoristas (email, senha_hash) VALUES (?, ?)')->execute(['motorista@teste.orq', password_hash('senha-de-teste-123', PASSWORD_DEFAULT)]);
echo "setup ok\\n";
`;
export const LOGIN_PHP=`<?php
session_start();
require __DIR__ . '/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $st = orq_pdo()->prepare('SELECT id, senha_hash FROM motoristas WHERE email = ?');
    $st->execute([$_POST['email'] ?? '']);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row && password_verify($_POST['senha'] ?? '', $row['senha_hash'])) {
        $_SESSION['motorista_id'] = $row['id'];
        header('Location: upload.php');
        exit;
    }
    http_response_code(401);
    echo 'Credenciais inválidas';
}
?><form method="post" action="login.php"><input name="email"><input type="password" name="senha"><button>Entrar</button></form>
`;
const GUARD=`session_start();
if (!isset($_SESSION['motorista_id'])) { header('Location: login.php'); exit; }
`;
export const uploadPhp=(insert:boolean)=>`<?php
${GUARD}require __DIR__ . '/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['documento'])) {
    @mkdir(__DIR__ . '/uploads', 0777, true);
    $dest = __DIR__ . '/uploads/' . bin2hex(random_bytes(6)) . '-' . basename($_FILES['documento']['name']);
    move_uploaded_file($_FILES['documento']['tmp_name'], $dest);
${insert?"    orq_pdo()->prepare('INSERT INTO documentos (motorista_id, arquivo) VALUES (?, ?)')->execute([$_SESSION['motorista_id'], basename($dest)]);\n":''}    header('Location: conferencia.php');
    exit;
}
?><form method="post" action="upload.php" enctype="multipart/form-data"><input type="file" name="documento"><button>Enviar</button></form>
`;
export const CONFERENCIA_PHP=`<?php
${GUARD}require __DIR__ . '/db.php';
$rows = orq_pdo()->query('SELECT d.arquivo, m.email FROM documentos d JOIN motoristas m ON m.id = d.motorista_id')->fetchAll(PDO::FETCH_ASSOC);
?><table><?php foreach ($rows as $r): ?><tr><td><?= htmlspecialchars($r['arquivo']) ?></td><td><?= htmlspecialchars($r['email']) ?></td></tr><?php endforeach; ?></table>
`;

export function fixture(options:{insert?:boolean}={}){
  const root=mkdtempSync(join(tmpdir(),'orq-motorista-'));mkdirSync(join(root,'database'),{recursive:true});
  const files:Record<string,string>={'db.php':DB_PHP,'database/setup.php':SETUP_PHP,'login.php':LOGIN_PHP,'upload.php':uploadPhp(options.insert!==false),'conferencia.php':CONFERENCIA_PHP};
  for(const [name,content] of Object.entries(files))writeFileSync(join(root,name),content);
  return root;
}

export const declaredFlows=()=>validateFlowTests([{
  flowId:'flow-completo',name:'Motorista: login → upload → gravação → listagem',
  steps:[
    {id:'seed',kind:'php',script:'database/setup.php',title:'Criar tabelas e o motorista de teste'},
    {id:'sem-sessao',kind:'http',method:'GET',path:'/upload.php',expect:{status:302,redirectTo:'login.php'},title:'Sem sessão, o upload redireciona para o login'},
    {id:'login-form',kind:'http',method:'GET',path:'/login.php',expect:{status:200,bodyIncludes:['name="senha"']}},
    {id:'login',kind:'http',method:'POST',path:'/login.php',form:{email:'motorista@teste.orq',senha:'senha-de-teste-123'},expect:{status:302,redirectTo:'upload.php'},title:'Login com credenciais de teste'},
    {id:'upload',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'comprovante-teste.pdf',content:'%PDF-1.4 teste',contentType:'application/pdf'}},expect:{status:302,redirectTo:'conferencia.php'},title:'Upload autenticado'},
    {id:'gravacao',kind:'db',query:"SELECT COUNT(*) FROM documentos WHERE arquivo LIKE '%comprovante-teste.pdf'",expect:{min:1},title:'Registro gravado no MySQL'},
    {id:'listagem',kind:'http',method:'GET',path:'/conferencia.php',expect:{status:200,bodyIncludes:['comprovante-teste.pdf','motorista@teste.orq']},title:'Registro aparece na conferência'}
  ],
  cleanup:[{kind:'db-exec',sql:"DELETE FROM documentos WHERE arquivo LIKE '%comprovante-teste.pdf'"},{kind:'db-exec',sql:"DELETE FROM motoristas WHERE email='motorista@teste.orq'"}]
}]);

export const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'Fluxo do motorista',description:REQUEST},workspaceContext:{location},previousArtifacts:[],projectRules:[]});
export const tester=(declared:any[],env:Record<string,string>)=>new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,flow:{request:REQUEST,env,tests:()=>declared}});
/** Executa o Tester com fluxos propostos no formato do Developer (passam por validateFlowTests). */
export const runProposed=(location:string,env:Record<string,string>,flows:any[])=>tester(validateFlowTests(flows),env).execute(input(location)).then((r:any)=>r.structuredResult);

// ---------- banco real (pulado quando indisponível) ----------
export const config=loadProjectDbConfig();
const PHP=process.platform==='win32'?'C:/xampp/php/php.exe':'php';
const reachable=config&&existsSync(config.mysqlBin)&&existsSync(PHP)?await testProjectDb(config):{ok:false};
export const mysqlAvailable=reachable.ok;
export const live=reachable.ok?test:test.skip;
export async function withDatabase<T>(run:(env:Record<string,string>)=>Promise<T>):Promise<T>{
  const name=databaseNameFor(`ff${randomBytes(6).toString('hex')}`);
  const prepared=await ensureTaskDatabase(config!,name);assert.equal(prepared.ok,true);
  try{return await run(taskDatabaseEnv(config!,name));}finally{await dropTaskDatabase(config!,name);}
}
export const countRows=async(env:Record<string,string>,table:string)=>Number((await runMysql(config!,`SELECT COUNT(*) FROM \`${env.ORQ_DB_NAME}\`.${table}`)).stdout.trim());
export const mysql=(sql:string)=>runMysql(config!,sql);
