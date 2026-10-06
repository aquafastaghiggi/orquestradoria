import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProjectContextForRole,buildStageContext} from '@orchestrator/core';
import type {Artifact,Task} from '@orchestrator/shared';

const task:Task={id:'task-1',workspaceId:'ws-1',title:'Small change',description:'Update the login button',pipeline:['planner','developer','tester','reviewer'],status:'pending',resumable:true,taskBudgetUsd:0,tokenBudget:0,configSnapshot:'{}',createdAt:'',updatedAt:''};
const artifact=(type:Artifact['type'],content:string):Artifact=>({id:type,taskId:task.id,type,name:type,content,createdAt:''});

test('reviewer context excludes raw provider and audit data while retaining diff and files',()=>{
  const context=buildStageContext({task,role:'reviewer',workspaceContext:{id:'ws-1',type:'local',location:'C:\\workspace'},changedFiles:['src/login.ts'],diff:'diff --git a/src/login.ts b/src/login.ts\n+button',artifacts:[artifact('implementation_summary','Implemented the button.'),artifact('log','HEARTBEAT raw provider response audit')],acceptanceCriteria:['Button is updated'],maxChars:5000});
  assert.match(context.prompt,/ACCEPTANCE CRITERIA/);assert.match(context.prompt,/DIFF/);assert.match(context.prompt,/src\/login\.ts/);assert.doesNotMatch(context.prompt,/HEARTBEAT raw provider/);assert.deepEqual(context.manifest.filesIncluded,['src/login.ts']);assert.equal(context.manifest.truncated,false);
});

test('large reviewer context preserves priority sections and reports truncation',()=>{
  const context=buildStageContext({task,role:'reviewer',workspaceContext:{id:'ws-1',type:'local',location:'C:\\workspace'},changedFiles:['src/a.ts','src/b.ts','src/c.ts'],diff:'x'.repeat(20000),artifacts:[artifact('implementation_summary','summary'),artifact('log','noise'.repeat(10000))],acceptanceCriteria:['Must remain safe'],maxChars:1200});
  assert.equal(context.contextTruncated,true);assert.match(context.prompt,/TASK/);assert.match(context.prompt,/ACCEPTANCE CRITERIA/);assert.match(context.prompt,/TASK CHANGESET/);assert.ok(context.manifest.omittedChars&&context.manifest.omittedChars>0);
});

test('developer receives planner summary without raw provider response',()=>{
  const context=buildStageContext({task,role:'developer',workspaceContext:{id:'ws-1',type:'local',location:'C:\\workspace'},artifacts:[artifact('plan','First inspect login.ts'),artifact('log','raw provider JSONL')],changedFiles:['src/login.ts'],maxChars:5000});
  assert.match(context.prompt,/PLAN/);assert.match(context.prompt,/First inspect login\.ts/);assert.doesNotMatch(context.prompt,/raw provider JSONL/);
});

const projectContext={version:1,status:'ready',sourceCommitSha:'abc123',context:{name:'Demo',projectType:'Node.js',stack:{languages:'TypeScript',frameworks:['Vite'],runtime:'Node.js',packageManager:'pnpm',databases:['SQLite']},commands:{test:['pnpm test'],typecheck:['pnpm typecheck'],build:['pnpm build']},testing:{profile:'unit'},importantFiles:['src/main.ts'],rules:['Do not deploy'],risks:['Validation required'],structureSummary:'src/ and packages/'}};

test('project context is rendered by role without raw context JSON',()=>{
  const planner=buildProjectContextForRole(projectContext,'planner');const tester=buildProjectContextForRole(projectContext,'tester');const reviewer=buildStageContext({task,role:'reviewer',workspaceContext:{id:'ws-1',type:'local',location:'C:\\workspace'},projectContext,changedFiles:['src/main.ts'],diff:'diff',acceptanceCriteria:['Keep behavior']});
  assert.ok(planner);assert.match(planner!.text,/pnpm test/);assert.match(planner!.text,/Do not deploy/);assert.match(tester!.text,/Profile: unit/);assert.doesNotMatch(tester!.text,/Structure/);assert.match(reviewer.prompt,/PROJECT CONTEXT/);assert.match(reviewer.prompt,/src\/main\.ts/);assert.doesNotMatch(planner!.text,/"projectType"/);
});

test('project context warning, hash and limit are deterministic',()=>{
  const stale=buildProjectContextForRole({...projectContext,status:'stale'},'developer',180);const again=buildProjectContextForRole({...projectContext,status:'stale'},'developer',180);
  assert.ok(stale);assert.equal(stale!.text,again!.text);assert.equal(stale!.hash,again!.hash);assert.equal(stale!.truncated,true);assert.match(stale!.text,/may be outdated/);assert.doesNotMatch(stale!.text,/SECRET_VALUE/);
});
