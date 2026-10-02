import {existsSync} from 'node:fs';
import type {AgentConfig,AgentRole,Workspace,WorkspaceType} from '@orchestrator/shared';

export interface ProviderEnvironment {reviewerProvider?:string;codexModel?:string;}
export interface TaskConfigSnapshot {pipeline:AgentRole[];agentConfigs:AgentConfig[];securityPolicy:unknown;gates:unknown;providerSelection:string;}

export function buildAgentConfigs(pipeline:AgentRole[],env:ProviderEnvironment=process.env):AgentConfig[]{return pipeline.map(role=>{const isCodexReviewer=role==='reviewer'&&env.reviewerProvider==='codex-cli';return{role,provider:isCodexReviewer?'codex-cli':'mock',model:isCodexReviewer?(env.codexModel||'configured'):'mock-fast',timeoutSeconds:120,maxRetries:2,maxIterations:3,budgetUsd:0,tokenBudget:0,fallbackProviders:[],enabled:true};});}
export function buildProviderSelection(configs:AgentConfig[]):string{return configs.map(config=>`${config.role}:${config.provider}/${config.model}`).join(',');}
export function createTaskConfigSnapshot(pipeline:AgentRole[],env:ProviderEnvironment,securityPolicy:unknown,gates:unknown):TaskConfigSnapshot{const agentConfigs=buildAgentConfigs(pipeline,env);return{pipeline,agentConfigs,securityPolicy,gates,providerSelection:buildProviderSelection(agentConfigs)};}
export function configForRole(snapshot:TaskConfigSnapshot,role:AgentRole):AgentConfig{return snapshot.agentConfigs.find(config=>config.role===role)||{role,provider:'mock',model:'mock-fast',timeoutSeconds:120,maxRetries:2,maxIterations:3,budgetUsd:0,tokenBudget:0,fallbackProviders:[],enabled:true};}
export function toWorkspaceContext(workspace:Workspace){return{id:workspace.id,type:workspace.type as WorkspaceType,location:workspace.location,branch:workspace.branch};}
export function validateWorkspaceLocation(workspace:Pick<Workspace,'type'|'location'>,pathExists:(path:string)=>boolean=existsSync){return workspace.type!=='local'||pathExists(workspace.location);}
