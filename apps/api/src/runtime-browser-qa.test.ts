import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector,RuntimeSessionManager,prepareRuntimeCommand} from '@orchestrator/workspace';
import {BrowserQaRunner,CommandTesterAdapter,buildTesterSummary,smokeRoutes} from '@orchestrator/adapters';

test('runtime detector serves static workspaces and stops safely',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orquestradoria-runtime-'));
  try{
    writeFileSync(join(root,'index.html'),'<h1>runtime</h1>');
    writeFileSync(join(root,'extra.html'),'<h1>extra</h1>');
    const detector=new RuntimeDetector({platform:'linux',env:{PATH:''},which:()=>undefined});
    assert.deepEqual(detector.detect(root),{type:'static'});
    const manager=new RuntimeSessionManager(detector);
    const session=await manager.start(root,{id:'test-runtime'});
    assert.equal(session.status,'ready');
    assert.equal((await fetch(session.baseUrl)).status,200);
    assert.equal((await fetch(`${session.baseUrl}/../package.json`)).status,404);
    await manager.stop(session);
    assert.equal(session.status,'stopped');
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
