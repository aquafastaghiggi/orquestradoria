import React,{useEffect,useMemo,useState} from 'react';
import './history.css';

type Stage={role:string;status:string};
type Item={kind:'task'|'mission';id:string;title:string;request:string;status:string;phase:{group:Group;label:string};createdAt:string;updatedAt:string;durationMs:number;tokens:number;costUsd:number;filesChanged:number;adjustments:number;fixCycles:number;stages:Stage[];baseBranch:string|null;progress?:{done:number;total:number}};
type Group='running'|'waiting'|'attention'|'queued'|'done';
type Props={workspaceId:string;refreshKey:string;onOpenTask:(id:string)=>void;onNew:()=>void};

const COLUMNS:{group:Group;title:string;hint:string}[]=[
  {group:'queued',title:'Na fila',hint:'Criadas, ainda não iniciadas'},
  {group:'running',title:'Em execução',hint:'O funcionário está trabalhando'},
  {group:'waiting',title:'Aguardando você',hint:'Revise, peça ajuste ou aplique'},
  {group:'attention',title:'Precisa de atenção',hint:'Falhou, parou ou foi cancelada'},
  {group:'done',title:'Finalizadas',hint:'Aplicadas ou descartadas'},
];
const STAGE_LABEL:Record<string,string>={planner:'Plan',analyst:'Anal',developer:'Dev',tester:'Test',reviewer:'Rev'};

export const formatDuration=(ms:number)=>{if(!ms)return '—';const s=Math.round(ms/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);return m<60?`${m}min ${s%60}s`:`${Math.floor(m/60)}h ${m%60}min`;};
const formatDate=(iso:string)=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});};
const stageTone=(status:string)=>status==='completed'?'ok':status==='running'?'run':['failed','stalled','timed_out','cancelled'].includes(status)?'bad':'idle';

function Card({item,onOpenTask}:{item:Item;onOpenTask:(id:string)=>void}){
  const open=item.kind==='task'?()=>onOpenTask(item.id):undefined;
  return <article className={`history-card ${item.phase.group}${open?' clickable':''}`} onClick={open} role={open?'button':undefined} tabIndex={open?0:undefined} onKeyDown={event=>{if(open&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open();}}}>
    <header><span className="history-kind">{item.kind==='mission'?'Missão':'Task'}</span><span className="history-phase">{item.phase.label}</span></header>
    <h4 title={item.request}>{item.title}</h4>
    {item.kind==='task'&&item.stages.length>0&&<div className="history-stages" aria-label="Etapas do pipeline">{item.stages.map(stage=><span key={stage.role} className={`stage ${stageTone(stage.status)}`} title={`${stage.role}: ${stage.status}`}>{STAGE_LABEL[stage.role]||stage.role}</span>)}</div>}
    {item.progress&&<div className="history-progress"><div style={{width:`${item.progress.total?Math.round(item.progress.done/item.progress.total*100):0}%`}}/><small>{item.progress.done}/{item.progress.total} etapas</small></div>}
    <footer>
      <span title="Última atualização">{formatDate(item.updatedAt)}</span>
      <span title="Tempo de execução">⏱ {formatDuration(item.durationMs)}</span>
      <span title="Tokens">{item.tokens.toLocaleString('pt-BR')} tok</span>
      <span title="Custo estimado">US$ {item.costUsd.toFixed(2)}</span>
      <span title="Arquivos alterados">{item.filesChanged} arq.</span>
      {item.adjustments>0&&<span title="Ajustes solicitados">↻ {item.adjustments}</span>}
      {item.baseBranch&&<span title="Branch base">{item.baseBranch}</span>}
    </footer>
  </article>;
}

export default function WorkspaceHistory({workspaceId,refreshKey,onOpenTask,onNew}:Props){
  const[items,setItems]=useState<Item[]|null>(null),[error,setError]=useState(''),[showDone,setShowDone]=useState(false);
  useEffect(()=>{
    let alive=true;
    const load=()=>fetch(`/api/workspaces/${workspaceId}/history`).then(r=>r.ok?r.json():Promise.reject(new Error('Falha ao carregar o histórico.'))).then(data=>{if(alive){setItems(data);setError('');}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Falha ao carregar o histórico.');});
    void load();
    const timer=setInterval(load,5000);
    return()=>{alive=false;clearInterval(timer);};
  },[workspaceId,refreshKey]);
  const byGroup=useMemo(()=>{const map=new Map<Group,Item[]>();for(const item of items||[])map.set(item.phase.group,[...(map.get(item.phase.group)||[]),item]);return map;},[items]);
  if(error&&!items)return <div className="notice warning">{error}</div>;
  if(!items)return <div className="panel-empty compact">Carregando histórico…</div>;
  if(!items.length)return <div className="empty compact"><strong>Nenhuma task neste workspace</strong><span>Crie sua primeira task para começar.</span><button className="secondary" onClick={onNew}>Criar task</button></div>;
  const columns=COLUMNS.filter(column=>column.group!=='done'||showDone);
  const doneCount=byGroup.get('done')?.length||0;
  return <section className="history-board">
    <div className="section-head"><div><p className="eyebrow">STATUS E HISTÓRICO</p><h3>Quadro de trabalho <small>{items.length.toString().padStart(2,'0')}</small></h3></div>
      <button className="text-button" onClick={()=>setShowDone(value=>!value)}>{showDone?'Ocultar finalizadas':`Mostrar finalizadas (${doneCount})`}</button></div>
    <div className="history-columns">
      {columns.map(column=>{const list=byGroup.get(column.group)||[];return <div key={column.group} className={`history-column ${column.group}`}>
        <div className="history-column-head"><strong>{column.title}</strong><span>{list.length}</span></div>
        <small>{column.hint}</small>
        {list.length?list.map(item=><Card key={`${item.kind}-${item.id}`} item={item} onOpenTask={onOpenTask}/>):<div className="history-empty">Nada aqui</div>}
      </div>;})}
    </div>
  </section>;
}
