import React,{useEffect,useState} from 'react';

type Tone='success'|'error'|'info';
type Notify=(message:string,tone?:Tone)=>void;
type Preview={status:'stopped'|'ready'|'failed';runtime?:string;url?:string;error?:string};
type Mode={mode:'mock'|'real';forced:boolean;entries:{key:string;provider:string}[]};

const PREVIEWABLE=['approved_waiting_action','manual_review_preserved','failed_preserved'];
const ADJUSTABLE=['approved_waiting_action','manual_review_preserved'];

async function post(url:string,body?:unknown){
  const response=await fetch(url,{method:'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{ok:response.ok,data};
}

/** Preview + pedido de ajuste. `baseUrl` aponta para /api/tasks/:id ou /api/missions/:id (mesmas rotas). */
export function PreviewAdjustCard({baseUrl,idKey,canPreview,canAdjust,workspaceId,developerProviderInSnapshot,noun,onRefresh,notify}:{baseUrl:string;idKey:string;canPreview:boolean;canAdjust:boolean;workspaceId?:string;developerProviderInSnapshot?:string;noun:'task'|'missão';onRefresh:()=>void;notify:Notify}){
  const[preview,setPreview]=useState<Preview>({status:'stopped'}),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[mode,setMode]=useState<Mode|null>(null);
  useEffect(()=>{if(!canPreview){setPreview({status:'stopped'});return;}void fetch(`${baseUrl}/preview`).then(r=>r.json()).then(setPreview).catch(()=>setPreview({status:'stopped'}));},[baseUrl,canPreview]);
  useEffect(()=>{void fetch(`/api/mode${workspaceId?`?workspaceId=${workspaceId}`:''}`).then(r=>r.json()).then(setMode).catch(()=>setMode(null));},[workspaceId]);
  if(!canPreview&&!canAdjust)return null;

  const developerMock=mode?.forced?true:developerProviderInSnapshot?developerProviderInSnapshot==='mock':mode?.entries.find(entry=>entry.key==='developer')?.provider==='mock';

  const start=async()=>{
    setBusy(true);
    try{
      const{data}=await post(`${baseUrl}/preview/start`);
      setPreview(data);
      if(data.status==='ready'&&data.url)window.open(data.url,'_blank','noopener');
      else notify(data.error||'Não foi possível iniciar o preview.','error');
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível iniciar o preview.','error');}
    finally{setBusy(false);}
  };
  const stop=async()=>{
    setBusy(true);
    try{const{data}=await post(`${baseUrl}/preview/stop`);setPreview(data);notify('Preview parado. A aba aberta deixa de responder.','success');}
    catch(error){notify(error instanceof Error?error.message:'Não foi possível parar o preview.','error');}
    finally{setBusy(false);}
  };
  const requestChanges=async()=>{
    setBusy(true);
    try{
      const{ok,data}=await post(`${baseUrl}/request-changes`,{feedback});
      if(!ok){notify(data.error||'Não foi possível solicitar o ajuste.','error');return;}
      setFeedback('');setPreview({status:'stopped'});
      notify(`Ajuste enviado ao Developer (rodada ${data.round}). Acompanhe o andamento.`,'success');
      onRefresh();
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível solicitar o ajuste.','error');}
    finally{setBusy(false);}
  };

  return <section className="panel task-preview-card">
    <div className="panel-title"><span>PREVIEW E AJUSTES</span></div>
    {canPreview&&<>
      {preview.status==='ready'&&preview.url
        ?<div className="notice success"><strong>Preview ativo ({preview.runtime})</strong><span><a href={preview.url} target="_blank" rel="noopener noreferrer">{preview.url}</a></span></div>
        :preview.status==='failed'?<div className="notice warning"><strong>Preview indisponível</strong><span>{preview.error}</span></div>
        :<p className="muted">Abre a versão desta {noun} a partir do worktree isolado. A branch principal não é tocada.</p>}
      {preview.status==='ready'
        ?<button className="secondary" disabled={busy} onClick={stop}>Parar preview</button>
        :<button className="secondary" disabled={busy} onClick={start}>{busy?'Iniciando…':'Abrir preview'}</button>}
    </>}
    {canAdjust&&<>
      {developerMock&&<div className="notice warning"><strong>Developer em modo simulado (mock)</strong><span>Ele não altera arquivos. O ajuste percorre o fluxo, mas o resultado não muda. Para alterações reais, configure o Developer como Claude Code.</span></div>}
      <label htmlFor={`adjust-${idKey}`} className="muted">Solicitar ajuste (volta ao Developer no mesmo worktree)</label>
      <textarea id={`adjust-${idKey}`} rows={4} maxLength={4000} value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder="Ex.: reduza o botão em 20% e altere o texto para Salvar" style={{width:'100%',boxSizing:'border-box'}}/>
      <button className="primary" disabled={busy||!feedback.trim()} onClick={requestChanges}>Solicitar ajuste</button>
      {!feedback.trim()&&<small className="muted">Descreva o ajuste acima para habilitar o botão.</small>}
    </>}
  </section>;
}

type TaskProps={task:{id:string;status:string;workspaceId?:string;missionId?:string|null;configSnapshot?:any};environment:any;onRefresh:()=>void;notify:Notify};

export default function TaskPreviewCard({task,environment,onRefresh,notify}:TaskProps){
  const envStatus=environment?.environmentStatus||task.status;
  const canPreview=Boolean(environment?.worktreePath)&&PREVIEWABLE.includes(envStatus);
  const canAdjust=!task.missionId&&ADJUSTABLE.includes(envStatus)&&['approved','needs_fix'].includes(task.status);
  const developer=(task.configSnapshot?.agentConfigs||[]).find((config:any)=>config.role==='developer');
  return <PreviewAdjustCard baseUrl={`/api/tasks/${task.id}`} idKey={task.id} canPreview={canPreview} canAdjust={canAdjust} workspaceId={task.workspaceId} developerProviderInSnapshot={developer?.provider} noun="task" onRefresh={onRefresh} notify={notify}/>;
}

export function MissionPreviewCard({mission,onRefresh,notify}:{mission:any;onRefresh:()=>void;notify:Notify}){
  let developerProvider:string|undefined;
  try{developerProvider=JSON.parse(mission.configSnapshot||'{}').agentConfigs?.find((config:any)=>config.role==='developer')?.provider;}catch{developerProvider=undefined;}
  const ready=mission.status==='completed'&&Boolean(mission.worktreePath);
  const canAdjust=ready&&mission.environmentStatus==='approved_waiting_action';
  return <PreviewAdjustCard baseUrl={`/api/missions/${mission.id}`} idKey={mission.id} canPreview={ready} canAdjust={canAdjust} workspaceId={mission.workspaceId} developerProviderInSnapshot={developerProvider} noun="missão" onRefresh={onRefresh} notify={notify}/>;
}
