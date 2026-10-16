import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import type {AgentRole,ExecutionContext,ProviderAdapter,ProviderCapabilities,ProviderExecutionResult} from '@orchestrator/shared';

/**
 * Developer de TESTE: aplica edições textuais fixas (arquivo, trecho, substituição) somente dentro do workspace da task
 * (o worktree isolado). Existe para provar, sem provider real e sem custo, que uma correção altera só o worktree. Nunca é
 * selecionado em produção: o servidor só o instala quando NODE_ENV=test e ORQ_TEST_FIXTURE_EDITS está definido.
 */
export interface FixtureEdit{file:string;find:string;replace:string}
const capabilities:ProviderCapabilities={streaming:false,cancel:true,usageReporting:false,modelSelection:false,toolUse:false,filesystemAccess:true,sessionResume:false,structuredOutput:true};

export class FixtureDeveloperAdapter implements ProviderAdapter{
  id='fixture-developer';name='Fixture Developer (test only)';capabilities=capabilities;
  constructor(private readonly edits:FixtureEdit[]){}
  async checkAvailability(){return true;}
  async getModels(){return['fixture'];}
  async cancel(){return;}
  async getUsage(){return{tokenUsage:0,estimatedCost:0};}
  async execute(input:ExecutionContext&{onProgress?:(message:string,percent?:number)=>void;onHeartbeat?:()=>void}):Promise<ProviderExecutionResult>{
    if((input.stage as AgentRole)!=='developer')throw Object.assign(new Error('Fixture Developer is restricted to the developer stage'),{kind:'validation_error'});
    const root=resolve(input.workspaceContext.location);
    const changed:string[]=[],notes:string[]=[];
    for(const edit of this.edits){
      const target=resolve(root,edit.file);
      if(!target.startsWith(root+sep))throw Object.assign(new Error(`Fixture edit escapes the workspace: ${edit.file}`),{kind:'validation_error'});
      if(!existsSync(target)){notes.push(`${edit.file}: arquivo não existe`);continue;}
      const before=readFileSync(target,'utf8');
      if(!before.includes(edit.find)){notes.push(`${edit.file}: trecho não encontrado (já aplicado?)`);continue;}
      writeFileSync(target,before.split(edit.find).join(edit.replace));
      changed.push(edit.file);input.onProgress?.(`Corrigido ${edit.file}`);input.onHeartbeat?.();
    }
    const summary=changed.length?`Correção aplicada em ${changed.join(', ')}.`:'Nenhuma edição aplicada.';
    const structuredResult={stage:'developer',status:'COMPLETED',summary,filesChanged:changed,testsRun:[],notes};
    return{output:summary,stdout:summary,stderr:'',progressEvents:[],structuredResult,rawProviderResponse:{fixture:true},tokenUsage:0,estimatedCost:0};
  }
}
