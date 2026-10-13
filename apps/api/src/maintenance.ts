import type Database from 'better-sqlite3';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

const FILE_PATTERN=/^orchestrator-(\d{4}-\d{2}-\d{2})(?:-\d{6})?\.db$/;

export const backupDir=(env:NodeJS.ProcessEnv=process.env)=>resolve(env.ORQ_BACKUP_DIR||join(process.cwd(),'storage','backups'));
export const backupKeep=(env:NodeJS.ProcessEnv=process.env)=>Math.max(1,Number(env.ORQ_BACKUP_KEEP)||14);

/** Pastas onde worktrees de tasks podem existir: a estável (padrão) e a antiga, na pasta temporária do Windows. */
export function worktreeRoots(env:NodeJS.ProcessEnv=process.env){
  const stable=resolve(env.TASK_WORKTREE_ROOT||join(process.cwd(),'storage','worktrees'));
  const legacy=resolve(join(tmpdir(),'orquestradoria-worktrees'));
  return[...new Set([stable,legacy])];
}

// ───────── Backup ─────────
export interface BackupInfo{file:string;path:string;sizeBytes:number;createdAt:string;}

const stamp=(now:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;};
const clock=(now:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return`${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;};

export function listBackups(dir:string):BackupInfo[]{
  if(!existsSync(dir))return[];
  return readdirSync(dir).filter(name=>FILE_PATTERN.test(name)).map(name=>{const path=join(dir,name);const stat=statSync(path);return{file:name,path,sizeBytes:stat.size,createdAt:stat.mtime.toISOString()};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export function pruneBackups(dir:string,keep:number){
  const removed:string[]=[];
  for(const item of listBackups(dir).slice(keep)){try{rmSync(item.path,{force:true});removed.push(item.file);}catch{/* arquivo em uso: tenta na próxima */}}
  return removed;
}

/** Cópia consistente do SQLite (API de backup online do better-sqlite3), segura mesmo com o servidor em uso. */
export async function backupDatabase(db:Database.Database,dir:string,now=new Date(),opts:{unique?:boolean}={}):Promise<BackupInfo>{
  mkdirSync(dir,{recursive:true});
  const file=`orchestrator-${stamp(now)}${opts.unique?`-${clock(now)}`:''}.db`;
  const path=join(dir,file);
  await db.backup(path);
  const stat=statSync(path);
  return{file,path,sizeBytes:stat.size,createdAt:stat.mtime.toISOString()};
}

/** Faz o backup do dia se ainda não existir; devolve null quando já havia um de hoje. */
export async function ensureDailyBackup(db:Database.Database,dir:string,keep:number,now=new Date()){
  const today=stamp(now);
  if(listBackups(dir).some(item=>item.file.startsWith(`orchestrator-${today}`)))return null;
  const info=await backupDatabase(db,dir,now);
  pruneBackups(dir,keep);
  return info;
}

// ───────── Disco e worktrees ─────────
export function dirSize(path:string,deadlineMs=4000):number{
  const deadline=Date.now()+deadlineMs;
  const walk=(current:string):number=>{
    if(Date.now()>deadline)return 0;
    let total=0;
    let entries:string[];
    try{entries=readdirSync(current);}catch{return 0;}
    for(const name of entries){
      const child=join(current,name);
      try{const stat=statSync(child);total+=stat.isDirectory()?walk(child):stat.size;}catch{/* ignora arquivos que sumiram */}
    }
    return total;
  };
  try{return statSync(path).isDirectory()?walk(path):statSync(path).size;}catch{return 0;}
}

const OWNER_MARKER='.orq-owner';

/**
 * Uma pasta raiz de worktrees só pode ter órfãos removidos pelo banco que a "reivindicou" (marca `.orq-owner` com o caminho do banco).
 * Sem isso, dois bancos compartilhando a mesma pasta (ou a antiga pasta temporária) apagariam o trabalho um do outro.
 */
export function claimRoot(root:string,dbPath:string):'owned'|'foreign'{
  mkdirSync(root,{recursive:true});
  const marker=join(root,OWNER_MARKER);
  if(!existsSync(marker))writeFileSync(marker,resolve(dbPath).toLowerCase());
  try{return readFileSync(marker,'utf8').trim()===resolve(dbPath).toLowerCase()?'owned':'foreign';}catch{return 'foreign';}
}

/** Somente a raiz estável pode ser "owned"; a antiga pasta temporária nunca é reivindicada. */
export function ownedRoots(roots:string[],dbPath:string):string[]{return roots.length&&claimRoot(roots[0],dbPath)==='owned'?[roots[0]]:[];}

export interface OrphanWorktree{path:string;sizeBytes:number;reason:'no_record'|'finished';}

/** Estados em que o ambiente da task ainda pode ser necessário ao usuário: NUNCA são removidos. */
const KEEP_ENVIRONMENT=new Set(['active','preparing','approved_waiting_action','failed_preserved','manual_review_preserved','apply_conflict','applying','discarding','cleanup_failed','environment_missing']);

const norm=(path:string)=>resolve(path).toLowerCase();

export function findOrphanWorktrees(db:Database.Database,roots:string[],owned:string[]=roots):OrphanWorktree[]{
  const ownedSet=new Set(owned.map(norm));
  const records=new Map<string,string>(); // caminho -> environmentStatus
  for(const row of db.prepare("SELECT worktreePath AS p,environmentStatus AS s FROM tasks WHERE worktreePath IS NOT NULL").all() as {p:string;s:string|null}[])records.set(norm(row.p),String(row.s||''));
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='missions'").get())
    for(const row of db.prepare("SELECT worktreePath AS p,environmentStatus AS s FROM missions WHERE worktreePath IS NOT NULL").all() as {p:string;s:string|null}[])records.set(norm(row.p),String(row.s||''));
  const orphans:OrphanWorktree[]=[];
  for(const root of roots){
    if(!existsSync(root))continue;
    for(const workspaceDir of safeList(root)){
      const workspacePath=join(root,workspaceDir);
      if(!isDirectory(workspacePath))continue;
      for(const taskDir of safeList(workspacePath)){
        const path=join(workspacePath,taskDir);
        if(!isDirectory(path))continue;
        const state=records.get(norm(path));
        if(state===undefined){if(ownedSet.has(norm(root)))orphans.push({path,sizeBytes:dirSize(path),reason:'no_record'});}
        else if(!KEEP_ENVIRONMENT.has(state)&&(state==='applied'||state==='discarded'))orphans.push({path,sizeBytes:dirSize(path),reason:'finished'});
      }
    }
  }
  return orphans;
}

const safeList=(path:string)=>{try{return readdirSync(path);}catch{return[] as string[];}};
const isDirectory=(path:string)=>{try{return statSync(path).isDirectory();}catch{return false;}};

/** Remove um worktree órfão, mas só se estiver DENTRO de uma das raízes conhecidas (nunca segue caminhos arbitrários). */
export function removeOrphan(path:string,roots:string[]):boolean{
  const target=resolve(path);
  const inside=roots.some(root=>{const base=resolve(root);return target!==base&&target.startsWith(base+sep);});
  if(!inside||!existsSync(target))return false;
  rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:200});
  return !existsSync(target);
}
