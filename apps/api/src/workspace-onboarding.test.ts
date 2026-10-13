import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectWorkspaceFolder} from './workspace-onboarding.js';

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=t','-c','user.email=t@t',...args],{cwd,stdio:'ignore'});
const codes=(result:ReturnType<typeof inspectWorkspaceFolder>)=>result.issues.map(issue=>issue.code);

test('onboarding rejects empty, missing and non-directory paths',()=>{
  assert.equal(inspectWorkspaceFolder('').ready,false);
  assert.deepEqual(codes(inspectWorkspaceFolder(join(tmpdir(),'orq-does-not-exist-xyz'))),['path_missing']);
  const dir=mkdtempSync(join(tmpdir(),'onb-'));
  try{
    writeFileSync(join(dir,'file.txt'),'x');
    const result=inspectWorkspaceFolder(join(dir,'file.txt'));
    assert.equal(result.ready,false);
    assert.deepEqual(codes(result),['not_directory']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('onboarding reports git state, branch, runtime and dirty tree for a real folder',()=>{
  const dir=mkdtempSync(join(tmpdir(),'onb-'));
  try{
    const plain=inspectWorkspaceFolder(dir);
    assert.equal(plain.ready,true);
    assert.ok(codes(plain).includes('not_git'));

    git(dir,'init','-q','-b','master');
    assert.deepEqual(codes(inspectWorkspaceFolder(dir)).includes('no_commits'),true);
    assert.equal(inspectWorkspaceFolder(dir).ready,false);

    writeFileSync(join(dir,'index.html'),'<h1>oi</h1>');
    git(dir,'add','.');git(dir,'commit','-q','-m','init');
    const clean=inspectWorkspaceFolder(dir);
    assert.equal(clean.ready,true);
    assert.equal(clean.git?.resolvedBaseBranch,'master');
    assert.equal(clean.stack?.runtime,'static');
    assert.equal(codes(clean).includes('dirty'),false);

    writeFileSync(join(dir,'novo.txt'),'x');
    const dirty=inspectWorkspaceFolder(dir);
    assert.equal(dirty.ready,true);
    assert.ok(codes(dirty).includes('dirty'));

    assert.ok(codes(inspectWorkspaceFolder(dir,'main')).includes('branch_mismatch'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
