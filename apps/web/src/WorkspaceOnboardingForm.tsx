import React,{useState} from 'react';

type Issue={level:'error'|'warning'|'info';code:string;message:string};
type Inspection={location:string;suggestedName:string;git:{currentBranch:string|null;resolvedBaseBranch:string|null;dirty:boolean}|null;stack:{runtime:string;projectType:string;packageManager?:string;testCommands:string[]}|null;issues:Issue[];ready:boolean};
type Props={onClose:()=>void;onCreated:(workspace?:any,missionId?:string)=>void;notify:(message:string,tone?:'success'|'error'|'info')=>void};

const post=async(url:string,body?:unknown)=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'A solicitação falhou.');
  return data;
};

export default function WorkspaceOnboardingForm({onClose,onCreated,notify}:Props){
  const[location,setLocation]=useState(''),[name,setName]=useState(''),[info,setInfo]=useState<Inspection|null>(null),[busy,setBusy]=useState(false);

  const inspect=async(path:string)=>{
    if(!path.trim()){setInfo(null);return;}
    try{
      const result:Inspection=await post('/api/workspaces/inspect',{location:path});
      setInfo(result);setLocation(result.location);
      if(!name.trim())setName(result.suggestedName);
    }catch(error){notify(error instanceof Error?error.message:'Falha ao validar a pasta.','error');}
  };
  const pick=async()=>{
    setBusy(true);
    try{const{path}=await post('/api/workspaces/pick-folder');if(path)await inspect(path);}
    catch(error){notify(error instanceof Error?error.message:'Não foi possível abrir o seletor.','error');}
    finally{setBusy(false);}
  };
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!info?.ready)return;
    setBusy(true);
    try{
      const workspace=await post('/api/workspaces',{name,location:info.location,type:'local'});
      await post(`/api/workspaces/${workspace.id}/context/analyze`).catch(()=>undefined);
      onCreated(workspace);
    }catch(error){notify(error instanceof Error?error.message:'Falha ao registrar.','error');}
    finally{setBusy(false);}
  };

  return <form onSubmit={submit}>
    <label>Pasta do projeto
      <div style={{display:'flex',gap:8}}>
        <input value={location} onChange={event=>{setLocation(event.target.value);setInfo(null);}} onBlur={()=>void inspect(location)} placeholder="C:\xampp\htdocs\meu-projeto" required style={{flex:1}}/>
        <button type="button" className="secondary" disabled={busy} onClick={pick}>Escolher pasta…</button>
      </div>
    </label>
    <label>Nome<input value={name} onChange={event=>setName(event.target.value)} required/></label>
    {info&&<div className="panel-empty compact" style={{textAlign:'left'}}>
      <strong>{info.ready?'Pronto para usar':'Ajustes necessários'}</strong>
      {info.git&&<div>Git: branch <b>{info.git.resolvedBaseBranch||info.git.currentBranch}</b>{info.git.dirty?' · alterações não commitadas':' · limpo'}</div>}
      {info.stack&&<div>Stack: {info.stack.runtime==='unsupported'?'sem runtime de preview':info.stack.runtime} · {info.stack.projectType}{info.stack.packageManager?` (${info.stack.packageManager})`:''} · {info.stack.testCommands.length} comando(s) de teste</div>}
      {info.issues.map(issue=><div key={issue.code} className={`notice ${issue.level==='error'?'danger':issue.level==='warning'?'warning':'info'}`}>{issue.message}</div>)}
    </div>}
    <div className="modal-foot">
      <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
      <button className="primary" disabled={busy||!info?.ready||!name.trim()}>Registrar workspace</button>
    </div>
  </form>;
}
