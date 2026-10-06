import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {analyzeProjectContext} from './project-context.js';

test('analyzes a static web fixture deterministically without reading secrets',()=>{
  const root=mkdtempSync(join(tmpdir(),'project-context-static-'));
  try {
    mkdirSync(join(root,'css'));mkdirSync(join(root,'js'));
    writeFileSync(join(root,'index.html'),'doctype html');writeFileSync(join(root,'css/style.css'),'body{}');writeFileSync(join(root,'js/script.js'),'console.log(1)');
    writeFileSync(join(root,'README.md'),'# Demo\n\nA small static project for testing.');writeFileSync(join(root,'.env'),'SECRET=do-not-read');
    const context=analyzeProjectContext(root,'workspace-1','main');
    assert.equal(context.version,1);assert.equal(context.project.type,'static-web');assert.deepEqual(context.stack.languages.sort(),['CSS','HTML','JavaScript'].sort());assert.equal(context.git.isRepository,false);assert.ok(context.structure.importantFiles.includes('index.html'));assert.equal(context.project.description,'A small static project for testing.');assert.equal(context.structure.importantFiles.includes('.env'),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('detects Node/Vite commands, stack and database evidence from manifests only',()=>{
  const root=mkdtempSync(join(tmpdir(),'project-context-node-'));
  try {
    const manifest={name:'demo',scripts:{dev:'vite',build:'vite build',test:'vitest'},dependencies:{react:'18.0.0',vite:'6.0.0','better-sqlite3':'11.0.0'}};writeFileSync(join(root,'package.json'),JSON.stringify(manifest));writeFileSync(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9');writeFileSync(join(root,'vite.config.ts'),'export default {}');
    const context=analyzeProjectContext(root,'workspace-2');
    assert.equal(context.project.name,'demo');assert.equal(context.project.type,'vite');assert.deepEqual(context.stack.frameworks.sort(),['React','Vite'].sort());assert.deepEqual(context.stack.packageManagers,['pnpm']);assert.deepEqual(context.stack.databases,['SQLite']);assert.deepEqual(context.commands.test,['pnpm run test']);assert.deepEqual(context.testing.commands,['pnpm run test']);
  } finally {rmSync(root,{recursive:true,force:true});}
});
