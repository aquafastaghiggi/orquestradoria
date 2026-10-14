import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const call=async(base:string,path:string,init?:RequestInit)=>{const response=await fetch(base+path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});return{status:response.status,body:await response.json().catch(()=>({}))};};
async function waitFor<T>(read:()=>Promise<T>,done:(value:T)=>boolean,label:string,ms=40000){const start=Date.now();let last:T;do{last=await read();if(done(last))return last;await new Promise(resolve=>setTimeout(resolve,300));}while(Date.now()-start<ms);throw new Error(`timeout waiting for ${label}: ${JSON.stringify(last!).slice(0,500)}`);}
const settled=(task:any)=>!['pending','analyzing','planning','implementing','testing','reviewing'].includes(task.status);

test('a task that continues from an unapplied task sees its work, blocks discarding it, and applying it applies both',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orq-stacked-'));const workspace=join(root,'ws');mkdirSync(workspace);
  const port=42000+Math.floor(Math.random()*900);let child:any;
  try{
    execFileSync('git',['init','-b','main'],{cwd:workspace});
    writeFileSync(join(workspace,'README.md'),'x\n');execFileSync('git',['add','.'],{cwd:workspace});execFileSync('git',['-c','user.name=t','-c','user.email=t@t','commit','-qm','readme'],{cwd:workspace});
    const tsx=resolve(import.meta.dirname,'../node_modules/tsx/dist/cli.mjs'),server=resolve(import.meta.dirname,'server.ts');
    child=spawn(process.execPath,[tsx,server],{cwd:import.meta.dirname,env:{...process.env,DB_PATH:join(root,'api.sqlite'),PORT:String(port),TASK_ISOLATION_MODE:'worktree',DEVELOPER_PROVIDER:'mock',REVIEWER_PROVIDER:'mock',TESTER_PROVIDER:'mock',TESTER_REQUIRED:'false',ORQ_PROJECT_DB_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    const base=`http://127.0.0.1:${port}`;
    await waitFor(async()=>fetch(`${base}/health`).then(r=>r.ok).catch(()=>false),ok=>ok,'server health');
    const ws=await call(base,'/api/workspaces',{method:'POST',body:JSON.stringify({name:'st',type:'local',location:workspace,branch:'main'})});assert.equal(ws.status,201);
    const mk=async(title:string,extra:Record<string,unknown>={})=>call(base,`/api/workspaces/${ws.body.id}/tasks`,{method:'POST',body:JSON.stringify({title,description:`faça ${title}`,pipeline:['planner','developer','tester','reviewer'],...extra})});
    const runToApproval=async(id:string)=>{assert.equal((await call(base,`/api/tasks/${id}/run`,{method:'POST'})).status,202);const task:any=await waitFor(async()=>(await call(base,`/api/tasks/${id}`)).body,settled,'task to settle');assert.equal(task.status,'approved',JSON.stringify({status:task.status,errors:(task.executions||[]).map((e:any)=>e.error)}));return task;};

    // A: aprovada e NÃO aplicada; o "trabalho" do Developer é um arquivo no worktree dela
    const a=(await mk('tarefa A')).body;const aDone=await runToApproval(a.id);
    writeFileSync(join(aDone.environment.worktreePath,'a.txt'),'trabalho da A\n');

    // continuar a partir de uma task inexistente / de outro workspace é recusado
    assert.equal((await mk('órfã',{baseTaskId:'nao-existe'})).status,404);

    // B continua a partir de A
    const b=await mk('tarefa B',{baseTaskId:a.id});assert.equal(b.status,201,JSON.stringify(b.body));
    assert.match((await call(base,`/api/tasks/${b.body.id}`)).body.description,/continua a partir do trabalho da task "tarefa A"/);
    assert.equal((await call(base,`/api/tasks/${b.body.id}`)).body.baseTask.title,'tarefa A');

    // enquanto B existe, descartar A é bloqueado
    const blocked=await call(base,`/api/tasks/${a.id}/discard`,{method:'POST'});
    assert.equal(blocked.status,409);assert.equal(blocked.body.code,'has_dependent_tasks');assert.match(blocked.body.error,/tarefa B/);

    const bDone=await runToApproval(b.body.id);
    assert.ok(existsSync(join(bDone.environment.worktreePath,'a.txt')),'B sees the work of A that was never applied');
    assert.ok(existsSync(join(bDone.environment.worktreePath,'README.md')));
    assert.equal(existsSync(join(workspace,'a.txt')),false,'main still has nothing until an apply');
    writeFileSync(join(bDone.environment.worktreePath,'b.txt'),'trabalho da B\n');

    // aplicar B leva A junto, e A passa a "aplicada"
    const applied=await call(base,`/api/tasks/${b.body.id}/apply`,{method:'POST'});
    assert.equal(applied.status,200,JSON.stringify(applied.body));
    assert.ok(existsSync(join(workspace,'a.txt'))&&existsSync(join(workspace,'b.txt')),'main received both pieces of work');
    const aAfter:any=(await call(base,`/api/tasks/${a.id}`)).body;
    assert.equal(aAfter.environment.environmentStatus,'applied');
    // e agora descartar A já não é necessário nem bloqueado por dependentes
    const bAfter:any=(await call(base,`/api/tasks/${b.body.id}`)).body;assert.equal(bAfter.environment.environmentStatus,'applied');
  }finally{if(child){child.kill();await new Promise(resolve=>setTimeout(resolve,150));}rmSync(root,{recursive:true,force:true});}
});
