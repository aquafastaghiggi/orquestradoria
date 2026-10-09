import type {ExplicitAcceptanceCriterion} from '@orchestrator/shared';

export const ACCEPTANCE_EVIDENCE_TYPES=['browser_step','workspace_no_changes','command_qa_passed','browser_smoke_passed','browser_interactive_passed','browser_no_runtime_errors','browser_screenshot_generated'] as const;
export type AcceptanceEvidenceType=typeof ACCEPTANCE_EVIDENCE_TYPES[number];
export interface AcceptanceCoverageItem{criterionId:string;status:'PASSED'|'FAILED'|'UNCOVERED';evidence?:AcceptanceCoverageEvidence;message:string;}
export interface AcceptanceCoverageEvidence{type:AcceptanceEvidenceType;scenario?:string;step?:number;}
export interface AcceptanceCoverageResult{status:'PASSED'|'FAILED'|'NOT_REQUIRED';criteria:AcceptanceCoverageItem[];covered:number;total:number;summary:string;}
const ASSERTIONS=new Set(['expectVisible','expectHidden','expectText','expectValue','expectCount']);
const array=(value:unknown)=>Array.isArray(value)?value:[];
const validEvidence=(value:unknown):value is AcceptanceCoverageEvidence=>Boolean(value&&typeof value==='object'&&ACCEPTANCE_EVIDENCE_TYPES.includes((value as any).type));

export function verifyAcceptanceCoverage(input:{criteria:ExplicitAcceptanceCriterion[];coveragePlan?:unknown;workspaceChanges?:any;testerResult?:any}):AcceptanceCoverageResult{
  const criteria=input.criteria||[];
  if(!criteria.length)return{status:'NOT_REQUIRED',criteria:[],covered:0,total:0,summary:'0/0 acceptance criteria verified'};
  const plan=array(input.coveragePlan).filter(item=>item&&typeof item==='object') as any[];
  const scenarios=array(input.testerResult?.browserQa?.scenarios);
  const browser=input.testerResult?.browserQa;
  const result:AcceptanceCoverageItem[]=criteria.map(criterion=>{
    const proposal=plan.find(item=>item.criterionId===criterion.id);
    const evidences=array(proposal?.evidence);
    if(!evidences.length)return{criterionId:criterion.id,status:'UNCOVERED',message:'Nenhuma evidência factual foi registrada.'};
    for(const raw of evidences){
      if(!validEvidence(raw))continue;
      const evidence=raw as AcceptanceCoverageEvidence;
      if(evidence.type==='workspace_no_changes'&&array(input.workspaceChanges?.filesChanged).length===0)return{criterionId:criterion.id,status:'PASSED',evidence,message:'Nenhuma alteração de workspace detectada.'};
      if(evidence.type==='command_qa_passed'&&input.testerResult?.commandQa?.status==='PASSED')return{criterionId:criterion.id,status:'PASSED',evidence,message:'Command QA passou.'};
      if(evidence.type==='browser_smoke_passed'&&browser?.smokeStatus==='PASSED')return{criterionId:criterion.id,status:'PASSED',evidence,message:'Browser smoke QA passou.'};
      if(evidence.type==='browser_interactive_passed'&&browser?.interactiveStatus==='PASSED'&&scenarios.length>0)return{criterionId:criterion.id,status:'PASSED',evidence,message:'Browser interactive QA passou.'};
      if(evidence.type==='browser_no_runtime_errors'&&browser&&array(browser.pageErrors).length===0&&array(browser.consoleErrors).length===0&&array(browser.failedRequests).length===0&&array(browser.routes).every((route:any)=>Number(route.statusCode||200)<400))return{criterionId:criterion.id,status:'PASSED',evidence,message:'Nenhum erro de runtime foi registrado.'};
      if(evidence.type==='browser_screenshot_generated'&&((array(browser?.screenshots).length>0)||scenarios.some((scenario:any)=>array(scenario.screenshots).length>0)))return{criterionId:criterion.id,status:'PASSED',evidence,message:'Screenshot registrado no Browser QA.'};
      if(evidence.type==='browser_step'){
        if(!evidence.scenario||!Number.isInteger(evidence.step)||Number(evidence.step)<1)return{criterionId:criterion.id,status:'FAILED',evidence,message:'browser_step exige cenário e step 1-based.'};
        const scenario:any=scenarios.find((item:any)=>item.name===evidence.scenario);
        const step:any=scenario?.steps?.find((item:any)=>Number(item.index)===Number(evidence.step)-1||Number(item.index)===Number(evidence.step));
        if(!scenario||scenario.status!=='PASSED'||!step||step.status!=='PASSED'||!ASSERTIONS.has(String(step.action)))return{criterionId:criterion.id,status:'FAILED',evidence,message:'A evidência browser_step precisa apontar para um cenário, step e assertion aprovados.'};
        return{criterionId:criterion.id,status:'PASSED',evidence,message:`Assertion ${step.action} passou.`};
      }
    }
    return{criterionId:criterion.id,status:'FAILED',message:'A evidência proposta não foi confirmada pelos resultados reais.'};
  });
  const covered=result.filter(item=>item.status==='PASSED').length;
  return{status:covered===criteria.length?'PASSED':'FAILED',criteria:result,covered,total:criteria.length,summary:`${covered}/${criteria.length} acceptance criteria verified`};
}
