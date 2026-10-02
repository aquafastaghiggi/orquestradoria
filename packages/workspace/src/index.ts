import type {WorkspaceType} from '@orchestrator/shared';
export interface WorkspacePolicy {denyGitPush:boolean; denyDeploy:boolean; denyDestructiveCommands:boolean; denySecrets:boolean; timeoutMs:number; maxIterations:number; requireHumanApproval:boolean;}
export const defaultPolicy: WorkspacePolicy = {denyGitPush:true,denyDeploy:true,denyDestructiveCommands:true,denySecrets:true,timeoutMs:120000,maxIterations:3,requireHumanApproval:false};
export const isSupportedWorkspaceType = (type:string): type is WorkspaceType => ['local','git','ssh'].includes(type);
