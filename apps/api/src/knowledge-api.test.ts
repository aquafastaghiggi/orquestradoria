import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const call=async(base:string,path:string,init?:RequestInit)=>{const response=await fetch(base+path,{...init,headers:{'content-type':'application/json',...(init?.headers||{})}});return{status:response.status,body:await response.json().catch(()=>({}))};};

test('project memory API: empty by default, saved per workspace, validated and limited',async()=>{
  const root=mkdtempSync(join(tmpdir(),'orq-knowledge-'));const workspace=join(root,'ws');mkdirSync(workspace);
  const port=43000+Math.floor(Math.random()*900);let child:any;
  try{
    execFileSync('git',['init','-b','main'],{cwd:workspace});writeFileSync(join(workspace,'README.md'),'x\n');execFileSync('git',['add','.'],{cwd:workspace});execFileSync('git',['-c','user.name=t','-c','user.email=t@t','commit','-qm','r'],{cwd:workspace});
    const tsx=resolve(import.meta.dirname,'../node_modules/tsx/dist/cli.mjs'),server=resolve(import.meta.dirname,'server.ts');
    child=spawn(process.execPath,[tsx,server],{cwd:import.meta.dirname,env:{...process.env,DB_PATH:join(root,'api.sqlite'),PORT:String(port),TASK_ISOLATION_MODE:'worktree',TASK_WORKTREE_ROOT:join(root,'worktrees'),DEVELOPER_PROVIDER:'mock',REVIEWER_PROVIDER:'mock',TESTER_PROVIDER:'mock',ORQ_PROJECT_DB_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    const base=`http://127.0.0.1:${port}`;
    for(let i=0;i<100;i++){try{if((await fetch(`${base}/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const a=(await call(base,'/api/workspaces',{method:'POST',body:JSON.stringify({name:'a',type:'local',location:workspace,branch:'main'})})).body;
    assert.deepEqual((await call(base,`/api/workspaces/${a.id}/knowledge`)).body,{content:'',updatedAt:null,maxChars:6000});
    const saved=await call(base,`/api/workspaces/${a.id}/knowledge`,{method:'PUT',body:JSON.stringify({content:'Login de teste: demo / demo123\r\nRodar com php -S'})});
    assert.equal(saved.status,200);assert.equal(saved.body.content,'Login de teste: demo / demo123\nRodar com php -S');
    assert.equal((await call(base,`/api/workspaces/${a.id}/knowledge`)).body.content,saved.body.content);
    assert.equal((await call(base,`/api/workspaces/${a.id}/knowledge`,{method:'PUT',body:JSON.stringify({content:'x'.repeat(6001)})})).status,400);
    assert.equal((await call(base,`/api/workspaces/${a.id}/knowledge`,{method:'PUT',body:JSON.stringify({})})).status,400);
    assert.equal((await call(base,'/api/workspaces/inexistente/knowledge')).status,404);
    assert.equal((await call(base,`/api/workspaces/${a.id}/knowledge`,{method:'PUT',body:JSON.stringify({content:''})})).body.content,'');
  }finally{if(child){child.kill();await new Promise(resolve=>setTimeout(resolve,150));}rmSync(root,{recursive:true,force:true});}
});