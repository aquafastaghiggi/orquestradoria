import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ProjectBootstrapError,createProjectFolder,slugifyProjectName} from './project-bootstrap.js';
import {inspectWorkspaceFolder} from './workspace-onboarding.js';

test('slugify produces safe folder names',()=>{
  assert.equal(slugifyProjectName('Meu App Ótimo!'),'meu-app-otimo');
  assert.equal(slugifyProjectName('../../etc/passwd'),'etc-passwd');
  assert.equal(slugifyProjectName('C:\\Windows'),'c-windows');
  assert.equal(slugifyProjectName('***'),'');
});

test('creates a committed git project that onboarding considers ready',()=>{
  const parent=mkdtempSync(join(tmpdir(),'boot-'));
  try{
    const project=createProjectFolder({name:'Loja de Pães',parentDir:parent,idea:'Um site simples para vender pães.'});
    assert.equal(project.path,join(parent,'loja-de-paes'));
    assert.match(readFileSync(join(project.path,'README.md'),'utf8'),/Um site simples para vender pães/);
    assert.equal(execFileSync('git',['rev-parse','--abbrev-ref','HEAD'],{cwd:project.path,encoding:'utf8'}).trim(),'main');
    assert.equal(execFileSync('git',['status','--porcelain'],{cwd:project.path,encoding:'utf8'}).trim(),'');
    const inspection=inspectWorkspaceFolder(project.path);
    assert.equal(inspection.ready,true);
    assert.equal(inspection.git?.hasCommits,true);
    assert.equal(inspection.issues.some(issue=>issue.code==='dirty'),false);
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('refuses invalid names, missing parents and non-empty folders without touching them',()=>{
  const parent=mkdtempSync(join(tmpdir(),'boot-'));
  try{
    const code=(fn:()=>unknown)=>{try{fn();}catch(error){return error instanceof ProjectBootstrapError?error.code:'other';}return 'none';};
    assert.equal(code(()=>createProjectFolder({name:'***',parentDir:parent,idea:'x'})),'invalid_name');
    assert.equal(code(()=>createProjectFolder({name:'ok',parentDir:join(parent,'nope'),idea:'x'})),'invalid_parent');
    mkdirSync(join(parent,'ocupada'));writeFileSync(join(parent,'ocupada','arquivo.txt'),'meu');
    assert.equal(code(()=>createProjectFolder({name:'ocupada',parentDir:parent,idea:'x'})),'folder_exists');
    assert.equal(readFileSync(join(parent,'ocupada','arquivo.txt'),'utf8'),'meu');
    assert.equal(existsSync(join(parent,'ocupada','.git')),false);
    mkdirSync(join(parent,'vazia'));
    assert.equal(createProjectFolder({name:'vazia',parentDir:parent,idea:'x'}).slug,'vazia');
  }finally{rmSync(parent,{recursive:true,force:true});}
});
