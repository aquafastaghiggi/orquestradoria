import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractExplicitAcceptanceCriteria} from '@orchestrator/shared';
import {TaskPreviewManager,adjustmentRound,appendAdjustmentRequest,canRequestAdjustment} from './task-preview.js';

test('adjustment feedback never becomes an acceptance criterion and rounds are counted',()=>{
  const base='Objetivo: ajustar tela\n\nCritérios de aceite:\n- Botão visível\n- Texto correto';
  const once=appendAdjustmentRequest(base,'- reduza o botão\n- troque o texto',adjustmentRound(base));
  assert.deepEqual(extractExplicitAcceptanceCriteria(once).map(item=>item.id),['AC1','AC2']);
  assert.match(once,/rodada 1/);
  assert.equal(adjustmentRound(once),2);
  const twice=appendAdjustmentRequest(once,'mais um ajuste',adjustmentRound(once));
  assert.match(twice,/rodada 2/);
  assert.equal(extractExplicitAcceptanceCriteria(twice).length,2);
});

test('adjustment is only allowed for approved worktree tasks waiting for a decision',()=>{
  const dir=mkdtempSync(join(tmpdir(),'adjust-'));
  try{
    const ok={status:'approved',environmentStatus:'approved_waiting_action',isolationMode:'worktree',worktreePath:dir};
    assert.equal(canRequestAdjustment(ok).ok,true);
    assert.equal(canRequestAdjustment({...ok,status:'failed'}).ok,false);
    assert.equal(canRequestAdjustment({...ok,environmentStatus:'applied'}).ok,false);
    assert.equal(canRequestAdjustment({...ok,isolationMode:'current-workspace'}).ok,false);
    assert.equal(canRequestAdjustment({...ok,worktreePath:join(dir,'missing')}).ok,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('preview serves the isolated worktree, is idempotent and stops cleanly',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'preview-'));
  const previews=new TaskPreviewManager();
  try{
    writeFileSync(join(dir,'index.html'),'<h1>preview</h1>');
    const started=await previews.start('task-1',dir);
    assert.equal(started.status,'ready');
    assert.match(started.url||'',/^http:\/\/127\.0\.0\.1:\d+$/);
    const body=await (await fetch(started.url!)).text();
    assert.match(body,/preview/);
    assert.equal((await previews.start('task-1',dir)).url,started.url);
    assert.equal(previews.get('task-1').status,'ready');
    assert.equal((await previews.stop('task-1')).status,'stopped');
    assert.equal(previews.get('task-1').status,'stopped');
    assert.equal((await previews.start('task-2',join(dir,'missing'))).status,'failed');
  }finally{await previews.stopAll();rmSync(dir,{recursive:true,force:true});}
});

test('stop closes the port even while a browser keeps a connection open',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'preview-'));
  const previews=new TaskPreviewManager();
  const agent=new http.Agent({keepAlive:true});
  try{
    writeFileSync(join(dir,'index.html'),'<h1>x</h1>');
    const started=await previews.start('task-ka',dir);
    await new Promise<void>(resolve=>http.get(started.url!,{agent},response=>{response.resume();response.on('end',()=>resolve());}));
    await previews.stop('task-ka');
    const open=await new Promise<boolean>(resolve=>{const socket=net.connect(Number(new URL(started.url!).port),'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));});
    assert.equal(open,false);
  }finally{agent.destroy();await previews.stopAll();rmSync(dir,{recursive:true,force:true});}
});

test('a task that stopped asking for help (attention) can be answered even when failed or in manual review; without it, it cannot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'orq-adj-'));
  try{
    const base={isolationMode:'worktree',worktreePath:dir,missionId:null};
    for(const [status,environmentStatus] of [['needs_manual_review','manual_review_preserved'],['failed','failed_preserved']]){
      const task={...base,status,environmentStatus};
      assert.equal(canRequestAdjustment(task).ok,false,`${status} without attention`);
      assert.equal(canRequestAdjustment(task,true).ok,true,`${status} with attention`);
    }
    assert.equal(canRequestAdjustment({...base,status:'running',environmentStatus:'active'},true).ok,false);
    assert.equal(canRequestAdjustment({...base,status:'failed',environmentStatus:'failed_preserved',missionId:'m1'},true).ok,false);
    assert.equal(canRequestAdjustment({...base,status:'failed',environmentStatus:'failed_preserved',worktreePath:join(dir,'gone')},true).ok,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});