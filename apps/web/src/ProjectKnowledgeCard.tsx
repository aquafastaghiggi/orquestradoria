import React,{useCallback,useEffect,useState} from 'react';

type Notify=(message:string,tone?:'success'|'error'|'info')=>void;
const when=(iso?:string|null)=>iso?new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';

/** Memória do projeto: o que a IA deve saber antes de cada task (como roda, logins de teste, convenções, armadilhas). */
export default function ProjectKnowledgeCard({workspaceId,notify}:{workspaceId:string;notify:Notify}){
  const [saved,setSaved]=useState(''),[text,setText]=useState(''),[updatedAt,setUpdatedAt]=useState<string|null>(null),[max,setMax]=useState(6000),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const load=useCallback(()=>{void fetch(`/api/workspaces/${workspaceId}/knowledge`).then(r=>r.json()).then(data=>{setSaved(data.content||'');setText(data.content||'');setUpdatedAt(data.updatedAt||null);if(data.maxChars)setMax(data.maxChars);}).catch(()=>{});},[workspaceId]);
  useEffect(()=>{load();},[load]);
  const save=async()=>{
    setBusy(true);
    try{
      const response=await fetch(`/api/workspaces/${workspaceId}/knowledge`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){notify(data.error||'Não foi possível salvar a memória.','error');return;}
      setSaved(data.content);setUpdatedAt(data.updatedAt);notify('Memória do projeto salva.','success');
    }catch(error){notify(error instanceof Error?error.message:'Não foi possível salvar a memória.','error');}
    finally{setBusy(false);}
  };
  const dirty=text!==saved;
  return <section className="panel knowledge-card">
    <div className="panel-title"><span>MEMÓRIA DO PROJETO</span><button className="text-button" onClick={()=>setOpen(value=>!value)}>{open?'Recolher':saved?'Abrir':'Escrever'}</button></div>
    {!open
      ?<p className="muted">{saved?`${saved.split('\n').filter(line=>line.trim()).length} linha(s) · atualizada ${when(updatedAt)}. O Developer e o Reviewer leem isto antes de cada task.`:'Vazia. Escreva aqui o que a IA deve saber: como o projeto roda, logins de teste, convenções, armadilhas.'}</p>
      :<>
        <textarea rows={10} maxLength={max} value={text} onChange={event=>setText(event.target.value)} placeholder={'Ex.:\n- Projeto PHP puro, sem framework.\n- Login de teste: demo / demo123.\n- O banco vem das variáveis ORQ_DB_*.'} style={{width:'100%',boxSizing:'border-box'}}/>
        <small className="muted">{text.length}/{max} · as tasks aprovadas acrescentam sozinhas uma seção "Aprendido automaticamente" (comandos que funcionaram e fatos que o Developer marcou). Você pode editar ou apagar tudo.</small>
        <div className="button-row"><button className="primary" disabled={!dirty||busy} onClick={save}>{busy?'Salvando…':'Salvar'}</button>{dirty&&<button className="secondary" disabled={busy} onClick={()=>setText(saved)}>Desfazer edição</button>}</div>
      </>}
  </section>;
}
