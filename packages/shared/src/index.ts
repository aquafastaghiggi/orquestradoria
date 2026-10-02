export type WorkspaceType = 'local' | 'git' | 'ssh';
export type WorkspaceStatus = 'active' | 'paused' | 'archived';
export type TaskStatus = 'pending'|'analyzing'|'planning'|'implementing'|'testing'|'reviewing'|'needs_fix'|'approved'|'human_review_required'|'cancelled'|'failed';
export type ExecutionStatus = 'queued'|'running'|'completed'|'failed'|'cancelled'|'timed_out';
export type AgentRole = 'analyst'|'planner'|'developer'|'tester'|'reviewer';
export interface Workspace {id:string; name:string; type:WorkspaceType; location:string; branch?:string; status:WorkspaceStatus; createdAt:string; updatedAt:string;}
export interface Task {id:string; workspaceId:string; title:string; description:string; pipeline:string[]; status:TaskStatus; createdAt:string; updatedAt:string;}
export interface Execution {id:string; taskId:string; role:AgentRole; provider:string; model:string; status:ExecutionStatus; startedAt?:string; finishedAt?:string; duration?:number; tokenUsage?:number; estimatedCost?:number; logs:string; error?:string;}
export interface DomainEvent {id:string; type:string; taskId?:string; executionId?:string; payload:string; createdAt:string;}
export interface ProviderAdapter {id:string; name:string; checkAvailability():Promise<boolean>; getModels():Promise<string[]>; execute(input:{role:AgentRole; prompt:string; signal?:AbortSignal; onProgress?:(message:string)=>void}):Promise<{output:string; tokenUsage:number}>; cancel(executionId:string):Promise<void>; getUsage():Promise<{tokenUsage:number; estimatedCost:number}>;}
export const DEFAULT_PIPELINE: AgentRole[] = ['planner','developer','tester','reviewer'];
export const TASK_STATUSES: TaskStatus[] = ['pending','analyzing','planning','implementing','testing','reviewing','needs_fix','approved','human_review_required','cancelled','failed'];
