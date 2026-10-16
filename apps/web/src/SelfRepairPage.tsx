import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import './self-repair.css';

type Notify=(message:string,tone?:'success'|'error'|'info')=>void;
type Overview={
  available:boolean;workspace:{id:string;name:string;location:string;branch:string};
  instance:{repoRoot:string;branch:string;headSha:string;pid:number;startedAt:string};
  mode:{mode:'mock'|'real';costly:Array<{label:string;provider:string;model:string}>;summary:string;forced:boolean};
  budget:{settings:{dailyUsd:number;monthlyUsd:number;defaultTaskUsd:number};spend:{todayUsd:number;monthUsd:number;blocked:boolean;message:string|null}};
  repairs:Array<{taskId:string;title:string;status:string;currentStage:string|null;environmentStatus:string|null;decision:string|null;mode:string;sourceTaskId:string|null;createdAt:string}>;
  diagnosableTasks:Array<{id:string;title:string;status:string;workspaceName:string;updatedAt:string}>;
};
type Detail={
  repair:{taskId:string;prompt:string;mode:string;decision:string|null;decidedAt:string|null;spendConfirmedAt:string|null;createdAt:string};
  task:{id:string;title:string;status:string;currentStage:string|null;environmentStatus:string|null;taskBranch:string|null;worktreePath:string|null;baseBranch:string|null;running:boolean};
  stages:Array<{role:string;status:string;provider:string;model:string;error?:string;summary?:string}>;
  tests:{status:string;summary?:string;commands:Array<{label:string;status:string;exitCode:number|null}>;notes:string[]}|null;
  review:{status:string;summary?:string;issues:Array<{severity?:string;file?:string|null;description?:string}>}|null;
  files:{files:string[];added:string[];modified:string[];deleted:string[];truncated:boolean};
  adjustments:Array<{at:string;round?:number}>;history:Array<{at:string;action:string}>;
  safety:{isolated:boolean;worktreeOutsideLiveCheckout:boolean;repoRoot:string;liveBranch:string;taskBranchCheckedOutInLive:boolean;repoHeadUnchanged:boolean;autoMerge:boolean;autoDeploy:boolean;autoRestart:boolean};
  actions:{canApprove:boolean;canRequestChanges:boolean;adjustReason?:string;canDiscard:boolean};
  instructions?:{note:string;review:string[];verify:string[];merge:string[];afterMerge:string};
};
type SpendInfo={mode:'mock'|'real';costly:Array<{label:string;provider:string;model:string}>;summary:string;estimate?:{estimate?:{expectedUsd:number;lowUsd:number;highUsd:number}}|null;budget:{taskBudgetUsd:number;dailyUsd:number;monthlyUsd:number;spend:{todayUsd:number;monthUsd:number;blocked:boolean;message:string|null}};requiresConfirmation:boolean;diagnosis?:{chars:number;truncated:boolean;sections:Array<{name:string}>}|null};

const usd=(value:number|null|undefined)=>value===null||value===undefined||Number.isNaN(value)?'N/D':`US$ ${value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4})}`;
const STATUS_LABEL:Record<string,string>={pending:'Pendente',planning:'Planejando',implementing:'Implementando',testing:'Testando',reviewing:'Revisando',approved:'Aprovada pelo pipeline',failed:'Falhou',needs_input:'Precisa de resposta',needs_manual_review:'Revisão manual',stalled:'Parada',cancelled:'Cancelada'};
const ROLE_LABEL:Record<string,string>={planner:'Planner',developer:'Developer',tester:'Tester',reviewer:'Reviewer'};
const ROLES=['planner','developer','tester','reviewer'];
const DECISION_LABEL:Record<string,string>={approved:'Aprovada (merge manual pendente)',discarded:'Descartada'};

async function request(method:string,url:string,body?:unknown){
  const response=await fetch(url,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{ok:response.ok,status:response.status,data};
}

type Problem={id:string;category:string;title:string;severity:'high'|'medium'|'low';status:'confirmed'|'suspected';probableCause:string;evidence:Array<{taskId:string;taskTitle:string;source:string;text:string;at:string}>;occurrences:number;taskIds:string[];firstSeen:string;lastSeen:string;investigation?:{taskId:string;status:string;decision:string|null}};
const SEVERITY_LABEL:Record<string,string>={high:'Alta',medium:'Média',low:'Baixa'};

export default function SelfRepairPage({notify,focusTaskId}:{notify:Notify;focusTaskId?:string|null}){
  const[problems,setProblems]=useState<Problem[]|null>(null);
  const[problemId,setProblemId]=useState<string|null>(null);
  const[problemNote,setProblemNote]=useState('');
  const[overview,setOverview]=useState<Overview|null>(null);
  const[error,setError]=useState('');
  const[prompt,setPrompt]=useState('');
  const[sourceTaskId,setSourceTaskId]=useState('');
  const[taskBudget,setTaskBudget]=useState('');
  const[pending,setPending]=useState<{kind:'create'|'adjust'|'resume';info:SpendInfo;feedback?:string}|null>(null);
  const[confirmed,setConfirmed]=useState(false);
  const[busy,setBusy]=useState(false);
  const[selected,setSelected]=useState<string|null>(null);
  const[detail,setDetail]=useState<Detail|null>(null);
  const[console_,setConsole]=useState<Array<{type:string;createdAt:string;payload:any}>>([]);
  const[diff,setDiff]=useState('');
  const[tab,setTab]=useState<'progress'|'console'|'files'|'tests'|'history'>('progress');
  const[feedback,setFeedback]=useState('');

  const loadOverview=useCallback(async()=>{
    const r=await request('GET','/api/self-repair');
    if(r.ok)setOverview(r.data);else setError(r.data?.error||'Não foi possível carregar a Autocorreção.');
  },[]);
  useEffect(()=>{void loadOverview();},[loadOverview]);

  const loadProblems=useCallback(async()=>{
    const r=await request('GET','/api/self-repair/problems');
    if(r.ok)setProblems(r.data.problems);
  },[]);
  useEffect(()=>{void loadProblems();},[loadProblems]);

  /** Monta diagnóstico e prompt do problema escolhido (sem IA, sem créditos); o usuário só revisa e envia. */
  const investigate=async(problem:Problem)=>{
    const r=await request('POST',`/api/self-repair/problems/${problem.id}/prompt`,{});
    if(!r.ok){notify(r.data?.error||'Não foi possível montar o diagnóstico.','error');void loadProblems();return;}
    setPrompt(r.data.prompt);setSourceTaskId(r.data.sourceTaskId||'');setProblemId(problem.id);
    setProblemNote(`Diagnóstico montado automaticamente (${r.data.diagnosis?r.data.diagnosis.chars+' caracteres de logs e eventos':'sem task de origem'}). Nenhum crédito foi usado. Revise o pedido e envie para a autocorreção.`);
    document.getElementById('selfrepair-new')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const focusDone=useRef<string|null>(null);
  useEffect(()=>{
    if(!focusTaskId||!problems||focusDone.current===focusTaskId)return;
    focusDone.current=focusTaskId;
    const match=problems.find(p=>p.taskIds.includes(focusTaskId)&&!p.investigation);
    if(match)void investigate(match);
    else{setSourceTaskId(focusTaskId);setPrompt('Diagnosticar a falha desta task e propor a correção no Orquestradoria.');setProblemNote('Nenhum problema detectado automaticamente para esta task; o diagnóstico (logs, erros e eventos) será anexado pela task de origem.');}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[focusTaskId,problems]);

  const loadDetail=useCallback(async(id:string)=>{
    const [d,t]=await Promise.all([request('GET',`/api/self-repair/repairs/${id}`),request('GET',`/api/tasks/${id}`)]);
    if(d.ok)setDetail(d.data);
    if(t.ok)setConsole((t.data.events||[]).slice(-200));
  },[]);
  const selectedRef=useRef<string|null>(null);selectedRef.current=selected;
  useEffect(()=>{if(selected){setDetail(null);setDiff('');void loadDetail(selected);}},[selected,loadDetail]);
  const active=detail?.task.running||['planning','implementing','testing','reviewing'].includes(String(detail?.task.status));
  useEffect(()=>{
    if(!selected||!active)return;
    const timer=setInterval(()=>{void loadDetail(selected);void loadOverview();},3000);
    return()=>clearInterval(timer);
  },[selected,active,loadDetail,loadOverview]);
  useEffect(()=>{
    if(!selected||tab!=='files')return;
    void request('GET',`/api/tasks/${selected}/diff`).then(r=>setDiff(r.ok?String(r.data.diff||''):''));
  },[selected,tab,detail?.files.files.length]);

  const bodyBase=useMemo(()=>({prompt,sourceTaskId:sourceTaskId||undefined,taskBudgetUsd:taskBudget?Number(taskBudget):undefined}),[prompt,sourceTaskId,taskBudget]);

  const submit=async(confirm:boolean,kind:'create'|'adjust'|'resume'='create',feedbackText?:string)=>{
    setBusy(true);
    try{
      const url=kind==='create'?'/api/self-repair/repairs':`/api/self-repair/repairs/${selected}/${kind==='adjust'?'request-changes':'resume'}`;
      const body=kind==='create'?{...bodyBase,problemId:problemId||undefined,confirmSpend:confirm}:{feedback:feedbackText,confirmSpend:confirm,taskBudgetUsd:taskBudget?Number(taskBudget):undefined};
      const r=await request('POST',url,body);
      if(r.status===409&&(r.data.code==='spend_confirmation_required'||r.data.code==='task_budget_required')){setPending({kind,info:r.data,feedback:feedbackText});setConfirmed(false);return;}
      if(r.status===409&&r.data?.code==='already_investigating'){notify(r.data.error,'info');setSelected(r.data.taskId);return;}
      if(!r.ok){notify(r.data?.error||'A solicitação falhou.','error');if(r.data?.code==='budget_blocked')setPending(null);return;}
      setPending(null);setConfirmed(false);
      if(kind==='create'){setPrompt('');setSourceTaskId('');setProblemId(null);setProblemNote('');void loadProblems();setSelected(r.data.taskId);setTab('progress');notify('Autocorreção iniciada num worktree isolado.','success');}
      else{setFeedback('');notify(kind==='adjust'?'Ajuste enviado ao Developer.':'Execução retomada.','success');if(selected)void loadDetail(selected);}
      void loadOverview();
    }finally{setBusy(false);}
  };

  const preview=async()=>{
    setBusy(true);
    try{
      const r=await request('POST','/api/self-repair/estimate',bodyBase);
      if(!r.ok){notify(r.data?.error||'Não foi possível estimar.','error');return;}
      if(r.data.requiresConfirmation){setPending({kind:'create',info:r.data});setConfirmed(false);}else void submit(false);
    }finally{setBusy(false);}
  };

  const decide=async(action:'approve'|'discard')=>{
    if(!selected)return;
    if(action==='discard'&&!window.confirm('Descartar esta correção? O worktree e a branch da task serão removidos.'))return;
    setBusy(true);
    try{
      const r=await request('POST',`/api/self-repair/repairs/${selected}/${action}`,{});
      if(!r.ok)notify(r.data?.error||'A ação falhou.','error');
      else notify(action==='approve'?'Correção aprovada. Nada foi mesclado: siga as instruções para revisar e mesclar.':'Correção descartada.','success');
      await loadDetail(selected);await loadOverview();
    }finally{setBusy(false);}
  };

  if(error)return <div className="content selfrepair-page"><div className="notice warning">{error}</div></div>;
  if(!overview)return <div className="content selfrepair-page"><p>Carregando…</p></div>;
  const stageStatus=(role:string)=>detail?.stages.filter(s=>s.role===role).slice(-1)[0];
  const pend=pending;

  return <div className="content selfrepair-page">
    <div className="dashboard-title"><div><p className="eyebrow">AUTOCORREÇÃO</p><h2>Diagnosticar, corrigir e evoluir o Orquestradoria</h2>
      <p>Cada pedido roda no pipeline Planner → Developer → Tester → Reviewer, <b>num worktree isolado</b> do repositório. A instância em execução não é alterada, e nada é mesclado, publicado ou reiniciado automaticamente.</p></div></div>

    <section className="panel selfrepair-safety" aria-label="Segurança">
      <div><span className="status-badge approved"><span className="dot"/>worktree isolado</span> <span className="status-badge approved"><span className="dot"/>sem merge/deploy/restart</span> <span className={`status-badge ${overview.mode.mode==='real'?'failed':'approved'}`}><span className="dot"/>{overview.mode.mode==='real'?'providers pagos configurados':'modo mock (sem custo)'}</span></div>
      <small>Instância em execução: <code>{overview.instance.repoRoot}</code> · branch <code>{overview.instance.branch}</code> · <code>{overview.instance.headSha.slice(0,8)}</code> · PID {overview.instance.pid}</small>
      <small>Orçamento: hoje {usd(overview.budget.spend.todayUsd)} de {overview.budget.settings.dailyUsd?usd(overview.budget.settings.dailyUsd):'sem limite'} · mês {usd(overview.budget.spend.monthUsd)} de {overview.budget.settings.monthlyUsd?usd(overview.budget.settings.monthlyUsd):'sem limite'}{overview.budget.spend.blocked&&<b> · BLOQUEADO: {overview.budget.spend.message}</b>}</small>
    </section>

    <section className="panel selfrepair-problems" aria-label="Problemas detectados">
      <div className="panel-title">PROBLEMAS DETECTADOS <span className="muted">{problems?`${problems.filter(p=>p.status==='confirmed').length} confirmado(s) · ${problems.filter(p=>p.status==='suspected').length} suspeita(s)`:'analisando…'}</span></div>
      <small className="muted">Detectados a partir de eventos, falhas de pipeline, execuções e histórico das tasks. A detecção não usa IA nem créditos. Uma <b>suspeita</b> é um padrão que sugere um problema, mas não o prova.</small>
      {problems&&!problems.length&&<div className="panel-empty">Nenhum problema detectado no histórico recente.</div>}
      {problems?.map(p=><article key={p.id} className={`problem ${p.status}`}>
        <div className="problem-head"><strong>{p.title}</strong>
          <span className={`status-badge ${p.status==='confirmed'?'failed':''}`}>{p.status==='confirmed'?'Confirmado':'Suspeita (não confirmada)'}</span>
          <span className={`status-badge ${p.severity==='high'?'failed':''}`}>Gravidade {SEVERITY_LABEL[p.severity]}</span>
          <small>{p.occurrences} ocorrência(s) em {p.taskIds.length} task(s) · última {new Date(p.lastSeen).toLocaleString('pt-BR')}</small></div>
        <p><b>Causa provável:</b> {p.probableCause}</p>
        <details><summary>Evidências ({p.evidence.length})</summary><ul>{p.evidence.map((e,i)=><li key={i}><small>{new Date(e.at).toLocaleString('pt-BR')} · {e.source} · task "{e.taskTitle}"</small><br/><code>{e.text}</code></li>)}</ul></details>
        <div className="selfrepair-actions">{p.investigation
          ?<button className="secondary" onClick={()=>{setSelected(p.investigation!.taskId);setTab('progress');}}>Em investigação — abrir</button>
          :<button className="primary" onClick={()=>void investigate(p)}>Investigar na Autocorreção</button>}</div>
      </article>)}
    </section>

    <section className="panel selfrepair-new" id="selfrepair-new">
      <div className="panel-title">NOVO PEDIDO</div>
      {problemNote&&<div className="notice info">{problemNote}</div>}
      <label>O que corrigir ou melhorar
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5} maxLength={8000} placeholder="Descreva o bug ou a melhoria no Orquestradoria. Ex.: o botão Aplicar fica ativo mesmo com a task em execução."/></label>
      <label>Diagnosticar uma task existente (logs, erros, eventos e contexto são anexados automaticamente)
        <select value={sourceTaskId} onChange={e=>setSourceTaskId(e.target.value)}>
          <option value="">— nenhuma —</option>
          {overview.diagnosableTasks.map(t=><option key={t.id} value={t.id}>{t.workspaceName} · {t.title.slice(0,70)} ({STATUS_LABEL[t.status]||t.status})</option>)}
        </select></label>
      <label>Orçamento da task (US$, usado só com providers pagos)
        <input type="number" min="0" step="0.05" value={taskBudget} onChange={e=>setTaskBudget(e.target.value)} placeholder={`padrão ${overview.budget.settings.defaultTaskUsd}`}/></label>
      <div className="selfrepair-actions"><button className="primary" disabled={busy||(!prompt.trim()&&!sourceTaskId)} onClick={()=>void preview()}>Enviar para autocorreção</button>
        <small>{overview.mode.mode==='real'?'Você verá a estimativa e precisará confirmar antes de gastar créditos reais.':'Modo mock: nenhum crédito será usado.'}</small></div>
    </section>

    {pend&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar gasto"><div className="modal selfrepair-confirm">
      <div className="modal-head"><h3>Confirmar uso de créditos reais</h3></div>
      <p>{pend.kind==='create'?'Esta autocorreção':pend.kind==='adjust'?'Este ajuste':'Esta retomada'} usará: <b>{pend.info.summary||pend.info.costly.map(c=>`${c.label}: ${c.model}`).join(' · ')}</b>.</p>
      <div className="selfrepair-facts">
        <div><span>Estimativa</span><b>{pend.info.estimate?.estimate?`${usd(pend.info.estimate.estimate.lowUsd)} – ${usd(pend.info.estimate.estimate.highUsd)} (esperado ${usd(pend.info.estimate.estimate.expectedUsd)})`:'indisponível'}</b></div>
        <div><span>Teto desta task</span><b>{usd(pend.info.budget.taskBudgetUsd)}</b></div>
        <div><span>Gasto hoje / mês</span><b>{usd(pend.info.budget.spend.todayUsd)} / {usd(pend.info.budget.spend.monthUsd)}</b></div>
        {pend.info.diagnosis&&<div><span>Diagnóstico anexado</span><b>{pend.info.diagnosis.chars} caracteres{pend.info.diagnosis.truncated?' (truncado)':''}</b></div>}
      </div>
      {pend.info.budget.spend.blocked&&<div className="notice warning">{pend.info.budget.spend.message}</div>}
      <label className="selfrepair-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que posso consumir créditos reais, até o teto da task.</label>
      <div className="modal-foot"><button className="secondary" onClick={()=>{setPending(null);setConfirmed(false);}}>Cancelar</button>
        <button className="primary" disabled={!confirmed||busy||pend.info.budget.spend.blocked||!(pend.info.budget.taskBudgetUsd>0)} onClick={()=>void submit(true,pend.kind,pend.feedback)}>Confirmar e executar</button></div>
    </div></div>}

    <div className="selfrepair-grid">
      <section className="panel selfrepair-history">
        <div className="panel-title">HISTÓRICO DE CORREÇÕES <span className="muted">{overview.repairs.length}</span></div>
        {!overview.repairs.length&&<div className="panel-empty">Nenhuma autocorreção ainda.</div>}
        {overview.repairs.map(r=><button key={r.taskId} className={`task-row ${selected===r.taskId?'selected':''}`} onClick={()=>{setSelected(r.taskId);setTab('progress');}}>
          <div className="task-main"><strong>{r.title.replace(/^Autocorreção:\s*/,'')}</strong><span>{new Date(r.createdAt).toLocaleString('pt-BR')} · {r.mode==='real'?'créditos reais':'mock'}{r.sourceTaskId?' · com diagnóstico':''}</span></div>
          <span className={`status-badge ${r.decision==='discarded'||r.status==='failed'?'failed':r.status==='approved'?'approved':''}`}>{r.decision?DECISION_LABEL[r.decision]:STATUS_LABEL[r.status]||r.status}</span></button>)}
      </section>

      <section className="panel selfrepair-detail">
        {!selected&&<div className="panel-empty">Selecione uma correção para acompanhar progresso, console, arquivos alterados, diff e testes.</div>}
        {selected&&!detail&&<p>Carregando…</p>}
        {detail&&<>
          <div className="panel-title">{detail.task.title.replace(/^Autocorreção:\s*/,'').toUpperCase().slice(0,80)}</div>
          <div className="selfrepair-stages">{ROLES.map(role=>{const s=stageStatus(role);return <div key={role} className={`stage ${s?.status||'idle'}`}><strong>{ROLE_LABEL[role]}</strong><small>{s?s.status:detail.task.currentStage===role?'em andamento':'aguardando'}</small></div>;})}</div>
          <div className="selfrepair-safe-row" aria-label="Isolamento">
            <span className={`status-badge ${detail.safety.isolated?'approved':'failed'}`}>{detail.safety.isolated?'executado no worktree isolado':'ISOLAMENTO NÃO CONFIRMADO'}</span>
            <small>branch <code>{detail.task.taskBranch||'—'}</code> · instância ao vivo na branch <code>{detail.safety.liveBranch}</code>{detail.safety.taskBranchCheckedOutInLive?' (ATENÇÃO: é a branch da correção)':''}{detail.safety.repoHeadUnchanged?' · HEAD da instância inalterado':' · o HEAD da instância mudou desde o pedido (por outro commit)'}</small>
          </div>
          <div className="tabs" role="tablist">{(['progress','console','files','tests','history'] as const).map(t=><button key={t} role="tab" className={tab===t?'active':''} onClick={()=>setTab(t)}>{({progress:'Progresso',console:'Console',files:`Arquivos e diff (${detail.files.files.length})`,tests:'Testes e revisão',history:'Histórico'})[t]}</button>)}</div>

          {tab==='progress'&&<div>
            <p><span className={`status-badge ${detail.task.status==='approved'?'approved':detail.task.status==='failed'?'failed':''}`}>{STATUS_LABEL[detail.task.status]||detail.task.status}</span> {detail.repair.decision&&<span className="status-badge">{DECISION_LABEL[detail.repair.decision]}</span>}</p>
            <p className="mono">{detail.repair.prompt}</p>
            {detail.stages.map((s,i)=><div key={i} className="execution"><div className="exec-main"><strong>{ROLE_LABEL[s.role]||s.role} — {s.status}</strong><small>{s.provider}/{s.model}{s.summary?` · ${String(s.summary).slice(0,160)}`:''}{s.error?` · erro: ${s.error.slice(0,160)}`:''}</small></div></div>)}
          </div>}
          {tab==='console'&&<pre className="logs-panel" aria-label="Console">{console_.length?console_.map(e=>`${new Date(e.createdAt).toLocaleTimeString('pt-BR')}  ${e.type}  ${JSON.stringify(e.payload?.data??e.payload).slice(0,200)}`).join('\n'):'Sem eventos ainda.'}</pre>}
          {tab==='files'&&<div>
            {detail.files.files.length?<ul className="selfrepair-files">{detail.files.files.map(f=><li key={f}><code>{f}</code> <small>{detail.files.added.includes(f)?'novo':detail.files.deleted.includes(f)?'removido':'alterado'}</small></li>)}</ul>:<p className="muted">Nenhum arquivo alterado no worktree (ainda).</p>}
            {detail.files.truncated&&<div className="notice warning">A lista foi truncada.</div>}
            <pre className="diff-viewer" aria-label="Diff">{diff||'Sem diff.'}</pre>
          </div>}
          {tab==='tests'&&<div>
            <h4>Testes</h4>
            {detail.tests?<><p><span className={`status-badge ${detail.tests.status==='PASSED'?'approved':'failed'}`}>{detail.tests.status}</span> {detail.tests.summary}</p>
              <ul>{detail.tests.commands.map((c,i)=><li key={i}>{c.label}: <b>{c.status}</b>{c.exitCode!==null&&c.exitCode!==undefined?` (código ${c.exitCode})`:''}</li>)}</ul>
              {detail.tests.notes.length>0&&<pre className="mono">{detail.tests.notes.join('\n')}</pre>}</>:<p className="muted">O Tester ainda não rodou.</p>}
            <h4>Revisão</h4>
            {detail.review?<><p><span className={`status-badge ${detail.review.status==='APPROVED'?'approved':'failed'}`}>{detail.review.status}</span> {detail.review.summary}</p>
              <ul>{detail.review.issues.map((i,k)=><li key={k}>[{i.severity}] {i.file||'geral'}: {i.description}</li>)}</ul></>:<p className="muted">O Reviewer ainda não rodou.</p>}
          </div>}
          {tab==='history'&&<ul className="selfrepair-history-list">{detail.history.map((h,i)=><li key={i}><small>{new Date(h.at).toLocaleString('pt-BR')}</small> {h.action}</li>)}{detail.adjustments.length>0&&<li><b>{detail.adjustments.length}</b> ajuste(s) solicitado(s)</li>}</ul>}

          <div className="selfrepair-decision">
            <div className="panel-title">DECISÃO</div>
            {detail.instructions&&<div className="notice success"><div><b>Aprovada. Nada foi mesclado.</b> {detail.instructions.note}
              <p>Revisar:</p><pre className="mono">{detail.instructions.review.join('\n')}</pre>
              <p>Verificar:</p><pre className="mono">{detail.instructions.verify.join('\n')}</pre>
              <p>Mesclar (você executa):</p><pre className="mono">{detail.instructions.merge.join('\n')}</pre>
              <p>{detail.instructions.afterMerge}</p></div></div>}
            <div className="selfrepair-actions">
              <button className="primary" disabled={busy||!detail.actions.canApprove} onClick={()=>void decide('approve')}>Aprovar</button>
              <button className="danger" disabled={busy||!detail.actions.canDiscard} onClick={()=>void decide('discard')}>Descartar</button>
            </div>
            <label>Solicitar ajustes ao Developer
              <textarea rows={3} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Descreva o que ajustar nesta correção." disabled={!detail.actions.canRequestChanges}/></label>
            <div className="selfrepair-actions"><button className="secondary" disabled={busy||!detail.actions.canRequestChanges||!feedback.trim()} onClick={()=>void submit(false,'adjust',feedback)}>Solicitar ajustes</button>
              {!detail.actions.canRequestChanges&&detail.actions.adjustReason&&<small>{detail.actions.adjustReason}</small>}
              {['failed','stalled','needs_manual_review'].includes(detail.task.status)&&!detail.repair.decision&&<button className="secondary" disabled={busy} onClick={()=>void submit(false,'resume')}>Retomar execução</button>}</div>
          </div>
        </>}
      </section>
    </div>
  </div>;
}
