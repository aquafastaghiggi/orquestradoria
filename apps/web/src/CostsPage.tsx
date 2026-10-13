import React,{useCallback,useEffect,useMemo,useState} from 'react';
import './costs.css';

type Notify=(message:string,tone?:'success'|'error'|'info')=>void;
type Workspace={id:string;name:string};
type Price={id:string;vendor:'anthropic'|'openai'|'cursor';displayName:string;tier:'economy'|'balanced'|'premium';status:'current'|'legacy';input:number;cacheWrite1h?:number;cacheRead?:number;output:number;executable:boolean;verified?:boolean;note?:string};
type Pricing={asOf:string;sources:{vendor:string;label:string;url:string}[];models:Price[];cursorPlans:{name:string;usdPerMonth:number|null;note:string}[]};
type Row={provider:string;modelId:string;displayName:string;tier:string;executable:boolean;verified:boolean;expectedUsd:number;lowUsd:number;highUsd:number;longContextRisk:boolean;savingsVsCurrentPct:number|null;isCurrent:boolean;isCheapest:boolean;usableForRole?:boolean;note?:string};
type Estimate={free:boolean;estimate:{expectedUsd:number;lowUsd:number;highUsd:number;longContextRisk:boolean};basis?:{kind:string;samples:number};comparison:Row[];cheapestUsable:{provider:string;modelId:string;displayName:string;expectedUsd:number}|null;warnings:string[];model?:{displayName:string}};
type RoleRec={role:string;status:'free'|'paid';message?:string;current:any;cheapest?:{provider:string;model:string;displayName:string;expectedUsd:number;verified:boolean}|null;alreadyCheapest?:boolean;savingsPct?:number|null;usable:string[]};
type Summary={days:number;totalUsd:number;executions:number;unknownCostExecutions:number;mismatchExecutions:number;byModel:{model:string;provider:string;usd:number;executions:number;tokens:number}[];byRole:{role:string;usd:number;executions:number}[];byDay:{day:string;usd:number}[];expensive:{taskId:string;title:string;usd:number}[]};

export const usd=(value:number|null|undefined)=>{
  if(value===null||value===undefined||Number.isNaN(value))return 'N/D';
  if(value===0)return 'US$ 0,00';
  const digits=value<0.01?4:value<1?3:2;
  return 'US$ '+value.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
};
const ROLE_LABEL:Record<string,string>={planner:'Planner',developer:'Developer',reviewer:'Reviewer'};
const PROVIDER_LABEL:Record<string,string>={'claude-code':'Claude Code','codex-cli':'Codex CLI',cursor:'Cursor'};
const VENDOR_OF:Record<string,string>={'claude-code':'anthropic','codex-cli':'openai',cursor:'cursor'};
const TIER_LABEL:Record<string,string>={economy:'econômico',balanced:'equilibrado',premium:'premium'};

async function getJson(url:string){const r=await fetch(url);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Falha ao carregar.');return d;}
async function send(method:string,url:string,body?:unknown){const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'A solicitação falhou.');return d;}

export default function CostsPage({workspaces,notify}:{workspaces:Workspace[];notify:Notify}){
  const[pricing,setPricing]=useState<Pricing|null>(null);
  useEffect(()=>{void getJson('/api/pricing').then(setPricing).catch(()=>setPricing(null));},[]);
  return <div className="content costs-page">
    <div className="dashboard-title"><div><p className="eyebrow">CUSTOS</p><h2>Custos e modelos</h2>
      <p>Simule, compare e acompanhe o gasto. {pricing&&<>Preços oficiais conferidos em <b>{pricing.asOf}</b>.</>}</p></div></div>
    <Recommendation workspaces={workspaces} notify={notify}/>
    <Simulator pricing={pricing}/>
    <RealSpend workspaces={workspaces}/>
    {pricing&&<PriceTable pricing={pricing}/>}
  </div>;
}

// ───────── Recomendação econômica ─────────
function Recommendation({workspaces,notify}:{workspaces:Workspace[];notify:Notify}){
  const[scope,setScope]=useState('global'),[data,setData]=useState<{roles:RoleRec[];note:string}|null>(null),[busy,setBusy]=useState(false);
  const load=useCallback(()=>getJson(`/api/costs/recommendation${scope!=='global'?`?workspaceId=${scope}`:''}`).then(setData).catch(()=>setData(null)),[scope]);
  useEffect(()=>{void load();},[load]);
  const changes=(data?.roles||[]).filter(role=>role.status==='paid'&&role.cheapest&&!role.alreadyCheapest);
  const apply=async()=>{
    if(!data||!changes.length)return;
    const summary=changes.map(role=>`• ${ROLE_LABEL[role.role]}: ${PROVIDER_LABEL[role.current.provider]} ${role.current.model} → ${role.cheapest!.displayName}`).join('\n');
    if(!window.confirm(`Aplicar a configuração econômica ${scope==='global'?'(global)':'neste workspace'}?\n\n${summary}\n\nModelos econômicos podem errar mais em tarefas complexas. Vale para tasks NOVAS.`))return;
    setBusy(true);
    try{
      const cfg=await getJson(scope==='global'?'/api/provider-config':`/api/workspaces/${scope}/provider-config`);
      const configs:Record<string,{provider:string;model:string}>={};
      for(const role of ['planner','developer','tester','reviewer'])configs[role]={provider:cfg.effective[role].provider,model:cfg.effective[role].model};
      for(const role of changes)configs[role.role]={provider:role.cheapest!.provider,model:role.cheapest!.model};
      await send('PUT',scope==='global'?'/api/provider-config':`/api/workspaces/${scope}/provider-config`,{configs});
      notify('Configuração econômica aplicada para tasks novas.','success');await load();
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível aplicar.','error');}
    finally{setBusy(false);}
  };
  return <section className="panel cost-section">
    <div className="panel-title"><span>RECOMENDAÇÃO ECONÔMICA</span>
      <select value={scope} onChange={event=>setScope(event.target.value)} aria-label="Escopo"><option value="global">Configuração global</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
    {!data?<p className="muted">Carregando…</p>:<>
      <table className="cost-table"><thead><tr><th>Papel</th><th>Em uso</th><th>Custo/task média</th><th>Mais barato utilizável</th><th>Economia</th></tr></thead><tbody>
        {data.roles.map(role=><tr key={role.role}>
          <td><b>{ROLE_LABEL[role.role]}</b></td>
          {role.status==='free'?<td colSpan={4} className="muted">{role.current?`${PROVIDER_LABEL[role.current.provider]||role.current.provider} · `:''}{role.message}{role.usable.length===0&&role.role==='planner'?' O Planner só roda em mock hoje.':''}</td>:<>
            <td>{PROVIDER_LABEL[role.current.provider]} · <code>{role.current.model}</code>{role.current.aliasNote&&<small className="warn-text"><br/>{role.current.aliasNote}</small>}</td>
            <td>{usd(role.current.expectedUsd)}</td>
            <td>{role.cheapest?<>{PROVIDER_LABEL[role.cheapest.provider]} · <b>{role.cheapest.displayName}</b>{!role.cheapest.verified&&<small className="warn-text"><br/>ID não verificado com chamada real</small>}<br/><small>{usd(role.cheapest.expectedUsd)}</small></>:'—'}</td>
            <td>{role.alreadyCheapest?<span className="badge ok">já é o mais barato</span>:role.savingsPct!==null&&role.savingsPct!==undefined?<span className="badge save">−{role.savingsPct}%</span>:'—'}</td></>}
        </tr>)}
      </tbody></table>
      <p className="muted">{data.note}</p>
      <button className="primary" disabled={busy||!changes.length} onClick={apply}>{changes.length?'Aplicar configuração econômica':'Nada a otimizar'}</button>
    </>}
  </section>;
}

// ───────── Simulador ─────────
function Simulator({pricing}:{pricing:Pricing|null}){
  const[access,setAccess]=useState<'cli'|'api'>('cli'),[role,setRole]=useState('developer'),[provider,setProvider]=useState('claude-code'),[model,setModel]=useState('claude-haiku-5-5'),[size,setSize]=useState('medium');
  const[promptTokens,setPromptTokens]=useState(8000),[cachedShare,setCachedShare]=useState(0),[outputTokens,setOutputTokens]=useState(2000);
  const[result,setResult]=useState<Estimate|null>(null),[error,setError]=useState('');
  const models=useMemo(()=>(pricing?.models||[]).filter(item=>item.vendor===VENDOR_OF[provider]&&item.status==='current'),[pricing,provider]);
  useEffect(()=>{if(models.length&&!models.some(item=>item.id===model))setModel(models[0].id);},[models,model]);
  useEffect(()=>{
    if(!model)return;
    const timer=setTimeout(()=>{void send('POST','/api/costs/estimate',{access,role,provider,model,size,api:{promptTokens,cachedShare:cachedShare/100,outputTokens}}).then(data=>{setResult(data);setError('');}).catch(e=>{setResult(null);setError(e instanceof Error?e.message:'Falha na simulação.');});},250);
    return()=>clearTimeout(timer);
  },[access,role,provider,model,size,promptTokens,cachedShare,outputTokens]);
  return <section className="panel cost-section">
    <div className="panel-title"><span>SIMULADOR DE CUSTO</span></div>
    <div className="cost-form">
      <label>Acesso<select value={access} onChange={event=>setAccess(event.target.value as 'cli'|'api')}><option value="cli">CLI (agente: várias etapas)</option><option value="api">API (chamada direta)</option></select></label>
      <label>Papel<select value={role} onChange={event=>setRole(event.target.value)}><option value="developer">Developer</option><option value="reviewer">Reviewer</option><option value="planner">Planner</option></select></label>
      <label>Ferramenta<select value={provider} onChange={event=>setProvider(event.target.value)}><option value="claude-code">Claude Code / Anthropic</option><option value="codex-cli">Codex / OpenAI</option><option value="cursor">Cursor (informativo)</option></select></label>
      <label>Modelo<select value={model} onChange={event=>setModel(event.target.value)}>{models.map(item=><option key={item.id} value={item.id}>{item.displayName} ({TIER_LABEL[item.tier]})</option>)}</select></label>
      {access==='cli'
        ?<label>Tamanho da tarefa<select value={size} onChange={event=>setSize(event.target.value)}><option value="small">Pequena (ajuste simples)</option><option value="medium">Média</option><option value="large">Grande (várias etapas)</option></select></label>
        :<><label>Tokens do prompt<input type="number" min={0} value={promptTokens} onChange={event=>setPromptTokens(Number(event.target.value))}/></label>
          <label>% do prompt em cache<input type="number" min={0} max={100} value={cachedShare} onChange={event=>setCachedShare(Number(event.target.value))}/></label>
          <label>Tokens de saída<input type="number" min={0} value={outputTokens} onChange={event=>setOutputTokens(Number(event.target.value))}/></label></>}
    </div>
    {error&&<div className="notice warning">{error}</div>}
    {result&&!result.free&&<>
      <div className="cost-result">
        <div><small>Estimado</small><strong>{usd(result.estimate.expectedUsd)}</strong></div>
        <div><small>Faixa provável</small><strong>{usd(result.estimate.lowUsd)} – {usd(result.estimate.highUsd)}</strong></div>
        <div><small>Base</small><strong>{result.basis?.kind==='history'?`${result.basis.samples} execuções reais`:result.basis?.kind==='api_inputs'?'tokens informados':'perfil padrão'}</strong></div>
      </div>
      {result.warnings.map((warning,index)=><p key={index} className="muted cost-warning">• {warning}</p>)}
      <table className="cost-table"><thead><tr><th>Modelo</th><th>Estimado</th><th>Faixa</th><th>vs. selecionado</th><th></th></tr></thead><tbody>
        {result.comparison.map(row=><tr key={`${row.provider}-${row.modelId}`} className={row.isCurrent?'current':''}>
          <td>{PROVIDER_LABEL[row.provider]} · {row.displayName} <small className="muted">({TIER_LABEL[row.tier]})</small></td>
          <td>{usd(row.expectedUsd)}</td><td><small>{usd(row.lowUsd)} – {usd(row.highUsd)}</small></td>
          <td>{row.isCurrent?'—':row.savingsVsCurrentPct===null?'':row.savingsVsCurrentPct>0?<span className="badge save">−{row.savingsVsCurrentPct}%</span>:row.savingsVsCurrentPct===0?<span className="badge info">igual</span>:<span className="badge more">+{Math.abs(row.savingsVsCurrentPct)}%</span>}</td>
          <td>{row.isCurrent&&<span className="badge cur">selecionado</span>} {result.cheapestUsable?.modelId===row.modelId&&result.cheapestUsable.provider===row.provider&&<span className="badge ok">mais barato utilizável</span>} {!row.executable&&<span className="badge info">informativo</span>} {row.usableForRole===false&&row.executable&&<span className="badge info">não suportado neste papel</span>}</td>
        </tr>)}
      </tbody></table></>}
    {result?.free&&<p className="muted">Este provider não tem custo por token.</p>}
  </section>;
}

// ───────── Gasto real ─────────
function RealSpend({workspaces}:{workspaces:Workspace[]}){
  const[days,setDays]=useState(30),[workspaceId,setWorkspaceId]=useState(''),[data,setData]=useState<Summary|null>(null);
  useEffect(()=>{void getJson(`/api/costs/summary?days=${days}${workspaceId?`&workspaceId=${workspaceId}`:''}`).then(setData).catch(()=>setData(null));},[days,workspaceId]);
  const maxDay=Math.max(0.000001,...(data?.byDay||[]).map(item=>item.usd));
  return <section className="panel cost-section">
    <div className="panel-title"><span>GASTO REAL (CALCULADO PELA TABELA DE PREÇOS)</span>
      <span><select value={days} onChange={event=>setDays(Number(event.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select> <select value={workspaceId} onChange={event=>setWorkspaceId(event.target.value)}><option value="">Todos os workspaces</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></span></div>
    {!data?<p className="muted">Carregando…</p>:<>
      <div className="summary-grid">
        <div className="summary-card blue"><span>Total no período</span><strong>{usd(data.totalUsd)}</strong></div>
        <div className="summary-card blue"><span>Execuções</span><strong>{data.executions}</strong></div>
        <div className={`summary-card ${data.unknownCostExecutions?'red':'green'}`}><span>Custo desconhecido</span><strong>{data.unknownCostExecutions}</strong></div>
        <div className={`summary-card ${data.mismatchExecutions?'red':'green'}`}><span>Divergência do provider</span><strong>{data.mismatchExecutions}</strong></div>
      </div>
      {data.mismatchExecutions>0&&<p className="muted cost-warning">O provider informou um valor diferente da tabela de preços em {data.mismatchExecutions} execução(ões) (ex.: o Claude Code estima errado modelos novos). O valor da tabela é o usado aqui.</p>}
      {data.byDay.length>0&&<div className="cost-bars" aria-label="Gasto por dia">{data.byDay.map(item=><div key={item.day} className="bar" title={`${item.day}: ${usd(item.usd)}`}><div style={{height:`${Math.max(4,item.usd/maxDay*100)}%`}}/><small>{item.day.slice(5)}</small></div>)}</div>}
      <div className="cost-split">
        <table className="cost-table"><thead><tr><th>Modelo</th><th>Execuções</th><th>Custo</th></tr></thead><tbody>{data.byModel.map(item=><tr key={item.provider+item.model}><td>{PROVIDER_LABEL[item.provider]||item.provider} · <code>{item.model}</code></td><td>{item.executions}</td><td>{usd(item.usd)}</td></tr>)}{!data.byModel.length&&<tr><td colSpan={3} className="muted">Sem execuções no período.</td></tr>}</tbody></table>
        <table className="cost-table"><thead><tr><th>Task mais cara</th><th>Custo</th></tr></thead><tbody>{data.expensive.map(item=><tr key={item.taskId}><td>{item.title}</td><td>{usd(item.usd)}</td></tr>)}{!data.expensive.length&&<tr><td colSpan={2} className="muted">—</td></tr>}</tbody></table>
      </div></>}
  </section>;
}

// ───────── Tabela de preços ─────────
function PriceTable({pricing}:{pricing:Pricing}){
  const[open,setOpen]=useState(false);
  return <section className="panel cost-section">
    <div className="panel-title"><span>TABELA DE PREÇOS (USD POR 1 MILHÃO DE TOKENS)</span><button className="text-button" onClick={()=>setOpen(value=>!value)}>{open?'Ocultar':'Mostrar'}</button></div>
    <p className="muted">Fontes oficiais: {pricing.sources.map((source,index)=><span key={source.url}>{index>0&&' · '}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></span>)}. Para ajustar valores sem mexer no código, aponte <code>PRICING_FILE</code> para um JSON.</p>
    {open&&<>
      <table className="cost-table"><thead><tr><th>Modelo</th><th>Entrada</th><th>Cache (leitura)</th><th>Saída</th><th>Nível</th><th></th></tr></thead><tbody>
        {pricing.models.map(item=><tr key={item.id} className={item.status==='legacy'?'legacy':''}><td>{item.displayName} <small className="muted">{item.vendor}</small></td><td>{usd(item.input)}</td><td>{item.cacheRead!==undefined?usd(item.cacheRead):'—'}</td><td>{usd(item.output)}</td><td>{TIER_LABEL[item.tier]}</td><td>{item.verified&&<span className="badge ok">verificado</span>} {item.status==='legacy'&&<span className="badge info">legado</span>} {!item.executable&&<span className="badge info">informativo</span>}</td></tr>)}
      </tbody></table>
      <p className="muted"><b>Cursor</b> — planos: {pricing.cursorPlans.map(plan=>`${plan.name} ${plan.usdPerMonth?`US$ ${plan.usdPerMonth}/mês`:''}`).join(' · ')}. Modelos de terceiros no Cursor são cobrados ao preço da API.</p></>}
  </section>;
}
