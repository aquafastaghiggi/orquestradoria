/**
 * Memória do projeto (por workspace): um texto que o usuário edita e que as tasks aprovadas completam sozinhas.
 * Entra no contexto do Developer e do Reviewer, para cada task não precisar redescobrir como o projeto roda.
 */
export const MAX_KNOWLEDGE_CHARS=6000;
export const AUTO_HEADING='## Aprendido automaticamente';
const MAX_AUTO_LINES=20;
const SAFE_COMMAND=/^(php|node|pnpm|npm|composer|python|py)\s+[\w./\\:@=-][^\n]*$/i;

export interface DeveloperLearnings{notes?:string[];testsRun?:Array<{command?:string;status?:string}>}

const tidy=(text:string,max:number)=>String(text||'').replace(/\s+/g,' ').trim().slice(0,max);

/** O que vale guardar de uma task aprovada: fatos marcados pelo Developer (`KNOWLEDGE: ...`) e comandos simples que passaram. */
export function extractLearnings(result:DeveloperLearnings|undefined):string[]{
  if(!result)return[];
  const facts=(result.notes||[]).map(note=>String(note).match(/^\s*KNOWLEDGE:\s*(.+)$/is)?.[1]).filter((text):text is string=>Boolean(text&&text.trim())).slice(0,3).map(text=>`- ${tidy(text,260)}`);
  const commands=(result.testsRun||[]).filter(test=>test.status==='passed'&&typeof test.command==='string').map(test=>tidy(test.command!,140)).filter(command=>SAFE_COMMAND.test(command)&&!/(&&|\|\||[;|<>`$])/.test(command)).slice(0,3).map(command=>`- Comando verificado que funcionou: \`${command}\``);
  return[...facts,...commands];
}

/** Junta as linhas aprendidas ao texto, sem duplicar, mantendo só as 20 mais recentes e o limite total. A parte do usuário nunca é cortada. */
export function mergeLearnings(content:string,lines:string[]):string{
  const text=String(content||'');
  const index=text.indexOf(AUTO_HEADING);
  const user=(index>=0?text.slice(0,index):text).trimEnd();
  const existing=index>=0?text.slice(index+AUTO_HEADING.length).split('\n').map(line=>line.trim()).filter(line=>line.startsWith('- ')):[];
  const kept=[...existing,...lines.filter(line=>!existing.includes(line))].slice(-MAX_AUTO_LINES);
  const build=()=>`${user?`${user}\n\n`:''}${AUTO_HEADING}\n${kept.join('\n')}\n`;
  while(build().length>MAX_KNOWLEDGE_CHARS&&kept.length>0)kept.shift();
  return kept.length?build():`${user}${user?'\n':''}`;
}

export function validateKnowledge(content:unknown):string{
  if(typeof content!=='string')throw Object.assign(new Error('O texto da memória é obrigatório.'),{status:400});
  if(content.length>MAX_KNOWLEDGE_CHARS)throw Object.assign(new Error(`A memória do projeto aceita no máximo ${MAX_KNOWLEDGE_CHARS} caracteres.`),{status:400});
  return content.replace(/\r\n/g,'\n');
}

/** Trecho enviado ao prompt (o limite protege o custo de tokens). */
export const knowledgeForPrompt=(content:string|null|undefined,max=4000)=>String(content||'').trim().slice(0,max);
