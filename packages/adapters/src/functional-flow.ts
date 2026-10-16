import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {existsSync,lstatSync,mkdtempSync,readdirSync,readFileSync,rmdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {getFreeLocalPort} from '@orchestrator/workspace';
import {requiredFlows,type FlowPage,type FlowPlan} from './flow-intelligence.js';

/**
 * Testes funcionais de ponta a ponta (PHP + HTTP local + MySQL ORQ_DB_*). O Developer declara os fluxos; o Tester os
 * executa de verdade e registra evidência por etapa.
 *
 * Garantias (hotfix):
 *  - Um fluxo obrigatório só é "validado" por PROVAS das etapas executadas (login com sessão, upload multipart,
 *    gravação no MySQL, listagem), correlacionadas pelo mesmo valor enviado. flowId/covers não validam nada.
 *  - Nada que possa gravar dados roda sem a garantia de que o código usa SOMENTE o banco isolado ORQ_DB_* (banco orq_*,
 *    host local, usuário não-root, sem credenciais reais no ambiente do PHP).
 *  - A limpeza remove só arquivos e registros comprovadamente criados pelo teste.
 */
export interface FlowHttpExpect{status?:number|number[];redirectTo?:string;bodyIncludes?:string[];bodyExcludes?:string[]}
export interface FlowFileUpload{name:string;content:string;contentType?:string}
export type FlowTestStep=
  |{id:string;title?:string;kind:'php';script:string}
  |{id:string;title?:string;kind:'http';method:'GET'|'POST';path:string;form?:Record<string,string>;files?:Record<string,FlowFileUpload>;follow?:boolean;expect?:FlowHttpExpect}
  |{id:string;title?:string;kind:'db';query:string;expect?:{min?:number;equals?:number;firstValue?:string}};
export interface FlowCleanup{kind:'db-exec';sql:string}
/** `covers` é aceito por compatibilidade, mas NÃO valida cobertura: quem valida são as provas das etapas. */
export interface FlowTest{flowId:string;name?:string;covers?:string[];steps:FlowTestStep[];cleanup?:FlowCleanup[]}

export type FlowStepStatus='passed'|'failed'|'skipped'|'blocked';
export interface FlowStepResult{id:string;title:string;kind:string;status:FlowStepStatus;evidence:string;durationMs:number}
export interface FlowProofs{login?:string;authenticatedAccess?:string;upload?:string;persistence?:string;listing?:string;token?:string;orderOk:boolean}
export interface FlowRunResult{flowId:string;name:string;status:'PASSED'|'FAILED'|'BLOCKED';steps:FlowStepResult[];proofs:FlowProofs;cleanup:{status:'done'|'partial'|'none';notes:string[]}}
export interface FunctionalFlowReport{
  status:'PASSED'|'FAILED'|'BLOCKED';
  required:Array<{flowId:string;name:string;validated:boolean;reason?:string}>;
  flows:FlowRunResult[];
  /** Verificações que não puderam ser feitas (ambiente/isolamento), distintas de falhas do código. */
  impossible:string[];notes:string[];
}

const SCRIPT=/^(?:database|scripts?|tests?|bin)\/[\w./-]+\.(?:php|js|mjs|cjs)$/;
const DB_NAME=/^orq_[a-z0-9]{1,24}$/;
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','::1']);
const SELECT_ONLY=/^\s*select\b[^;]*;?\s*$/i;
const DELETE_WHERE=/^\s*delete\s+from\s+`?(\w+)`?\s+where\s+([^;]+?)\s*;?\s*$/i;
const DROP_TABLE=/^\s*drop\s+table\s+if\s+exists\s+`?(\w+)`?\s*;?\s*$/i;
const bad=(message:string)=>Object.assign(new Error(message),{kind:'validation_error'});
const str=(value:unknown,max:number,label:string)=>{if(typeof value!=='string'||value.length>max)throw bad(`${label} inválido`);return value;};

/** Valida a proposta de fluxos do Developer (formato e limites). Lança validation_error. */
export function validateFlowTests(value:unknown):FlowTest[]{
  if(value===undefined)return[];
  if(!Array.isArray(value)||value.length>8)throw bad('functionalFlows deve ser uma lista com no máximo 8 fluxos');
  let size=0;try{size=JSON.stringify(value).length;}catch{throw bad('functionalFlows precisa ser JSON');}
  if(size>60000)throw bad('functionalFlows é grande demais');
  return value.map((raw,flowIndex)=>{
    if(!raw||typeof raw!=='object')throw bad(`fluxo ${flowIndex+1} inválido`);
    const flow=raw as Record<string,unknown>;
    const flowId=str(flow.flowId,60,'flowId');
    if(!Array.isArray(flow.steps)||!flow.steps.length||flow.steps.length>25)throw bad(`fluxo ${flowId}: de 1 a 25 etapas`);
    const ids=new Set<string>();
    const steps=flow.steps.map((rawStep,index)=>{
      if(!rawStep||typeof rawStep!=='object')throw bad(`fluxo ${flowId}: etapa ${index+1} inválida`);
      const step=rawStep as Record<string,unknown>;
      const id=typeof step.id==='string'&&step.id?step.id.slice(0,40):`s${index+1}`;
      if(ids.has(id))throw bad(`fluxo ${flowId}: etapa repetida ${id}`);ids.add(id);
      const title=typeof step.title==='string'?step.title.slice(0,160):undefined;
      if(step.kind==='php'){
        const script=str(step.script,160,'script');
        if(!SCRIPT.test(script)||script.split('/').includes('..'))throw bad(`fluxo ${flowId}: script fora de database/, scripts/, tests/ ou bin/`);
        return{id,title,kind:'php' as const,script};
      }
      if(step.kind==='http'){
        const method:'GET'|'POST'|null=step.method==='POST'?'POST':step.method==='GET'?'GET':null;if(!method)throw bad(`fluxo ${flowId}: método HTTP inválido`);
        const path=str(step.path,300,'path');
        if(!path.startsWith('/')||path.startsWith('//')||/[\s\\]|:\/\//.test(path))throw bad(`fluxo ${flowId}: o caminho precisa ser relativo ao servidor local`);
        const form=step.form===undefined?undefined:Object.fromEntries(Object.entries(step.form as Record<string,unknown>).slice(0,30).map(([k,v])=>[k.slice(0,60),str(v,500,'valor de formulário')]));
        let files:Record<string,FlowFileUpload>|undefined;
        if(step.files!==undefined){
          const entries=Object.entries(step.files as Record<string,Record<string,unknown>>);if(entries.length>4)throw bad(`fluxo ${flowId}: no máximo 4 arquivos`);
          files=Object.fromEntries(entries.map(([field,file])=>[field.slice(0,60),{name:str(file?.name,80,'nome do arquivo').replace(/[\\/]/g,'_'),content:str(file?.content,20000,'conteúdo do arquivo'),contentType:typeof file?.contentType==='string'?file.contentType.slice(0,80):undefined}]));
        }
        const e=step.expect as Record<string,unknown>|undefined;
        const list=(v:unknown)=>v===undefined?undefined:(Array.isArray(v)&&v.length<=10?v.map(item=>str(item,200,'texto esperado')):(()=>{throw bad(`fluxo ${flowId}: lista de textos inválida`);})());
        const status=e?.status===undefined?undefined:Array.isArray(e.status)?e.status.map(Number):Number(e.status);
        if(status!==undefined&&[status].flat().some(n=>!Number.isInteger(n)||n<100||n>599))throw bad(`fluxo ${flowId}: status esperado inválido`);
        return{id,title,kind:'http' as const,method,path,form,files,follow:step.follow===true,expect:e?{status,redirectTo:typeof e.redirectTo==='string'?e.redirectTo.slice(0,200):undefined,bodyIncludes:list(e.bodyIncludes),bodyExcludes:list(e.bodyExcludes)}:undefined};
      }
      if(step.kind==='db'){
        const query=str(step.query,500,'query');if(!SELECT_ONLY.test(query))throw bad(`fluxo ${flowId}: a verificação de banco aceita somente um SELECT`);
        const e=step.expect as Record<string,unknown>|undefined;
        return{id,title,kind:'db' as const,query,expect:e?{min:e.min===undefined?undefined:Number(e.min),equals:e.equals===undefined?undefined:Number(e.equals),firstValue:typeof e.firstValue==='string'?e.firstValue.slice(0,200):undefined}:undefined};
      }
      throw bad(`fluxo ${flowId}: tipo de etapa desconhecido`);
    });
    const cleanup=Array.isArray(flow.cleanup)?flow.cleanup.slice(0,10).map(item=>{
      const sql=str((item as Record<string,unknown>)?.sql,500,'sql de limpeza');
      if(!DELETE_WHERE.test(sql)&&!DROP_TABLE.test(sql))throw bad(`fluxo ${flowId}: a limpeza aceita somente DELETE FROM <tabela> WHERE <condição do teste> ou DROP TABLE IF EXISTS de tabela criada pelo teste`);
      return{kind:'db-exec' as const,sql};
    }):undefined;
    const covers=Array.isArray(flow.covers)?flow.covers.filter((c):c is string=>typeof c==='string').slice(0,8):undefined;
    return{flowId,name:typeof flow.name==='string'?flow.name.slice(0,120):undefined,covers,steps,cleanup};
  });
}

const PHP_DB_HELPER=`<?php
$mode=getenv('ORQ_FLOW_MODE');$sql=getenv('ORQ_FLOW_SQL');
try{
  $pdo=new PDO('mysql:host='.getenv('ORQ_DB_HOST').';port='.getenv('ORQ_DB_PORT').';dbname='.getenv('ORQ_DB_NAME').';charset=utf8mb4',getenv('ORQ_DB_USER'),getenv('ORQ_DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_TIMEOUT=>5]);
  if($mode==='exec'){echo json_encode(['affected'=>$pdo->exec($sql)]);exit(0);}
  $rows=$pdo->query($sql)->fetchAll(PDO::FETCH_NUM);
  echo json_encode(['rows'=>count($rows),'first'=>isset($rows[0][0])?(string)$rows[0][0]:null]);
}catch(Throwable $e){fwrite(STDERR,'erro de banco (código '.$e->getCode().')');exit(2);}
`;

const phpBinary=(env:Record<string,string|undefined>)=>{
  const candidates=[env.PHP_BIN,process.platform==='win32'?'C:/xampp/php/php.exe':undefined,'php'].filter((c):c is string=>Boolean(c));
  for(const candidate of candidates){try{if(spawnSync(candidate,['-v'],{encoding:'utf8',windowsHide:true}).status===0)return candidate;}catch{/* tenta o próximo */}}
  return null;
};

/** Ambiente dos processos PHP: ORQ_* do banco isolado e NADA de credenciais de banco do ambiente do host. */
const REAL_DB_ENV=/^(?:DB_|MYSQL_|MARIADB_|DATABASE_URL|PG(?:HOST|PORT|USER|PASSWORD|DATABASE))/i;
export function phpProcessEnv(base:NodeJS.ProcessEnv,orq:Record<string,string|undefined>):NodeJS.ProcessEnv{
  const out:NodeJS.ProcessEnv={};
  for(const [key,value] of Object.entries(base))if(!REAL_DB_ENV.test(key)&&!/^ORQ_DB_/.test(key))out[key]=value;
  for(const [key,value] of Object.entries(orq))if(/^ORQ_DB_/.test(key)&&value!==undefined)out[key]=value;
  return out;
}

// ---------- isolamento do banco ----------
const CONNECT=/\bnew\s+\\?PDO\s*\(|\bnew\s+\\?mysqli\s*\(|\bmysqli_connect\s*\(|\bmysql_connect\s*\(/;
const ORQ_VARS=['ORQ_DB_HOST','ORQ_DB_USER','ORQ_DB_PASSWORD','ORQ_DB_NAME'] as const;
const readsOrq=(source:string,name:string)=>new RegExp(`(?:getenv\\(\\s*|\\$_(?:ENV|SERVER)\\[\\s*)['"]${name}['"]`).test(source);
const INCLUDE=/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"$]+)['"]/g;
const ROOT_LITERAL=/(?:new\s+\\?(?:PDO|mysqli)\s*\([^)]*['"]root['"]|mysqli_connect\s*\([^)]*['"]root['"]|mysql_connect\s*\([^)]*['"]root['"]|\b(?:user|username|db_user)['"]?\s*(?:=>|=|,)\s*['"]root['"])/i;
const LITERAL_DBNAME=/dbname\s*=\s*([A-Za-z_][A-Za-z0-9_]*)(?=[;'"\s])/g;

function readSource(path:string){try{const stat=lstatSync(path);if(!stat.isFile()||stat.size>400*1024)return null;return readFileSync(path,'utf8');}catch{return null;}}

function targetFiles(location:string,test:FlowTest):string[]{
  const files=new Set<string>();
  const add=(rel:string)=>{const abs=resolve(location,rel);if(abs.startsWith(resolve(location)+sep)&&existsSync(abs)&&lstatSync(abs).isFile())files.add(abs);};
  for(const step of test.steps){
    if(step.kind==='php')add(step.script);
    if(step.kind==='http'){
      const pathname=decodeURIComponent(step.path.split('?')[0].split('#')[0]).replace(/^\/+/,'');
      if(!pathname||pathname.endsWith('/')){add(join(pathname,'index.php'));continue;}
      const abs=resolve(location,pathname);
      if(abs.startsWith(resolve(location)+sep)&&existsSync(abs)&&lstatSync(abs).isFile())add(pathname);
      else add('index.php'); // o servidor embutido do PHP cai no index.php da raiz
    }
  }
  return[...files];
}

function includeClosure(location:string,start:string[]):string[]{
  const seen=new Set<string>(),queue=[...start];
  while(queue.length&&seen.size<40){
    const file=queue.shift()!;if(seen.has(file))continue;seen.add(file);
    const source=readSource(file);if(source===null)continue;
    for(const match of source.matchAll(INCLUDE)){
      const rel=match[1];const candidates=[resolve(dirname(file),rel.replace(/^\/+/,'')),resolve(location,rel.replace(/^\/+/,''))];
      for(const candidate of candidates){if(candidate.startsWith(resolve(location)+sep)&&existsSync(candidate)&&!seen.has(candidate)){queue.push(candidate);break;}}
    }
  }
  return[...seen];
}

export interface IsolationVerdict{safe:boolean;reasons:string[];notes:string[];connects:boolean}
/**
 * Antes de executar PHP/HTTP que possa gravar dados: o código alcançável pelo teste só pode usar o banco isolado.
 * Sem garantia suficiente, bloqueia e informa o motivo. Nunca cai para credenciais reais.
 */
export function checkDatabaseIsolation(location:string,test:FlowTest,env:Record<string,string|undefined>):IsolationVerdict{
  const reasons:string[]=[],notes:string[]=[];
  const files=includeClosure(location,targetFiles(location,test));
  const sources=files.map(file=>({file:relative(location,file).replace(/\\/g,'/'),source:readSource(file)||''}));
  const connecting=sources.filter(item=>CONNECT.test(item.source));
  const connects=connecting.length>0;
  const envOk=Boolean(env.ORQ_DB_NAME&&DB_NAME.test(env.ORQ_DB_NAME)&&env.ORQ_DB_USER&&env.ORQ_DB_USER.toLowerCase()!=='root'&&env.ORQ_DB_HOST&&LOCAL_HOSTS.has(env.ORQ_DB_HOST.toLowerCase())&&env.ORQ_DB_PORT);
  const usesDb=connects||test.steps.some(s=>s.kind==='db'||s.kind==='php')||Boolean(test.cleanup?.length);
  if(usesDb&&!envOk)reasons.push('o banco de teste isolado (ORQ_DB_*: banco orq_*, host local, usuário diferente de root) não está disponível');
  if(connects){
    const all=sources.map(item=>item.source).join('\n');
    for(const name of ORQ_VARS)if(!readsOrq(all,name))reasons.push(`o código que conecta ao MySQL (${connecting.map(c=>c.file).join(', ')}) não lê ${name}; poderia usar um banco real`);
    for(const item of sources){
      if(ROOT_LITERAL.test(item.source))reasons.push(`${item.file}: usa o usuário root do MySQL`);
      for(const match of item.source.matchAll(LITERAL_DBNAME))if(!match[1].startsWith('orq_'))reasons.push(`${item.file}: o banco "${match[1]}" está fixo no código`);
    }
    if(!reasons.length&&sources.some(item=>/getenv\(\s*['"]ORQ_DB_[A-Z]+['"]\s*\)\s*(?:\?:|\?\?|\|\|)/.test(item.source)))notes.push('O código tem valores padrão para ORQ_DB_*; como o ambiente do teste define todas as variáveis, o padrão não é usado.');
  }
  return{safe:reasons.length===0,reasons:[...new Set(reasons)],notes,connects};
}

// ---------- provas por etapa ----------
const meaningful=(step:Extract<FlowTestStep,{kind:'http'}>)=>Boolean(step.expect?.redirectTo||step.expect?.bodyIncludes?.some(text=>text.trim().length>=3));
const pathOf=(path:string)=>{try{return decodeURIComponent(path.split('?')[0].split('#')[0]);}catch{return path;}};
const routeMatches=(path:string,route:string|undefined)=>Boolean(route)&&(pathOf(path)===route||pathOf(path).endsWith(route!));
const stem=(name:string)=>name.replace(/\.[^.]+$/,'');
const tokensOfUpload=(step:Extract<FlowTestStep,{kind:'http'}>)=>[...Object.values(step.files||{}).map(f=>f.name),...Object.values(step.form||{}).filter(v=>v.length>=4)];
const tableMentioned=(query:string,tables:string[])=>tables.some(table=>new RegExp(`\\b${table}\\b`,'i').test(query));

interface ExecutedStep{spec:FlowTestStep;result:FlowStepResult;hadCookies:boolean;cookiesAfter:number}
interface PlanTargets{loginRoute?:string;guarded:string[];upload?:FlowPage;lister?:FlowPage;loginPage?:FlowPage}
const targetsOf=(plan:FlowPlan|undefined):PlanTargets=>{
  const page=(file?:string)=>plan?.pages.find(p=>p.file===file);
  const uploadFile=plan?.flows.find(f=>f.id==='flow-upload')?.files[0];
  const listFile=plan?.flows.find(f=>f.id==='flow-listing')?.files[0];
  const loginPage=page(plan?.auth.loginPage);
  return{loginRoute:loginPage?.route,loginPage,guarded:(plan?.auth.guardedPages||[]).map(f=>`/${f}`),upload:page(uploadFile),lister:page(listFile)};
};

/** Procura, em ordem, as provas de login, acesso autenticado, upload, gravação e listagem — todas correlacionadas. */
export function collectProofs(plan:FlowPlan|undefined,executed:ExecutedStep[]):FlowProofs&{gaps:string[]}{
  const t=targetsOf(plan);const gaps:string[]=[];const proofs:FlowProofs&{gaps:string[]}={orderOk:false,gaps};
  const passed=(i:number)=>executed[i].result.status==='passed';
  const http=(i:number)=>executed[i].spec.kind==='http'?executed[i].spec as Extract<FlowTestStep,{kind:'http'}>:null;
  let loginIdx=-1,uploadIdx=-1,dbIdx=-1,listIdx=-1,authIdx=-1;let token='';
  for(let i=0;i<executed.length;i++){
    const s=http(i);if(!s||!passed(i))continue;
    if(loginIdx<0&&s.method==='POST'&&routeMatches(s.path,t.loginRoute)&&meaningful(s)&&executed[i].cookiesAfter>0)loginIdx=i;
  }
  if(loginIdx>=0)proofs.login=executed[loginIdx].spec.id;
  else gaps.push(t.loginRoute?`login: nenhum POST em ${t.loginRoute} com verificação específica (redirecionamento ou texto) e sessão recebida`:'login: nenhuma página de login foi identificada no código');
  if(loginIdx>=0){
    for(let i=loginIdx+1;i<executed.length;i++){
      const s=http(i);if(!s||!passed(i)||!meaningful(s)||!executed[i].hadCookies)continue;
      if(t.guarded.some(g=>routeMatches(s.path,g))){authIdx=i;break;}
    }
    if(authIdx>=0)proofs.authenticatedAccess=executed[authIdx].spec.id;
    else if(t.guarded.length)gaps.push(`acesso autenticado: nenhuma requisição com a sessão a uma página protegida (${t.guarded[0]}) com verificação específica`);
  }
  const uploadRoutes=[t.upload?.route,...(t.upload?.forms.filter(f=>f.multipart).map(f=>f.action.startsWith('/')?f.action:`/${f.action.replace(/^\.?\//,'')}`)||[])];
  for(let i=Math.max(loginIdx,-1)+1;i<executed.length;i++){
    const s=http(i);if(!s||!passed(i)||s.method!=='POST'||!s.files||!Object.keys(s.files).length)continue;
    if(!uploadRoutes.some(r=>routeMatches(s.path,r)))continue;
    if(!meaningful(s))continue;
    if(t.upload?.requiresAuth&&(loginIdx<0||!executed[i].hadCookies))continue;
    uploadIdx=i;token=tokensOfUpload(s)[0]||'';break;
  }
  if(uploadIdx>=0){proofs.upload=executed[uploadIdx].spec.id;proofs.token=token;}
  else gaps.push(t.upload?`upload: nenhum POST multipart com arquivo em ${t.upload.route} com verificação específica${t.upload.requiresAuth?' e sessão autenticada':''}`:'upload: nenhum ponto de upload foi identificado no código');
  const written=t.upload?.tablesWritten||[];
  if(uploadIdx>=0&&written.length){
    const tokens=tokensOfUpload(executed[uploadIdx].spec as Extract<FlowTestStep,{kind:'http'}>);
    for(let i=uploadIdx+1;i<executed.length;i++){
      const s=executed[i].spec;if(s.kind!=='db'||!passed(i))continue;
      const nontrivial=s.expect?(s.expect.min!==undefined&&s.expect.min>=1)||(s.expect.equals!==undefined&&s.expect.equals>=1)||s.expect.firstValue!==undefined:true;
      if(tableMentioned(s.query,written)&&tokens.some(tk=>tk&&(s.query.includes(tk)||s.query.includes(stem(tk))))&&nontrivial){dbIdx=i;break;}
    }
    if(dbIdx>=0)proofs.persistence=executed[dbIdx].spec.id;
    else gaps.push(`gravação: nenhum SELECT em ${written.join(', ')} citando o valor enviado no upload (arquivo/campo) e esperando ao menos 1 registro`);
  }
  if(uploadIdx>=0){
    const tokens=tokensOfUpload(executed[uploadIdx].spec as Extract<FlowTestStep,{kind:'http'}>);
    const after=Math.max(uploadIdx,dbIdx);
    for(let i=after+1;i<executed.length;i++){
      const s=http(i);if(!s||!passed(i)||s.method!=='GET'||!routeMatches(s.path,t.lister?.route))continue;
      if(tokens.some(tk=>tk&&s.expect?.bodyIncludes?.some(text=>text.includes(tk)||text.includes(stem(tk))))){listIdx=i;break;}
    }
    if(listIdx>=0)proofs.listing=executed[listIdx].spec.id;
    else gaps.push(t.lister?`listagem: nenhum GET em ${t.lister.route}, depois do upload, esperando o valor enviado (${token||'arquivo'}) na resposta`:'listagem: nenhuma página que liste os dados enviados foi identificada no código');
  }else gaps.push('listagem: sem upload provado não há o que listar');
  proofs.orderOk=loginIdx>=0&&uploadIdx>loginIdx&&(!written.length||dbIdx>uploadIdx)&&listIdx>Math.max(uploadIdx,dbIdx);
  return proofs;
}

type RunProofs=FlowProofs&{gaps:string[]};
/** Um fluxo obrigatório só vale com as provas próprias dele (e, no completo, todas juntas, em ordem, no mesmo teste). */
function validateRequired(flow:{id:string},runs:Array<{status:string;proofs:RunProofs}>,plan:FlowPlan|undefined):{validated:boolean;reason?:string}{
  const t=targetsOf(plan);const written=(t.upload?.tablesWritten||[]).length>0;
  const okRuns=runs.filter(run=>run.status==='PASSED');
  if(!runs.length)return{validated:false,reason:'nenhum teste funcional foi declarado para este fluxo obrigatório'};
  if(!okRuns.length)return{validated:false,reason:runs.some(run=>run.status==='BLOCKED')?'o fluxo não pôde ser executado (verificação impossível ou bloqueada por segurança; veja o motivo)':'o teste do fluxo não passou'};
  const rules:Record<string,(p:RunProofs)=>boolean>={
    'flow-auth':p=>Boolean(p.login)&&(!t.guarded.length||Boolean(p.authenticatedAccess)),
    'flow-upload':p=>(!t.upload?.requiresAuth||Boolean(p.login))&&Boolean(p.upload)&&(!written||Boolean(p.persistence)),
    'flow-listing':p=>Boolean(p.upload)&&Boolean(p.listing),
    'flow-completo':p=>Boolean(p.login)&&(!t.guarded.length||Boolean(p.authenticatedAccess))&&Boolean(p.upload)&&(!written||Boolean(p.persistence))&&Boolean(p.listing)&&p.orderOk
  };
  const rule=rules[flow.id];if(!rule)return{validated:okRuns.length>0};
  if(okRuns.some(run=>rule(run.proofs)))return{validated:true};
  const gaps=[...new Set(okRuns.flatMap(run=>run.proofs.gaps))];
  const orderGap=flow.id==='flow-completo'&&!gaps.length?['as provas não estão na ordem login → upload → gravação → listagem dentro do mesmo teste']:[];
  return{validated:false,reason:`faltam provas das etapas executadas: ${[...gaps,...orderGap].join('; ')||'cobertura insuficiente'}`};
}

// ---------- arquivos ----------
interface FileSnapshot{files:Map<string,string>;dirs:Set<string>}
const SKIP_DIRS=new Set(['.git','node_modules','vendor']);
function snapshot(root:string):FileSnapshot{
  const files=new Map<string,string>(),dirs=new Set<string>();
  const visit=(dir:string)=>{let names:string[];try{names=readdirSync(dir);}catch{return;}for(const name of names){if(SKIP_DIRS.has(name))continue;const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch{continue;}if(stat.isSymbolicLink())continue;if(stat.isDirectory()){dirs.add(path);visit(path);}else if(stat.isFile())files.set(path,`${stat.size}:${Math.round(stat.mtimeMs)}`);}};
  visit(root);return{files,dirs};
}

const redact=(text:string,env:Record<string,string|undefined>)=>{let out=text;for(const secret of [env.ORQ_DB_PASSWORD,env.ORQ_DB_USER])if(secret&&secret.length>=3)out=out.split(secret).join('***');return out;};
const snippet=(text:string,max=160)=>text.replace(/\s+/g,' ').trim().slice(0,max);

export interface RunFlowsOptions{
  location:string;plan?:FlowPlan;tests:FlowTest[];env:Record<string,string|undefined>;
  signal?:AbortSignal;onProgress?:(message:string)=>void;stepTimeoutMs?:number;
}

export async function runFunctionalFlows(options:RunFlowsOptions):Promise<FunctionalFlowReport>{
  const {location,plan,tests,env}=options;
  const required=requiredFlows(plan);
  const impossible:string[]=[],notes:string[]=[];
  const report:FunctionalFlowReport={status:'PASSED',required:[],flows:[],impossible,notes};
  const php=tests.length?phpBinary(env):null;
  if(tests.length&&!php)impossible.push('PHP não está disponível neste ambiente: os fluxos não puderam ser executados.');
  const orqEnv:Record<string,string|undefined>=Object.fromEntries(Object.entries(env).filter(([k])=>/^ORQ_DB_/.test(k)));
  const childEnv=phpProcessEnv({...process.env,...(Object.fromEntries(Object.entries(env).filter(([k])=>!/^ORQ_DB_/.test(k))) as NodeJS.ProcessEnv)},orqEnv);

  const initial=snapshot(location);
  const created=new Map<string,string>(); // arquivo criado -> etapa que o criou (prova de autoria)
  let known=new Map(initial.files);
  const attribute=(stepId:string)=>{const now=snapshot(location);for(const file of now.files.keys())if(!known.has(file)&&!created.has(file))created.set(file,stepId);known=now.files;};

  const helperDir=mkdtempSync(join(tmpdir(),'orq-flow-'));writeFileSync(join(helperDir,'db.php'),PHP_DB_HELPER);
  let server:ChildProcess|undefined;let baseUrl='';let serverError='';
  const cookies=new Map<string,string>();

  const runProcess=(args:string[],extraEnv:Record<string,string>,timeoutMs:number)=>new Promise<{code:number|null;stdout:string;stderr:string}>(resolveRun=>{
    let stdout='',stderr='',done=false;
    const child=spawn(php!,args,{cwd:location,env:{...childEnv,...extraEnv} as NodeJS.ProcessEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolveRun({code,stdout,stderr});};
    const timer=setTimeout(()=>{try{child.kill();}catch{}stderr+='\n[tempo esgotado]';finish(null);},timeoutMs);
    child.stdout!.on('data',c=>{stdout+=c;});child.stderr!.on('data',c=>{stderr+=c;});
    child.on('error',e=>{stderr+=String(e.message);finish(null);});child.on('close',finish);
  });
  const sql=async(mode:'query'|'exec',statement:string)=>runProcess([join(helperDir,'db.php')],{ORQ_FLOW_MODE:mode,ORQ_FLOW_SQL:statement},20000);

  const ensureServer=async():Promise<boolean>=>{
    if(baseUrl)return true;if(serverError)return false;
    try{
      const port=await getFreeLocalPort();
      server=spawn(php!,['-S',`127.0.0.1:${port}`,'-t',location],{cwd:location,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
      server.on('error',e=>{serverError=String(e.message);});
      const deadline=Date.now()+8000;
      while(Date.now()<deadline){
        try{await fetch(`http://127.0.0.1:${port}/__orq_probe__`,{redirect:'manual',signal:AbortSignal.timeout(1000)});baseUrl=`http://127.0.0.1:${port}`;return true;}catch{await new Promise(r=>setTimeout(r,150));}
      }
      serverError='o servidor PHP local não respondeu a tempo';
    }catch(error){serverError=String((error as Error).message);}
    return false;
  };

  const sendHttp=async(step:Extract<FlowTestStep,{kind:'http'}>):Promise<{ok:boolean;evidence:string}>=>{
    const cookieHeader=()=>[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    const absorb=(headers:Headers)=>{for(const line of headers.getSetCookie?.()||[]){const [pair]=line.split(';');const eq=pair.indexOf('=');if(eq>0)cookies.set(pair.slice(0,eq).trim(),pair.slice(eq+1).trim());}};
    const request=async(method:string,path:string,body?:FormData|URLSearchParams)=>{
      const response=await fetch(baseUrl+path,{method,body,redirect:'manual',headers:cookies.size?{cookie:cookieHeader()}:{},signal:AbortSignal.timeout(options.stepTimeoutMs||15000)});
      absorb(response.headers);return response;
    };
    let body:FormData|URLSearchParams|undefined;
    if(step.method==='POST'){
      if(step.files&&Object.keys(step.files).length){const data=new FormData();for(const [k,v] of Object.entries(step.form||{}))data.append(k,v);for(const [field,file] of Object.entries(step.files))data.append(field,new Blob([file.content],{type:file.contentType||'application/octet-stream'}),file.name);body=data;}
      else body=new URLSearchParams(step.form||{});
    }
    let response=await request(step.method,step.path,body);
    const hops:string[]=[`${step.method} ${step.path} → ${response.status}${response.headers.get('location')?` Location: ${response.headers.get('location')}`:''}`];
    const firstLocation=response.headers.get('location')||'';const firstStatus=response.status;
    let hop=0;
    while(step.follow&&response.status>=300&&response.status<400&&response.headers.get('location')&&hop<3){
      const target=new URL(response.headers.get('location')!,baseUrl+step.path);
      if(target.origin!==baseUrl){return{ok:false,evidence:`${hops.join(' | ')} | redirecionamento para fora do servidor local recusado`};}
      response=await request('GET',target.pathname+target.search);hop++;hops.push(`GET ${target.pathname} → ${response.status}`);
    }
    const text=await response.text();
    const problems:string[]=[];
    const expect=step.expect;
    const finalStatus=response.status;
    if(expect?.status!==undefined){
      const list=[expect.status].flat();
      const check=step.follow?finalStatus:firstStatus;
      if(!list.includes(check))problems.push(`status ${check}, esperado ${list.join(' ou ')}`);
    }else if(!expect?.redirectTo&&finalStatus>=400)problems.push(`status ${finalStatus} (erro HTTP)`);
    if(expect?.redirectTo&&!firstLocation.includes(expect.redirectTo))problems.push(`redirecionamento para "${firstLocation||'(nenhum)'}", esperado conter "${expect.redirectTo}"`);
    for(const needle of expect?.bodyIncludes||[])if(!text.includes(needle))problems.push(`a resposta não contém "${needle}"`);
    for(const needle of expect?.bodyExcludes||[])if(text.includes(needle))problems.push(`a resposta contém "${needle}", que não deveria aparecer`);
    if(/(?:Fatal error|Parse error|Uncaught \w+)/.test(text))problems.push(`erro PHP na resposta: ${snippet(text.slice(Math.max(0,text.search(/Fatal error|Parse error|Uncaught/)),400),140)}`);
    const sessionNote=cookies.size?` · cookies na sessão: ${[...cookies.keys()].join(', ')}`:'';
    const evidence=`${hops.join(' | ')}${sessionNote}${expect?.bodyIncludes?.length&&!problems.length?` · contém ${expect.bodyIncludes.map(n=>`"${n}"`).join(', ')}`:''}`;
    return problems.length?{ok:false,evidence:`${evidence} · FALHA: ${problems.join('; ')}`}:{ok:true,evidence};
  };

  const runStep=async(step:FlowTestStep,blockedReason?:string):Promise<FlowStepResult>=>{
    const started=Date.now();const title=step.title||(step.kind==='http'?`${step.method} ${step.path}`:step.kind==='php'?`php ${step.script}`:`SELECT: ${snippet(step.query,60)}`);
    const done=(status:FlowStepStatus,evidence:string):FlowStepResult=>({id:step.id,title,kind:step.kind,status,evidence:redact(evidence,env),durationMs:Date.now()-started});
    if(blockedReason)return done('blocked',`bloqueada: ${blockedReason}`);
    if(!php)return done('blocked','impossível: PHP indisponível');
    try{
      if(step.kind==='php'){
        if(!existsSync(join(location,step.script)))return done('failed',`o script ${step.script} não existe`);
        const result=await runProcess([step.script],{},60000);attribute(step.id);
        return result.code===0?done('passed',`php ${step.script} → código 0 · ${snippet(result.stdout)||'(sem saída)'}`):done('failed',`php ${step.script} → código ${result.code} · ${snippet(result.stderr||result.stdout)}`);
      }
      if(step.kind==='db'){
        const result=await sql('query',step.query);
        if(result.code!==0)return done('failed',`consulta falhou · ${snippet(result.stderr)}`);
        let parsed:{rows:number;first:string|null};try{parsed=JSON.parse(result.stdout);}catch{return done('failed','resposta inesperada do verificador de banco');}
        const value=parsed.first!==null&&/^-?\d+$/.test(parsed.first)&&/^\s*select\s+count\(/i.test(step.query)?Number(parsed.first):parsed.rows;
        const problems:string[]=[];
        if(step.expect?.equals!==undefined&&value!==step.expect.equals)problems.push(`valor ${value}, esperado ${step.expect.equals}`);
        const min=step.expect?.min??(step.expect?.equals===undefined&&step.expect?.firstValue===undefined?1:undefined);
        if(min!==undefined&&value<min)problems.push(`valor ${value}, esperado pelo menos ${min}`);
        if(step.expect?.firstValue!==undefined&&parsed.first!==step.expect.firstValue)problems.push(`primeiro valor diferente do esperado`);
        const evidence=`SELECT → ${parsed.rows} linha(s)${parsed.first!==null?`, primeiro valor ${snippet(parsed.first,60)}`:''}`;
        return problems.length?done('failed',`${evidence} · FALHA: ${problems.join('; ')}`):done('passed',evidence);
      }
      if(!(await ensureServer()))return done('blocked',`impossível: ${serverError||'servidor PHP local indisponível'}`);
      const result=await sendHttp(step);attribute(step.id);
      return done(result.ok?'passed':'failed',result.evidence);
    }catch(error){return done('failed',`erro ao executar a etapa: ${snippet(String((error as Error)?.message||error))}`);}
  };

  /** Valores que o próprio teste cria/usa: só registros que os citam podem ser limpos. */
  const testTokens=(test:FlowTest)=>{const out=new Set<string>();for(const s of test.steps){if(s.kind==='http'){for(const v of Object.values(s.form||{}))if(v.length>=4)out.add(v);for(const f of Object.values(s.files||{})){out.add(f.name);out.add(stem(f.name));}}if(s.kind==='db')for(const m of s.query.matchAll(/'([^']{4,})'/g))out.add(m[1].replace(/%/g,''));}return[...out].filter(Boolean);};

  const executedByTest:Array<{flowId:string;status:string;proofs:RunProofs}>=[];
  try{
    for(const test of tests){
      if(options.signal?.aborted)break;
      cookies.clear();
      options.onProgress?.(`Executando fluxo ${test.flowId}`);
      const verdict=checkDatabaseIsolation(location,test,env);
      for(const note of verdict.notes)if(!notes.includes(note))notes.push(note);
      const steps:FlowStepResult[]=[];const executed:ExecutedStep[]=[];let failed=false,blocked=false;
      const blockedReason=verdict.safe?undefined:verdict.reasons.join('; ');
      if(blockedReason){const message=`Execução bloqueada por segurança (nenhum PHP/HTTP/SQL foi executado): ${blockedReason}`;if(!impossible.includes(message))impossible.push(message);}
      const preexisting:Map<number,number>=new Map();let tablesBefore=new Set<string>();
      if(verdict.safe&&php&&test.cleanup?.length){
        for(const [index,item] of test.cleanup.entries()){
          const del=DELETE_WHERE.exec(item.sql);
          if(del){const before=await sql('query',`SELECT COUNT(*) FROM \`${del[1]}\` WHERE ${del[2]}`);let n=0;try{n=before.code===0?Number(JSON.parse(before.stdout).first)||0:0;}catch{n=0;}preexisting.set(index,n);}
        }
        const listing=await sql('query',"SELECT GROUP_CONCAT(table_name SEPARATOR ',') FROM information_schema.tables WHERE table_schema=DATABASE()");
        try{if(listing.code!==0)throw new Error('sem lista');const first=JSON.parse(listing.stdout).first as string|null;tablesBefore=new Set((first||'').split(',').filter(Boolean).map(n=>n.toLowerCase()));}catch{tablesBefore=new Set(['*']);}
      }
      for(const step of test.steps){
        if(failed||blocked){steps.push({id:step.id,title:step.title||step.id,kind:step.kind,status:'skipped',evidence:failed?'não executada: uma etapa anterior falhou':'não executada: uma etapa anterior não pôde ser executada',durationMs:0});continue;}
        const hadCookies=cookies.size>0;
        const result=await runStep(step,blockedReason);steps.push(result);executed.push({spec:step,result,hadCookies,cookiesAfter:cookies.size});
        if(result.status==='failed')failed=true;if(result.status==='blocked')blocked=true;
      }
      const cleanupNotes:string[]=[];let cleanupStatus:'done'|'partial'|'none'='none';
      if(test.cleanup?.length){
        cleanupStatus='done';const tokens=testTokens(test);
        for(const [index,item] of test.cleanup.entries()){
          if(!verdict.safe||!php){cleanupStatus='partial';cleanupNotes.push('limpeza de banco não executada (banco isolado não garantido)');continue;}
          const del=DELETE_WHERE.exec(item.sql),drop=DROP_TABLE.exec(item.sql);
          if(del){
            const literals=[...del[2].matchAll(/'([^']{3,})'/g)].map(m=>m[1].replace(/%/g,'')).filter(Boolean);
            if(!literals.some(lit=>tokens.some(tk=>tk.includes(lit)||lit.includes(tk)))){cleanupStatus='partial';cleanupNotes.push(`limpeza não executada: o WHERE de "${snippet(item.sql,60)}" não cita um valor criado pelo teste`);continue;}
            if((preexisting.get(index)||0)>0){cleanupStatus='partial';cleanupNotes.push(`limpeza não executada: já existiam ${preexisting.get(index)} registro(s) em ${del[1]} que casam com a condição antes do teste; preservados`);continue;}
          }else if(drop){
            if(tablesBefore.has('*')||tablesBefore.has(drop[1].toLowerCase())){cleanupStatus='partial';cleanupNotes.push(`limpeza não executada: a tabela ${drop[1]} já existia antes do teste (ou não foi possível provar o contrário); preservada`);continue;}
          }
          const result=await sql('exec',item.sql);
          if(result.code!==0){cleanupStatus='partial';cleanupNotes.push(`limpeza falhou: ${snippet(redact(result.stderr,env),100)}`);}
          else cleanupNotes.push(`limpeza: ${snippet(item.sql,70)}`);
        }
      }
      const proofs=collectProofs(plan,executed);
      const status:FlowRunResult['status']=failed?'FAILED':blocked?'BLOCKED':'PASSED';
      const run:FlowRunResult={flowId:test.flowId,name:test.name||plan?.flows.find(f=>f.id===test.flowId)?.name||test.flowId,status,steps,proofs,cleanup:{status:cleanupStatus,notes:cleanupNotes}};
      report.flows.push(run);executedByTest.push({flowId:test.flowId,status,proofs});
    }

    // Cobertura por PROVAS: flowId/covers não validam. Cada fluxo obrigatório precisa das provas próprias dele.
    const allRuns=executedByTest;
    for(const flow of required){
      const verdict=validateRequired(flow,allRuns,plan);
      report.required.push({flowId:flow.id,name:flow.name,validated:verdict.validated,reason:verdict.reason});
    }
    if(report.flows.some(f=>f.status==='FAILED'))report.status='FAILED';
    else if(report.required.some(r=>!r.validated)||report.flows.some(f=>f.status==='BLOCKED'))report.status='BLOCKED';
  }finally{
    if(server){try{server.kill();}catch{/* já encerrado */}}
    // Limpeza de arquivos: só o que uma etapa comprovadamente criou. Arquivos preexistentes nunca são apagados.
    const removed:string[]=[];
    for(const [file,stepId] of created){
      if(initial.files.has(file))continue;
      if(!file.startsWith(resolve(location)+sep))continue;
      try{if(lstatSync(file).isFile()){unlinkSync(file);removed.push(`${relative(location,file).replace(/\\/g,'/')} (etapa ${stepId})`);}}catch{/* já removido */}
    }
    const finalSnap=snapshot(location);
    const newDirs=[...finalSnap.dirs].filter(dir=>!initial.dirs.has(dir)).sort((a,b)=>b.length-a.length);
    for(const dir of newDirs){try{if(readdirSync(dir).length===0)rmdirSync(dir);}catch{/* não está vazio: preservado */}}
    if(removed.length)notes.push(`Arquivos criados pelos fluxos e removidos: ${removed.slice(0,10).join(', ')}${removed.length>10?'…':''}`);
    const changed=[...initial.files].filter(([file,sig])=>finalSnap.files.has(file)&&finalSnap.files.get(file)!==sig).map(([file])=>relative(location,file).replace(/\\/g,'/'));
    const deleted=[...initial.files.keys()].filter(file=>!finalSnap.files.has(file)).map(file=>relative(location,file).replace(/\\/g,'/'));
    if(changed.length)notes.push(`Arquivos preexistentes alterados durante o teste (preservados, não revertidos): ${changed.slice(0,10).join(', ')}`);
    if(deleted.length)notes.push(`ATENÇÃO: arquivos preexistentes sumiram durante o teste: ${deleted.slice(0,10).join(', ')}`);
    try{rmSync(helperDir,{recursive:true,force:true});}catch{/* melhor esforço */}
  }
  return report;
}

/** Linhas de problema para o ciclo de correção: etapa que falhou, evidência e arquivos prováveis. */
export function flowIssues(report:FunctionalFlowReport|undefined,plan?:FlowPlan):string[]{
  if(!report)return[];
  const issues:string[]=[];
  for(const flow of report.flows){
    if(flow.status!=='FAILED')continue;
    const step=flow.steps.find(s=>s.status==='failed');
    const files=plan?.flows.find(f=>f.id===flow.flowId)?.files||[];
    issues.push(`TEST FAILURE; Functional flow: ${flow.name} (${flow.flowId}); Failed step: ${step?.id} - ${step?.title}; Evidence: ${step?.evidence.slice(0,400)}${files.length?`; Likely files (edit in place, do not recreate): ${files.join(', ')}`:''}`);
  }
  for(const item of report.required.filter(r=>!r.validated&&!report.flows.some(f=>f.flowId===r.flowId&&f.status==='FAILED')))
    issues.push(`REQUIRED FLOW NOT VALIDATED; ${item.name} (${item.flowId}): ${item.reason}`);
  return issues;
}
