import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkUndo,gitHead,latestApply,recordApply,undoApply} from './apply-undo.js';

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=t','-c','user.email=t@t',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

/** Simula exatamente o que o Apply faz: branch da task + merge --no-ff na base. */
function appliedRepo(){
  const dir=mkdtempSync(join(tmpdir(),'undo-'));
  git(dir,'init','-q','-b','main');writeFileSync(join(dir,'index.html'),'<h1>antes</h1>');git(dir,'add','.');git(dir,'commit','-q','-m','inicial');
  git(dir,'checkout','-q','-b','task/x');writeFileSync(join(dir,'index.html'),'<h1>depois</h1>');writeFileSync(join(dir,'novo.js'),'1');git(dir,'add','.');git(dir,'commit','-q','-m','trabalho');
  git(dir,'checkout','-q','main');
  const preSha=gitHead(dir);
  git(dir,'merge','--no-ff','task/x','-m','orchestrator: apply task task/x');
  return{dir,preSha,postSha:gitHead(dir)};
}
const newDb=()=>new Database(':memory:');

test('records only real applies and finds the latest one',()=>{
  const db=newDb();
  assert.equal(recordApply(db,{kind:'task',refId:'t',workspaceId:'w',baseBranch:'main',preSha:'abc',postSha:'abc'}),null);
  recordApply(db,{kind:'task',refId:'t',workspaceId:'w',baseBranch:'main',preSha:'a',postSha:'b'});
  recordApply(db,{kind:'task',refId:'t',workspaceId:'w',baseBranch:'main',preSha:'b',postSha:'c'});
  assert.equal(latestApply(db,'task','t')?.postSha,'c');
  assert.equal(latestApply(db,'mission','t'),undefined);
});

test('undo restores the previous tree with a NEW revert commit, keeping all history',()=>{
  const {dir,preSha,postSha}=appliedRepo();
  try{
    const db=newDb();
    recordApply(db,{kind:'task',refId:'t',workspaceId:'w',baseBranch:'main',preSha,postSha});
    const record=latestApply(db,'task','t')!;
    assert.equal(checkUndo(record,dir).available,true);
    const {revertSha}=undoApply(db,record,dir);
    assert.equal(readFileSync(join(dir,'index.html'),'utf8'),'<h1>antes</h1>');
    assert.equal(existsSync(join(dir,'novo.js')),false);
    assert.notEqual(revertSha,postSha);
    assert.match(git(dir,'log','--format=%s','-n','1'),/Revert/);
    assert.equal(git(dir,'cat-file','-t',postSha),'commit'); // o commit aplicado continua no histórico
    assert.equal(git(dir,'status','--porcelain'),'');
    const after=latestApply(db,'task','t')!;
    assert.ok(after.undoneAt&&after.undoSha===revertSha);
    assert.equal(checkUndo(after,dir).alreadyUndone,true);
    assert.throws(()=>undoApply(db,after,dir),/já foi desfeita/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('undo is refused when later commits, local changes or another branch would make it unsafe',()=>{
  const {dir,preSha,postSha}=appliedRepo();
  try{
    const db=newDb();
    recordApply(db,{kind:'task',refId:'t',workspaceId:'w',baseBranch:'main',preSha,postSha});
    const record=latestApply(db,'task','t')!;
    writeFileSync(join(dir,'index.html'),'<h1>editado à mão</h1>');
    assert.match(checkUndo(record,dir).reason!,/não commitadas/);
    git(dir,'checkout','--','index.html');
    git(dir,'checkout','-q','-b','outra');
    assert.match(checkUndo(record,dir).reason!,/branch "outra"/);
    git(dir,'checkout','-q','main');
    writeFileSync(join(dir,'depois.txt'),'trabalho posterior');git(dir,'add','.');git(dir,'commit','-q','-m','posterior');
    assert.match(checkUndo(record,dir).reason!,/novos commits/);
    assert.equal(readFileSync(join(dir,'depois.txt'),'utf8'),'trabalho posterior');
    assert.equal(checkUndo(undefined,dir).available,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
