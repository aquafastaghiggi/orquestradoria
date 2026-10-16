import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {existsSync,lstatSync,mkdtempSync,readdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {getFreeLocalPort} from '@orchestrator/workspace';
import {requiredFlows,type FlowPlan} from './flow-intelligence.js';

/**
 * Testes funcionais de ponta a ponta (PHP + HTTP local + MySQL ORQ_DB_*). O Developer declara os fluxos; o Tester os
 * executa de verdade e registra evidência por etapa. Só usa o servidor PHP local, o banco de teste descartável (orq_*),
 * dados temporários e limpeza ao final. Nada aqui chama a rede externa nem um banco real.
 */
export interface FlowHttpExpect{status?:number|number[];redirectTo?:string;bodyIncludes?:string[];bodyExcludes?:string[]}
export interface FlowFileUpload{name:string;content:string;contentType?:string}
export type FlowTestStep=
  |{id:string;title?:string;kind:'php';script:string}
  |{id:string;title?:string;kind:'http';method:'GET'|'POST';path:string;form?:Record<string,string>;files?:Record<string,FlowFileUpload>;follow?:boolean;expect?:FlowHttpExpect}
  |{id:string;title?:string;kind:'db';query:string;expect?:{min?:number;equals?:number;firstValue?:string}};
export interface FlowCleanup{kind:'db-exec';sql:string}
export interface FlowTest{flowId:string;name?:string;covers?:string[];steps:FlowTestStep[];cleanup?:FlowCleanup[]}

export type FlowStepStatus='passed'|'failed'|'skipped'|'blocked';
export interface FlowStepResult{id:string;title:string;kind:string;status:FlowStepStatus;evidence:string;durationMs:number}
export interface FlowRunResult{flowId:string;name:string;status:'PASSED'|'FAILED'|'BLOCKED';steps:FlowStepResult[];cleanup:{status:'done'|'partial'|'none';notes:string[]}}
export interface FunctionalFlowReport{
  status:'PASSED'|'FAILED'|'BLOCKED';
  required:Array<{flowId:string;name:string;validated:boolean;reason?:string}>;
  flows:FlowRunResult[];
  /** Verificações que não puderam ser feitas (ambiente), distintas de falhas do código. */
  impossible:string[];notes:string[];
}

const SCRIPT=/^(?:database|scripts?|tests?|bin)\/[\w./-]+\.(?:php|js|mjs|cjs)$/;
const DB_NAME=/^orq_[a-z0-9]{1,24}$/;
const SELECT_ONLY=/^\s*select\b[^;]*;?\s*$/i;
const CLEANUP_SQL=/^\s*(?:delete\s+from\s+`?\w+`?|truncate\s+table\s+`?\w+`?|drop\s+table\s+if\s+exists\s+`?\w+`?)\b[^;]*;?\s*$/i;
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
      const sql=str((item as Record<string,unknown>)?.sql,500,'sql de limpeza');if(!CLEANUP_SQL.test(sql))throw bad(`fluxo ${flowId}: a limpeza aceita somente DELETE FROM, TRUNCATE TABLE ou DROP TABLE IF EXISTS`);
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

function listFiles(root:string):Set<string>{
  const out=new Set<string>();
  const visit=(dir:string)=>{let names:string[];try{names=readdirSync(dir);}catch{return;}for(const name of names){if(name==='.git'||name==='node_modules')continue;const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch{continue;}if(stat.isDirectory())visit(path);else if(stat.isFile())out.add(path);}};
  visit(root);return out;
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
  const needsPhp=tests.length>0;
  const php=needsPhp?phpBinary(env):null;
  if(needsPhp&&!php)impossible.push('PHP não está disponível neste ambiente: os fluxos não puderam ser executados.');
  const dbReady=Boolean(env.ORQ_DB_NAME&&DB_NAME.test(env.ORQ_DB_NAME)&&env.ORQ_DB_USER&&env.ORQ_DB_USER.toLowerCase()!=='root'&&env.ORQ_DB_HOST&&env.ORQ_DB_PORT);
  const usesDb=tests.some(t=>t.steps.some(s=>s.kind==='db'||s.kind==='php')||t.cleanup?.length);
  if(usesDb&&!dbReady)impossible.push('O banco de teste (ORQ_DB_*, banco orq_*) não está disponível: etapas de banco não puderam ser executadas.');

  const before=listFiles(location);
  const helperDir=mkdtempSync(join(tmpdir(),'orq-flow-'));writeFileSync(join(helperDir,'db.php'),PHP_DB_HELPER);
  let server:ChildProcess|undefined;let baseUrl='';let serverError='';
  const cookies=new Map<string,string>();

  const runProcess=(args:string[],extraEnv:Record<string,string>,timeoutMs:number)=>new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{
    let stdout='',stderr='',done=false;
    const child=spawn(php!,args,{cwd:location,env:{...process.env,...env,...extraEnv} as NodeJS.ProcessEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolve({code,stdout,stderr});};
    const timer=setTimeout(()=>{try{child.kill();}catch{}stderr+='\n[tempo esgotado]';finish(null);},timeoutMs);
    child.stdout!.on('data',c=>{stdout+=c;});child.stderr!.on('data',c=>{stderr+=c;});
    child.on('error',e=>{stderr+=String(e.message);finish(null);});child.on('close',finish);
  });

  const ensureServer=async():Promise<boolean>=>{
    if(baseUrl)return true;if(serverError)return false;
    try{
      const port=await getFreeLocalPort();
      server=spawn(php!,['-S',`127.0.0.1:${port}`,'-t',location],{cwd:location,env:{...process.env,...env} as NodeJS.ProcessEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    const expectedStatus=expect?.status;
    const finalStatus=response.status;
    if(expectedStatus!==undefined){
      const list=[expectedStatus].flat();
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

  const runStep=async(step:FlowTestStep):Promise<FlowStepResult>=>{
    const started=Date.now();const title=step.title||(step.kind==='http'?`${step.method} ${step.path}`:step.kind==='php'?`php ${step.script}`:`SELECT: ${snippet(step.query,60)}`);
    const done=(status:FlowStepStatus,evidence:string):FlowStepResult=>({id:step.id,title,kind:step.kind,status,evidence:redact(evidence,env),durationMs:Date.now()-started});
    if(!php)return done('blocked','impossível: PHP indisponível');
    try{
      if(step.kind==='php'){
        if(!dbReady)return done('blocked','impossível: banco de teste (orq_*) indisponível');
        if(!existsSync(join(location,step.script)))return done('failed',`o script ${step.script} não existe`);
        const result=await runProcess([step.script],{},60000);
        return result.code===0?done('passed',`php ${step.script} → código 0 · ${snippet(result.stdout)||'(sem saída)'}`):done('failed',`php ${step.script} → código ${result.code} · ${snippet(result.stderr||result.stdout)}`);
      }
      if(step.kind==='db'){
        if(!dbReady)return done('blocked','impossível: banco de teste (orq_*) indisponível');
        const result=await runProcess([join(helperDir,'db.php')],{ORQ_FLOW_MODE:'query',ORQ_FLOW_SQL:step.query},20000);
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
      const result=await sendHttp(step);
      return done(result.ok?'passed':'failed',result.evidence);
    }catch(error){return done('failed',`erro ao executar a etapa: ${snippet(String((error as Error)?.message||error))}`);}
  };

  try{
    const byId=new Map<string,FlowRunResult>();
    for(const test of tests){
      if(options.signal?.aborted)break;
      cookies.clear();
      options.onProgress?.(`Executando fluxo ${test.flowId}`);
      const steps:FlowStepResult[]=[];let failed=false,blocked=false;
      for(const step of test.steps){
        if(failed||blocked){steps.push({id:step.id,title:step.title||step.id,kind:step.kind,status:'skipped',evidence:failed?'não executada: uma etapa anterior falhou':'não executada: uma etapa anterior não pôde ser executada',durationMs:0});continue;}
        const result=await runStep(step);steps.push(result);
        if(result.status==='failed')failed=true;if(result.status==='blocked')blocked=true;
      }
      const cleanupNotes:string[]=[];let cleanupStatus:'done'|'partial'|'none'='none';
      if(test.cleanup?.length){
        cleanupStatus='done';
        for(const item of test.cleanup){
          if(!php||!dbReady){cleanupStatus='partial';cleanupNotes.push('limpeza de banco não executada (banco de teste indisponível)');continue;}
          const result=await runProcess([join(helperDir,'db.php')],{ORQ_FLOW_MODE:'exec',ORQ_FLOW_SQL:item.sql},20000);
          if(result.code!==0){cleanupStatus='partial';cleanupNotes.push(`limpeza falhou: ${snippet(redact(result.stderr,env),100)}`);}
          else cleanupNotes.push(`limpeza: ${snippet(item.sql,70)}`);
        }
      }
      const run:FlowRunResult={flowId:test.flowId,name:test.name||plan?.flows.find(f=>f.id===test.flowId)?.name||test.flowId,status:failed?'FAILED':blocked?'BLOCKED':'PASSED',steps,cleanup:{status:cleanupStatus,notes:cleanupNotes}};
      report.flows.push(run);byId.set(test.flowId,run);
      for(const covered of test.covers||[])if(run.status==='PASSED'&&!byId.has(covered))byId.set(covered,{...run,flowId:covered});
    }

    for(const flow of required){
      const run=byId.get(flow.id);
      if(!run)report.required.push({flowId:flow.id,name:flow.name,validated:false,reason:'nenhum teste funcional foi declarado para este fluxo obrigatório'});
      else if(run.status==='PASSED')report.required.push({flowId:flow.id,name:flow.name,validated:true});
      else report.required.push({flowId:flow.id,name:flow.name,validated:false,reason:run.status==='FAILED'?'o fluxo falhou':'o fluxo não pôde ser executado (verificação impossível)'});
    }
    if(report.flows.some(f=>f.status==='FAILED'))report.status='FAILED';
    else if(report.required.some(r=>!r.validated)||report.flows.some(f=>f.status==='BLOCKED'))report.status='BLOCKED';
  }finally{
    if(server){try{server.kill();}catch{/* já encerrado */}}
    // Limpeza de arquivos: remove só o que o fluxo criou no workspace (por exemplo uploads de teste).
    const removed:string[]=[];
    for(const file of listFiles(location))if(!before.has(file)){try{unlinkSync(file);removed.push(relative(location,file).replace(/\\/g,'/'));}catch{/* melhor esforço */}}
    if(removed.length)notes.push(`Arquivos temporários criados pelos fluxos e removidos: ${removed.slice(0,10).join(', ')}${removed.length>10?'…':''}`);
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
