import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const call=async(base:string,path:string,init?:RequestInit)=>{const response=await fetch(base+path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});return{status:response.status,body:await response.json().catch(()=>({}))};};
async function waitFor<T>(read:()=>Promise<T>,done:(value:T)=>boolean,label:string,ms=40000){const start=Date.now();let last:T;do{last=await read();if(done(last))return last;await new Promise(resolve=>setTimeout(resolve,300));}while(Date.now()-start<ms);throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last!).slice(0,500)}`);}
const settled=(task:any)=>!['pending','analyzing','planning','implementing','testing','reviewing'].includes(task.status);

test('Developer asks a question: the task stops asking the user (no tester/reviewer spent), the answer is passed on and the task resumes to approval',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orq-needs-input-'));const workspace=join(root,'ws');mkdirSync(workspace);
  const port=41000+Math.floor(Math.random()*900);let child:any;
  try{
    execFileSync('git',['init','-b','main'],{cwd:workspace});
    writeFileSync(join(workspace,'README.md'),'x\n');execFileSync('git',['add','.'],{cwd:workspace});execFileSync('git',['-c','user.name=t','-c','user.email=t@t','commit','-qm','readme'],{cwd:workspace});
    const tsx=resolve(import.meta.dirname,'../node_modules/tsx/dist/cli.mjs'),server=resolve(import.meta.dirname,'server.ts');
    child=spawn(process.execPath,[tsx,server],{cwd:import.meta.dirname,env:{...process.env,DB_PATH:join(root,'api.sqlite'),PORT:String(port),TASK_ISOLATION_MODE:'worktree',TASK_WORKTREE_ROOT:join(root,'worktrees'),DEVELOPER_PROVIDER:'mock',REVIEWER_PROVIDER:'mock',TESTER_PROVIDER:'mock',TESTER_REQUIRED:'false',ORQ_PROJECT_DB_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    const base=`http://127.0.0.1:${port}`;
    await waitFor(async()=>fetch(`${base}/health`).then(r=>r.ok).catch(()=>false),ok=>ok,'server health');
    const ws=await call(base,'/api/workspaces',{method:'POST',body:JSON.stringify({name:'ni',type:'local',location:workspace,branch:'main'})});assert.equal(ws.status,201);
    const created=await call(base,`/api/workspaces/${ws.body.id}/tasks`,{method:'POST',body:JSON.stringify({title:'criar motorista',description:'crie o usuário motorista com senha [[mock:bloqueado]]',pipeline:['planner','developer','tester','reviewer']})});assert.equal(created.status,201);
    const id=created.body.id;
    assert.equal((await call(base,`/api/tasks/${id}/run`,{method:'POST'})).status,202);

    // 1) o Developer pergunta -> a task para pedindo ajuda, sem rodar Tester nem Reviewer
    const stopped:any=await waitFor(async()=>(await call(base,`/api/tasks/${id}`)).body,settled,'task to stop');
    assert.equal(stopped.status,'needs_manual_review',JSON.stringify({status:stopped.status,errors:(stopped.executions||[]).map((e:any)=>e.error)}));
    assert.equal(stopped.environment.environmentStatus,'manual_review_preserved');
    assert.equal(stopped.attention.kind,'needs_input');
    assert.deepEqual(stopped.attention.questions,['Qual deve ser a senha do usuário motorista?']);
    assert.equal(stopped.attention.details.denials.length,1);assert.match(stopped.attention.details.denials[0].command,/cat database\/schema\.sql/);
    assert.deepEqual(stopped.executions.map((e:any)=>e.role).filter((role:string)=>role==='reviewer'||role==='tester'),[],'no tester/reviewer ran after a blocked developer');

    // 2) sem "atenção" não há ajuste liberado para uma task parada; com ela, o usuário responde
    const answer=await call(base,`/api/tasks/${id}/request-changes`,{method:'POST',body:JSON.stringify({feedback:'Respostas às perguntas do Developer:\n1. Qual deve ser a senha?\nResposta: segredo-do-motorista-123'})});
    assert.equal(answer.status,202,JSON.stringify(answer.body));

    // 3) a resposta segue para o Developer, a task chega à aprovação e a atenção some
    const finished:any=await waitFor(async()=>(await call(base,`/api/tasks/${id}`)).body,settled,'task to finish');
    assert.equal(finished.status,'approved',JSON.stringify({status:finished.status,attention:finished.attention,errors:(finished.executions||[]).map((e:any)=>e.error)}));
    assert.equal(finished.attention,null);
    assert.match(finished.description,/segredo-do-motorista-123/);
    assert.deepEqual(finished.executions.map((e:any)=>e.role).filter((role:string)=>role==='reviewer').length,1);
  }finally{if(child){child.kill();await new Promise(resolve=>setTimeout(resolve,150));}rmSync(root,{recursive:true,force:true});}
});