import type {AgentRole,Artifact,ContextManifest,ExecutionContext,ReviewBundle,ReviewScope,StageContext,Task} from '@orchestrator/shared';
import {buildProjectContextForRole, type ProjectContextSnapshotInput} from './project-context.js';

export interface ProjectContextSummary {language?:string;framework?:string;packageManager?:string;relevantPaths?:string[];testCommands?:string[];rules?:string[];}
export interface StageContextOptions {
  task:Task;
  role:AgentRole;
  workspaceContext:ExecutionContext['workspaceContext'];
  projectRules?:string[];
  projectSummary?:ProjectContextSummary;
  acceptanceCriteria?:string[];
  refinedRequest?:string;
  originalRequest?:string;
  artifacts?:Artifact[];
  changedFiles?:string[];
  diff?:string;
  tests?:string[];
  reviewIssues?:string[];
  reviewScope?:ReviewScope;
  reviewBundle?:ReviewBundle;
  maxChars?:number;
  projectContext?:ProjectContextSnapshotInput|Record<string,unknown>|null;
  projectContextMaxChars?:number;
}

const DEFAULT_LIMITS:Record<AgentRole,number>={analyst:8000,planner:10000,developer:16000,tester:12000,reviewer:30000};
const section=(name:string,value:string|undefined)=>value?.trim()?`\n${name}\n${value.trim()}`:'';
const list=(values:string[]|undefined)=>values?.filter(Boolean).map(value=>`- ${value}`).join('\n')||'';
const artifactText=(artifact:Artifact)=>artifact.content.trim();

function selectArtifacts(role:AgentRole,artifacts:Artifact[]):Artifact[]{
  const allowed:Record<AgentRole,Artifact['type'][]>= {
    analyst:['context_snapshot'],planner:['context_snapshot','plan'],developer:['plan','implementation_summary','review'],tester:['implementation_summary','diff','test_report'],reviewer:['diff','implementation_summary','test_report','review','plan']
  };
  return artifacts.filter(artifact=>allowed[role].includes(artifact.type));
}

function selectDiff(diff:string|undefined,changedFiles:string[],maxChars:number){
  if(!diff)return {text:'',truncated:false,omittedFiles:[] as string[],omittedChars:0};
  if(diff.length<=maxChars)return {text:diff,truncated:false,omittedFiles:[] as string[],omittedChars:0};
  const files=changedFiles.length?changedFiles:['workspace diff'];
  const text=`${diff.slice(0,Math.max(0,maxChars-180))}\n\n[Diff truncated by context budget. Included files: ${files.join(', ')}]`;
  return {text,truncated:true,omittedFiles:files.slice(1),omittedChars:diff.length-text.length};
}

export function buildStageContext(options:StageContextOptions):StageContext{
  const limit=options.maxChars||DEFAULT_LIMITS[options.role];
  const projectContext=buildProjectContextForRole(options.projectContext,options.role,options.projectContextMaxChars);
  const changedFiles=[...new Set(options.changedFiles||[])];
  const selected=selectArtifacts(options.role,options.artifacts||[]);
  const diffBudget=Math.floor(limit*.42);
  const selectedDiff=selectDiff(options.diff,changedFiles,diffBudget);
  const includedSections:string[]=[];const excludedSections=['raw provider response','audit logs','heartbeat/progress events','duplicate artifacts','full workspace state'];
  const parts:string[]=[];
  const add=(name:string,value:string|undefined)=>{if(value?.trim()){includedSections.push(name);parts.push(section(name,value));}};
  add('ROLE',`You are the ${options.role} stage.`);
  add('TASK',`Title: ${options.task.title}\nDescription: ${options.refinedRequest||options.task.description}`);
  if(options.originalRequest&&options.originalRequest!==options.refinedRequest)add('ORIGINAL REQUEST (compact)',options.originalRequest);
  add('ACCEPTANCE CRITERIA',list(options.acceptanceCriteria)||'Implement and verify the requested outcome.');
  add('CONSTRAINTS',list(options.projectRules||[]));
  if(projectContext)add('PROJECT CONTEXT',projectContext.text);
  if(options.projectSummary)add('PROJECT SUMMARY',[options.projectSummary.language&&`Language: ${options.projectSummary.language}`,options.projectSummary.framework&&`Framework: ${options.projectSummary.framework}`,options.projectSummary.packageManager&&`Package manager: ${options.projectSummary.packageManager}`,options.projectSummary.relevantPaths?.length&&`Relevant paths: ${options.projectSummary.relevantPaths.join(', ')}`,options.projectSummary.testCommands?.length&&`Test commands: ${options.projectSummary.testCommands.join(', ')}`].filter(Boolean).join('\n'));
  if(options.role==='planner'){
    add('PLANNING SCOPE',`Workspace: ${options.workspaceContext.location}`);
  } else if(options.role==='developer'){
    add('WORKSPACE',options.workspaceContext.location);
    add('PLAN',artifactText(selected.find(a=>a.type==='plan')||({content:''} as Artifact)));
    if(options.reviewIssues?.length)add('REVIEW ISSUES',`Corrija somente os problemas apontados pelo Reviewer.\nPreserve alterações corretas já realizadas.\nNão refaça toda a implementação sem necessidade.\nNão reverta mudanças não relacionadas aos issues.\nNão altere arquivos fora do escopo necessário.\n\n${options.reviewIssues.map((issue,index)=>`${index+1}. ${issue}`).join('\n')}`);
    add('RELEVANT FILES',list(changedFiles));
  } else if(options.role==='tester'){
    add('CHANGED FILES',list(changedFiles));add('IMPLEMENTATION SUMMARY',artifactText(selected.find(a=>a.type==='implementation_summary')||({content:''} as Artifact)));add('TEST COMMANDS',list(options.tests||options.projectSummary?.testCommands));
  } else if(options.role==='reviewer'){
    const scope=options.reviewScope;add('CURRENT TASK STATE',`Task changes under review: ${scope?.actualFilesChanged.join(', ')||changedFiles.join(', ')||'none'}\nThis review must assess the complete current task state, including prior fix cycles.`);add('TASK CHANGESET',scope?`Added: ${scope.filesAdded.join(', ')||'none'}\nModified: ${scope.filesModified.join(', ')||'none'}\nDeleted: ${scope.filesDeleted.join(', ')||'none'}\nActual files changed: ${scope.actualFilesChanged.join(', ')||'none'}`:list(changedFiles));add('PRE-EXISTING WORKSPACE CHANGES',scope?`${scope.preExistingFiles.length} files existed before this task. These files are outside the scope of this review unless the task changed them.`:'No baseline metadata supplied.');add('DIFF',scope?.relevantDiff||selectedDiff.text);add('IMPLEMENTATION SUMMARY',artifactText(selected.find(a=>a.type==='implementation_summary')||({content:''} as Artifact)));add('TEST RESULTS',list(options.tests));add('REVIEW RULES','Review only task-attributed changes.\nPre-existing changes are not part of this review.\nDo not fail because unrelated files are dirty or untracked.\nUse actualFilesChanged as the authoritative task scope.\nReturn NEEDS_FIX only for issues introduced by this task.');
  }
  const raw=parts.join('');let prompt=raw;let truncated=selectedDiff.truncated;let omittedChars=selectedDiff.omittedChars;const filesOmitted=[...selectedDiff.omittedFiles];
  if(prompt.length>limit){const kept=prompt.slice(0,Math.max(0,limit-160));prompt=`${kept}\n\n[Context truncated at ${limit} characters. Omitted lower-priority sections.]`;truncated=true;omittedChars=(omittedChars||0)+raw.length-prompt.length;}
  const manifest:ContextManifest={role:options.role,includedSections,excludedSections,filesIncluded:options.reviewBundle?.filesIncluded||changedFiles.slice(0,changedFiles.length-filesOmitted.length),filesOmitted:options.reviewBundle?.filesOmitted||filesOmitted,charCount:prompt.length,truncated,omittedChars:omittedChars||undefined};
  return {prompt,manifest,contextChars:prompt.length,contextSections:includedSections,contextTruncated:truncated,contextFilesIncluded:manifest.filesIncluded,contextFilesOmitted:filesOmitted,reviewBundle:options.reviewBundle,projectContext:projectContext||undefined};
}

export {DEFAULT_LIMITS};
