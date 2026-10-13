import React,{useEffect,useState} from 'react';
import {usd} from './CostsPage';

type RoleLine={role:string;free:boolean;provider:string;model:string;unknown?:boolean;displayName?:string;expectedUsd?:number};
type Estimate={expensive?:boolean;defaultTaskCapUsd?:number;anyPaid:boolean;forcedMock:boolean;roles:RoleLine[];expectedUsd:number;lowUsd:number;highUsd:number;suggestedBudgetUsd:number;basis:string;incomplete:boolean;warnings:string[];steps:number};
const ROLE:Record<string,string>={developer:'Developer',reviewer:'Reviewer'};

/** Mostra quanto o trabalho deve custar com a configuração real do workspace e sugere um teto de orçamento. */
export default function CostHint({workspaceId,steps=1,onUseBudget,currentBudget}:{workspaceId:string;steps?:number;onUseBudget?:(usd:number)=>void;currentBudget?:number}){
  const[size,setSize]=useState<'small'|'medium'|'large'>('medium'),[data,setData]=useState<Estimate|null>(null);
  useEffect(()=>{let alive=true;void fetch(`/api/costs/workspace-estimate?workspaceId=${workspaceId}&size=${size}&steps=${steps}`).then(r=>r.json()).then(d=>{if(alive)setData(d);}).catch(()=>{if(alive)setData(null);});return()=>{alive=false;};},[workspaceId,size,steps]);
  if(!data)return null;
  return <div className="cost-hint" role="group" aria-label="Estimativa de custo">
    <div className="cost-hint-head"><strong>Custo estimado</strong>
      <select value={size} onChange={event=>setSize(event.target.value as 'small'|'medium'|'large')} aria-label="Tamanho do trabalho"><option value="small">pequeno</option><option value="medium">médio</option><option value="large">grande</option></select></div>
    {!data.anyPaid
      ?<p className="muted">Nenhum provider pago configurado neste workspace: <b>US$ 0,00</b>.</p>
      :<>
        <p className="cost-hint-value"><b>{usd(data.expectedUsd)}</b> <small>(faixa {usd(data.lowUsd)} – {usd(data.highUsd)}{steps>1?` · ${steps} etapas`:''})</small></p>
        <ul>{data.roles.filter(item=>!item.free&&!item.unknown).map(item=><li key={item.role}>{ROLE[item.role]}: {item.displayName} — {usd(item.expectedUsd)}</li>)}</ul>
        {data.expensive&&<p className="cost-expensive"><b>Atenção: configuração cara.</b> Esta estimativa passa de US$ 0,25. Veja a página Custos para um modelo mais econômico.</p>}
        {!!data.defaultTaskCapUsd&&<p className="muted">Se você não definir um limite, a task usa o padrão de {usd(data.defaultTaskCapUsd)} (ajustável em Configurações).</p>}
        {data.forcedMock&&<p className="muted"><b>Modo MOCK ativo:</b> agora nada será cobrado. O valor acima vale se você rodar em modo REAL.</p>}
        {data.basis==='default'&&<p className="muted">Baseado em perfil padrão; fica mais preciso conforme execuções reais são registradas.</p>}
        {data.incomplete&&<p className="muted warn-text">Algum modelo sem preço conhecido ficou fora da estimativa.</p>}
        {data.warnings.map((warning,index)=><p key={index} className="muted warn-text">• {warning}</p>)}
        {onUseBudget&&data.suggestedBudgetUsd>0&&<button type="button" className="secondary" disabled={currentBudget===data.suggestedBudgetUsd} onClick={()=>onUseBudget(data.suggestedBudgetUsd)}>{currentBudget===data.suggestedBudgetUsd?`Limite de ${usd(data.suggestedBudgetUsd)} aplicado`:`Usar ${usd(data.suggestedBudgetUsd)} como limite`}</button>}
      </>}
  </div>;
}
