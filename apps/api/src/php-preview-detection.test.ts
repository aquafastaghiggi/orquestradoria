import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector,RuntimeSessionManager} from '@orchestrator/workspace';
import {extractPreviewErrors,previewView} from './task-preview.js';

const which=()=>'php';
function project(files:Record<string,string>){const root=mkdtempSync(join(tmpdir(),'orq-php-'));for(const [name,content] of Object.entries(files)){const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,content);}return root;}

test('php project without index.php is unsupported by default (QA keeps strict detection)',()=>{
  const root=project({'login.php':'<?php'});
  try{assert.equal(new RuntimeDetector({which}).detect(root).type,'unsupported');}finally{rmSync(root,{recursive:true,force:true});}
});

test('preview fallback serves a php project whose pages live in the root and opens login.php',()=>{
  const root=project({'login.php':'<?php','carga.php':'<?php','config/database.php':'<?php'});
  try{
    const profile=new RuntimeDetector({which,phpFallback:true}).detect(root);
    assert.equal(profile.type,'php');assert.equal(profile.entryPath,'/login.php');
    assert.deepEqual(profile.command?.args.slice(0,2),['-S','127.0.0.1:{PORT}']);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('preview fallback prefers public/index.php as document root',()=>{
  const root=project({'public/index.php':'<?php','lib/x.php':'<?php'});
  try{
    const profile=new RuntimeDetector({which,phpFallback:true}).detect(root);
    assert.equal(profile.type,'php');assert.equal(profile.entryPath,'/');
    assert.equal(profile.command?.args[3],join(root,'public'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('preview passes extra environment (the task test database) to the php server',async()=>{
  const root=project({'index.php':'<?php echo getenv("ORQ_DB_NAME") ?: "sem-banco";'});
  const detector=new RuntimeDetector({phpFallback:true});
  try{
    if(!detector.detect(root).command)return; // php indisponível nesta máquina
    const manager=new RuntimeSessionManager(detector);
    const withEnv=await manager.start(root,{env:{ORQ_DB_NAME:'orq_teste123'}});
    try{assert.equal(withEnv.status,'ready');assert.equal(await (await fetch(withEnv.baseUrl+'/')).text(),'orq_teste123');}finally{await manager.stop(withEnv);}
    const without=await manager.start(root);
    try{assert.equal(without.status,'ready');assert.equal(await (await fetch(without.baseUrl+'/')).text(),'sem-banco');}finally{await manager.stop(without);}
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('extractPreviewErrors keeps php errors and 4xx/5xx requests, drops dates, noise and duplicates',()=>{
  const stderr=[
    '[Wed Oct 14 14:49:25 2026] PHP 8.2.12 Development Server (http://127.0.0.1:52999) started',
    '[Wed Oct 14 14:49:27 2026] 127.0.0.1:51413 Accepted',
    '[Wed Oct 14 14:49:27 2026] PHP Fatal error:  Uncaught PDOException: Table x doesn\'t exist in C:\\w\\login.php:23',
    'Stack trace:','#0 {main}','  thrown in C:\\w\\login.php on line 23',
    '[Wed Oct 14 14:49:27 2026] 127.0.0.1:51413 [200]: GET /login.php - Uncaught PDOException',
    '[Wed Oct 14 14:49:28 2026] PHP Warning:  Undefined variable $a in C:\\w\\a.php on line 1',
    '[Wed Oct 14 14:49:28 2026] PHP Warning:  Undefined variable $a in C:\\w\\a.php on line 1',
    '[Wed Oct 14 14:49:29 2026] 127.0.0.1:51414 [404]: GET /nada.php - No such file or directory',
    '[Wed Oct 14 14:49:29 2026] 127.0.0.1:51414 [200]: GET /ok.php',
    '[Wed Oct 14 14:49:29 2026] 127.0.0.1:51414 Closing'
  ].join('\n');
  const errors=extractPreviewErrors(stderr);
  assert.equal(errors.length,3);
  assert.match(errors[0],/^PHP Fatal error:\s+Uncaught PDOException.*Stack trace: #0 \{main\} thrown in/);
  assert.match(errors[1],/^PHP Warning/);assert.equal(errors[2],'HTTP 404 GET /nada.php');
  assert.equal(errors.some(e=>/Development Server|Accepted|Closing|\[200\]/.test(e)),false);
  assert.deepEqual(extractPreviewErrors('[Wed Oct 14 14:49:29 2026] 127.0.0.1:1 [404]: GET / - No such file',6,true),[]);assert.deepEqual(extractPreviewErrors('[Wed Oct 14 14:49:29 2026] 127.0.0.1:1 [404]: GET / - No such file'),['HTTP 404 GET /']);
  assert.deepEqual(extractPreviewErrors(''),[]);assert.deepEqual(extractPreviewErrors(undefined),[]);
  assert.equal(extractPreviewErrors(Array.from({length:20},(_,i)=>`[Wed Oct 14 14:49:2${i%10} 2026] PHP Warning:  w${i}`).join('\n')).length,6);
});

test('a real php preview reports the fatal error the page hit',async()=>{
  const root=project({'index.php':'<?php http_response_code(500); throw new RuntimeException("falha real 987");'});
  const detector=new RuntimeDetector({phpFallback:true});
  try{
    if(!detector.detect(root).command)return;
    const manager=new RuntimeSessionManager(detector);
    const session=await manager.start(root,{anyResponseIsReady:true});
    try{
      assert.equal(session.status,'ready','a page that answers 500 must still open the preview so the error is visible');
      await fetch(session.baseUrl+'/');await new Promise(resolve=>setTimeout(resolve,400));
      const errors=previewView(session).errors||[];
      assert.ok(errors.some(e=>/Fatal error.*falha real 987/.test(e)),JSON.stringify(errors));
    }finally{await manager.stop(session);}
  }finally{rmSync(root,{recursive:true,force:true});}
});