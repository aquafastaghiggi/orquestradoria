import React,{useEffect,useState} from 'react';
import './mode-banner.css';

type Entry={key:string;label:string;provider:string;model:string;costly:boolean};
type Mode={mode:'mock'|'real';forced:boolean;costly:Entry[];summary:string};

/** Faixa sempre visível: deixa claro se a próxima execução gasta créditos (REAL) ou não (MOCK). */
export default function ModeBanner({workspaceId}:{workspaceId?:string}){
  const[mode,setMode]=useState<Mode|null>(null);
  useEffect(()=>{
    let alive=true;
    const load=()=>fetch(`/api/mode${workspaceId?`?workspaceId=${workspaceId}`:''}`).then(r=>r.json()).then(data=>{if(alive)setMode(data);}).catch(()=>{if(alive)setMode(null);});
    void load();
    const timer=setInterval(load,10000);
    return()=>{alive=false;clearInterval(timer);};
  },[workspaceId]);
  if(!mode)return null;
  const real=mode.mode==='real';
  return <span className={`mode-banner ${real?'real':'mock'}`} title={real?`Consome créditos: ${mode.summary}`:mode.forced?'Modo mock forçado (ORQ_FORCE_MOCK=1): nada é enviado a providers pagos.':'Nenhum provider pago está configurado.'} role="status">
    <b>{real?'REAL':'MOCK'}</b>
    <span>{real?`consome créditos · ${mode.costly.map(entry=>entry.label).join(', ')}`:mode.forced?'sem custo (forçado)':'sem custo'}</span>
  </span>;
}
