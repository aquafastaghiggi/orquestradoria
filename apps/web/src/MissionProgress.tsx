import React,{useEffect,useState} from 'react';

const STAGES:Array<{key:string;label:string}>=[{key:'developer',label:'Developer'},{key:'tester',label:'Tester'},{key:'reviewer',label:'Reviewer'}];
const seconds=(from?:string|null,to:number=Date.now())=>{const t=from?Date.parse(from):NaN;return Number.isFinite(t)?Math.max(0,Math.round((to-t)/1000)):null;};
const clock=(s:number)=>s>=60?`${Math.floor(s/60)}min ${String(s%60).padStart(2,'0')}s`:`${s}s`;

/** Explica em português o motivo de uma falha e o que fazer. O texto original continua visível em "detalhe técnico". */
export function explainFailure(error?:string|null,role?:string):{reason:string;action:string}|null{
  const text=String(error||'');
  if(!text)return null;
  const timeout=text.match(/timed out after (\d+)\s*ms/i);
  if(timeout){const s=Math.round(Number(timeout[1])/1000);return{reason:`A IA passou do tempo limite (${clock(s)}) nesta etapa e foi interrompida. Isso costuma significar que a etapa é grande demais para uma única execução, ou que o modelo ficou lento.`,action:'Retomar a missão tenta a etapa de novo. Se repetir, descarte e peça etapas menores, ou aumente CLAUDE_TIMEOUT_MS no iniciar-real.cmd.'};}
  if(/not valid JSON|structured output/i.test(text))return{reason:'O Claude terminou, mas a resposta final não veio no formato esperado, então o sistema não conseguiu ler o resultado.',action:'Retomar a missão costuma resolver. As alterações feitas ficam preservadas no ambiente.'};
  if(/stall|heartbeat/i.test(text))return{reason:'O processo da IA parou de dar sinal de vida e foi considerado travado.',action:'Retomar a missão inicia uma nova tentativa a partir desta etapa.'};
  if(/budget|spend|limite|limit/i.test(text))return{reason:'Um limite de gasto ou de tokens foi atingido antes de a etapa terminar.',action:'Confira os limites em Sistema > Limites de gasto antes de retomar.'};
  if(/ENOENT|not found|não encontrado|not recognized/i.test(text))return{reason:`Não foi possível iniciar a ferramenta de linha de comando${role?` do ${role}`:''}. Ela pode não estar instalada ou não estar no PATH.`,action:'Confira o painel de saúde dos providers.'};
  return null;
}

/** Quebra a mensagem em motivo + ação + detalhe técnico (o texto cru fica à mão). */
export function FailureExplanation({error,role}:{error?:string|null;role?:string}){
  if(!error)return null;
  const info=explainFailure(error,role);
  return <>
    {info&&<><span><strong>Motivo:</strong> {info.reason}</span><span><strong>O que fazer:</strong> {info.action}</span></>}
    <span className="muted">{info?'Detalhe técnico':'Erro'}: {String(error).slice(0,500)}</span>
  </>;
}

/** Etapas do pipeline da task atual + tempo decorrido + há quanto tempo a IA deu sinal de vida. */
export function StageProgress({current,stageNames,completed,total}:{current:any;stageNames:Record<string,string>;completed:number;total:number}){
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setTick(Date.now()),1000);return()=>window.clearInterval(id);},[]);
  const execution=current?.execution;
  const active=String(current?.childTask?.currentStage||execution?.role||'');
  const activeIndex=STAGES.findIndex(s=>s.key===active);
  const running=execution?.status==='running';
  const elapsed=running?seconds(execution.startedAt,tick):null;
  const silent=running?seconds(execution.lastHeartbeatAt,tick):null;
  return <div className="stage-progress">
    <div className="stage-progress-head"><strong>Etapa {Math.min(completed+1,total)} de {total}</strong>{elapsed!==null&&<span>nesta execução há {clock(elapsed)}</span>}</div>
    <ol className="stage-steps">{STAGES.map((s,i)=><li key={s.key} className={i<activeIndex?'done':i===activeIndex?'active':''}>{i<activeIndex?'✓':i===activeIndex?'→':'○'} {stageNames[s.key]||s.label}</li>)}</ol>
    {running&&<small className="muted">{execution.progressMessage||'Executando…'}{silent!==null&&silent>=15?` · sem sinal da IA há ${clock(silent)} (normal em tarefas grandes, o limite total é por etapa)`:''}</small>}
  </div>;
}
