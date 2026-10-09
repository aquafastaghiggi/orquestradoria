import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previewEligibility} from './preview-policy.js';

test('preview eligibility only accepts an isolated task worktree',()=>{
  const workspace=mkdtempSync(join(tmpdir(),'orquestradoria-preview-policy-'));
  const worktree=mkdtempSync(join(tmpdir(),'orquestradoria-preview-policy-worktree-'));
  try{
    writeFileSync(join(worktree,'index.html'),'<h1>preview</h1>');
    const valid={status:'pending',environmentStatus:'active',isolationMode:'worktree',taskBranch:'task/preview',worktreePath:worktree};
    assert.equal(previewEligibility(valid,{location:workspace}),null);
    assert.match(previewEligibility({...valid,worktreePath:workspace},{location:workspace})||'',/isolado/);
    assert.match(previewEligibility({...valid,isolationMode:'current-workspace',worktreePath:null},{location:workspace})||'',/worktree/);
    assert.match(previewEligibility({...valid,status:'approved',environmentStatus:'applied'},{location:workspace})||'',/finalizado/);
    assert.match(previewEligibility({...valid,status:'discarded',environmentStatus:'discarded'},{location:workspace})||'',/finalizado/);
    assert.match(previewEligibility({...valid,missionId:'mission-1'},{location:workspace})||'',/Missions/);
  }finally{rmSync(workspace,{recursive:true,force:true});rmSync(worktree,{recursive:true,force:true});}
});
