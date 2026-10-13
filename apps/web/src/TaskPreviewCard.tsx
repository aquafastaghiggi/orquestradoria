import React,{useEffect,useState} from 'react';

type Props={task:{id:string;status:string};environment:any;onRefresh:()=>void;notify:(message:string,tone?:'success'|'error'|'info')=>void};
type Preview={status:'stopped'|'ready'|'failed';runtime?:string;url?:string;error?:string};

const PREVIEWABLE=['approved_waiting_action','manual_review_preserved','failed_preserved'];
const ADJUSTABLE=['approved_waiting_action','manual_review_preserved'];

async function call(url:string,body?:unknown){
  const response=await fetch(url,{method:'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{ok:response.ok,data};
}

export default function TaskPreviewCard({task,environment,onRefresh,notify}:Props){
  const[preview,setPreview]=useState<Preview>({status:'stopped'}),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('');
  const envStatus=environment?.environmentStatus||task.status;
  const canPreview=Boolean(environment?.worktreePath)&&PREVIEWABLE.includes(envStatus);
  const canAdjust=ADJUSTABLE.includes(envStatus)&&['approved','needs_fix'].includes(task.status);
  useEffect(()=>{if(!canPreview){setPreview({status:'stopped'});return;}void fetch(`/api/tasks/${task.id}/preview`).then(r=>r.json()).then(setPreview).catch(()=>setPreview({status:'stopped'}));},[task.id,canPreview]);
  if(!canPreview&&!canAdjust)return null;

  const start=async()=>{
    setBusy(true);
    try{
      const{data}=await call(`/api/tasks/${task.id}/preview/start`);
      setPreview(data);
      if(data.status==='ready'&&data.url)window.open(data.url,'_blank','noopener');
      else notify(data.error||'Não foi possível iniciar o preview.','error');
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível iniciar o preview.','error');}
    finally{setBusy(false);}
  };
  const stop=async()=>{setBusy(true);try{const{data}=await call(`/api/tasks/${task.id}/preview/stop`);setPreview(data);}finally{setBusy(false);}};
  const requestChanges=async()=>{
    setBusy(true);
    try{
      const{ok,data}=await call(`/api/tasks/${task.id}/request-changes`,{feedback});
      if(!ok){notify(data.error||'Não foi possível solicitar o ajuste.','error');return;}
      setFeedback('');setPreview({status:'stopped'});
      notify(`Ajuste enviado ao Developer (rodada ${data.round}).`,'success');
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
        :<p className="muted">Abre a versão desta task a partir do worktree isolado. A branch principal não é tocada.</p>}
      {preview.status==='ready'
        ?<button className="secondary" disabled={busy} onClick={stop}>Parar preview</button>
        :<button className="secondary" disabled={busy} onClick={start}>{busy?'Iniciando…':'Abrir preview'}</button>}
    </>}
    {canAdjust&&<>
      <label htmlFor={`adjust-${task.id}`} className="muted">Solicitar ajuste (volta ao Developer no mesmo worktree)</label>
      <textarea id={`adjust-${task.id}`} rows={4} maxLength={4000} value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder="Ex.: reduza o botão em 20% e altere o texto para Salvar" style={{width:'100%',boxSizing:'border-box'}}/>
      <button className="primary" disabled={busy||!feedback.trim()} onClick={requestChanges}>Solicitar ajuste</button>
    </>}
  </section>;
}
