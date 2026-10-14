/**
 * Decisões de parada do ciclo de correção automática. Funções puras: o PipelineRunner as consulta depois de cada
 * Developer e cada Reviewer para parar cedo (e explicar) em vez de gastar mais ciclos sem avançar.
 */
export type StopKind='needs_input'|'no_progress'|'repeated_issue';
export interface StopDecision{kind:StopKind;reason:string;questions:string[];denials?:Array<{tool:string;command:string}>}
export interface DeveloperOutcome{status?:string;summary?:string;filesChanged?:string[];testsRun?:Array<{status?:string}>;questions?:string[];permissionDenials?:Array<{tool:string;command:string}>}
export interface ReviewIssue{severity?:string;file?:string;description?:string}

const words=(text:string)=>new Set(String(text||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(word=>word.length>=4));
const similarity=(a:Set<string>,b:Set<string>)=>{if(!a.size||!b.size)return 0;let shared=0;for(const word of a)if(b.has(word))shared++;return shared/(a.size+b.size-shared);};
const fileKey=(issue:ReviewIssue)=>String(issue.file||'general').toLowerCase();

/** Dois conjuntos de problemas descrevem "o mesmo problema" quando a maioria cai no mesmo arquivo com texto parecido. */
export function sameIssues(current:ReviewIssue[],previous:ReviewIssue[]):boolean{
  if(!current.length||!previous.length)return false;
  const prior=previous.map(issue=>({file:fileKey(issue),words:words(issue.description||'')}));
  let matched=0;
  for(const issue of current){
    const w=words(issue.description||'');
    if(prior.some(p=>p.file===fileKey(issue)&&similarity(w,p.words)>=0.3))matched++;
  }
  return matched/current.length>=0.6;
}

const denialText=(denials:Array<{tool:string;command:string}>|undefined)=>denials?.length?` Comandos recusados pela política: ${denials.slice(0,3).map(d=>`"${d.command.slice(0,90)}"`).join('; ')}.`:'';

/** Depois de um Developer: ele pediu informação, ficou bloqueado, ou (em ciclo de correção) não fez nem executou nada. */
export function assessDeveloper(result:DeveloperOutcome|undefined,cycle:number):StopDecision|null{
  if(!result)return null;
  const questions=(result.questions||[]).filter(Boolean);
  const denials=result.permissionDenials;
  if(result.status==='BLOCKED'||questions.length){
    return{kind:'needs_input',questions,denials,reason:questions.length
      ?'O Developer precisa de uma informação sua para continuar.'
      :`O Developer terminou bloqueado e não conseguiu fazer o que foi pedido.${denialText(denials)} ${String(result.summary||'').slice(0,300)}`.trim()};
  }
  const changed=(result.filesChanged||[]).length>0;
  const executed=(result.testsRun||[]).some(test=>test.status&&test.status!=='skipped');
  // só conta como "sem progresso" quando o Developer declarou as duas listas e ambas estão vazias/ignoradas
  const declared=Array.isArray(result.filesChanged)&&Array.isArray(result.testsRun);
  if(cycle>=1&&declared&&!changed&&!executed){
    return{kind:'no_progress',questions:[],denials,reason:`Em uma rodada de correção o Developer não alterou nenhum arquivo e não executou nenhuma verificação.${denialText(denials)}`};
  }
  return null;
}

/** Depois de um Reviewer que pediu correção: se é o mesmo problema da rodada anterior, outra tentativa igual não adianta. */
export function assessReviewer(current:ReviewIssue[],previous:ReviewIssue[]|undefined):StopDecision|null{
  if(!previous||!sameIssues(current,previous))return null;
  return{kind:'repeated_issue',questions:[],reason:'O Reviewer apontou o mesmo problema duas rodadas seguidas: a correção automática não está resolvendo e outra tentativa igual só gastaria créditos.'};
}

/** Texto acrescentado ao prompt do Developer no ciclo seguinte quando o anterior teve chamadas recusadas. */
export function denialGuidanceText(denials:Array<{tool:string;command:string}>|undefined):string{
  if(!denials?.length)return '';
  return `TOOL DENIALS FROM YOUR PREVIOUS RUN\n${denials.slice(0,5).map(d=>`- ${d.tool}: ${d.command}`).join('\n')}\nThese were refused because they chained several commands or used a command that is not allowed. This does NOT mean Bash is unavailable: run each command alone (no &&, ;, |, $(...) or redirects), prefer the Read, Glob and Grep tools for reading files, and "php" / "node" scripts are allowed.`;
}

export function needsInputError(decision:StopDecision){
  return Object.assign(new Error(decision.reason),{kind:'needs_input',details:{stopKind:decision.kind,questions:decision.questions,denials:decision.denials||[]}});
}
