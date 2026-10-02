import type {AgentRole, ProviderAdapter, TaskStatus} from '@orchestrator/shared';
export const roleToStatus: Record<AgentRole, TaskStatus> = {analyst:'analyzing', planner:'planning', developer:'implementing', tester:'testing', reviewer:'reviewing'};
export class PipelineRunner {
  constructor(private readonly adapter: ProviderAdapter, private readonly hooks: {onStageStart:(role:AgentRole)=>void; onStageComplete:(role:AgentRole, output:string)=>void; onProgress:(role:AgentRole, message:string)=>void}) {}
  async run(description:string, pipeline:AgentRole[], signal?:AbortSignal) { const outputs:string[]=[]; for (const role of pipeline) { if(signal?.aborted) throw new Error('Execution cancelled'); this.hooks.onStageStart(role); const result=await this.adapter.execute({role,prompt:description,signal,onProgress:(m: string)=>this.hooks.onProgress(role,m)}); outputs.push(result.output); this.hooks.onStageComplete(role,result.output); } return outputs; }
}
