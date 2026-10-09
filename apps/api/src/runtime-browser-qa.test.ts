import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector,RuntimeSessionManager,prepareRuntimeCommand} from '@orchestrator/workspace';
import {BrowserQaRunner,BrowserScenarioRunner,CommandTesterAdapter,buildTesterSummary,browserPlan,locatorFor,smokeRoutes,validateBrowserScenarios} from '@orchestrator/adapters';
import {testerIssues} from '@orchestrator/core';
import {validateClaudeDeveloperResult} from '@orchestrator/adapters';

test('runtime detector serves static workspaces and stops safely',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orquestradoria-runtime-'));
  try{
    writeFileSync(join(root,'index.html'),'<h1>runtime</h1>');
    const before=readFileSync(join(root,'index.html'),'utf8');
    writeFileSync(join(root,'extra.html'),'<h1>extra</h1>');
    const detector=new RuntimeDetector({platform:'linux',env:{PATH:''},which:()=>undefined});
    assert.deepEqual(detector.detect(root),{type:'static'});
    const manager=new RuntimeSessionManager(detector);
    const first=manager.start(root,{id:'test-runtime'});
    const second=manager.start(root,{id:'test-runtime-duplicate'});
    const session=await first;
    const duplicate=await second;
    assert.equal(session.status,'ready');
    assert.equal(duplicate.status,'ready');
    assert.equal((await fetch(session.baseUrl)).status,200);
    assert.equal(await (await fetch(session.baseUrl)).text(),'<h1>runtime</h1>');
    assert.equal((await fetch(`${session.baseUrl}/../package.json`)).status,404);
    await manager.stop(session);
    assert.equal(session.status,'stopped');
    await manager.stop(duplicate);
    const restarted=await manager.start(root,{id:'test-runtime-restart'});
    assert.equal(restarted.status,'ready');
    assert.equal(await (await fetch(restarted.baseUrl)).text(),'<h1>runtime</h1>');
    await manager.stop(restarted);
    assert.equal(readFileSync(join(root,'index.html'),'utf8'),before);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('browser QA routes are bounded and use an injectable launcher without Chromium',async()=>{
  assert.deepEqual(smokeRoutes('http://127.0.0.1:1234',['/index.html','/other.html','/third.html','/fourth.html','/fifth.html','/sixth.html','/seventh.html','/eighth.html','/ninth.html','/tenth.html','/eleventh.html']),['/','/index.html','/other.html','/third.html','/fourth.html','/fifth.html','/sixth.html','/seventh.html','/eighth.html','/ninth.html']);
  const calls:string[]=[];
  const page:any={on(){},goto:async()=>({status:()=>200}),waitForTimeout:async()=>{},screenshot:async({path}:{path:string})=>{calls.push(path)},close:async()=>{}};
  const context:any={route:async()=>{},newPage:async()=>page,close:async()=>{}};
  const launcher:any={launch:async()=>({newContext:async()=>context,close:async()=>{}})};
  const root=mkdtempSync(join(tmpdir(),'orquestradoria-browser-qa-'));
  try{
    const result=await new BrowserQaRunner(launcher).run({baseUrl:'http://127.0.0.1:1234',routes:['/'],screenshotDir:root});
    assert.equal(result.status,'PASSED');
    assert.equal(result.routes[0].status,'PASSED');
    assert.equal(calls.length,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('HTML-only projects continue to Browser QA when command QA has no commands',async()=>{
  const profile:any={projectType:'html',commands:[],notes:[],unvalidatedFiles:[]};
  const runtime:any={start:async()=>({profile:{type:'static'},baseUrl:'http://127.0.0.1:12345',status:'ready'}),stop:async()=>{}};
  const browser:any={run:async()=>({status:'PASSED',baseUrl:'http://127.0.0.1:12345',routes:[{route:'/',status:'PASSED',errors:[]}],consoleErrors:[],pageErrors:[],failedRequests:[],externalOrigins:[],screenshots:[],durationMs:1,summary:'ok'})};
  const input:any={stage:'tester',task:{id:'html-only',configSnapshot:{}},workspaceContext:{location:process.cwd()},stageContext:{contextFilesIncluded:['index.html']},previousArtifacts:[]};
  const optional=await new CommandTesterAdapter({profile,browserQaEnabled:true,testerRequired:false,runtimeManager:runtime,browserQaRunner:browser}).execute(input);
  assert.equal((optional.structuredResult as any).commandQa.status,'BLOCKED');
  assert.equal((optional.structuredResult as any).browserQa.status,'PASSED');
  assert.equal((optional.structuredResult as any).status,'PASSED');
  const required=await new CommandTesterAdapter({profile,browserQaEnabled:true,testerRequired:true,runtimeManager:runtime,browserQaRunner:browser}).execute(input);
  assert.equal((required.structuredResult as any).status,'BLOCKED');
});

test('runtime executable resolution handles Windows extensions without shell execution',()=>{
  assert.equal(new RuntimeDetector({platform:'win32',env:{PATH:'C:\\tools',PATHEXT:'.EXE;.CMD'},which:command=>command==='php'?undefined:undefined}).detect('C:\\missing').type,'unsupported');
  const detector=new RuntimeDetector({platform:'win32',env:{PATH:'C:\\tools',PATHEXT:'.EXE;.CMD'},which:command=>command==='php'?'C:\\tools\\php.exe':command==='pnpm'?'C:\\tools\\pnpm.cmd':undefined});
  const root=mkdtempSync(join(tmpdir(),'orquestradoria-php-'));
  try{writeFileSync(join(root,'index.php'),'<?php echo "ok";');const profile=detector.detect(root);assert.equal(profile.type,'php');assert.equal(profile.command?.executable,'C:\\tools\\php.exe');}finally{rmSync(root,{recursive:true,force:true});}
});

test('browser QA records same-origin HTTP failures and applies the external resource policy',async()=>{
  const handlers:Record<string,Function>={};const listeners:Record<string,Function[]>={};
  const page:any={on:(name:string,handler:Function)=>(listeners[name]??=[]).push(handler),url:()=> 'http://127.0.0.1:12345/',goto:async()=>{for(const handler of listeners.response||[])handler({status:()=>404,url:()=>'http://127.0.0.1:12345/js/app.js'});for(const handler of listeners.response||[])handler({status:()=>404,url:()=>'http://127.0.0.1:12345/favicon.ico'});return{status:()=>200}},waitForTimeout:async()=>{},screenshot:async()=>{},close:async()=>{}};
  const context:any={route:async(_pattern:string,handler:Function)=>{handlers.route=handler},newPage:async()=>page,close:async()=>{}};
  const launcher:any={launch:async()=>({newContext:async()=>context,close:async()=>{}})};
  const result=await new BrowserQaRunner(launcher).run({baseUrl:'http://127.0.0.1:12345',routes:['/'],screenshotDir:mkdtempSync(join(tmpdir(),'orquestradoria-network-'))});
  assert.equal(result.status,'FAILED');
  assert.deepEqual(result.routes[0].errors.find((error:any)=>error.type==='http_response'),{type:'http_response',message:'HTTP 404',url:'http://127.0.0.1:12345/js/app.js',status:404});
  const request=(url:string,navigation=false)=>({url:()=>url,isNavigationRequest:()=>navigation});
  const route=(url:string,navigation=false)=>({request:()=>request(url,navigation),continue:()=>undefined,abort:(reason:string)=>reason});
  assert.equal(await handlers.route(route('https://unpkg.com/leaflet.js')),undefined);
  assert.equal(await handlers.route(route('http://example.com/x')),'blockedbyclient');
  assert.equal(await handlers.route(route('https://127.0.0.1/x')),'blockedbyclient');
  assert.equal(await handlers.route(route('https://example.com/',true)),'blockedbyclient');
});

test('Windows Vite runtime wraps .cmd executables through cmd.exe without shell mode',()=>{
  const invocation=prepareRuntimeCommand('C:\\tools\\pnpm.cmd',['run','dev','--','--port','4321'],'win32');
  assert.equal(invocation.command,'cmd.exe');
  assert.deepEqual(invocation.args.slice(0,4),['/d','/c','call','"C:\\tools\\pnpm.cmd"']);
  assert.equal(invocation.shell,false);
  assert.notEqual(invocation.command,'C:\\tools\\pnpm.cmd');
});

test('Tester summaries reflect command and browser states',()=>{
  assert.equal(buildTesterSummary('PASSED','PASSED'),'Command QA and browser smoke QA passed');
  assert.equal(buildTesterSummary('BLOCKED','PASSED','PASSED'),'Command QA unavailable; browser smoke QA passed');
  assert.equal(buildTesterSummary('PASSED','BLOCKED','PASSED'),'Command QA passed; browser smoke QA unavailable');
  assert.equal(buildTesterSummary('BLOCKED','BLOCKED'),'No command QA or browser QA was available');
  assert.equal(buildTesterSummary('FAILED','PASSED'),'Command QA failed');
  assert.equal(buildTesterSummary('PASSED','FAILED'),'Browser smoke QA failed');
  assert.match(buildTesterSummary('BLOCKED','PASSED','BLOCKED'),/requires command QA/);
});

test('legacy developer output remains valid and browser scenario plans are strictly validated',()=>{
  const legacy=validateClaudeDeveloperResult({status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[]});
  assert.equal(legacy.browserScenarios,undefined);
  const plan=validateBrowserScenarios([{name:'Criar POI',route:'/admin.html',steps:[{action:'fill',target:{label:'Nome'},value:'POI QA'},{action:'click',target:{role:'button',name:'Salvar'}},{action:'expectText',target:{selector:'#lista-pois'},text:'POI QA'}]}]);
  assert.equal(plan[0].steps.length,3);
  assert.throws(()=>validateBrowserScenarios([{name:'externo',route:'https://example.com',steps:[]}]),/relative/);
  assert.throws(()=>validateBrowserScenarios([{name:'invalido',route:'/',steps:[{action:'eval' as any}]}]),/Unknown browser scenario action/);
  assert.throws(()=>validateBrowserScenarios([{name:'xpath',route:'/',steps:[{action:'click',target:{selector:'//button'}}]}]),/XPath/);
});

test('interactive browser validation preserves role name and rejects unsafe goto locators',()=>{
  const plan=validateBrowserScenarios([{name:'Salvar',route:'/',steps:[{action:'click',target:{role:'button',name:'Salvar'}}]}]);
  assert.deepEqual(plan[0].steps[0].target,{role:'button',name:'Salvar'});
  const calls:any[]=[];locatorFor({getByRole:(role:string,options:any)=>{calls.push({role,options});return{};}},{role:'button',name:'Salvar'});
  assert.deepEqual(calls,[{role:'button',options:{name:'Salvar'}}]);
  assert.throws(()=>validateBrowserScenarios([{name:'bad',route:'/',steps:[{action:'click',target:{name:'Salvar'}}]}]),/only valid with/);
  assert.throws(()=>validateBrowserScenarios([{name:'bad',route:'/',steps:[{action:'click',target:{label:'Nome',name:'Salvar'}}]}]),/only valid with/);
  assert.throws(()=>validateBrowserScenarios([{name:'bad',route:'/',steps:[{action:'goto',value:'https://example.com'}]}]),/same-origin/);
  assert.throws(()=>validateBrowserScenarios([{name:'bad',route:'/',steps:[{action:'goto'}]}]),/same-origin/);
});

test('browser plan selects newest artifact and preserves invalid-plan diagnostics',()=>{
  const base:any={type:'browser_qa_plan',createdAt:'2026-01-01T00:00:00.000Z'};
  const old={...base,content:JSON.stringify([{name:'old',route:'/',steps:[]}])};
  const newer={...base,createdAt:'2026-01-02T00:00:00.000Z',content:JSON.stringify([{name:'new',route:'/',steps:[]}])};
  assert.equal(browserPlan([old,newer]).scenarios[0].name,'new');
  const invalid={...newer,content:JSON.stringify([{name:'bad',route:'/',steps:[{action:'goto',value:'https://example.com'}]}])};
  const result=browserPlan([invalid]);assert.equal(result.planned,true);assert.equal(result.scenarios.length,0);assert.match(result.error||'',/same-origin/);
});

test('ARIA roles are validated at the Tester boundary while Developer keeps the raw proposal',()=>{
  for(const role of ['spinbutton','listitem','table','row','cell']){
    const plan=validateBrowserScenarios([{name:role,route:'/',steps:[{action:'expectVisible',target:{role,name:role}}]}]);
    assert.equal(plan[0].steps[0].target?.role,role);
  }
  assert.throws(()=>validateBrowserScenarios([{name:'bad',route:'/',steps:[{action:'click',target:{role:'superbutton' as any}}]}]),/superbutton/);
  const raw=validateClaudeDeveloperResult({status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[],browserScenarios:[{name:'Mapa',route:'/',steps:[{action:'click',target:{role:'superbutton',name:'Mapa'}}]}]});
  assert.equal((raw.browserScenarios as any)[0].steps[0].target.role,'superbutton');
});

test('invalid interactive plan is a repairable FAILED result with a structured error',async()=>{
  const page:any={on:()=>{},goto:async()=>({status:()=>200}),waitForTimeout:async()=>{},screenshot:async()=>{},close:async()=>{},url:()=> 'http://127.0.0.1:4321/'};
  const context:any={route:async()=>{},newPage:async()=>page,close:async()=>{}};
  const launcher:any={launch:async()=>({newContext:async()=>context,close:async()=>{}})};
  const result=await new BrowserQaRunner(launcher).run({baseUrl:'http://127.0.0.1:4321',routes:['/'],screenshotDir:mkdtempSync(join(tmpdir(),'orquestradoria-invalid-plan-')),interactiveEnabled:true,interactivePlanError:'Unsupported browser target role: "superbutton"',interactiveRequired:true});
  assert.equal(result.status,'FAILED');assert.equal(result.interactiveStatus,'FAILED');assert.deepEqual(result.interactivePlanError,{type:'invalid_browser_qa_plan',message:'Unsupported browser target role: "superbutton"'});assert.equal(result.summary,'Interactive Browser QA plan is invalid.');
});

test('interactive runner uses allowlisted page APIs and records a failed assertion with evidence',async()=>{
  const events:string[]=[];const screenshotPaths:string[]=[];
  const locator={fill:async()=>{},click:async()=>{},textContent:async()=> 'different',waitFor:async()=>{},inputValue:async()=>'',count:async()=>0,selectOption:async()=>{},check:async()=>{},uncheck:async()=>{},press:async()=>{}};
  const page:any={goto:async()=>({status:()=>200}),url:()=> 'http://127.0.0.1:4000/',on:()=>{},getByLabel:()=>locator,getByRole:()=>locator,locator:()=>locator,screenshot:async({path}:any)=>screenshotPaths.push(path),close:async()=>{},context:()=>({clearCookies:async()=>{}})};
  const context:any={newPage:async()=>page,route:async()=>{},close:async()=>{}};
  const results=await new BrowserScenarioRunner().run(context,[{name:'Falha',route:'/',steps:[{action:'expectText',target:{label:'Nome'},text:'esperado'}]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:'storage/local/browser-qa/test-scenario',onEvent:type=>events.push(type)});
  assert.equal(results[0].status,'FAILED');assert.ok(results[0].screenshots.length>=1);assert.ok(screenshotPaths.length>=1);assert.ok(events.includes('browser_qa.step_failed'));
});

test('interactive runner preserves factual assertion metadata without fill values',async()=>{
  const run=async(step:any,options:any={})=>{
    const listeners=new Map<string,Function[]>();
    const dialog=(message:string)=>({message:()=>message,accept:async()=>{},dismiss:async()=>{}});
    const locator={
      fill:async()=>{},
      click:async()=>{for(const handler of listeners.get('dialog')||[])handler(dialog('Excluir item?'));},
      textContent:async()=>options.text??'POI QA Editado',
      waitFor:async()=>{},
      inputValue:async()=>options.value??'valor esperado',
      count:async()=>options.count??0,
      selectOption:async()=>{},check:async()=>{},uncheck:async()=>{},press:async()=>{}
    };
    const page:any={goto:async()=>({status:()=>200}),url:()=> 'http://127.0.0.1:4000/',on:(type:string,handler:Function)=>{listeners.set(type,[...(listeners.get(type)||[]),handler]);},once:(type:string,handler:Function)=>{listeners.set(type,[...(listeners.get(type)||[]),handler]);},off:(type:string,handler:Function)=>{listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==handler));},getByRole:()=>locator,getByLabel:()=>locator,locator:()=>locator,screenshot:async()=>{},waitForTimeout:async()=>{},close:async()=>{}};
    const context:any={newPage:async()=>page,route:async()=>{},close:async()=>{}};
    const root=mkdtempSync(join(tmpdir(),'orquestradoria-step-evidence-'));
    try{
      const results=await new BrowserScenarioRunner().run(context,[{name:'Evidence',route:'/',steps:[step]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:root});
      return results[0].steps[0];
    }finally{rmSync(root,{recursive:true,force:true});}
  };
  const countOne=await run({action:'expectCount',target:{role:'row',name:'POI QA Automatizado'},count:1},{count:1});
  assert.equal(countOne.status,'PASSED');assert.equal(countOne.count,1);
  const countZero=await run({action:'expectCount',target:{role:'row',name:'POI QA Automatizado'},count:0},{count:0});
  assert.equal(countZero.count,0);
  const text=await run({action:'expectText',target:{role:'row',name:'POI QA Automatizado'},text:'POI QA Editado'},{text:'POI QA Editado'});
  assert.equal(text.text,'POI QA Editado');
  const value=await run({action:'expectValue',target:{label:'Nome'},value:'valor esperado'},{value:'valor esperado'});
  assert.equal(value.value,'valor esperado');
  const fill=await run({action:'fill',target:{label:'Nome'},value:'segredo'});
  assert.equal(fill.value,undefined);
  const click=await run({action:'click',target:{role:'button',name:'Excluir'},dialog:{action:'accept',messageIncludes:'Excluir'}});
  assert.deepEqual(click.dialog,{action:'accept',messageIncludes:'Excluir'});
  const failed=await run({action:'expectCount',target:{role:'row',name:'POI QA Automatizado'},count:1},{count:0});
  assert.equal(failed.status,'FAILED');assert.equal(failed.count,1);
});

test('interactive runner classifies expected and unexpected dialog outcomes',async()=>{
  const listeners=new Map<string,Function[]>();
  const dialog=(message:string)=>({message:()=>message,accept:async()=>{},dismiss:async()=>{}});
  const locator={click:async()=>{for(const handler of listeners.get('dialog')||[])handler(dialog('Excluir item?'));},fill:async()=>{},textContent:async()=>'',waitFor:async()=>{},inputValue:async()=>'',count:async()=>0,selectOption:async()=>{},check:async()=>{},uncheck:async()=>{},press:async()=>{}};
  const page:any={goto:async()=>({status:()=>200}),url:()=> 'http://127.0.0.1:4000/',on:(type:string,handler:Function)=>{listeners.set(type,[...(listeners.get(type)||[]),handler]);},once:(type:string,handler:Function)=>{listeners.set(type,[...(listeners.get(type)||[]),handler]);},off:(type:string,handler:Function)=>{listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==handler));},getByRole:()=>locator,screenshot:async()=>{},waitForTimeout:async()=>{},close:async()=>{}};
  const context:any={newPage:async()=>page,route:async()=>{},close:async()=>{}};
  const root=mkdtempSync(join(tmpdir(),'orquestradoria-dialog-'));
  try{
    const accepted=await new BrowserScenarioRunner().run(context,[{name:'Aceitar',route:'/',steps:[{action:'click',target:{role:'button',name:'Excluir'},dialog:{action:'accept',messageIncludes:'Excluir'}}]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:root});
    assert.equal(accepted[0].status,'PASSED');
    const missingPage={...page,getByRole:()=>({...locator,click:async()=>{}})};
    const missingContext={...context,newPage:async()=>missingPage};
    const missing=await new BrowserScenarioRunner().run(missingContext,[{name:'Ausente',route:'/',steps:[{action:'click',target:{role:'button',name:'Excluir'},dialog:{action:'dismiss'}}]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:root});
    assert.equal(missing[0].steps[0].errorType,'expected_dialog_missing');
    const mismatchPage={...page,getByRole:()=>({...locator,click:async()=>{for(const handler of listeners.get('dialog')||[])handler(dialog('Outro texto'));}})};
    const mismatch=await new BrowserScenarioRunner().run({...context,newPage:async()=>mismatchPage},[{name:'Divergente',route:'/',steps:[{action:'click',target:{role:'button',name:'Excluir'},dialog:{action:'accept',messageIncludes:'Excluir'}}]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:root});
    assert.equal(mismatch[0].steps[0].errorType,'dialog_message_mismatch');
    const unexpectedPage={...page,getByRole:()=>({...locator,click:async()=>{for(const handler of listeners.get('dialog')||[])handler(dialog('Inesperado'));}})};
    const unexpected=await new BrowserScenarioRunner().run({...context,newPage:async()=>unexpectedPage},[{name:'Inesperado',route:'/',steps:[{action:'click',target:{role:'button',name:'Excluir'}}]}],{baseUrl:'http://127.0.0.1:4000',screenshotDir:root});
    assert.equal(unexpected[0].steps[0].errorType,'unexpected_dialog');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('tester issues explain unexpected dialogs without assuming a response',()=>{
  const issues=testerIssues({structuredResult:{browserQa:{status:'FAILED',scenarios:[{name:'Excluir',status:'FAILED',steps:[{index:0,action:'click',target:{role:'button',name:'Excluir'},status:'FAILED',errorType:'unexpected_dialog',message:'Unexpected dialog appeared'}]}]}}} as any);
  assert.match(issues[0],/Type: unexpected_dialog/);assert.match(issues[0],/Action: click/);assert.match(issues[0],/Target:/);assert.match(issues[0],/declare dialog\.action on the click step/);assert.doesNotMatch(issues[0],/accept|dismiss/);
});
