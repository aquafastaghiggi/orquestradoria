import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeDetector} from '@orchestrator/workspace';

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