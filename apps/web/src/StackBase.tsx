import React,{useEffect,useState} from 'react';

type Pending={id:string;title:string};
const UNAPPLIED=['approved_waiting_action'];

/**
 * Nova task: ou continua a partir do trabalho (ainda não aplicado) de outra task, ou avisa que tasks aprovadas e não aplicadas
 * NÃO são vistas por uma task nova, que sempre parte da branch principal.
 */
export default function StackBase({workspaceId,baseTask,checked,onChange}:{workspaceId:string;baseTask?:{id:string;title:string;environmentStatus?:string}|null;checked:boolean;onChange:(value:boolean)=>void}){
  const [pending,setPending]=useState<Pending[]>([]);
  useEffect(()=>{
    let alive=true;
    void fetch(`/api/workspaces/${workspaceId}`).then(r=>r.json()).then(data=>{
      if(!alive)return;
      const list=(data?.tasks||[]).filter((task:any)=>!task.missionId&&UNAPPLIED.includes(task.environment?.environmentStatus||task.environmentStatus)).map((task:any)=>({id:task.id,title:task.title}));
      setPending(list);
    }).catch(()=>{});
    return()=>{alive=false;};
  },[workspaceId]);
  const canStack=Boolean(baseTask&&['approved_waiting_action','manual_review_preserved'].includes(baseTask.environmentStatus||'approved_waiting_action'));
  if(canStack&&baseTask)return <label className="notice info stack-base">
    <span><input type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)}/> <strong>Continuar a partir do trabalho de «{baseTask.title}»</strong></span>
    <small>A nova task já começa com o que essa fez (ainda não aplicado). Aplicar a nova leva as duas para a branch principal, e enquanto ela existir a anterior não pode ser descartada. Desmarque para partir da branch principal.</small>
  </label>;
  const others=pending.filter(task=>task.id!==baseTask?.id);
  if(!others.length)return null;
  return <div className="notice warning stack-base">
    <strong>{others.length} task(s) aprovada(s) ainda não aplicada(s)</strong>
    <span>{others.slice(0,3).map(task=>`«${task.title}»`).join(', ')}{others.length>3?'…':''}</span>
    <small>Uma task nova parte da branch principal e <b>não enxerga</b> esse trabalho. Aplique-as antes ou, para continuar o trabalho de uma delas, abra a task e use o botão "Nova task" lá dentro.</small>
  </div>;
}
