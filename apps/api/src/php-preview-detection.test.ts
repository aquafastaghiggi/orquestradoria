import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector,RuntimeSessionManager} from '@orchestrator/workspace';

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