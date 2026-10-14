import {execFileSync} from 'node:child_process';
import type {ClaudeDeveloperResult} from './claude.js';

/**
 * Recuperação de saída estruturada do Developer.
 *
 * Caso real (2026-10-13): o Claude fez o trabalho (arquivos alterados) mas a mensagem final não veio como JSON válido, e a etapa
 * inteira falhou ("Claude structured output is not valid JSON"). O JSON é só metadado; a verdade são as alterações no workspace.
 * Quando existem alterações reais e o texto não declara BLOCKED, reconstruímos um resultado COMPLETED com aviso explícito e o
 * Tester/Reviewer validam o conteúdo de verdade.
 */

/** Arquivos alterados/novos no workspace segundo o Git (vazio se não for repositório ou o Git falhar). */
export function listWorkspaceChanges(cwd:string,run:typeof execFileSync=execFileSync):string[]{
  try{
    const out=String(run('git',['status','--porcelain','-uall'],{cwd,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','ignore']}));
    return out.split(/\r?\n/).map(line=>line.slice(3).trim()).map(entry=>entry.includes(' -> ')?entry.split(' -> ').pop()!:entry).map(entry=>entry.replace(/^"|"$/g,'')).filter(Boolean);
  }catch{return[];}
}

/** Texto final do modelo: o campo `result` do envelope JSON do CLI, ou a saída crua. */
export function finalModelText(stdout:string):{text:string;isError:boolean}{
  const raw=String(stdout||'').trim();
  try{
    const parsed=JSON.parse(raw);
    const envelope=Array.isArray(parsed)?[...parsed].reverse().find((item:any)=>item&&typeof item==='object'&&'result' in item):parsed;
    if(envelope&&typeof envelope==='object')return{text:typeof envelope.result==='string'?envelope.result:'',isError:envelope.is_error===true||envelope.subtype==='error'};
  }catch{/* não é envelope: usa a saída crua */}
  return{text:raw,isError:false};
}

const BLOCKED=/"status"\s*:\s*"BLOCKED"|\bBLOCKED\b/;

export function recoverDeveloperResult(input:{stdout:string;changedFiles:string[]}):(ClaudeDeveloperResult&{warnings:{code:string;message:string}[]})|undefined{
  if(!input.changedFiles.length)return undefined;
  const {text,isError}=finalModelText(input.stdout);
  const trimmed=text.replace(/```[a-z]*\s*|```/gi,'').trim();
  if(isError||!trimmed||BLOCKED.test(trimmed))return undefined;
  const summary=trimmed.length>600?`${trimmed.slice(0,600).trimEnd()}…`:trimmed;
  return{
    status:'COMPLETED',
    summary:`[Resumo reconstruído: a resposta final do Claude não veio em JSON] ${summary}`,
    filesChanged:[...new Set(input.changedFiles)],
    testsRun:[],
    notes:['A saída final do Claude não veio em JSON válido. O resultado foi reconstruído a partir das alterações detectadas no workspace; Tester e Reviewer validam o conteúdo real.'],
    browserScenarios:[],
    warnings:[{code:'structured_output_recovered',message:'Saída estruturada inválida; resultado reconstruído a partir das alterações do workspace.'}],
  };
}
