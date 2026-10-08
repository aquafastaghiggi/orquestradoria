import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector,RuntimeSessionManager} from '@orchestrator/workspace';
import {BrowserQaRunner,smokeRoutes} from '@orchestrator/adapters';

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

