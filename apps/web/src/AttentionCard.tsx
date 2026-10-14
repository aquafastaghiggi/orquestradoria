import React from 'react';
import {canAdjustTask,prefillAdjust} from './TaskPreviewCard';
import {explainFailure} from './MissionProgress';

const TITLES:Record<string,string>={
  needs_input:'Preciso de você',
  no_progress:'A IA não conseguiu avançar',
  repeated_issue:'O mesmo problema se repetiu',
  approval_invalid:'Aprovação invalidada'
};
const NEXT:Record<string,string>={
  needs_input:'Responda abaixo e a task volta ao Developer com a sua resposta.',
  no_progress:'Explique o que fazer de diferente (ou o que está faltando) e a task volta ao Developer.',
  repeated_issue:'Descreva como você quer resolver esse ponto, ou remova o requisito, e a task volta ao Developer.',
  approval_invalid:'Complemente o pedido com o que faltou e a task volta ao Developer.'
};

/** Rascunho com as perguntas do Developer prontas para você responder (vai para o campo "Solicitar ajuste"). */
export const buildAnswerDraft=(questions:string[],kind?:string)=>questions.length
  ?`Respostas às perguntas do Developer:\n${questions.map((question,index)=>`${index+1}. ${question}\nResposta: `).join('\n')}\n\nComplemente aqui o que mais precisa mudar:\n`
  :`Complemento para destravar a task${kind?` (${TITLES[kind]||kind})`:''}:\n(explique o que faltou ou o que deve ser feito diferente)\n`;

/** Por que a task parou e o que fazer. Vem da parada inteligente do ciclo de correção ou da explicação do último erro. */
export default function AttentionCard({task}:{task:any}){
  const attention=task.attention as {kind:string;reason:string;questions:string[];details?:{denials?:Array<{tool:string;command:string}>}}|null|undefined;
  const failedExecution=[...(task.executions||[])].reverse().find((execution:any)=>execution.status==='failed');
  const failure=!attention&&task.status==='failed'?explainFailure(failedExecution?.error,failedExecution?.role):null;
  if(!attention&&!failure)return null;
  const envStatus=task.environment?.environmentStatus||task.status;
  const canAnswer=canAdjustTask(task,envStatus,Boolean(attention));
  const title=attention?(TITLES[attention.kind]||'A task precisa de você'):'A task falhou';
  const denials=attention?.details?.denials||[];
  return <section className="notice warning attention-card">
    <strong>{title}</strong>
    <span>{attention?attention.reason:failure!.reason}</span>
    {attention?.questions?.length?<ol className="attention-questions">{attention.questions.map((question,index)=><li key={index}>{question}</li>)}</ol>:null}
    {denials.length>0&&<details><summary>Comandos que a política recusou ({denials.length})</summary>{denials.map((denial,index)=><code key={index} className="mono">{denial.tool}: {denial.command}</code>)}</details>}
    <span><strong>O que fazer:</strong> {attention?(NEXT[attention.kind]||'Complemente o pedido e envie.'):failure!.action}</span>
    {attention&&canAnswer&&<button className="primary" onClick={()=>prefillAdjust(buildAnswerDraft(attention.questions||[],attention.kind))}>{attention.questions?.length?'Responder e continuar':'Complementar e continuar'}</button>}
  </section>;
}
