import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateFlowTests} from '@orchestrator/adapters';

/**
 * Projeto de teste no ESTILO do "Controle de Notas" (reproduz a estrutura real, sem usar nem alterar o projeto real):
 *  - login.php verifica a senha e grava a sessão por HELPERS (iniciar_sessao()), sem session_start() na página;
 *  - as páginas da equipe se protegem com exigirPerfil()/exigirLogin() (helpers de lib/auth.php), sem $_SESSION na página;
 *  - o envio é um HANDLER (enviar_canhoto.php) que grava pelo helper inserir_canhoto() de lib/nota_fiscal.php;
 *  - a conferência lista por consulta (canhotos + notas_fiscais) e mostra o NÚMERO da NF, não o nome do arquivo;
 *  - acao_canhoto.php (ação que grava) e relatorio.php também leem canhotos;
 *  - config/database.php lê ORQ_DB_* com valores padrão.
 */
export const TOKEN='0123456789abcdef0123456789abcdef';
export const NUMERO_NF='NF-TESTE-9001';
export const CARGA='CARGA-TESTE-9001';
export const ARQUIVO='canhoto-teste-9001.pdf';
export const LOGIN_EQUIPE='equipe-teste';
export const SENHA_EQUIPE='senha-equipe-123';
export const PEDIDO='O motorista envia o canhoto da NF e a equipe confere o envio na conferência depois do login.';
export const PDF='%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';

const CONFIG_OK=`<?php

$dbHost = getenv('ORQ_DB_HOST') ?: 'localhost';
$dbPorta = (int) (getenv('ORQ_DB_PORT') ?: 3306);
$dbNome = getenv('ORQ_DB_NAME') ?: 'controle_notas';
$dbUsuario = getenv('ORQ_DB_USER') ?: 'root';
$dbSenha = getenv('ORQ_DB_PASSWORD') ?: '';

$dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $dbHost, $dbPorta, $dbNome);

return new PDO($dsn, $dbUsuario, $dbSenha, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
`;
export const CONFIG_REAL_FIXO=`<?php
file_put_contents(__DIR__ . '/../executado.flag', 'x');
return new PDO('mysql:host=127.0.0.1;dbname=controle_notas;charset=utf8mb4', 'app', 'segredo-real');
`;
const AUTH=`<?php

declare(strict_types=1);

function iniciar_sessao(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Lax']);
    }
}

function exigirLogin(): void
{
    iniciar_sessao();

    if (!isset($_SESSION['usuario_id'])) {
        header('Location: login.php');
        exit;
    }
}

function pagina_inicial_do_perfil(string $perfil): string
{
    return $perfil === 'motorista' ? 'motorista.php' : 'conferencia.php';
}

function exigirPerfil(string $perfil): void
{
    exigirLogin();

    $atual = $_SESSION['usuario_perfil'] ?? 'equipe';

    if ($atual !== $perfil) {
        header('Location: ' . pagina_inicial_do_perfil($atual));
        exit;
    }
}
`;
const NOTA_FISCAL=(grava:boolean)=>`<?php

declare(strict_types=1);

function buscar_nota_fiscal_por_token(PDO $pdo, string $token): ?array
{
    $stmt = $pdo->prepare('SELECT id, numero, status FROM notas_fiscais WHERE token = ?');
    $stmt->execute([$token]);
    $nota = $stmt->fetch();

    return $nota === false ? null : $nota;
}

function inserir_canhoto(PDO $pdo, int $notaId, string $arquivo, string $nome, string $mime, int $tamanho): ?int
{
${grava?`    $stmt = $pdo->prepare('INSERT INTO canhotos (nota_fiscal_id, arquivo, nome_original, mime, tamanho, status) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$notaId, $arquivo, $nome, $mime, $tamanho, 'enviado']);

    return (int) $pdo->lastInsertId();`:`    // defeito simulado: o envio "funciona" (redireciona) mas nada é gravado
    return 1;`}
}
`;
const LOGIN=`<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/auth.php';

iniciar_sessao();

$erro = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $login = is_string($_POST['login'] ?? null) ? trim($_POST['login']) : '';
    $senha = is_string($_POST['senha'] ?? null) ? $_POST['senha'] : '';

    $pdo = require __DIR__ . '/config/database.php';

    $stmt = $pdo->prepare('SELECT id, senha_hash, perfil FROM usuarios WHERE login = ? AND ativo = 1');
    $stmt->execute([$login]);
    $usuario = $stmt->fetch();

    if ($usuario !== false && password_verify($senha, $usuario['senha_hash'])) {
        session_regenerate_id(true);
        $_SESSION['usuario_id'] = (int) $usuario['id'];
        $_SESSION['usuario_perfil'] = $usuario['perfil'];

        header('Location: ' . pagina_inicial_do_perfil($usuario['perfil']));
        exit;
    }

    $erro = 'Usuário ou senha inválidos.';
}
?>
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Login da equipe</title></head>
<body><main><h1>Entrar</h1><?php if ($erro): ?><p><?= htmlspecialchars($erro) ?></p><?php endif; ?>
<form method="post" action="login.php"><input name="login"><input type="password" name="senha"><button>Entrar</button></form></main></body></html>
`;
const MOTORISTA=`<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/auth.php';

exigirPerfil('motorista');

$pdo = require __DIR__ . '/config/database.php';
$notas = $pdo->query("SELECT numero, token FROM notas_fiscais WHERE status = 'pendente' ORDER BY numero")->fetchAll();
?>
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Envio de canhotos</title></head>
<body><h1>Envio de canhotos</h1>
<?php foreach ($notas as $nota): ?>
<form method="post" action="enviar_canhoto.php" enctype="multipart/form-data">
<input type="hidden" name="token" value="<?= htmlspecialchars($nota['token']) ?>">
<input type="file" name="canhoto" accept=".pdf,.jpg,.png"><button>Enviar</button></form>
<?php endforeach; ?>
</body></html>
`;
const ENVIAR=`<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/nota_fiscal.php';

const EXTENSOES_CANHOTO = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'];
const PASTA_CANHOTOS = __DIR__ . '/uploads/canhotos';

function redirecionar_entrega(string $token, array $parametros): never
{
    header('Location: entrega.php?' . http_build_query(['token' => $token] + $parametros));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$token = $_POST['token'] ?? '';
$token = is_string($token) && preg_match('/^[a-f0-9]{32}$/', $token) === 1 ? $token : '';

$pdo = require __DIR__ . '/config/database.php';

$nota = $token !== '' ? buscar_nota_fiscal_por_token($pdo, $token) : null;

if ($nota === null) {
    http_response_code(404);
    exit('Link de entrega inválido.');
}

$arquivo = $_FILES['canhoto'] ?? null;

if (!is_array($arquivo) || $arquivo['error'] !== UPLOAD_ERR_OK) {
    redirecionar_entrega($token, ['erro' => 'envio_falhou']);
}

$nomeOriginal = mb_substr(basename((string) $arquivo['name']), 0, 255, 'UTF-8');
$extensao = strtolower(pathinfo($nomeOriginal, PATHINFO_EXTENSION));

if (!isset(EXTENSOES_CANHOTO[$extensao])) {
    redirecionar_entrega($token, ['erro' => 'formato']);
}

$mime = (new finfo(FILEINFO_MIME_TYPE))->file($arquivo['tmp_name']);

if ($mime === false || EXTENSOES_CANHOTO[$extensao] !== $mime) {
    redirecionar_entrega($token, ['erro' => 'formato']);
}

if (!is_dir(PASTA_CANHOTOS) && !mkdir(PASTA_CANHOTOS, 0775, true) && !is_dir(PASTA_CANHOTOS)) {
    throw new RuntimeException('Não foi possível criar a pasta de canhotos.');
}

$nomeArmazenado = bin2hex(random_bytes(16)) . '.' . $extensao;
$destino = PASTA_CANHOTOS . DIRECTORY_SEPARATOR . $nomeArmazenado;

if (!move_uploaded_file($arquivo['tmp_name'], $destino)) {
    redirecionar_entrega($token, ['erro' => 'envio_falhou']);
}

$canhotoId = inserir_canhoto($pdo, (int) $nota['id'], 'uploads/canhotos/' . $nomeArmazenado, $nomeOriginal, $mime, (int) $arquivo['size']);

redirecionar_entrega($token, ['enviado' => '1']);
`;
const LISTA=(titulo:string,perfil:string)=>`<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/auth.php';

exigirPerfil('${perfil}');

$pdo = require __DIR__ . '/config/database.php';

$canhotos = $pdo->query(
    "SELECT c.id, c.data_envio, nf.numero, cg.codigo AS carga_codigo
     FROM canhotos c
     JOIN notas_fiscais nf ON nf.id = c.nota_fiscal_id
     JOIN cargas cg ON cg.id = nf.carga_id
     WHERE c.status = 'enviado'
     ORDER BY c.data_envio, c.id"
)->fetchAll();
?>
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title></head>
<body><h1>${titulo}</h1><table>
<?php foreach ($canhotos as $c): ?><tr><td><?= htmlspecialchars($c['numero']) ?></td><td><?= htmlspecialchars($c['carga_codigo']) ?></td></tr><?php endforeach; ?>
</table></body></html>
`;
const ACAO=`<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/auth.php';

exigirPerfil('equipe');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: conferencia.php');
    exit;
}

$pdo = require __DIR__ . '/config/database.php';
$stmt = $pdo->prepare('SELECT id, status FROM canhotos WHERE id = ?');
$stmt->execute([(int) ($_POST['id'] ?? 0)]);
$canhoto = $stmt->fetch();

if ($canhoto !== false) {
    $pdo->prepare('UPDATE canhotos SET status = ? WHERE id = ?')->execute(['aprovado', $canhoto['id']]);
}

header('Location: conferencia.php?sucesso=aprovar');
`;
export const SEED=`<?php

declare(strict_types=1);

$pdo = require __DIR__ . '/../config/database.php';

$pdo->exec('CREATE TABLE IF NOT EXISTS usuarios (id INT AUTO_INCREMENT PRIMARY KEY, login VARCHAR(60) UNIQUE, senha_hash VARCHAR(255), perfil VARCHAR(20), ativo TINYINT DEFAULT 1)');
$pdo->exec('CREATE TABLE IF NOT EXISTS cargas (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(60) UNIQUE)');
$pdo->exec('CREATE TABLE IF NOT EXISTS notas_fiscais (id INT AUTO_INCREMENT PRIMARY KEY, carga_id INT, numero VARCHAR(60) UNIQUE, token CHAR(32) UNIQUE, status VARCHAR(20))');
$pdo->exec('CREATE TABLE IF NOT EXISTS canhotos (id INT AUTO_INCREMENT PRIMARY KEY, nota_fiscal_id INT, arquivo VARCHAR(255), nome_original VARCHAR(255), mime VARCHAR(80), tamanho INT, status VARCHAR(20) DEFAULT \\'enviado\\', data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');

$pdo->prepare('INSERT IGNORE INTO usuarios (login, senha_hash, perfil) VALUES (?, ?, ?)')->execute(['${LOGIN_EQUIPE}', password_hash('${SENHA_EQUIPE}', PASSWORD_DEFAULT), 'equipe']);
$pdo->prepare('INSERT IGNORE INTO cargas (codigo) VALUES (?)')->execute(['${CARGA}']);
$cargaId = (int) $pdo->query("SELECT id FROM cargas WHERE codigo = '${CARGA}'")->fetchColumn();
$pdo->prepare('INSERT IGNORE INTO notas_fiscais (carga_id, numero, token, status) VALUES (?, ?, ?, ?)')->execute([$cargaId, '${NUMERO_NF}', '${TOKEN}', 'pendente']);
echo 'seed ok';
`;

export function controleNotas(options:{insere?:boolean;config?:string}={}){
  const root=mkdtempSync(join(tmpdir(),'orq-controle-notas-'));
  for(const dir of ['config','lib','database'])mkdirSync(join(root,dir),{recursive:true});
  const files:Record<string,string>={
    'config/database.php':options.config??CONFIG_OK,'lib/auth.php':AUTH,'lib/nota_fiscal.php':NOTA_FISCAL(options.insere!==false),
    'login.php':LOGIN,'motorista.php':MOTORISTA,'enviar_canhoto.php':ENVIAR,
    'conferencia.php':LISTA('Canhotos aguardando conferência','equipe'),'relatorio.php':LISTA('Relatório de canhotos','equipe'),'acao_canhoto.php':ACAO,
    'database/seed_teste.php':SEED
  };
  for(const [name,content] of Object.entries(files))writeFileSync(join(root,name),content);
  return root;
}

const STEP_SEED={id:'seed',kind:'php',script:'database/seed_teste.php',title:'Criar tabelas, usuário, carga e NF de teste'};
const STEP_LOGIN_FORM={id:'login-form',kind:'http',method:'GET',path:'/login.php',expect:{status:200,bodyIncludes:['name="senha"']}};
const STEP_LOGIN={id:'login',kind:'http',method:'POST',path:'/login.php',form:{login:LOGIN_EQUIPE,senha:SENHA_EQUIPE},expect:{status:302,redirectTo:'conferencia.php'},title:'Login da equipe'};
const STEP_UPLOAD={id:'upload',kind:'http',method:'POST',path:'/enviar_canhoto.php',form:{token:TOKEN},files:{canhoto:{name:ARQUIVO,content:PDF,contentType:'application/pdf'}},expect:{status:302,redirectTo:'enviado=1'},title:'Envio do canhoto pelo handler do formulário'};
export const CLEANUP=[
  {kind:'db-exec',sql:`DELETE FROM canhotos WHERE nome_original='${ARQUIVO}'`},
  {kind:'db-exec',sql:`DELETE FROM notas_fiscais WHERE numero='${NUMERO_NF}'`},
  {kind:'db-exec',sql:`DELETE FROM cargas WHERE codigo='${CARGA}'`},
  {kind:'db-exec',sql:`DELETE FROM usuarios WHERE login='${LOGIN_EQUIPE}'`}
];
const JOIN="FROM canhotos c JOIN notas_fiscais nf ON nf.id = c.nota_fiscal_id";

/** Os fluxos como o Developer os declararia: variações de qualidade da prova de gravação e de listagem. */
export function flowsFor(kind:'retorna-numero'|'conta-por-numero'|'sem-identidade'|'listagem-generica'){
  const persistence=kind==='retorna-numero'
    ?{id:'gravacao',kind:'db',query:`SELECT nf.numero ${JOIN} WHERE nf.token='${TOKEN}' AND c.nome_original='${ARQUIVO}'`,expect:{firstValue:NUMERO_NF},title:'Registro do canhoto gravado no MySQL (devolve o número da NF)'}
    :kind==='conta-por-numero'
      ?{id:'gravacao',kind:'db',query:`SELECT COUNT(*) ${JOIN} WHERE nf.numero='${NUMERO_NF}' AND c.nome_original='${ARQUIVO}'`,expect:{min:1},title:'Registro do canhoto gravado no MySQL'}
      :kind==='sem-identidade'
        ?{id:'gravacao',kind:'db',query:'SELECT COUNT(*) FROM canhotos',expect:{min:1},title:'Há canhotos'}
        :{id:'gravacao',kind:'db',query:`SELECT nf.numero ${JOIN} WHERE nf.token='${TOKEN}' AND c.nome_original='${ARQUIVO}'`,expect:{firstValue:NUMERO_NF},title:'Registro do canhoto gravado no MySQL'};
  const listagem={id:'listagem',kind:'http',method:'GET',path:'/conferencia.php',expect:{status:200,bodyIncludes:kind==='listagem-generica'?['Canhotos aguardando conferência']:[NUMERO_NF,CARGA]},title:'A NF enviada aparece na conferência'};
  return validateFlowTests([{flowId:'flow-completo',name:'Controle de Notas: login → envio do canhoto → MySQL → conferência',steps:[STEP_SEED,STEP_LOGIN_FORM,STEP_LOGIN,STEP_UPLOAD,persistence,listagem],cleanup:CLEANUP}]);
}
