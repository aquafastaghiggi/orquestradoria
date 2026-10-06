import {execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';

type SqliteConnection={prepare:(sql:string)=>{get:()=>unknown};close:()=>void};
export type SqliteDiagnostic={available:boolean;driver:string;mode:string;error?:string;cliAvailable:boolean};

export function sqliteCliAvailable(check=()=>{try{execFileSync('sqlite3',['--version'],{stdio:'ignore'});return true;}catch{return false;}}){return check();}

export function diagnoseSqlite(options:{createDatabase?:()=>SqliteConnection;cliCheck?:()=>boolean}={}):SqliteDiagnostic{
  const createDatabase=options.createDatabase||(()=>new Database(':memory:') as unknown as SqliteConnection);
  try{
    const database=createDatabase();
    try{
      const row=database.prepare('SELECT 1 AS ok').get() as {ok?:number};
      if(row?.ok!==1)throw new Error('SQLite smoke query returned an unexpected result');
    }finally{database.close();}
    return {available:true,driver:'better-sqlite3',mode:'Node.js embedded',cliAvailable:(options.cliCheck||sqliteCliAvailable)()};
  }catch(error){
    return {available:false,driver:'better-sqlite3',mode:'Node.js embedded',error:error instanceof Error?error.message:'unknown SQLite error',cliAvailable:(options.cliCheck||sqliteCliAvailable)()};
  }
}
