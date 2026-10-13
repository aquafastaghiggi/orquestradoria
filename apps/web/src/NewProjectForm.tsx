import React,{useEffect,useState} from 'react';

type Props={onClose:()=>void;onCreated:(workspace?:any,missionId?:string)=>void;notify:(message:string,tone?:'success'|'error'|'info')=>void};

const post=async(url:string,body?:unknown)=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'A solicitação falhou.');
  return data;
};

export default function NewProjectForm({onClose,onCreated,notify}:Props){
  const[name,setName]=useState(''),[parentDir,setParentDir]=useState(''),[idea,setIdea]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{void fetch('/api/projects/defaults').then(r=>r.json()).then(d=>setParentDir(current=>current||d.parentDir||'')).catch(()=>undefined);},[]);

  const pick=async()=>{
    setBusy(true);
    try{const{path}=await post('/api/workspaces/pick-folder');if(path)setParentDir(path);}
    catch(error){notify(error instanceof Error?error.message:'Não foi possível abrir o seletor.','error');}
    finally{setBusy(false);}
  };
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    setBusy(true);
    try{
      const created=await post('/api/projects/from-idea',{name,parentDir,idea});
      await post(`/api/workspaces/${created.workspace.id}/context/analyze`).catch(()=>undefined);
      onCreated(created.workspace,created.missionId);
    }catch(error){notify(error instanceof Error?error.message:'Falha ao criar o projeto.','error');}
    finally{setBusy(false);}
  };

  return <form onSubmit={submit}>
    <label>Nome do projeto<input value={name} onChange={event=>setName(event.target.value)} maxLength={80} required/></label>
    <label>Criar dentro da pasta
      <div style={{display:'flex',gap:8}}>
        <input value={parentDir} onChange={event=>setParentDir(event.target.value)} required style={{flex:1}}/>
        <button type="button" className="secondary" disabled={busy} onClick={pick}>Escolher pasta…</button>
      </div>
    </label>
    <label>Qual é a ideia?
      <textarea value={idea} onChange={event=>setIdea(event.target.value)} rows={6} maxLength={8000} required placeholder="Ex.: um site simples para cadastrar clientes com nome, telefone e e-mail, usando PHP e SQLite." style={{width:'100%',boxSizing:'border-box'}}/>
    </label>
    <p className="muted">Cria a pasta, inicia o Git com um commit inicial, registra o workspace e deixa uma Missão em rascunho com a sua ideia. Nenhum provider é chamado agora — o plano só é gerado quando você pedir.</p>
    <div className="modal-foot">
      <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
      <button className="primary" disabled={busy||!name.trim()||!idea.trim()||!parentDir.trim()}>{busy?'Criando…':'Criar projeto'}</button>
    </div>
  </form>;
}
