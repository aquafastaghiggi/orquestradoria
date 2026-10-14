import React,{useCallback,useEffect,useState} from 'react';

type Status={available:boolean;reason?:string;alreadyUndone?:boolean;redo?:{available:boolean;reason?:string}|null;applied?:{appliedAt:string;undoneAt:string|null;undoSha:string|null}|null};
const when=(iso?:string|null)=>iso?new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';

/** Desfaz uma aplicação com um commit de reversão (nada é apagado do histórico). Só aparece para task/missão já aplicada. */
export default function UndoApplyCard({baseUrl,show,noun,branch,onChanged,notify}:{baseUrl:string;show:boolean;noun:'task'|'missão';branch?:string;onChanged:()=>void;notify:(message:string,tone?:'success'|'error'|'info')=>void}){
  const[status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false);
  const load=useCallback(()=>{void fetch(`${baseUrl}/undo-apply`).then(r=>r.json()).then(setStatus).catch(()=>setStatus(null));},[baseUrl]);
  useEffect(()=>{if(show)load();},[show,load]);
  if(!show||!status)return null;
  const undo=async()=>{
    if(!window.confirm(`Desfazer a aplicação desta ${noun} na branch ${branch||'base'}?\n\nSerá criado um novo commit que reverte as alterações. Nada é apagado do histórico, e nada é enviado (sem push).`))return;
    setBusy(true);
    try{
      const response=await fetch(`${baseUrl}/undo-apply`,{method:'POST'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){notify(data.error||'Não foi possível desfazer.','error');return;}
      notify('Aplicação desfeita com um commit de reversão.','success');load();onChanged();
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível desfazer.','error');}
    finally{setBusy(false);}
  };
  const redo=async()=>{
    if(!window.confirm(`Refazer a aplicação desta ${noun} na branch ${branch||'base'}?\n\nSerá criado um novo commit que restaura as alterações. Nada é apagado e nada é enviado (sem push).`))return;
    setBusy(true);
    try{
      const response=await fetch(`${baseUrl}/redo-apply`,{method:'POST'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){notify(data.error||'Não foi possível refazer.','error');return;}
      notify('Aplicação refeita: as alterações voltaram para a branch.','success');load();onChanged();
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível refazer.','error');}
    finally{setBusy(false);}
  };
  return <section className="panel undo-apply-card">
    <div className="panel-title"><span>{status.alreadyUndone?'APLICAÇÃO DESFEITA':'DESFAZER APLICAÇÃO'}</span></div>
    {status.alreadyUndone
      ?<>
        <div className="notice info"><strong>Aplicação desfeita</strong><span>{when(status.applied?.undoneAt)} · commit de reversão {status.applied?.undoSha?.slice(0,8)}. As alterações estão no histórico do Git, mas fora da branch.</span></div>
        {status.redo&&!status.redo.available&&<div className="notice warning"><span>{status.redo.reason}</span></div>}
        <button className="primary" disabled={!status.redo?.available||busy} onClick={redo}>{busy?'Refazendo…':'Refazer aplicação'}</button>
      </>
      :<>
        <p className="muted">Aplicada em {when(status.applied?.appliedAt)}. Desfazer cria um commit de reversão; o histórico é preservado.</p>
        {!status.available&&<div className="notice warning"><span>{status.reason}</span></div>}
        <button className="danger" disabled={!status.available||busy} onClick={undo}>{busy?'Desfazendo…':'Desfazer aplicação'}</button>
      </>}
  </section>;
}
