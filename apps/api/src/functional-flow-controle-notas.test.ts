import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CommandTesterAdapter,analyzeProjectFlows,checkDatabaseIsolation,renderFlowPlan} from '@orchestrator/adapters';
import {ARQUIVO,CARGA,CONFIG_REAL_FIXO,LOGIN_EQUIPE,NUMERO_NF,PEDIDO,TOKEN,controleNotas,flowsFor} from './controle-notas-fixture.js';
import {countRows,live,mysql,withDatabase} from './functional-flow-fixture.js';

/**
 * Regressões do bloqueio indevido no projeto "Controle de Notas": os testes HTTP reais de login, envio multipart, SELECT em
 * canhotos e listagem passavam, mas o validador marcava required_flow_unvalidated. Aqui o projeto é reproduzido em estilo
 * (helpers de sessão/guarda/SQL, handler de envio, listagem que mostra o número da NF) num diretório temporário: o projeto real
 * nunca é lido nem alterado, e o banco é um orq_* descartável.
 */
const PHP=process.platform==='win32'?'C:/xampp/php/php.exe':'php';
const tester=(declared:any[],env:Record<string,string>)=>new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,flow:{request:PEDIDO,env,tests:()=>declared}});
const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'Controle de Notas',description:PEDIDO},workspaceContext:{location},previousArtifacts:[],projectRules:[]});
const execute=async(root:string,env:Record<string,string>,declared:any[])=>(await tester(declared,env).execute(input(root))).structuredResult as any;
const seed=(root:string,env:Record<string,string>)=>{const r=spawnSync(PHP,['database/seed_teste.php'],{cwd:root,env:{...process.env,...env},encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);};
const required=(result:any)=>Object.fromEntries(result.functionalFlows.required.map((r:any)=>[r.flowId,r]));
const ALL=['flow-auth','flow-completo','flow-listing','flow-upload'];

// ---------- 1) o código é entendido como ele é (helpers, handler, listagem por consulta) ----------
test('análise: login por helper de sessão, guarda por exigirPerfil, envio pelo handler e listagem por consulta são reconhecidos',()=>{
  const root=controleNotas();
  try{
    const plan=analyzeProjectFlows(root,PEDIDO);
    assert.equal(plan.auth.loginPage,'login.php','login.php usa iniciar_sessao() e não session_start()');
    for(const guarded of ['conferencia.php','relatorio.php','acao_canhoto.php','motorista.php'])assert.ok(plan.auth.guardedPages.includes(guarded),`${guarded} é protegida por exigirPerfil()`);
    assert.equal(plan.auth.guardedPages.includes('enviar_canhoto.php'),false,'o envio por link com token não exige sessão');
    assert.equal(plan.auth.guardedPages.includes('login.php'),false);
    const flow=(id:string)=>plan.flows.find(f=>f.id===id)!;
    assert.deepEqual(flow('flow-upload').files,['enviar_canhoto.php'],'o ponto de upload é o handler, não a página do formulário');
    const upload=plan.pages.find(p=>p.file==='enviar_canhoto.php')!;
    assert.ok(upload.tablesWritten.includes('canhotos'),'a gravação em canhotos vem do helper inserir_canhoto()');
    assert.deepEqual(flow('flow-listing').files,['conferencia.php'],'a conferência é escolhida entre as páginas que leem canhotos (e não a ação que grava nem o relatório)');
    assert.deepEqual(plan.ambiguities,[]);assert.deepEqual(plan.hypotheses,[]);
    assert.deepEqual(plan.flows.filter(f=>f.required).map(f=>f.id).sort(),ALL);
    assert.ok(plan.flows.every(f=>f.certainty==='fact'));
    assert.ok(plan.facts.some(f=>/login\.php verifica senha e grava a sessão/.test(f)));
    assert.ok(plan.facts.some(f=>/enviar_canhoto\.php processa \$_FILES e grava em canhotos/.test(f)));
    assert.match(renderFlowPlan(plan,'developer'),/SAME document\/NF created by the test/);assert.match(renderFlowPlan(plan,'developer'),/Data that already existed before the upload is not accepted as proof/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('análise: duas listagens indistinguíveis continuam sendo uma pergunta, e sem helper de gravação o fluxo de listagem vira hipótese',()=>{
  const root=controleNotas({insere:false});
  try{
    writeFileSync(join(root,'lib','nota_fiscal.php'),'<?php function buscar_nota_fiscal_por_token(PDO $pdo, string $t): ?array { return null; }\nfunction inserir_canhoto(PDO $pdo): ?int { return 1; }');
    const plan=analyzeProjectFlows(root,PEDIDO);
    const listing=plan.flows.find(f=>f.id==='flow-listing')!;
    assert.equal(listing.certainty,'hypothesis','nenhuma gravação em canhotos é identificada: o código atual manda, não a suposição antiga');
    assert.ok(plan.hypotheses.some(h=>/O fluxo "Listagem na conferência" foi pedido, mas ainda não existe no código/.test(h)));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('o Tester reanalisa o código ATUAL do worktree a cada execução',async()=>{
  const root=controleNotas();
  try{
    const before=await execute(root,{},[]);
    assert.equal(before.functionalFlows.plan.flows.find((f:any)=>f.id==='flow-listing').certainty,'fact');
    assert.equal(before.status,'BLOCKED');
    // o código muda (o helper deixa de gravar em canhotos): a próxima execução enxerga isso, sem hipóteses antigas
    writeFileSync(join(root,'lib','nota_fiscal.php'),'<?php function buscar_nota_fiscal_por_token(PDO $pdo, string $t): ?array { return null; }\nfunction inserir_canhoto(PDO $pdo): ?int { return 1; }');
    const after=await execute(root,{},[]);
    assert.equal(after.functionalFlows.plan.flows.find((f:any)=>f.id==='flow-listing').certainty,'hypothesis');
  }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- 2) o cenário real passa, correlacionado ao mesmo documento/NF criado no teste ----------
for(const kind of ['retorna-numero','conta-por-numero'] as const){
  live(`Controle de Notas (MySQL real): login → envio multipart → SELECT → conferência passam e ficam VALIDADOS (${kind})`,async()=>{
    const root=controleNotas();
    try{await withDatabase(async env=>{
      const result=await execute(root,env,flowsFor(kind));
      assert.equal(result.status,'PASSED',JSON.stringify(result.functionalFlows.required)+JSON.stringify(result.notes.slice(-6)));
      const flows=result.functionalFlows;assert.equal(flows.status,'PASSED');
      assert.deepEqual(Object.keys(required(result)).sort(),ALL);
      for(const id of ALL)assert.equal(required(result)[id].validated,true,`${id}: ${required(result)[id].reason}`);
      assert.deepEqual(flows.flows[0].steps.map((s:any)=>s.status),Array(6).fill('passed'));
      assert.equal(flows.flows[0].proofs.orderOk,true);assert.ok([TOKEN,ARQUIVO].includes(flows.flows[0].proofs.token),'a identidade do documento vem do que o upload enviou (token da NF ou nome do arquivo)');
      const byId=Object.fromEntries(flows.flows[0].steps.map((s:any)=>[s.id,s.evidence as string]));
      assert.match(byId.login,/POST \/login\.php → 302 Location: conferencia\.php/);assert.match(byId.upload,/POST \/enviar_canhoto\.php → 302 Location: entrega\.php\?token=.*enviado=1/);
      assert.match(byId.listagem,new RegExp(`contém "${NUMERO_NF}", "${CARGA}"`));
      // limpeza: só o que o teste criou
      for(const table of ['canhotos','notas_fiscais','cargas','usuarios'])assert.equal(await countRows(env,table),0,table);
      assert.equal(flows.flows[0].cleanup.status,'done');
      assert.equal(existsSync(join(root,'uploads')),false,'o arquivo enviado e a pasta criada pelo teste foram removidos');
      const text=JSON.stringify(result);for(const secret of [env.ORQ_DB_PASSWORD,'senha-equipe-123'])assert.equal(text.includes(secret),false);
    });}finally{rmSync(root,{recursive:true,force:true});}
  });
}

// ---------- 3) o que NÃO prova nada continua bloqueado ----------
live('dado preexistente não é prova: registro e listagem que já existiam, com o envio quebrado, seguem BLOQUEADOS e preservados',async()=>{
  const root=controleNotas({insere:false});
  try{await withDatabase(async env=>{
    seed(root,env);
    const pre=await mysql(`INSERT INTO \`${env.ORQ_DB_NAME}\`.canhotos (nota_fiscal_id,arquivo,nome_original,mime,tamanho,status) SELECT id,'uploads/antigo.pdf','${ARQUIVO}','application/pdf',10,'enviado' FROM \`${env.ORQ_DB_NAME}\`.notas_fiscais WHERE numero='${NUMERO_NF}'`);
    assert.equal(pre.ok,true,pre.error);
    const result=await execute(root,env,flowsFor('retorna-numero'));
    assert.equal(result.functionalFlows.flows[0].status,'PASSED','as etapas passam: o envio redireciona e a consulta já era verdadeira');
    assert.equal(result.status,'BLOCKED');assert.equal(result.blockReason,'required_flow_unvalidated');
    const r=required(result);
    assert.equal(r['flow-upload'].validated,false);assert.match(r['flow-upload'].reason,/gravação: o SELECT em .*canhotos.* já era verdadeiro ANTES do upload; dados preexistentes não valem como prova/);
    assert.equal(r['flow-listing'].validated,false);assert.match(r['flow-listing'].reason,/listagem:/);
    assert.equal(r['flow-completo'].validated,false);assert.equal(r['flow-auth'].validated,true,'o login continua provado: ele não depende do upload');
    // nada preexistente foi apagado
    assert.equal(await countRows(env,'canhotos'),1);assert.equal(await countRows(env,'notas_fiscais'),1);assert.equal(await countRows(env,'usuarios'),1);
    assert.ok(result.functionalFlows.flows[0].cleanup.notes.some((n:string)=>/preservados/.test(n)));
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('listagem que já mostrava a NF por OUTRO canhoto preexistente não vale; só o registro criado pelo teste é removido',async()=>{
  const root=controleNotas();
  try{await withDatabase(async env=>{
    seed(root,env);
    const pre=await mysql(`INSERT INTO \`${env.ORQ_DB_NAME}\`.canhotos (nota_fiscal_id,arquivo,nome_original,mime,tamanho,status) SELECT id,'uploads/anterior.pdf','anterior.pdf','application/pdf',10,'enviado' FROM \`${env.ORQ_DB_NAME}\`.notas_fiscais WHERE numero='${NUMERO_NF}'`);
    assert.equal(pre.ok,true,pre.error);
    const result=await execute(root,env,flowsFor('retorna-numero'));
    const r=required(result);
    assert.equal(r['flow-upload'].validated,true,'o registro do teste (arquivo novo, com a identidade enviada) foi gravado de verdade');
    assert.equal(r['flow-listing'].validated,false);assert.match(r['flow-listing'].reason,/já mostrava o texto esperado ANTES do upload/);
    assert.equal(result.status,'BLOCKED');
    assert.equal(await countRows(env,'canhotos'),1,'só o canhoto criado pelo teste saiu; o anterior ficou');
    assert.equal((await mysql(`SELECT nome_original FROM \`${env.ORQ_DB_NAME}\`.canhotos`)).stdout.trim(),'anterior.pdf');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

live('SELECT sem a identidade do documento enviado e listagem genérica seguem BLOQUEADOS (mesmo com as etapas passando)',async()=>{
  const root=controleNotas();
  try{await withDatabase(async env=>{
    const weakQuery=await execute(root,env,flowsFor('sem-identidade'));
    assert.equal(weakQuery.functionalFlows.flows[0].status,'PASSED');assert.equal(weakQuery.status,'BLOCKED');
    assert.match(required(weakQuery)['flow-upload'].reason,/gravação: nenhum SELECT em canhotos citando o valor enviado no upload \(token\/arquivo\)/);
    assert.equal(required(weakQuery)['flow-completo'].validated,false);
    const generic=await execute(root,env,flowsFor('listagem-generica'));
    assert.equal(generic.status,'BLOCKED');
    assert.equal(required(generic)['flow-upload'].validated,true);
    assert.match(required(generic)['flow-listing'].reason,/listagem: nenhum GET em \/conferencia\.php, depois do upload e do login, esperando na resposta um valor do documento criado no teste/);
    for(const table of ['canhotos','notas_fiscais','usuarios'])assert.equal(await countRows(env,table),0,`${table}: limpeza do que o teste criou`);
    assert.ok(generic.functionalFlows.flows[0].cleanup.notes.some((n:string)=>/não cita um valor criado pelo teste/.test(n)),'a carga não é citada em nenhum outro passo: a limpeza não a apaga (não é comprovável que o teste a criou)');
  });}finally{rmSync(root,{recursive:true,force:true});}
});

// ---------- 4) isolamento ORQ_DB_* preservado ----------
test('isolamento: o config/database.php do projeto (ORQ_DB_* com valores padrão) é liberado; o fixo no banco real é bloqueado',async()=>{
  const ok=controleNotas();const bad=controleNotas({config:CONFIG_REAL_FIXO});
  try{
    const env={ORQ_DB_HOST:'127.0.0.1',ORQ_DB_PORT:'3306',ORQ_DB_USER:'orquestradoria',ORQ_DB_PASSWORD:'x',ORQ_DB_NAME:'orq_fake1234'};
    const steps=[{kind:'php',script:'database/seed_teste.php'},{kind:'http',path:'/login.php'},{kind:'http',path:'/enviar_canhoto.php'},{kind:'http',path:'/conferencia.php'}];
    const verdict=checkDatabaseIsolation(ok,{steps},env);
    assert.equal(verdict.safe,true,verdict.reasons.join(' | '));assert.equal(verdict.connects,true);
    assert.ok(verdict.notes.some(n=>/valores padrão para ORQ_DB_\*/.test(n)),'o padrão só vale como reserva do ORQ_DB_*');
    assert.equal(checkDatabaseIsolation(ok,{steps},{}).safe,false,'sem o banco isolado no ambiente, nada roda');
    const blocked=checkDatabaseIsolation(bad,{steps},env);
    assert.equal(blocked.safe,false);assert.ok(blocked.reasons.some(r=>/controle_notas/.test(r)));
    // e pelo Tester: nenhum PHP do projeto executa
    const result=await execute(bad,env,flowsFor('retorna-numero'));
    assert.equal(result.status,'BLOCKED');assert.ok(result.functionalFlows.impossible.some((m:string)=>/Execução bloqueada por segurança/.test(m)));
    assert.equal(existsSync(join(bad,'executado.flag')),false);
    assert.equal(JSON.stringify(result).includes('segredo-real'),false);
  }finally{rmSync(ok,{recursive:true,force:true});rmSync(bad,{recursive:true,force:true});}
});

test('o projeto de teste não é o projeto real e nunca é lido de outro lugar',()=>{
  const source=readFileSync(new URL('./controle-notas-fixture.ts',import.meta.url),'utf8');
  assert.equal(/C:\\xampp\\htdocs\\controle_notas|C:\/xampp\/htdocs\/controle_notas/i.test(source),false);
  assert.match(source,/mkdtempSync\(join\(tmpdir\(\)/);
  assert.ok(LOGIN_EQUIPE.endsWith('teste'));
});
