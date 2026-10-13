import React,{useCallback,useEffect,useState} from 'react';
import {usd} from './CostsPage';
import './costs.css';

type Notify=(message:string,tone?:'success'|'error'|'info')=>void;
type Budget={settings:{dailyUsd:number;monthlyUsd:number;defaultTaskUsd:number};status:{todayUsd:number;monthUsd:number;blocked:boolean;message:string|null}};
type Status={network:{bindHost:string;lanAllowed:boolean};db:{path:string;sizeBytes:number};backups:{dir:string;keep:number;count:number;latest:{file:string;sizeBytes:number;createdAt:string}|null;items:{file:string;sizeBytes:number;createdAt:string}[]};worktrees:{roots:string[];sizeBytes:number;orphans:{path:string;sizeBytes:number;reason:string}[];orphanBytes:number}};

const mb=(bytes:number)=>bytes>=1_073_741_824?`${(bytes/1_073_741_824).toFixed(2)} GB`:`${(bytes/1_048_576).toFixed(bytes<1_048_576?2:1)} MB`;
const when=(iso:string)=>new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
async function call(method:string,url:string,body?:unknown){const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'A solicitação falhou.');return d;}

export default function SystemPanel({notify}:{notify:Notify}){
  const[budget,setBudget]=useState<Budget|null>(null),[draft,setDraft]=useState({dailyUsd:'',monthlyUsd:'',defaultTaskUsd:''}),[status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState('');
  const load=useCallback(async()=>{
    try{const b:Budget=await call('GET','/api/settings/budget');setBudget(b);setDraft({dailyUsd:String(b.settings.dailyUsd),monthlyUsd:String(b.settings.monthlyUsd),defaultTaskUsd:String(b.settings.defaultTaskUsd)});}catch{setBudget(null);}
    try{setStatus(await call('GET','/api/maintenance/status'));}catch{setStatus(null);}
  },[]);
  useEffect(()=>{void load();},[load]);

  const saveBudget=async()=>{
    setBusy('budget');
    try{const b:Budget=await call('PUT','/api/settings/budget',{dailyUsd:draft.dailyUsd,monthlyUsd:draft.monthlyUsd,defaultTaskUsd:draft.defaultTaskUsd});setBudget(b);notify('Limites de gasto salvos.','success');}
    catch(error){notify(error instanceof Error?error.message:'Não foi possível salvar.','error');}
    finally{setBusy('');}
  };
  const backupNow=async()=>{setBusy('backup');try{await call('POST','/api/backups');notify('Backup criado.','success');await load();}catch(error){notify(error instanceof Error?error.message:'Falha no backup.','error');}finally{setBusy('');}};
  const cleanup=async()=>{
    if(!status?.worktrees.orphans.length)return;
    if(!window.confirm(`Remover ${status.worktrees.orphans.length} pasta(s) de trabalho órfã(s) (${mb(status.worktrees.orphanBytes)})?\n\nSó são removidas pastas sem task associada ou de tasks já aplicadas/descartadas. Tasks aguardando decisão ou com falha preservada nunca são tocadas.`))return;
    setBusy('cleanup');
    try{const r=await call('POST','/api/maintenance/cleanup-worktrees',{confirm:true});notify(`Limpeza concluída: ${r.removed} removida(s), ${mb(r.freedBytes)} liberados.`,'success');await load();}
    catch(error){notify(error instanceof Error?error.message:'Falha na limpeza.','error');}
    finally{setBusy('');}
  };
  const dirty=budget&&(draft.dailyUsd!==String(budget.settings.dailyUsd)||draft.monthlyUsd!==String(budget.settings.monthlyUsd)||draft.defaultTaskUsd!==String(budget.settings.defaultTaskUsd));
  const pct=(used:number,limit:number)=>limit>0?Math.min(100,Math.round(used/limit*100)):0;

  return <div className="content system-panel">
    <section className="panel cost-section">
      <div className="panel-title"><span>LIMITES DE GASTO</span></div>
      {!budget?<p className="muted">Carregando…</p>:<>
        {budget.status.blocked&&<div className="notice warning"><strong>Execuções pagas bloqueadas</strong><span>{budget.status.message}</span></div>}
        <div className="cost-form">
          <label>Limite diário (US$)<input type="number" min={0} step="0.1" value={draft.dailyUsd} onChange={event=>setDraft({...draft,dailyUsd:event.target.value})}/></label>
          <label>Limite mensal (US$)<input type="number" min={0} step="1" value={draft.monthlyUsd} onChange={event=>setDraft({...draft,monthlyUsd:event.target.value})}/></label>
          <label>Limite padrão por task (US$)<input type="number" min={0} step="0.05" value={draft.defaultTaskUsd} onChange={event=>setDraft({...draft,defaultTaskUsd:event.target.value})}/></label>
        </div>
        <p className="muted">0 = sem limite. O limite diário e o mensal bloqueiam qualquer etapa paga (Developer, Reviewer, Planner de missão, Refinador) quando atingidos. O limite por task vale quando a task é criada sem limite próprio e usa provider pago.</p>
        <div className="cost-result">
          <div><small>Hoje</small><strong>{usd(budget.status.todayUsd)}</strong>{budget.settings.dailyUsd>0&&<small>{pct(budget.status.todayUsd,budget.settings.dailyUsd)}% de {usd(budget.settings.dailyUsd)}</small>}</div>
          <div><small>Este mês</small><strong>{usd(budget.status.monthUsd)}</strong>{budget.settings.monthlyUsd>0&&<small>{pct(budget.status.monthUsd,budget.settings.monthlyUsd)}% de {usd(budget.settings.monthlyUsd)}</small>}</div>
        </div>
        <button className="primary" disabled={!dirty||busy==='budget'} onClick={saveBudget}>{busy==='budget'?'Salvando…':'Salvar limites'}</button>
      </>}
    </section>

    <section className="panel cost-section">
      <div className="panel-title"><span>BACKUP DO BANCO</span><button className="secondary" disabled={busy==='backup'} onClick={backupNow}>{busy==='backup'?'Criando…':'Fazer backup agora'}</button></div>
      {!status?<p className="muted">Carregando…</p>:<>
        <p className="muted">Backup automático diário (mantém os últimos {status.backups.keep}). Banco atual: {mb(status.db.sizeBytes)}. Pasta: <code>{status.backups.dir}</code></p>
        {status.backups.count===0?<div className="notice warning">Nenhum backup ainda. O primeiro é criado automaticamente poucos segundos após a API iniciar.</div>
          :<table className="cost-table"><thead><tr><th>Arquivo</th><th>Quando</th><th>Tamanho</th></tr></thead><tbody>{status.backups.items.map(item=><tr key={item.file}><td><code>{item.file}</code></td><td>{when(item.createdAt)}</td><td>{mb(item.sizeBytes)}</td></tr>)}</tbody></table>}
        <p className="muted">Para restaurar: pare a API e substitua o arquivo do banco por uma cópia.</p></>}
    </section>

    <section className="panel cost-section">
      <div className="panel-title"><span>DISCO E LIMPEZA</span><button className="secondary" disabled={!status?.worktrees.orphans.length||busy==='cleanup'} onClick={cleanup}>{busy==='cleanup'?'Limpando…':`Limpar órfãs${status?.worktrees.orphans.length?` (${mb(status.worktrees.orphanBytes)})`:''}`}</button></div>
      {!status?<p className="muted">Carregando…</p>:<>
        <p className="muted">Pastas de trabalho das tasks (worktrees): {mb(status.worktrees.sizeBytes)} em {status.worktrees.roots.map(root=><code key={root}> {root}</code>)}.</p>
        <p>{status.worktrees.orphans.length?<>{status.worktrees.orphans.length} pasta(s) órfã(s) podem ser removidas com segurança.</>:'Nada para limpar.'}</p></>}
    </section>

    <section className="panel cost-section">
      <div className="panel-title"><span>REDE</span></div>
      {!status?<p className="muted">Carregando…</p>:status.network.lanAllowed
        ?<div className="notice warning"><strong>API acessível na rede ({status.network.bindHost})</strong><span>A API não tem autenticação. Remova ORQ_ALLOW_LAN=1 para voltar ao modo seguro.</span></div>
        :<div className="notice success"><strong>Somente local</strong><span>A API escuta apenas em {status.network.bindHost} e recusa outros hosts e origens. Outras máquinas da rede não conseguem usá-la.</span></div>}
    </section>
  </div>;
}
