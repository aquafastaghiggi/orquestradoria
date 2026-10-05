import {createCliSpawn,type CliSpawn} from './cli-process.js';
import {detectProjectProfile,type ProjectTestProfile, type TestCommand} from './project-detector.js';
import type {ExecutionContext,ProviderAdapter,ProviderCapabilities,ProviderExecutionResult} from '@orchestrator/shared';

export type TesterStatus='PASSED'|'FAILED'|'BLOCKED';
export interface TesterCommandResult{commandId:string;label:string;status:'passed'|'failed'|'blocked'|'cancelled'|'timed_out';exitCode:number|null;stdout:string;stderr:string;durationMs:number;}
export interface TesterResult{status:TesterStatus;projectProfile:ProjectTestProfile;commands:TesterCommandResult[];progress:number;summary:string;}
export interface CommandTesterConfig{profile?:ProjectTestProfile;timeoutMs?:number;maxOutputChars?:number;failFast?:boolean;spawn?:CliSpawn;platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;}
type TesterInput=ExecutionContext&{signal?:AbortSignal;onProgress?:(message:string,percent?:number)=>void;onHeartbeat?:()=>void};
const capabilities:ProviderCapabilities={streaming:false,cancel:true,usageReporting:false,modelSelection:false,toolUse:false,filesystemAccess:true,sessionResume:false,structuredOutput:true};
const executable=(name:string,platform:NodeJS.Platform)=>platform==='win32'&&['pnpm','npm','yarn'].includes(name)?`${name}.cmd`:name;
const bounded=(value:string,max:number)=>value.length<=max?value:`${value.slice(0,Math.max(0,max-32))}\n...[truncated]`;
const safeCommand=(command:TestCommand)=>['pnpm','npm','yarn','php','python'].includes(command.executable)&&command.args.every(arg=>!/[;&|`$<>]/.test(arg));

export class CommandTesterAdapter implements ProviderAdapter{
  id='command-tester';name='Command Tester';capabilities=capabilities;private readonly active=new Map<string,{kill:(signal?:NodeJS.Signals)=>void}>();
  constructor(private readonly config:CommandTesterConfig={}){}
  async checkAvailability(){return true;}
  async getModels(){return['local-command-runner'];}
  async getUsage(){return{tokenUsage:0,estimatedCost:undefined as unknown as number};}
  async cancel(executionId:string){this.active.get(executionId)?.kill('SIGTERM');}
  async execute(input:TesterInput):Promise<ProviderExecutionResult>{
    if(input.stage!=='tester')throw Object.assign(new Error('Command Tester is restricted to tester stage'),{kind:'validation_error'});
    const profile=this.config.profile||detectProjectProfile({location:input.workspaceContext.location,env:this.config.env||process.env});
    const maxOutput=this.config.maxOutputChars||Number(this.config.env?.TEST_MAX_OUTPUT_CHARS||12000);const commands=profile.commands;
    if(!commands.length){const result:TesterResult={status:'BLOCKED',projectProfile:profile,commands:[],progress:0,summary:'No safe test command was detected'};return this.result(result);}
    const results:TesterCommandResult[]=[];
    for(const command of commands){if(!safeCommand(command)){results.push({commandId:command.id,label:command.label,status:'blocked',exitCode:null,stdout:'',stderr:'Unsafe generated command rejected',durationMs:0});if(this.config.failFast!==false)break;continue;}
      const item=await this.runCommand(input,command,maxOutput);results.push(item);input.onProgress?.(`${command.label}: ${item.status}`,Math.round(results.length/commands.length*100));if(item.status!=='passed'&&this.config.failFast!==false)break;}
    const status=results.some(r=>r.status==='failed'||r.status==='timed_out')?'FAILED':results.some(r=>r.status==='blocked'||r.status==='cancelled')?'BLOCKED':'PASSED';const result:TesterResult={status,projectProfile:profile,commands:results,progress:Math.round(results.length/commands.length*100),summary:status==='PASSED'?'All detected commands passed':status==='FAILED'?'One or more test commands failed':'Testing was blocked'};return this.result(result);
  }
  private result(result:TesterResult):ProviderExecutionResult{return{output:JSON.stringify(result),stdout:JSON.stringify(result),stderr:'',progressEvents:[],structuredResult:result as unknown as Record<string,unknown>,rawProviderResponse:{kind:'local-command-tester',status:result.status},tokenUsage:0,estimatedCost:undefined};}
  private runCommand(input:TesterInput,command:TestCommand,maxOutput:number):Promise<TesterCommandResult>{const platform=this.config.platform||process.platform;const spawn=this.config.spawn||createCliSpawn(platform);const started=Date.now();return new Promise((resolve,reject)=>{let stdout='',stderr='',settled=false,timedOut=false;const timeout=this.config.timeoutMs||command.timeoutMs;let timer:ReturnType<typeof setTimeout>|undefined;let heartbeat:ReturnType<typeof setInterval>|undefined;let child:any;const finish=(result:TesterCommandResult)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);if(heartbeat)clearInterval(heartbeat);this.active.delete(input.task.id);resolve({...result,stdout:bounded(stdout,maxOutput),stderr:bounded(stderr,maxOutput),durationMs:Date.now()-started});};try{child=spawn(executable(command.executable,platform),command.args,{cwd:command.cwd,env:this.config.env||process.env,stdio:['pipe','pipe','pipe'],shell:false});this.active.set(input.task.id,child);heartbeat=setInterval(()=>{if(!settled)input.onHeartbeat?.();},Math.max(25,Math.min(1000,Math.floor(timeout/3))));child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();});child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();});child.on('error',(error:Error)=>{if((error as NodeJS.ErrnoException).code==='ENOENT')finish({commandId:command.id,label:command.label,status:'blocked',exitCode:null,stdout:'',stderr:'executable not found',durationMs:0});else reject(Object.assign(new Error(String(error)),{kind:'cli_invocation_error'}));});child.on('close',(code:number|null)=>{if(timedOut)finish({commandId:command.id,label:command.label,status:'timed_out',exitCode:code,stdout,stderr,durationMs:0});else finish({commandId:command.id,label:command.label,status:code===0?'passed':'failed',exitCode:code,stdout,stderr,durationMs:0});});timer=setTimeout(()=>{if(settled)return;timedOut=true;child.kill('SIGTERM');},timeout);input.signal?.addEventListener('abort',()=>{if(settled)return;child.kill('SIGTERM');finish({commandId:command.id,label:command.label,status:'cancelled',exitCode:null,stdout,stderr,durationMs:0});reject(Object.assign(new Error('Command tester cancelled'),{kind:'cancelled'}));},{once:true});child.stdin.end();}catch(error){reject(Object.assign(new Error(String(error)),{kind:'cli_invocation_error'}));}});}
}
export type {ProjectTestProfile,TestCommand} from './project-detector.js';
export {detectProjectProfile} from './project-detector.js';
