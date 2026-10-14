import type Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';

/**
 * Desfazer aplicação: o Apply é um `git merge --no-ff` na branch base. Desfazer = `git revert -m 1` do commit de merge, ou seja,
 * um NOVO commit que restaura o estado anterior (nenhum histórico é apagado, nada de reset --hard). Só é oferecido quando nada
 * mudou na branch depois do Apply, para nunca reverter por cima de trabalho posterior.
 */
export interface ApplyRecord{id:number;kind:'task'|'mission';refId:string;workspaceId:string;baseBranch:string;preSha:string;postSha:string;appliedAt:string;undoneAt:string|null;undoSha:string|null;}

export function ensureApplyHistory(db:Database.Database){
  db.exec('CREATE TABLE IF NOT EXISTS apply_history (id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,refId TEXT NOT NULL,workspaceId TEXT NOT NULL,baseBranch TEXT NOT NULL,preSha TEXT NOT NULL,postSha TEXT NOT NULL,appliedAt TEXT NOT NULL,undoneAt TEXT,undoSha TEXT)');
}

const git=(cwd:string,args:string[],identity=false)=>execFileSync('git',[...(identity?['-c','user.name=Orquestradoria','-c','user.email=orquestradoria@localhost']:[]),...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
export const gitHead=(cwd:string)=>{try{return git(cwd,['rev-parse','HEAD']);}catch{return '';}};

/** Só registra quando o Apply realmente moveu a branch (HEAD mudou). */
export function recordApply(db:Database.Database,input:{kind:'task'|'mission';refId:string;workspaceId:string;baseBranch:string;preSha:string;postSha:string},now=new Date()){
  ensureApplyHistory(db);
  if(!input.preSha||!input.postSha||input.preSha===input.postSha)return null;
  return db.prepare('INSERT INTO apply_history (kind,refId,workspaceId,baseBranch,preSha,postSha,appliedAt) VALUES (?,?,?,?,?,?,?)').run(input.kind,input.refId,input.workspaceId,input.baseBranch,input.preSha,input.postSha,now.toISOString()).lastInsertRowid;
}

export function latestApply(db:Database.Database,kind:'task'|'mission',refId:string):ApplyRecord|undefined{
  ensureApplyHistory(db);
  return db.prepare('SELECT * FROM apply_history WHERE kind=? AND refId=? ORDER BY id DESC LIMIT 1').get(kind,refId) as ApplyRecord|undefined;
}

export interface UndoCheck{available:boolean;reason?:string;alreadyUndone?:boolean;}

export function checkUndo(record:ApplyRecord|undefined,workspacePath:string):UndoCheck{
  if(!record)return{available:false,reason:'Não há registro desta aplicação (feita antes deste recurso existir).'};
  if(record.undoneAt)return{available:false,alreadyUndone:true,reason:'Esta aplicação já foi desfeita.'};
  try{
    const branch=git(workspacePath,['rev-parse','--abbrev-ref','HEAD']);
    if(branch!==record.baseBranch)return{available:false,reason:`A pasta do projeto está na branch "${branch}", não em "${record.baseBranch}". Volte para "${record.baseBranch}" para desfazer.`};
    if(gitHead(workspacePath)!==record.postSha)return{available:false,reason:'Houve novos commits na branch depois da aplicação. Desfazer automaticamente poderia reverter trabalho posterior; faça o revert manualmente.'};
    if(git(workspacePath,['status','--porcelain','--untracked-files=no']))return{available:false,reason:'Há alterações não commitadas na pasta do projeto. Commite ou descarte antes de desfazer.'};
    return{available:true};
  }catch(error){return{available:false,reason:`Não foi possível verificar o Git: ${error instanceof Error?error.message:String(error)}`};}
}

export function undoApply(db:Database.Database,record:ApplyRecord,workspacePath:string,now=new Date()):{revertSha:string}{
  const check=checkUndo(record,workspacePath);
  if(!check.available)throw Object.assign(new Error(check.reason||'Não é possível desfazer.'),{status:409,code:'undo_unavailable'});
  const parents=git(workspacePath,['rev-list','--parents','-n','1',record.postSha]).split(/\s+/).length-1;
  try{
    git(workspacePath,['revert',...(parents>1?['-m','1']:[]),'--no-edit',record.postSha],true);
  }catch(error){
    try{git(workspacePath,['revert','--abort']);}catch{/* nada a abortar */}
    throw Object.assign(new Error(`O Git não conseguiu reverter automaticamente: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`),{status:409,code:'undo_conflict'});
  }
  const revertSha=gitHead(workspacePath);
  db.prepare('UPDATE apply_history SET undoneAt=?,undoSha=? WHERE id=?').run(now.toISOString(),revertSha,record.id);
  return{revertSha};
}

/**
 * Refazer: depois de desfazer, `undoSha` é o commit de reversão. Reverter a reversão restaura as alterações (novo commit, nada é
 * reescrito) e registra uma nova aplicação, que pode ser desfeita de novo. Mesmas travas de segurança do desfazer.
 */
export function checkRedo(record:ApplyRecord|undefined,workspacePath:string):UndoCheck{
  if(!record||!record.undoneAt||!record.undoSha)return{available:false,reason:'Não há aplicação desfeita para refazer.'};
  try{
    const branch=git(workspacePath,['rev-parse','--abbrev-ref','HEAD']);
    if(branch!==record.baseBranch)return{available:false,reason:`A pasta do projeto está na branch "${branch}", não em "${record.baseBranch}". Volte para "${record.baseBranch}" para refazer.`};
    if(gitHead(workspacePath)!==record.undoSha)return{available:false,reason:'Houve novos commits depois do desfazer. Refazer automaticamente poderia misturar com trabalho posterior; faça o revert da reversão manualmente.'};
    if(git(workspacePath,['status','--porcelain','--untracked-files=no']))return{available:false,reason:'Há alterações não commitadas na pasta do projeto. Commite ou descarte antes de refazer.'};
    return{available:true};
  }catch(error){return{available:false,reason:`Não foi possível verificar o Git: ${error instanceof Error?error.message:String(error)}`};}
}

export function redoApply(db:Database.Database,record:ApplyRecord,workspacePath:string,now=new Date()):{redoSha:string}{
  const check=checkRedo(record,workspacePath);
  if(!check.available)throw Object.assign(new Error(check.reason||'Não é possível refazer.'),{status:409,code:'redo_unavailable'});
  try{git(workspacePath,['revert','--no-edit',record.undoSha!],true);}
  catch(error){
    try{git(workspacePath,['revert','--abort']);}catch{/* nada a abortar */}
    throw Object.assign(new Error(`O Git não conseguiu refazer automaticamente: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`),{status:409,code:'redo_conflict'});
  }
  const redoSha=gitHead(workspacePath);
  db.prepare('INSERT INTO apply_history (kind,refId,workspaceId,baseBranch,preSha,postSha,appliedAt) VALUES (?,?,?,?,?,?,?)').run(record.kind,record.refId,record.workspaceId,record.baseBranch,record.undoSha!,redoSha,now.toISOString());
  return{redoSha};
}