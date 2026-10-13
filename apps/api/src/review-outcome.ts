/** Resultado do Reviewer → status da task. A ÚLTIMA revisão manda: um APPROVED depois de um ciclo de Auto-Fix cancela o NEEDS_FIX anterior. */
export type ReviewerTaskStatus='approved'|'needs_fix';
export const reviewerOutcome=(status:unknown):ReviewerTaskStatus=>status==='NEEDS_FIX'?'needs_fix':'approved';

interface RepairInput{status?:string;environmentStatus?:string|null;executions:{role:string;status?:string;startedAt?:string;structuredResult?:any}[];}

/**
 * Uma task marcada needs_fix cuja ÚLTIMA execução do pipeline é um Reviewer concluído e APROVADO (sem Developer/Tester depois dele)
 * foi marcada errado (defeito antigo do Auto-Fix). Só nesse caso pode ser reparada para approved.
 */
export function wasWronglyMarkedNeedsFix(input:RepairInput):boolean{
  if(input.status!=='needs_fix')return false;
  const ordered=[...input.executions].sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')));
  const last=ordered[ordered.length-1];
  return Boolean(last&&last.role==='reviewer'&&last.status==='completed'&&last.structuredResult?.status==='APPROVED');
}
