import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeCodeAdapter} from '@orchestrator/adapters';

const REAL_HELP='Claude Code - starts an interactive session by default, use -p/--print for non-interactive output\n  -p, --print                           Print response and exit (useful for pipes).\n--model <model>\n--allowedTools, --allowed-tools <tools...>\n--disallowedTools, --disallowed-tools <tools...>\n--output-format <format>\n--permission-mode <mode>\n--permission-prompts <target>';
const GOOD=JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[],browserScenarios:[]})});
function capture(){
  const seen:{prompt:string;args:string[]}={prompt:'',args:[]};
  const spawn=(_command:string,args:string[])=>{
    const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.stdin={end(data?:string){
      if(!args.includes('--version')&&!args.includes('--help')){seen.prompt=String(data||'');seen.args=args;}
      child.stdout.emit('data',Buffer.from(args.includes('--version')?'2.1.287 (Claude Code)':args.includes('--help')?REAL_HELP:GOOD));child.emit('close',0);
    }};
    child.kill=()=>child.emit('close',null);return child;
  };
  return{seen,spawn};
}
const run=async(env:Record<string,string>)=>{
  const dir=mkdtempSync(join(tmpdir(),'orq-db-prompt-'));const {seen,spawn}=capture();
  try{
    const adapter=new ClaudeCodeAdapter({executable:'claude.cmd',platform:'win32',model:'claude-haiku-5-5',spawn:spawn as any,env:{...process.env,...env} as any});
    await adapter.execute({stage:'developer',task:{id:'t1',title:'Banco',description:'crie o banco'},workspaceContext:{location:dir},previousArtifacts:[]} as any);
    return seen;
  }finally{rmSync(dir,{recursive:true,force:true});}
};

test('Developer prompt gets the test-database rules (and never the password) only when a database is provided',async()=>{
  const withDb=await run({ORQ_DB_NAME:'orq_abc123',ORQ_DB_PASSWORD:'top-secret-password-xyz'});
  assert.match(withDb.prompt,/TEST DATABASE/);assert.match(withDb.prompt,/orq_abc123/);assert.match(withDb.prompt,/RUN them/);
  assert.equal(withDb.prompt.includes('top-secret-password-xyz'),false);
  const without=await run({ORQ_DB_NAME:''});
  assert.equal(without.prompt.includes('TEST DATABASE'),false);
});

test('Developer may run php (scripts and lint) but still cannot commit, push or delete',async()=>{
  const seen=await run({});
  const joined=seen.args.join(' ');
  assert.match(joined,/Bash\(php:\*\)/);
  assert.match(joined,/Bash\(git push:\*\)/);assert.match(joined,/Bash\(rm:\*\)/);
});

const envelopeWithDenials=JSON.stringify({type:'result',subtype:'success',is_error:false,permission_denials:[{tool_name:'Bash',tool_use_id:'t1',tool_input:{command:'echo "$ORQ_DB_NAME"; cat database/schema.sql | head -5'}}],result:JSON.stringify({status:'COMPLETED',summary:'ok',filesChanged:[],testsRun:[],notes:[],browserScenarios:[]})});
const runWith=async(stdout:string)=>{
  const dir=mkdtempSync(join(tmpdir(),'orq-denials-'));
  const spawn=(_c:string,args:string[])=>{const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(){child.stdout.emit('data',Buffer.from(args.includes('--version')?'2.1.287 (Claude Code)':args.includes('--help')?REAL_HELP:stdout));child.emit('close',0);}};child.kill=()=>child.emit('close',null);return child;};
  try{return await new ClaudeCodeAdapter({executable:'claude.cmd',platform:'win32',model:'claude-haiku-5-5',spawn:spawn as any}).execute({stage:'developer',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location:dir},previousArtifacts:[]} as any);}finally{rmSync(dir,{recursive:true,force:true});}
};

test('refused tool calls are recorded in the Developer result so the next cycle and the user can see them',async()=>{
  const result=await runWith(envelopeWithDenials);
  const denials=(result.structuredResult as any).permissionDenials;
  assert.equal(denials.length,1);assert.equal(denials[0].tool,'Bash');assert.match(denials[0].command,/cat database\/schema\.sql/);
  const clean=await runWith(GOOD);
  assert.equal((clean.structuredResult as any).permissionDenials,undefined);
});

test('Developer may use simple read-only commands but still not env/printenv (credentials) or destructive ones',async()=>{
  const seen=await run({});
  const joined=seen.args.join(' ');
  for(const allowed of ['Bash(cat:*)','Bash(ls:*)','Bash(head:*)','Bash(grep:*)','Bash(echo:*)'])assert.ok(joined.includes(allowed),allowed);
  assert.equal(/Bash\(env:|Bash\(printenv:|Bash\(set:/.test(joined),false);
  assert.match(seen.prompt,/ONE simple command per Bash call/);assert.match(seen.prompt,/"questions"/);
});