import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {existsSync,mkdirSync,mkdtempSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupDatabase,claimRoot,dirSize,ensureDailyBackup,findOrphanWorktrees,listBackups,ownedRoots,pruneBackups,removeOrphan,worktreeRoots} from './maintenance.js';

const tmp=()=>mkdtempSync(join(tmpdir(),'maint-'));

test('backup is a consistent, restorable copy and the daily one is made only once',async()=>{
  const dir=tmp(),backups=join(dir,'b');
  try{
    const db=new Database(join(dir,'orchestrator.db'));
    db.exec("CREATE TABLE t(a TEXT)");db.prepare('INSERT INTO t VALUES (?)').run('dado importante');
    const now=new Date(2026,9,13,10,0,0);
    const first=await ensureDailyBackup(db,backups,14,now);
    assert.ok(first&&first.file==='orchestrator-2026-10-13.db'&&first.sizeBytes>0);
    assert.equal(await ensureDailyBackup(db,backups,14,new Date(2026,9,13,18,0,0)),null);
    const restored=new Database(first!.path,{readonly:true});
    assert.equal((restored.prepare('SELECT a FROM t').get() as any).a,'dado importante');
    restored.close();
    const manual=await backupDatabase(db,backups,new Date(2026,9,13,19,30,5),{unique:true});
    assert.match(manual.file,/^orchestrator-2026-10-13-193005\.db$/);
    assert.equal(listBackups(backups).length,2);
    db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('pruning keeps only the newest backups and ignores unrelated files',()=>{
  const dir=tmp();
  try{
    for(let day=1;day<=5;day++){const path=join(dir,`orchestrator-2026-10-0${day}.db`);writeFileSync(path,'x');const time=new Date(2026,9,day);utimesSync(path,time,time);}
    writeFileSync(join(dir,'minhas-notas.txt'),'não mexer');
    const removed=pruneBackups(dir,2);
    assert.equal(removed.length,3);
    assert.deepEqual(listBackups(dir).map(item=>item.file),['orchestrator-2026-10-05.db','orchestrator-2026-10-04.db']);
    assert.equal(existsSync(join(dir,'minhas-notas.txt')),true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('orphan finder removes only dirs with no record or already finished; never protects-nothing-in-use',()=>{
  const root=tmp();
  try{
    const mk=(rel:string)=>{const path=join(root,rel);mkdirSync(path,{recursive:true});writeFileSync(join(path,'f.txt'),'123456');return path;};
    const waiting=mk('w1/t-waiting'),failed=mk('w1/t-failed'),applied=mk('w1/t-applied'),orphan=mk('w1/t-orphan'),mission=mk('w2/mission-m1'),discarded=mk('w2/t-discarded');
    const db=new Database(':memory:');
    db.exec('CREATE TABLE tasks(id TEXT,worktreePath TEXT,environmentStatus TEXT);CREATE TABLE missions(id TEXT,worktreePath TEXT,environmentStatus TEXT);');
    const insert=db.prepare('INSERT INTO tasks VALUES (?,?,?)');
    insert.run('1',waiting,'approved_waiting_action');insert.run('2',failed,'failed_preserved');insert.run('3',applied,'applied');insert.run('4',discarded,'discarded');
    db.prepare('INSERT INTO missions VALUES (?,?,?)').run('m1',mission,'active');
    const found=findOrphanWorktrees(db,[root]);
    const byPath=Object.fromEntries(found.map(item=>[item.path,item.reason]));
    assert.deepEqual(byPath,{[orphan]:'no_record',[applied]:'finished',[discarded]:'finished'});
    assert.ok(found.every(item=>item.sizeBytes>=6));
    // remoção: só dentro da raiz
    assert.equal(removeOrphan(orphan,[root]),true);
    assert.equal(existsSync(orphan),false);
    assert.equal(removeOrphan(waiting,['C:\\outra-raiz']),false);
    assert.equal(removeOrphan(root,[root]),false); // nunca a própria raiz
    assert.equal(removeOrphan(join(root,'..'),[root]),false);
    assert.equal(existsSync(waiting),true);
    assert.equal(dirSize(root)>0,true);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('worktree roots default to a stable folder plus the legacy temp one',()=>{
  const roots=worktreeRoots({} as NodeJS.ProcessEnv);
  assert.equal(roots.length,2);
  assert.match(roots[0].replace(/\\/g,'/'),/storage\/worktrees$/);
  assert.equal(worktreeRoots({TASK_WORKTREE_ROOT:join(tmpdir(),'meu-root')} as NodeJS.ProcessEnv)[0],join(tmpdir(),'meu-root'));
});

test('a root claimed by another database is never cleaned (protects work of a different DB or the legacy temp root)',()=>{
  const root=tmp();
  try{
    const other=join(root,'w1','tarefa-de-outro-banco');mkdirSync(other,{recursive:true});writeFileSync(join(other,'f.txt'),'meu trabalho');
    const db=new Database(':memory:');
    db.exec('CREATE TABLE tasks(id TEXT,worktreePath TEXT,environmentStatus TEXT);');
    assert.equal(claimRoot(root,'C:\\bancos\\A.db'),'owned');
    assert.equal(claimRoot(root,'C:\\bancos\\A.db'),'owned');
    assert.equal(claimRoot(root,'C:\\bancos\\B.db'),'foreign');
    assert.deepEqual(ownedRoots([root],'C:\\bancos\\B.db'),[]);
    assert.deepEqual(findOrphanWorktrees(db,[root],ownedRoots([root],'C:\\bancos\\B.db')),[]);
    assert.equal(findOrphanWorktrees(db,[root],ownedRoots([root],'C:\\bancos\\A.db')).length,1);
    // a raiz antiga (índice > 0) nunca é reivindicada
    assert.deepEqual(ownedRoots([join(root,'estavel'),root],'C:\\bancos\\A.db'),[join(root,'estavel')]);
  }finally{rmSync(root,{recursive:true,force:true});}
});