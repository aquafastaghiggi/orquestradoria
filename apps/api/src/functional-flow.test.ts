import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CommandTesterAdapter,analyzeProjectFlows,renderFlowPlan,validateFlowTests,runFunctionalFlows} from '@orchestrator/adapters';
import {PipelineRunner,assertPipelineApprovalIntegrity,testerIssues} from '@orchestrator/core';
import {databaseNameFor,dropTaskDatabase,ensureTaskDatabase,loadProjectDbConfig,taskDatabaseEnv,testProjectDb,runMysql} from './project-database.js';

/**
 * Fixture isolado de motorista: login -> upload -> gravação no MySQL -> listagem na conferência.
 * Os testes que precisam de banco usam o MySQL do XAMPP com um banco descartável orq_* (apagado ao final) e são pulados
 * quando o login de teste, o MySQL ou o PHP não estão disponíveis. Nenhum Claude/Codex é executado.
 */
const REQUEST='Quero o fluxo do motorista: login, upload do comprovante e a listagem dele na conferência.';
const DB_PHP=`<?php
function orq_pdo(): PDO {
    return new PDO('mysql:host=' . getenv('ORQ_DB_HOST') . ';port=' . getenv('ORQ_DB_PORT') . ';dbname=' . getenv('ORQ_DB_NAME') . ';charset=utf8mb4', getenv('ORQ_DB_USER'), getenv('ORQ_DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}
`;
const SETUP_PHP=`<?php
require __DIR__ . '/../db.php';
$pdo = orq_pdo();
$pdo->exec('CREATE TABLE IF NOT EXISTS motoristas (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(80) UNIQUE, senha_hash VARCHAR(255))');
$pdo->exec('CREATE TABLE IF NOT EXISTS documentos (id INT AUTO_INCREMENT PRIMARY KEY, motorista_id INT, arquivo VARCHAR(200))');
$pdo->prepare('INSERT IGNORE INTO motoristas (email, senha_hash) VALUES (?, ?)')->execute(['motorista@teste.orq', password_hash('senha-de-teste-123', PASSWORD_DEFAULT)]);
echo "setup ok\\n";
`;
const LOGIN_PHP=`<?php
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
const uploadPhp=(insert:boolean)=>`<?php
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
const CONFERENCIA_PHP=`<?php
${GUARD}require __DIR__ . '/db.php';
$rows = orq_pdo()->query('SELECT d.arquivo, m.email FROM documentos d JOIN motoristas m ON m.id = d.motorista_id')->fetchAll(PDO::FETCH_ASSOC);
?><table><?php foreach ($rows as $r): ?><tr><td><?= htmlspecialchars($r['arquivo']) ?></td><td><?= htmlspecialchars($r['email']) ?></td></tr><?php endforeach; ?></table>
`;

function fixture(options:{insert?:boolean}={}){
  const root=mkdtempSync(join(tmpdir(),'orq-motorista-'));mkdirSync(join(root,'database'),{recursive:true});
  const files:Record<string,string>={'db.php':DB_PHP,'database/setup.php':SETUP_PHP,'login.php':LOGIN_PHP,'upload.php':uploadPhp(options.insert!==false),'conferencia.php':CONFERENCIA_PHP};
  for(const [name,content] of Object.entries(files))writeFileSync(join(root,name),content);
  return root;
}

const declaredFlows=()=>validateFlowTests([{
  flowId:'flow-completo',name:'Motorista: login → upload → gravação → listagem',covers:['flow-auth','flow-upload','flow-listing'],
  steps:[
    {id:'seed',kind:'php',script:'database/setup.php',title:'Criar tabelas e o motorista de teste'},
    {id:'sem-sessao',kind:'http',method:'GET',path:'/upload.php',expect:{status:302,redirectTo:'login.php'},title:'Sem sessão, o upload redireciona para o login'},
    {id:'login-form',kind:'http',method:'GET',path:'/login.php',expect:{status:200,bodyIncludes:['name="senha"']}},
    {id:'login',kind:'http',method:'POST',path:'/login.php',form:{email:'motorista@teste.orq',senha:'senha-de-teste-123'},expect:{status:302,redirectTo:'upload.php'},title:'Login com credenciais de teste'},
    {id:'upload',kind:'http',method:'POST',path:'/upload.php',files:{documento:{name:'comprovante-teste.pdf',content:'%PDF-1.4 teste',contentType:'application/pdf'}},expect:{status:302,redirectTo:'conferencia.php'},title:'Upload autenticado'},
    {id:'gravacao',kind:'db',query:"SELECT COUNT(*) FROM documentos WHERE arquivo LIKE '%comprovante-teste.pdf'",expect:{min:1},title:'Registro gravado no MySQL'},
    {id:'listagem',kind:'http',method:'GET',path:'/conferencia.php',expect:{status:200,bodyIncludes:['comprovante-teste.pdf','motorista@teste.orq']},title:'Registro aparece na conferência'}
  ],
  cleanup:[{kind:'db-exec',sql:'DELETE FROM documentos'},{kind:'db-exec',sql:'DELETE FROM motoristas'}]
}]);

const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'Fluxo do motorista',description:REQUEST},workspaceContext:{location},previousArtifacts:[],projectRules:[]});
const tester=(declared:any[],env:Record<string,string>)=>new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,flow:{request:REQUEST,env,tests:()=>declared}});

// ---------- banco real (pulado quando indisponível) ----------
const config=loadProjectDbConfig();
const PHP=process.platform==='win32'?'C:/xampp/php/php.exe':'php';
const reachable=config&&existsSync(config.mysqlBin)&&existsSync(PHP)?await testProjectDb(config):{ok:false};
const live=reachable.ok?test:test.skip;
async function withDatabase<T>(run:(env:Record<string,string>)=>Promise<T>):Promise<T>{
  const name=databaseNameFor(`ff${randomBytes(6).toString('hex')}`);
  const prepared=await ensureTaskDatabase(config!,name);assert.equal(prepared.ok,true);
  try{return await run(taskDatabaseEnv(config!,name));}finally{await dropTaskDatabase(config!,name);}
}
const countRows=async(env:Record<string,string>,table:string)=>Number((await runMysql(config!,`SELECT COUNT(*) FROM \`${env.ORQ_DB_NAME}\`.${table}`)).stdout.trim());

live('fixture do motorista (MySQL real): login → upload → gravação → listagem passam com evidência real por etapa, e a limpeza é feita',async()=>{
  const root=fixture();
  try{await withDatabase(async env=>{
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    const flows=result.functionalFlows;
    assert.equal(result.status,'PASSED',JSON.stringify(result.notes));assert.equal(flows.status,'PASSED');
    assert.deepEqual(flows.required.map((r:any)=>[r.flowId,r.validated]).sort(),[['flow-auth',true],['flow-completo',true],['flow-listing',true],['flow-upload',true]]);
    const steps=flows.flows[0].steps;
    assert.deepEqual(steps.map((s:any)=>s.status),Array(7).fill('passed'));
    const byId=Object.fromEntries(steps.map((s:any)=>[s.id,s.evidence as string]));
    assert.match(byId['sem-sessao'],/GET \/upload\.php → 302 Location: login\.php/);
    assert.match(byId.login,/POST \/login\.php → 302 Location: upload\.php .*PHPSESSID/);
    assert.match(byId.upload,/POST \/upload\.php → 302 Location: conferencia\.php/);
    assert.match(byId.gravacao,/SELECT → 1 linha\(s\), primeiro valor 1/);
    assert.match(byId.listagem,/contém "comprovante-teste\.pdf", "motorista@teste\.orq"/);
    // limpeza: dados temporários e arquivos enviados removidos
    assert.equal(await countRows(env,'documentos'),0);assert.equal(await countRows(env,'motoristas'),0);
    assert.deepEqual(existsSync(join(root,'uploads'))?readdirSync(join(root,'uploads')):[],[],'uploaded test files are removed');
    assert.ok(result.notes.some((n:string)=>/Arquivos temporários criados pelos fluxos e removidos: uploads\//.test(n)));
    assert.deepEqual(flows.flows[0].cleanup.status,'done');
    // nenhuma credencial na evidência
    const text=JSON.stringify(result);for(const secret of [env.ORQ_DB_PASSWORD,'senha-de-teste-123'])assert.equal(text.includes(secret),false);
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('fixture com etapa quebrada (upload não grava no MySQL): FAILED na etapa certa, etapas seguintes não executadas, sem aprovação',async()=>{
  const root=fixture({insert:false});
  try{await withDatabase(async env=>{
    const result:any=(await tester(declaredFlows(),env).execute(input(root))).structuredResult;
    assert.equal(result.status,'FAILED');assert.equal(result.blockReason,'Functional flow failed');
    const steps=result.functionalFlows.flows[0].steps;
    assert.deepEqual(steps.map((s:any)=>[s.id,s.status]),[['seed','passed'],['sem-sessao','passed'],['login-form','passed'],['login','passed'],['upload','passed'],['gravacao','failed'],['listagem','skipped']]);
    assert.match(steps.find((s:any)=>s.id==='gravacao').evidence,/valor 0, esperado pelo menos 1/);
    assert.equal(result.functionalFlows.required.every((r:any)=>!r.validated),true,'a failed run validates nothing');
    assert.deepEqual(readdirSync(join(root,'uploads')),[],'cleanup also runs after a failure');
    assert.equal(await countRows(env,'motoristas'),0);

    // o ciclo de correção recebe a etapa, a evidência e os arquivos prováveis
    const issues=testerIssues({structuredResult:result} as any).join('\n');
    assert.match(issues,/Functional flow: Motorista/);assert.match(issues,/Failed step: gravacao/);assert.match(issues,/editing the existing files in place/);

    // sem aprovação: nem a integridade do pipeline aceita um Reviewer APPROVED depois desse Tester
    const at=(n:number)=>new Date(Date.UTC(2026,0,1,0,0,n)).toISOString();
    const executions=(testerResult:any)=>[{role:'developer',status:'completed',startedAt:at(1),structuredResult:{status:'COMPLETED'}},{role:'tester',status:'completed',startedAt:at(2),structuredResult:testerResult},{role:'reviewer',status:'completed',startedAt:at(3),structuredResult:{status:'APPROVED'}}];
    const task={pipeline:['developer','tester','reviewer'] as any,lastSuccessfulStage:'reviewer' as any,configSnapshot:{}};
    assert.throws(()=>assertPipelineApprovalIntegrity(task,executions(result)),/tester PASSED is required/);
    // mesmo um Tester "PASSED" cujo relatório funcional não validou um fluxo obrigatório não habilita a aprovação
    assert.throws(()=>assertPipelineApprovalIntegrity(task,executions({...result,status:'PASSED'})),/required functional flow was not validated/);
  });}finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- sem banco ----------
test('fluxo obrigatório sem teste declarado: BLOCKED (nunca aprovado) e o Reviewer nem chega a rodar',async()=>{
  const root=fixture();
  try{
    const result:any=(await tester([],{}).execute(input(root))).structuredResult;
    assert.equal(result.status,'BLOCKED');assert.equal(result.blockReason,'required_flow_unvalidated');
    assert.deepEqual(result.functionalFlows.required.map((r:any)=>r.validated),[false,false,false,false]);
    assert.ok(result.notes.some((n:string)=>/Fluxo obrigatório NÃO validado: .*nenhum teste funcional foi declarado/.test(n)));

    const stages:string[]=[];let call=0;
    const adapter:any={id:'f',name:'f',capabilities:{},checkAvailability:async()=>true,getModels:async()=>[],getUsage:async()=>({tokenUsage:0,estimatedCost:0}),cancel:async()=>{},execute:async(ctx:any)=>{stages.push(ctx.stage);call++;
      const structuredResult=ctx.stage==='developer'?{status:'COMPLETED',summary:'ok',filesChanged:['a.php'],testsRun:[{status:'passed',command:'x'}],notes:[]}:result;
      return{output:JSON.stringify(structuredResult),stdout:'',stderr:'',progressEvents:[],structuredResult,tokenUsage:0,estimatedCost:0};}};
    const hooks:any={onStageStart(){},onStageComplete(){},onProgress(){},onHeartbeat(){},onFailure(){}};
    const ctx:any={task:{id:'t',workspaceId:'w',title:'x',description:REQUEST,pipeline:['developer','tester','reviewer'],status:'implementing',configSnapshot:{testerRequired:false},fixCycle:0},workspaceContext:{id:'w',type:'local',location:root},projectRules:[],previousArtifacts:[],constraints:{timeoutSeconds:1,tokenBudget:100,budgetUsd:1}};
    await assert.rejects(new PipelineRunner(adapter,hooks).run(ctx,['developer','tester','reviewer'],0,undefined,undefined,(role:string,base:any)=>({...base,stage:role,stageContext:{prompt:'p',contextChars:1}}),{enabled:true,maxCycles:2} as any),(error:any)=>error.kind==='pipeline_incomplete'&&error.details.reason==='tester_blocked');
    assert.deepEqual(stages,['developer','tester'],'a required flow that was not validated stops the pipeline even when the Tester is not otherwise mandatory');
    assert.equal(call,2);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('banco de teste indisponível: a verificação é registrada como impossível (não como sucesso), fluxo BLOCKED, nenhuma etapa de banco executada',async()=>{
  const root=fixture();
  try{
    const result:any=(await tester(declaredFlows(),{}).execute(input(root))).structuredResult;
    assert.equal(result.status,'BLOCKED');
    assert.ok(result.functionalFlows.impossible.some((m:string)=>/banco de teste.*não está disponível/.test(m)));
    const steps=result.functionalFlows.flows[0].steps;
    assert.equal(steps[0].status,'blocked');assert.match(steps[0].evidence,/impossível/);
    assert.ok(steps.slice(1).every((s:any)=>s.status==='skipped'));
    assert.equal(result.functionalFlows.required.some((r:any)=>r.validated),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a mesma falha do Tester em duas rodadas seguidas para o ciclo automático (sem gastar mais Developer/Reviewer)',async()=>{
  const failed={status:'FAILED',commands:[],functionalFlows:{status:'FAILED',required:[],flows:[{flowId:'flow-completo',name:'Fluxo',status:'FAILED',steps:[{id:'gravacao',title:'Registro gravado',status:'failed',evidence:'valor 0'}]}]}};
  const stages:string[]=[];
  const adapter:any={id:'f',name:'f',capabilities:{},checkAvailability:async()=>true,getModels:async()=>[],getUsage:async()=>({tokenUsage:0,estimatedCost:0}),cancel:async()=>{},execute:async(ctx:any)=>{stages.push(ctx.stage);
    const structuredResult=ctx.stage==='developer'?{status:'COMPLETED',summary:'ok',filesChanged:['upload.php'],testsRun:[{status:'passed',command:'x'}],notes:[]}:failed;
    return{output:'{}',stdout:'',stderr:'',progressEvents:[],structuredResult,tokenUsage:0,estimatedCost:0};}};
  const hooks:any={onStageStart(){},onStageComplete(){},onProgress(){},onHeartbeat(){},onFailure(){}};
  const ctx:any={task:{id:'t',workspaceId:'w',title:'x',description:'y',pipeline:['developer','tester','reviewer'],status:'implementing',configSnapshot:{},fixCycle:0},workspaceContext:{id:'w',type:'local',location:tmpdir()},projectRules:[],previousArtifacts:[],constraints:{timeoutSeconds:1,tokenBudget:100,budgetUsd:1}};
  await assert.rejects(new PipelineRunner(adapter,hooks).run(ctx,['developer','tester','reviewer'],0,undefined,undefined,(role:string,base:any)=>({...base,stage:role,stageContext:{prompt:'p',contextChars:1}}),{enabled:true,maxCycles:5} as any),(error:any)=>error.kind==='needs_input'&&error.details.stopKind==='repeated_issue');
  assert.deepEqual(stages,['developer','tester','developer','tester'],'stopped right after the second identical failure');
});

test('inteligência de fluxo: fatos (com arquivo) separados de hipóteses, critérios derivados e plano compartilhado',()=>{
  const root=fixture();
  try{
    const plan=analyzeProjectFlows(root,REQUEST);
    assert.equal(plan.auth.loginPage,'login.php');assert.deepEqual(plan.auth.guardedPages.sort(),['conferencia.php','upload.php']);
    const required=plan.flows.filter(f=>f.required).map(f=>f.id).sort();assert.deepEqual(required,['flow-auth','flow-completo','flow-listing','flow-upload']);
    assert.ok(plan.facts.some(f=>/login\.php verifica senha e grava a sessão/.test(f)));
    assert.ok(plan.facts.some(f=>/Tabela documentos: gravada por upload\.php e lida por conferencia\.php/.test(f)));
    assert.ok(plan.facts.some(f=>/upload\.php processa \$_FILES e grava em documentos/.test(f)));
    assert.deepEqual(plan.hypotheses,[]);assert.deepEqual(plan.ambiguities,[]);
    assert.ok(plan.criteria.length>=8&&plan.criteria.every(c=>c.source==='request'&&c.certainty==='fact'));
    for(const role of ['developer','tester','reviewer'] as const){
      const text=renderFlowPlan(plan,role);assert.match(text,/FUNCTIONAL FLOW PLAN/);assert.match(text,/Facts identified/);assert.match(text,/flow-completo/);
    }
    assert.match(renderFlowPlan(plan,'developer'),/functionalFlows/);assert.match(renderFlowPlan(plan,'developer'),/edit the existing files above in place/);
    assert.match(renderFlowPlan(plan,'reviewer'),/do NOT approve when a required flow/);
    // projeto vazio: o pedido gera fluxos obrigatórios, mas tudo é hipótese
    const empty=mkdtempSync(join(tmpdir(),'orq-empty-'));
    try{const emptyPlan=analyzeProjectFlows(empty,REQUEST);const composite=emptyPlan.flows.find(f=>f.id==='flow-completo')!;
      assert.equal(composite.certainty,'hypothesis');assert.ok(emptyPlan.hypotheses.some(h=>/ainda não existe no código/.test(h)));assert.ok(emptyPlan.criteria.every(c=>c.certainty==='hypothesis'));}
    finally{rmSync(empty,{recursive:true,force:true});}
    // ambiguidade relevante vira pergunta; menção solta não exige fluxo obrigatório
    writeFileSync(join(root,'login_antigo.php'),LOGIN_PHP);
    assert.ok(analyzeProjectFlows(root,REQUEST).ambiguities.some(a=>/mais de uma página que parece ser o login/.test(a)));
    rmSync(join(root,'login_antigo.php'));
    assert.deepEqual(analyzeProjectFlows(root,'Trocar o texto do botão').flows.filter(f=>f.required),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('validação dos fluxos propostos: só servidor local, SELECT e limpeza restrita, scripts nas pastas permitidas',()=>{
  const flow=(step:any,extra:any={})=>[{flowId:'f',steps:[{id:'s',...step}],...extra}];
  assert.throws(()=>validateFlowTests(flow({kind:'http',method:'GET',path:'http://example.com/x'})),/relativo ao servidor local/);
  assert.throws(()=>validateFlowTests(flow({kind:'http',method:'GET',path:'//evil.test/x'})),/relativo/);
  assert.throws(()=>validateFlowTests(flow({kind:'db',query:'DELETE FROM documentos'})),/somente um SELECT/);
  assert.throws(()=>validateFlowTests(flow({kind:'db',query:'SELECT 1; DROP DATABASE x'})),/somente um SELECT/);
  assert.throws(()=>validateFlowTests(flow({kind:'php',script:'src/app.php'})),/fora de database/);
  assert.throws(()=>validateFlowTests(flow({kind:'php',script:'database/../x.php'})),/fora de database/);
  assert.throws(()=>validateFlowTests(flow({kind:'db',query:'SELECT 1'},{cleanup:[{kind:'db-exec',sql:'DROP DATABASE orq_x'}]})),/limpeza aceita somente/);
  assert.throws(()=>validateFlowTests(flow({kind:'shell',command:'rm -rf /'})),/tipo de etapa desconhecido/);
  assert.equal(validateFlowTests(flow({kind:'db',query:'SELECT COUNT(*) FROM t'},{cleanup:[{kind:'db-exec',sql:'DELETE FROM t WHERE id=1'}]})).length,1);
  assert.deepEqual(validateFlowTests(undefined),[]);
});

test('sem fluxos obrigatórios nem declarados o Tester não muda de comportamento',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orq-plain-'));writeFileSync(join(root,'a.php'),'<?php echo 1;');
  try{
    const plain=new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,flow:{request:'Trocar a cor do botão',tests:()=>[]}});
    const result:any=(await plain.execute(input(root))).structuredResult;
    assert.equal(result.functionalFlows,undefined);assert.equal(result.status,'BLOCKED');assert.notEqual(result.blockReason,'required_flow_unvalidated');
    const report=await runFunctionalFlows({location:root,tests:[],env:{}});
    assert.equal(report.status,'PASSED');
  }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- Developer: o plano chega no prompt e functionalFlows atravessa a validação ----------
import {EventEmitter} from 'node:events';
import {ClaudeCodeAdapter,validateClaudeDeveloperResult} from '@orchestrator/adapters';
const HELP='Claude Code - starts an interactive session by default, use -p/--print for non-interactive output\n  -p, --print                           Print response and exit (useful for pipes).\n--model <model>\n--allowedTools, --allowed-tools <tools...>\n--disallowedTools, --disallowed-tools <tools...>\n--output-format <format>\n--permission-mode <mode>\n--permission-prompts <target>';
test('o Developer recebe o plano de fluxo no prompt e devolve functionalFlows validados',async()=>{
  const root=fixture();const plan=analyzeProjectFlows(root,REQUEST);let prompt='';
  const flows=[{flowId:'flow-completo',steps:[{id:'a',kind:'http',method:'GET',path:'/login.php'}]}];
  const out=JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({status:'COMPLETED',summary:'ok',filesChanged:['upload.php'],testsRun:[],notes:[],browserScenarios:[],functionalFlows:flows})});
  const spawn=(_c:string,args:string[])=>{const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(data?:string){if(!args.includes('--version')&&!args.includes('--help'))prompt=String(data||'');child.stdout.emit('data',Buffer.from(args.includes('--version')?'2.1.287 (Claude Code)':args.includes('--help')?HELP:out));child.emit('close',0);}};child.kill=()=>child.emit('close',null);return child;};
  try{
    const result:any=await new ClaudeCodeAdapter({executable:'claude.cmd',platform:'win32',model:'claude-haiku-5-5',spawn:spawn as any,flowPlanText:renderFlowPlan(plan,'developer')}).execute({stage:'developer',task:{id:'t1',title:'x',description:REQUEST},workspaceContext:{location:root},previousArtifacts:[]} as any);
    assert.match(prompt,/FUNCTIONAL FLOW PLAN/);assert.match(prompt,/Facts identified in the code/);assert.match(prompt,/reuse and edit the existing files/);
    assert.equal(result.structuredResult.functionalFlows[0].flowId,'flow-completo');
    assert.throws(()=>validateClaudeDeveloperResult({status:'COMPLETED',summary:'x',filesChanged:[],testsRun:[],notes:[],functionalFlows:[{flowId:'f',steps:[{id:'s',kind:'http',method:'GET',path:'https://externo.test'}]}]}),/servidor local/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
