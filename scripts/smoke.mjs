#!/usr/bin/env node
/**
 * Teste de fumaça da interface (custo zero): sobe API + web em modo MOCK forçado com banco temporário e percorre o fluxo
 * principal num navegador real: criar projeto a partir de uma ideia → plano → aprovar → executar → preview → ajuste →
 * aplicar → desfazer aplicação, mais as páginas Custos e Configurações. Falha (exit 1) em qualquer erro de página, resposta
 * de API >= 400 inesperada ou passo que não aconteça.
 *
 * Uso: pnpm smoke   (precisa do Chromium: pnpm --filter @orchestrator/adapters exec playwright install chromium)
 * Usa portas próprias (4400/5400; SMOKE_API_PORT/SMOKE_WEB_PORT mudam), então pode rodar com o sistema normal aberto.
 */
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'packages','adapters','package.json'));
const {chromium}=require('playwright');
const isWin=process.platform==='win32';
const API_PORT=Number(process.env.SMOKE_API_PORT||4400),WEB_PORT=Number(process.env.SMOKE_WEB_PORT||5400);
const API=`http://127.0.0.1:${API_PORT}`,WEB=`http://localhost:${WEB_PORT}`;

const steps=[];const failures=[];
const pass=(name)=>{steps.push(name);console.log('  ✓',name);};
const check=(condition,name,detail='')=>{if(condition)pass(name);else{failures.push(`${name}${detail?` — ${detail}`:''}`);console.log('  ✗',name,detail);}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const portFree=(port)=>new Promise(r=>{const s=createServer();s.once('error',()=>r(false));s.listen(port,'127.0.0.1',()=>s.close(()=>r(true)));});
async function waitFor(url,ms=120000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fetch(url);if(r.ok)return true;}catch{}await sleep(500);}return false;}

const children=[];
function start(name,args,env){
  const child=spawn('pnpm',args,{cwd:root,env:{...process.env,...env},shell:isWin,stdio:['ignore','pipe','pipe'],detached:!isWin});
  let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
  children.push({name,child,get log(){return log;}});
  return child;
}
function stopAll(){
  for(const {child} of children){
    try{if(isWin)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});else process.kill(-child.pid,'SIGKILL');}catch{/* já encerrou */}
  }
}

const tmp=mkdtempSync(join(tmpdir(),'orq-smoke-'));
const parent=join(tmp,'projetos');mkdirSync(parent,{recursive:true});
const git=(cwd,...args)=>execFileSync('git',['-c','user.name=smoke','-c','user.email=smoke@localhost',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

async function main(){
  console.log('Teste de fumaça (mock, custo zero)\n');
  if(!(await portFree(API_PORT))||!(await portFree(WEB_PORT))){console.error(`As portas ${API_PORT}/${WEB_PORT} do teste estão ocupadas (defina SMOKE_API_PORT/SMOKE_WEB_PORT). O sistema normal (4000/5173) pode ficar aberto.`);process.exit(2);}

  start('api',['--filter','@orchestrator/api','exec','tsx','src/server.ts'],{
    PORT:String(API_PORT),WEB_PORT:String(WEB_PORT),DB_PATH:join(tmp,'smoke.db'),TASK_WORKTREE_ROOT:join(tmp,'worktrees'),ORQ_BACKUP_DIR:join(tmp,'backups'),
    ORQ_FORCE_MOCK:'1',DEVELOPER_PROVIDER:'mock',REVIEWER_PROVIDER:'mock',TESTER_PROVIDER:'mock',PROMPT_REFINER_PROVIDER:'mock',MISSION_PLANNER_PROVIDER:'mock',
  });
  start('web',['--filter','@orchestrator/web','exec','vite','--port',String(WEB_PORT),'--strictPort'],{ORQ_API_PORT:String(API_PORT)});
  check(await waitFor(`${API}/health`),'API iniciou');
  check(await waitFor(WEB),'Web iniciou');
  if(failures.length)throw new Error('Servidores não iniciaram');

  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  const pageErrors=[],apiErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(WEB,'')}`);});
  page.on('dialog',d=>d.accept());
  const text=async(sel)=>(await page.locator(sel).first().innerText().catch(()=>'')).replace(/\n+/g,' | ');
  const buttons=async()=>(await page.locator('.modal button, [role=dialog] button').allInnerTexts()).map(s=>s.trim()).filter(Boolean);

  try{
    await page.goto(WEB);await page.waitForSelector('.mode-banner',{timeout:20000});
    check(/MOCK/.test(await text('.mode-banner')),'Faixa de modo mostra MOCK');

    // 1) projeto a partir de uma ideia
    await page.locator('aside').getByText('Workspaces').first().click();
    await page.getByRole('button',{name:/Novo workspace/}).first().click();
    await page.getByRole('button',{name:/Novo projeto a partir de uma ideia/}).click();
    await page.getByLabel('Nome do projeto').fill('smoke-projeto');
    await page.getByLabel(/Criar dentro da pasta/).fill(parent);
    await page.getByLabel(/Qual é a ideia/).fill('Página simples com o título Minhas tarefas.');
    await page.getByRole('button',{name:'Criar projeto'}).click();
    await page.getByRole('button',{name:'Gerar plano'}).waitFor({timeout:20000});
    pass('Projeto criado e missão aberta com "Gerar plano"');
    const project=join(parent,'smoke-projeto');
    check(existsSync(join(project,'.git')),'Pasta do projeto criada com Git');
    writeFileSync(join(project,'index.html'),'<h1>Minhas tarefas</h1>');git(project,'add','.');git(project,'commit','-q','-m','pagina');

    // 2) plano → aprovar → executar
    await page.getByRole('button',{name:'Gerar plano'}).click();
    await page.getByRole('button',{name:/aprovar/i}).first().waitFor({timeout:20000});
    await page.getByRole('button',{name:/aprovar/i}).first().click();
    await page.getByRole('button',{name:/INICIAR MISS/i}).waitFor({timeout:20000});
    await page.getByRole('button',{name:/INICIAR MISS/i}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.modal button,[role=dialog] button')].some(b=>/APLICAR NA/i.test(b.textContent||'')),null,{timeout:180000});
    pass('Missão executada até "Aplicar"');

    // 3) preview
    const card=page.locator('.task-preview-card');
    const [popup]=await Promise.all([page.context().waitForEvent('page',{timeout:15000}).catch(()=>null),card.getByRole('button',{name:/Abrir preview/}).click()]);
    check(Boolean(popup)&&/Minhas tarefas/.test(await popup.locator('body').innerText()),'Preview serve a página do worktree');
    await page.bringToFront();
    await card.getByRole('button',{name:'Parar preview'}).click();
    await page.waitForTimeout(800);
    check(!(await text('.task-preview-card')).includes('Preview ativo'),'Preview parou');

    // 4) ajuste
    await card.locator('textarea').fill('Deixe o título verde');
    await card.getByRole('button',{name:'Solicitar ajuste'}).click();
    await page.waitForTimeout(2500);
    await page.waitForFunction(()=>[...document.querySelectorAll('.modal button,[role=dialog] button')].some(b=>/APLICAR NA/i.test(b.textContent||''))&&document.body.innerText.includes('Ajuste 1'),null,{timeout:180000});
    pass('Ajuste executado (etapa "Ajuste 1")');

    // 5) simula o trabalho do Developer (mock não escreve) para o Apply ter o que aplicar, e aplica
    const workspaces=await (await fetch(`${API}/api/workspaces`)).json();
    const ws=workspaces.find(w=>w.name==='smoke-projeto');
    const missions=await (await fetch(`${API}/api/workspaces/${ws.id}/missions`)).json();
    const detail=await (await fetch(`${API}/api/missions/${missions[0].id}`)).json();
    writeFileSync(join(detail.mission.worktreePath,'app.js'),'console.log("smoke");');
    await page.getByRole('button',{name:/APLICAR NA/i}).click();
    await page.getByText(/APLICADO NA/i).first().waitFor({timeout:30000});
    pass('Apply concluído');
    check(existsSync(join(project,'app.js')),'Arquivo aplicado chegou na pasta do projeto');
    check(/apply/i.test(git(project,'log','--format=%s','-n','3')),'Git registrou o commit de apply');

    // 6) desfazer aplicação
    const undo=page.locator('.undo-apply-card');
    await undo.waitFor({timeout:15000});
    await undo.getByRole('button',{name:'Desfazer aplicação'}).click();
    await undo.getByText(/Aplicação desfeita/).waitFor({timeout:30000});
    check(!existsSync(join(project,'app.js')),'Desfazer removeu o arquivo aplicado');
    check(/Revert/.test(git(project,'log','--format=%s','-n','1')),'Desfazer criou um commit de reversão (histórico preservado)');
    check(git(project,'status','--porcelain')==='','Pasta do projeto limpa após desfazer');
    // 6b) refazer aplicação (reverte a reversão)
    const redoButton=undo.getByRole('button',{name:'Refazer aplicação'});
    await redoButton.waitFor({timeout:15000});
    await redoButton.click();
    await undo.getByRole('button',{name:'Desfazer aplicação'}).waitFor({timeout:30000});
    check(existsSync(join(project,'app.js')),'Refazer restaurou o arquivo na pasta do projeto');
    check(git(project,'status','--porcelain')==='','Pasta do projeto limpa após refazer');

    // 7) páginas de apoio
    await page.keyboard.press('Escape').catch(()=>{});
    await page.goto(WEB);await page.waitForSelector('.mode-banner');
    await page.locator('aside').getByText('Custos').first().click();
    await page.waitForSelector('.costs-page',{timeout:15000});
    check((await page.locator('.costs-page .cost-section').count())>=3,'Página Custos carrega (recomendação, simulador, gasto)');
    await page.locator('aside').getByText('Configurações').first().click();
    await page.waitForSelector('.system-panel',{timeout:15000});
    const titles=await page.locator('.system-panel .panel-title span').allInnerTexts();
    for(const wanted of ['LIMITES DE GASTO','BACKUP DO BANCO','DISCO E LIMPEZA','RETENÇÃO DE DADOS ANTIGOS','REDE'])check(titles.includes(wanted),`Configurações tem "${wanted}"`);
    await page.locator('aside').getByText('Workspaces').first().click();
    await page.locator('.workspace-card').filter({hasText:'smoke-projeto'}).first().click();
    await page.waitForSelector('.history-board',{timeout:15000});
    pass('Quadro de trabalho do workspace carrega');
    const waiting=(await page.locator('.summary-card').filter({hasText:'Aguardando ação'}).locator('strong').first().innerText()).trim();
    check(waiting==='0','Painel não mostra tasks "aguardando ação" depois do Apply',`valor: ${waiting}`);

    check(pageErrors.length===0,'Nenhum erro JavaScript na página',pageErrors.join(' | '));
    check(apiErrors.length===0,'Nenhuma resposta de API >= 400',apiErrors.join(' | '));
  }finally{await browser.close();}
}

let code=0;
try{await main();}
catch(error){failures.push(`Exceção: ${error instanceof Error?error.message:String(error)}`);for(const c of children)console.log(`\n--- log ${c.name} (final) ---\n${c.log.slice(-1500)}`);}
finally{
  stopAll();await sleep(1500);
  try{rmSync(tmp,{recursive:true,force:true});}catch{/* arquivos ainda em uso no Windows: o SO limpa o temp */}
  if(failures.length){console.log(`\nFALHOU (${failures.length}):`);for(const f of failures)console.log(' -',f);code=1;}
  else console.log(`\nOK: ${steps.length} verificações passaram.`);
}
process.exit(code);
