import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

/**
 * Dependências do monorepo no WORKTREE isolado da autocorreção, antes do Tester.
 *
 * - Roda `pnpm install --frozen-lockfile` somente com cwd no worktree (recusa o diretório da instância em execução), então só o
 *   `node_modules` do worktree é criado; a instância ativa não é tocada. O store do pnpm é compartilhado (somente adiciona pacotes).
 * - Sem `node_modules`, o Tester resolvia `@orchestrator/*` para o dist do checkout principal e validava o código errado.
 * - Idempotente: um marcador com o hash do pnpm-lock.yaml evita reinstalar quando já está pronto.
 * - Falha com o comando completo, o código de saída e o fim de stdout/stderr (sem cores), nunca em silêncio.
 */
export interface DepsResult{status:'skipped'|'prepared'|'failed';reason?:string;command:string;cwd:string;exitCode?:number|null;stdout:string;stderr:string;durationMs:number}
export type DepsRunner=(command:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number})=>Promise<{code:number|null;stdout:string;stderr:string;timedOut?:boolean}>;

/** Ambiente das ferramentas do monorepo no worktree: o pnpm instalado pode divergir do `packageManager` fixado (Corepack). */
export const SELF_REPAIR_TOOL_ENV:Record<string,string>={npm_config_pm_on_fail:'ignore',COREPACK_ENABLE_STRICT:'0',CI:'true'};

export const INSTALL_ARGS=['install','--frozen-lockfile','--prefer-offline'];
const MARKER='.orq-deps-lock-hash';
const TAIL=6000;
export const stripAnsi=(text:string)=>String(text).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g,'');
const tail=(text:string,max=TAIL)=>{const clean=stripAnsi(text);return clean.length<=max?clean:`…[+${clean.length-max} caracteres]\n${clean.slice(-max)}`;};

export const defaultRunner:DepsRunner=(command,args,{cwd,env,timeoutMs})=>new Promise(resolveRun=>{
  let stdout='',stderr='',done=false,timedOut=false;
  const child=spawn(command,args,{cwd,env,shell:process.platform==='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
  const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolveRun({code,stdout,stderr,timedOut});};
  const timer=setTimeout(()=>{timedOut=true;try{child.kill();}catch{/* já encerrou */}},timeoutMs);
  child.stdout!.on('data',c=>{stdout+=c;if(stdout.length>400000)stdout=stdout.slice(-200000);});
  child.stderr!.on('data',c=>{stderr+=c;if(stderr.length>400000)stderr=stderr.slice(-200000);});
  const events=child as unknown as NodeJS.EventEmitter;
  events.on('error',(error:Error)=>{stderr+=String(error.message);finish(null);});
  events.on('close',(code:number|null)=>finish(code));
});

export async function prepareWorktreeDependencies(worktree:string,repoRoot:string,options:{env?:NodeJS.ProcessEnv;run?:DepsRunner;timeoutMs?:number}={}):Promise<DepsResult>{
  const cwd=resolve(worktree);
  const command=`pnpm ${INSTALL_ARGS.join(' ')}`;
  const base={command,cwd,stdout:'',stderr:'',durationMs:0};
  if(cwd===resolve(repoRoot))throw Object.assign(new Error('Preparação de dependências recusada: o diretório é a instância em execução, não um worktree isolado.'),{kind:'configuration_error'});
  if(!existsSync(join(cwd,'package.json')))return{...base,status:'skipped',reason:'o worktree não tem package.json'};
  const lockFile=join(cwd,'pnpm-lock.yaml');
  if(!existsSync(lockFile))return{...base,status:'skipped',reason:'o worktree não tem pnpm-lock.yaml; nada a instalar de forma reproduzível'};
  const hash=createHash('sha256').update(readFileSync(lockFile)).digest('hex');
  const marker=join(cwd,'node_modules',MARKER);
  try{if(existsSync(marker)&&readFileSync(marker,'utf8').trim()===hash)return{...base,status:'skipped',reason:'dependências já preparadas para este pnpm-lock.yaml'};}catch{/* reinstala */}
  const started=Date.now();
  const env={...process.env,...SELF_REPAIR_TOOL_ENV,...(options.env||{})} as NodeJS.ProcessEnv;
  const result=await (options.run||defaultRunner)('pnpm',INSTALL_ARGS,{cwd,env,timeoutMs:options.timeoutMs??10*60*1000});
  const durationMs=Date.now()-started;
  if(result.code===0){
    try{mkdirSync(join(cwd,'node_modules'),{recursive:true});writeFileSync(marker,hash);}catch{/* sem marcador: reinstala na próxima vez */}
    return{status:'prepared',command,cwd,exitCode:0,stdout:tail(result.stdout),stderr:tail(result.stderr),durationMs};
  }
  return{status:'failed',reason:result.timedOut?'tempo esgotado instalando as dependências':`o comando terminou com código ${result.code}`,command,cwd,exitCode:result.code,stdout:tail(result.stdout),stderr:tail(result.stderr),durationMs};
}

/** Mensagem de falha com tudo que é preciso para reproduzir: comando, diretório, código e saída. */
export function describeDepsFailure(result:DepsResult){
  return [`Falha ao preparar as dependências do worktree (${result.reason||'erro'}).`,`Comando: ${result.command}`,`Diretório: ${result.cwd}`,`Código de saída: ${result.exitCode??'n/a'}`,`stdout:\n${result.stdout||'(vazio)'}`,`stderr:\n${result.stderr||'(vazio)'}`].join('\n');
}
