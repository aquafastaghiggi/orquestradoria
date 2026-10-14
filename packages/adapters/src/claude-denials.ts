/** Chamadas de ferramenta que a política de permissões do Claude Code recusou durante a execução. */
export interface PermissionDenial{tool:string;command:string}

function parseEnvelope(stdout:string):any{
  const text=String(stdout||'').trim();
  if(!text)return undefined;
  try{return JSON.parse(text);}catch{}
  const lines=text.split(/\r?\n/).reverse();
  for(const line of lines){const candidate=line.trim();if(candidate.startsWith('{')){try{return JSON.parse(candidate);}catch{}}}
  return undefined;
}

/** Lê `permission_denials` do envelope JSON do CLI. O comando é cortado em 300 caracteres. */
export function extractPermissionDenials(stdout:string,limit=8):PermissionDenial[]{
  const envelope=parseEnvelope(stdout);
  const list=Array.isArray(envelope?.permission_denials)?envelope.permission_denials:[];
  return list.slice(0,limit).map((item:any)=>({
    tool:String(item?.tool_name||'tool'),
    command:String(item?.tool_input?.command??item?.tool_input?.file_path??JSON.stringify(item?.tool_input||{})).replace(/\s+/g,' ').slice(0,300)
  }));
}
