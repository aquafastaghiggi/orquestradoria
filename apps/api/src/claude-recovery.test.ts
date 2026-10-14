import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeCodeAdapter,finalModelText,listWorkspaceChanges,recoverDeveloperResult} from '@orchestrator/adapters';

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=t','-c','user.email=t@t',...args],{cwd,stdio:'ignore'});
function repoWithChanges(withChanges:boolean){
  const dir=mkdtempSync(join(tmpdir(),'recover-'));
  git(dir,'init','-q','-b','main');writeFileSync(join(dir,'index.html'),'<h1>a</h1>');git(dir,'add','.');git(dir,'commit','-q','-m','i');
  if(withChanges){writeFileSync(join(dir,'index.html'),'<h1>Minhas tarefas</h1>');writeFileSync(join(dir,'app.js'),'console.log(1)');}
  return dir;
}
const envelope=(result:string,extra:Record<string,unknown>={})=>JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:3,total_cost_usd:0.4,usage:{input_tokens:5,cache_creation_input_tokens:1000,cache_read_input_tokens:2000,output_tokens:300},modelUsage:{'claude-haiku-5-5':{inputTokens:5,outputTokens:300,cacheReadInputTokens:2000,cacheCreationInputTokens:1000,costUSD:0.4,costBasis:'unknown'}},result,...extra});

test('listWorkspaceChanges reports modified and new files, and nothing outside a git repo',()=>{
  const dir=repoWithChanges(true),plain=mkdtempSync(join(tmpdir(),'plain-'));
  try{
    assert.deepEqual(listWorkspaceChanges(dir).sort(),['app.js','index.html']);
    assert.deepEqual(listWorkspaceChanges(plain),[]);
    assert.deepEqual(listWorkspaceChanges(repoWithChanges(false)),[]);
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(plain,{recursive:true,force:true});}
});

test('finalModelText reads the CLI envelope, falls back to raw text and flags errors',()=>{
  assert.deepEqual(finalModelText(envelope('feito')),{text:'feito',isError:false});
  assert.deepEqual(finalModelText('texto cru'),{text:'texto cru',isError:false});
  assert.equal(finalModelText(envelope('x',{is_error:true})).isError,true);
});

test('recovery only happens with real workspace changes and never hides BLOCKED/errors',()=>{
  const ok=recoverDeveloperResult({stdout:envelope('Alterei o título e criei app.js.'),changedFiles:['index.html','app.js','app.js']})!;
  assert.equal(ok.status,'COMPLETED');
  assert.deepEqual(ok.filesChanged,['index.html','app.js']);
  assert.equal(ok.warnings[0].code,'structured_output_recovered');
  assert.match(ok.summary,/Alterei o título/);
  assert.equal(recoverDeveloperResult({stdout:envelope('Alterei tudo'),changedFiles:[]}),undefined);
  assert.equal(recoverDeveloperResult({stdout:envelope('{"status":"BLOCKED","summary":"sem acesso"}'),changedFiles:['a.js']}),undefined);
  assert.equal(recoverDeveloperResult({stdout:envelope('Não consegui. BLOCKED por falta de permissão'),changedFiles:['a.js']}),undefined);
  assert.equal(recoverDeveloperResult({stdout:envelope('ok',{is_error:true}),changedFiles:['a.js']}),undefined);
  assert.equal(recoverDeveloperResult({stdout:envelope('   '),changedFiles:['a.js']}),undefined);
});

const REAL_HELP='Claude Code - starts an interactive session by default, use -p/--print for non-interactive output\n  -p, --print                           Print response and exit (useful for pipes).\n--model <model>\n--allowedTools, --allowed-tools <tools...>\n--disallowedTools, --disallowed-tools <tools...>\n--output-format <format>\n--permission-mode <mode>\n--permission-prompts <target>';
function fakeClaude(finalText:string){
  return(_command:string,args:string[])=>{
    const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.stdin={end(){
      const output=args.includes('--version')?'2.1.287 (Claude Code)':args.includes('--help')?REAL_HELP:envelope(finalText);
      child.stdout.emit('data',Buffer.from(output));child.emit('close',0);
    }};
    child.kill=()=>child.emit('close',null);return child;
  };
}
const run=(dir:string,finalText:string,env:Record<string,string>={})=>{
  const adapter=new ClaudeCodeAdapter({executable:'claude.cmd',platform:'win32',model:'claude-haiku-5-5',spawn:fakeClaude(finalText) as any,env:{...process.env,...env} as any});
  return adapter.execute({stage:'developer',task:{id:'t1',title:'Ajuste',description:'x'},workspaceContext:{location:dir},previousArtifacts:[]} as any);
};

test('adapter: invalid final JSON + real changes => COMPLETED with warning, cost still computed from usage',async()=>{
  const dir=repoWithChanges(true);
  try{
    const result=await run(dir,'Pronto! Troquei a cor do título e adicionei o botão.');
    const structured:any=result.structuredResult;
    assert.equal(structured.status,'COMPLETED');
    assert.deepEqual(structured.filesChanged.sort(),['app.js','index.html']);
    assert.equal(structured.warnings[0].code,'structured_output_recovered');
    assert.ok(result.tokenUsage>0&&result.usageDetails?.length===1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('adapter: invalid final JSON without changes, with BLOCKED, or with recovery disabled still fails',async()=>{
  const clean=repoWithChanges(false),dirty=repoWithChanges(true);
  try{
    await assert.rejects(run(clean,'Pronto!'),(error:any)=>error.kind==='validation_error');
    await assert.rejects(run(dirty,'BLOCKED: não tenho permissão'),(error:any)=>error.kind==='validation_error');
    await assert.rejects(run(dirty,'Pronto!',{CLAUDE_RECOVER_STRUCTURED:'0'}),(error:any)=>error.kind==='validation_error');
  }finally{rmSync(clean,{recursive:true,force:true});rmSync(dirty,{recursive:true,force:true});}
});

test('adapter: a valid JSON answer is untouched (no warning)',async()=>{
  const dir=repoWithChanges(true);
  try{
    const good=JSON.stringify({status:'COMPLETED',summary:'ok',filesChanged:['index.html'],testsRun:[],notes:[],browserScenarios:[]});
    const result=await run(dir,good);
    assert.equal((result.structuredResult as any).warnings,undefined);
    assert.equal((result.structuredResult as any).summary,'ok');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
