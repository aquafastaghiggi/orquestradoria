import {spawn,type ChildProcess} from 'node:child_process';
import {lstatSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {getFreeLocalPort} from '@orchestrator/workspace';
import {checkDatabaseIsolation} from './database-isolation.js';
import {phpBinary,phpProcessEnv} from './functional-flow.js';
import type {ServerVerification} from './verification.js';
import type {TestCommand} from './project-detector.js';
import type {TesterCommandResult} from './tester.js';

/**
 * Verificações do Developer que precisam de um servidor (`php database/verificar_fluxo.php http://127.0.0.1:8099`).
 * Antes o Tester as ignorava ("precisa de um servidor em execução"), o Reviewer cobrava a prova e o ciclo se repetia.
 * Agora o Tester sobe um `php -S 127.0.0.1:<porta livre>` temporário, troca a porta do URL, roda o script e encerra o servidor.
 *
 * Só roda com a garantia de isolamento do banco (checkDatabaseIsolation sobre TODAS as páginas PHP que o servidor pode servir):
 * sem ela, a verificação não é executada e o motivo é informado. Nunca usa URL externa nem banco real.
 */
const SKIP_DIRS=new Set(['.git','node_modules','vendor','uploads','storage','tmp','temp','logs']);
function phpPages(root:string):string[]{
  const out:string[]=[];
  const visit=(dir:string,depth:number)=>{
    if(out.length>=120||depth>4)return;
    let names:string[];try{names=readdirSync(dir).sort();}catch{return;}
    for(const name of names){
      const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch{continue;}
      if(stat.isSymbolicLink())continue;
      if(stat.isDirectory()){if(!SKIP_DIRS.has(name))visit(path,depth+1);}
      else if(/\.php$/i.test(name))out.push(relative(root,path).replace(/\\/g,'/'));
    }
  };
  visit(root,0);return out;
}

export interface ServerVerificationOutcome{result?:TesterCommandResult;skipped?:string}
export async function runServerVerification(options:{
  location:string;server:ServerVerification;env:NodeJS.ProcessEnv;orq:Record<string,string|undefined>;
  run:(command:TestCommand,env:NodeJS.ProcessEnv)=>Promise<TesterCommandResult>;
}):Promise<ServerVerificationOutcome>{
  const {location,server,orq}=options;
  const php=phpBinary({...(options.env as Record<string,string|undefined>),...orq});
  if(!php)return{skipped:'PHP não está disponível para subir o servidor local'};
  const script=server.command.args[0];
  const verdict=checkDatabaseIsolation(location,{steps:[{kind:'php',script},...phpPages(location).map(path=>({kind:'http',path:`/${path}`}))]},orq);
  if(!verdict.safe)return{skipped:`bloqueada por segurança, nenhum PHP foi executado: ${verdict.reasons.join('; ')}`};
  const env=phpProcessEnv({...process.env,...(options.env||{})} as NodeJS.ProcessEnv,orq);
  const port=await getFreeLocalPort();
  const child:ChildProcess=spawn(php,['-S',`127.0.0.1:${port}`,'-t',location],{cwd:location,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let failed='';(child as unknown as NodeJS.EventEmitter).on('error',(error:Error)=>{failed=error.message;});
  try{
    let ready=false;const deadline=Date.now()+8000;
    while(!ready&&!failed&&Date.now()<deadline){
      try{await fetch(`http://127.0.0.1:${port}/__orq_probe__`,{redirect:'manual',signal:AbortSignal.timeout(1000)});ready=true;}catch{await new Promise(resolve=>setTimeout(resolve,150));}
    }
    if(!ready)return{skipped:`o servidor PHP local temporário não respondeu${failed?` (${failed})`:''}`};
    const args=server.command.args.map((arg,index)=>index===server.urlArg?`http://127.0.0.1:${port}`:arg);
    const command:TestCommand={...server.command,label:`${server.command.label} (servidor PHP local temporário)`,args};
    return{result:await options.run(command,env)};
  }finally{
    await new Promise<void>(done=>{
      if(child.exitCode!==null||child.signalCode!==null)return done();
      const timer=setTimeout(done,3000);
      (child as unknown as NodeJS.EventEmitter).once('exit',()=>{clearTimeout(timer);done();});
      try{child.kill();}catch{clearTimeout(timer);done();}
    });
  }
}
