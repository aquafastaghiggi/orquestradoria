export type WorkspaceType = 'local' | 'git' | 'ssh';
export type WorkspaceStatus = 'active' | 'paused' | 'archived';
export type TaskStatus = 'pending'|'analyzing'|'planning'|'implementing'|'testing'|'reviewing'|'needs_fix'|'approved'|'human_review_required'|'cancelled'|'failed'|'stalled';
export type ExecutionStatus = 'queued'|'running'|'completed'|'failed'|'cancelled'|'timed_out'|'stalled';
export type AgentRole = 'analyst'|'planner'|'developer'|'tester'|'reviewer';
export type FailureKind = 'provider_error'|'timeout'|'validation_error'|'review_rejected'|'cancelled'|'budget_exceeded';
export type ArtifactType = 'plan'|'implementation_summary'|'diff'|'review'|'test_report'|'log'|'generated_file'|'context_snapshot';
export interface Workspace {id:string; name:string; type:WorkspaceType; location:string; branch?:string; status:WorkspaceStatus; taskBudgetUsd:number; monthlyBudgetUsd:number; createdAt:string; updatedAt:string;}
export interface AgentConfig {role:AgentRole; provider:string; model:string; timeoutSeconds:number; maxRetries:number; maxIterations:number; budgetUsd:number; tokenBudget:number; fallbackProviders:string[]; enabled:boolean;}
export interface SecurityPolicy {denyGitPush:boolean; denyDeploy:boolean; denyDestructiveCommands:boolean; denySecrets:boolean; timeoutMs:number; maxIterations:number; requireHumanApproval:boolean;}
export interface HumanApprovalGates {beforeImplementation:boolean; beforeCommit:boolean; beforeMerge:boolean; beforeDeploy:boolean; beforeDatabaseChange:boolean;}
export interface Task {id:string; workspaceId:string; title:string; description:string; pipeline:AgentRole[]; status:TaskStatus; currentStage?:AgentRole; lastSuccessfulStage?:AgentRole; resumable:boolean; taskBudgetUsd:number; tokenBudget:number; configSnapshot:string; createdAt:string; updatedAt:string;}
export interface ProviderCapabilities {streaming:boolean; cancel:boolean; usageReporting:boolean; modelSelection:boolean; toolUse:boolean; filesystemAccess:boolean; sessionResume:boolean; structuredOutput:boolean;}
export interface ExecutionContext {task:Task; workspaceContext:{id:string;type:WorkspaceType;location:string;branch?:string}; projectRules:string[]; stage:AgentRole; previousArtifacts:Artifact[]; constraints:{timeoutSeconds:number;tokenBudget:number;budgetUsd:number}; expectedOutputSchema?:Record<string,unknown>;}
export interface Execution {id:string; taskId:string; role:AgentRole; provider:string; model:string; status:ExecutionStatus; startedAt?:string; finishedAt?:string; duration?:number; tokenUsage?:number; estimatedCost?:number; logs:string; error?:string; lastHeartbeatAt?:string; progressMessage?:string; progressPercent?:number;}
export interface Artifact {id:string; taskId:string; executionId?:string; type:ArtifactType; name:string; content:string; createdAt:string;}
export interface AuditEntry {id:string; actor:string; action:string; taskId?:string; executionId?:string; provider?:string; model?:string; timestamp:string; metadata:string;}
export interface DomainEvent {id:string; type:string; taskId?:string; executionId?:string; payload:string; createdAt:string;}
export interface ProviderAdapter {id:string; name:string; capabilities:ProviderCapabilities; checkAvailability():Promise<boolean>; getModels():Promise<string[]>; execute(input:ExecutionContext & {signal?:AbortSignal; onProgress?:(message:string,percent?:number)=>void; onHeartbeat?:()=>void}):Promise<{output:string; tokenUsage:number; estimatedCost?:number}>; cancel(executionId:string):Promise<void>; getUsage():Promise<{tokenUsage:number; estimatedCost:number}>;}
export const DEFAULT_PIPELINE: AgentRole[] = ['planner','developer','tester','reviewer'];
export const DEFAULT_POLICY: SecurityPolicy = {denyGitPush:true,denyDeploy:true,denyDestructiveCommands:true,denySecrets:true,timeoutMs:120000,maxIterations:3,requireHumanApproval:false};
export const DEFAULT_GATES: HumanApprovalGates = {beforeImplementation:false,beforeCommit:false,beforeMerge:false,beforeDeploy:true,beforeDatabaseChange:true};
export const TASK_STATUSES: TaskStatus[] = ['pending','analyzing','planning','implementing','testing','reviewing','needs_fix','approved','human_review_required','cancelled','failed','stalled'];
