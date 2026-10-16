import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join,posix as posixPath,relative} from 'node:path';
import {phpCode} from './database-isolation.js';

/**
 * Inteligência de fluxo funcional: antes do Developer, lê o projeto (PHP/HTML/JS simples) e monta um mapa de páginas,
 * formulários, autenticação, banco e relações entre funcionalidades, mais critérios de aceite derivados do pedido e do
 * código. Tudo que vem do código é "fact" (com arquivo de origem); o que é inferência é "hypothesis". O mesmo plano é
 * entregue ao Developer, ao Tester e ao Reviewer.
 */
export type Certainty='fact'|'hypothesis';
export interface FlowForm{method:'GET'|'POST';action:string;fields:string[];fileFields:string[];multipart:boolean}
export interface FlowPage{
  file:string;route:string;kind:'page'|'endpoint';
  requiresAuth:boolean;setsSession:boolean;verifiesPassword:boolean;handlesUpload:boolean;
  forms:FlowForm[];tablesRead:string[];tablesWritten:string[];redirects:string[];includes:string[];usesOrqEnv:boolean;
}
export interface FlowStepPlan{id:string;title:string;page?:string;certainty:Certainty;evidence:string}
export type FlowKind='auth'|'upload'|'listing'|'composite';
export interface FlowPlanFlow{id:string;name:string;kind:FlowKind;required:boolean;source:'request'|'code';certainty:Certainty;steps:FlowStepPlan[];files:string[]}
export interface FlowCriterion{id:string;flowId:string;text:string;source:'request'|'code';certainty:Certainty}
export interface FlowPlan{
  version:1;pages:FlowPage[];
  auth:{loginPage?:string;guardedPages:string[];certainty:Certainty};
  database:{usesDatabase:boolean;usesOrqEnv:boolean;tables:Array<{name:string;writtenBy:string[];readBy:string[]}>};
  flows:FlowPlanFlow[];criteria:FlowCriterion[];
  facts:string[];hypotheses:string[];ambiguities:string[];
  truncated:boolean;
}

const IGNORED=new Set(['.git','node_modules','vendor','dist','build','coverage','.cache','storage','uploads','tmp','temp','logs']);
const MAX_FILES=300,MAX_BYTES=200*1024;
const CODE_EXT=/\.(?:php|phtml|html?)$/i;
const unique=<T>(items:T[])=>[...new Set(items)];
const posix=(path:string)=>path.replace(/\\/g,'/');

function scan(root:string){
  const files:string[]=[];let truncated=false;
  const visit=(dir:string)=>{
    let entries:string[];try{entries=readdirSync(dir);}catch{return;}
    for(const name of entries.sort()){
      if(files.length>=MAX_FILES){truncated=true;return;}
      const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch{continue;}
      if(stat.isSymbolicLink())continue;
      if(stat.isDirectory()){if(!IGNORED.has(name))visit(path);}
      else if(stat.isFile()&&CODE_EXT.test(name)&&stat.size<=MAX_BYTES)files.push(path);
    }
  };
  visit(root);return{files,truncated};
}

const tableNames=(source:string,pattern:RegExp)=>unique([...source.matchAll(pattern)].map(m=>m[1].toLowerCase()).filter(name=>!['select','set','values','dual'].includes(name)));
const WRITE_SQL=/\b(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|REPLACE\s+INTO)\s+`?([a-z_][a-z0-9_]*)`?/gi;
const READ_SQL=/\b(?:FROM|JOIN)\s+`?([a-z_][a-z0-9_]*)`?/gi;

/** Posições (início do corpo, fim do corpo, nome) das funções PHP declaradas: `function nome(...) { corpo }`. */
function functionRanges(code:string):Array<{name:string;start:number;end:number}>{
  const out:Array<{name:string;start:number;end:number}>=[];
  for(const match of code.matchAll(/\bfunction\s+&?([A-Za-z_]\w*)\s*\(/g)){
    let i=(match.index||0)+match[0].length,depth=1,quote='';
    for(;i<code.length&&depth>0;i++){const c=code[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}if(c==="'"||c==='"'){quote=c;continue;}if(c==='(')depth++;else if(c===')')depth--;}
    const open=code.indexOf('{',i);const semi=code.indexOf(';',i);
    if(open<0||(semi>=0&&semi<open))continue; // declaração sem corpo (interface/abstract)
    depth=1;quote='';let j=open+1;
    for(;j<code.length&&depth>0;j++){const c=code[j];if(quote){if(c==='\\')j++;else if(c===quote)quote='';continue;}if(c==="'"||c==='"'){quote=c;continue;}if(c==='{')depth++;else if(c==='}')depth--;}
    out.push({name:match[1],start:open+1,end:j-1});
  }
  return out;
}
const extractFunctions=(code:string)=>new Map(functionRanges(code).map(range=>[range.name,code.slice(range.start,range.end)] as [string,string]));
/** O código sem o corpo das funções: o que a página executa quando é aberta (uma biblioteca que só declara guardas não é protegida). */
const topLevelCode=(code:string)=>{let out='',cursor=0;for(const range of functionRanges(code).sort((x,y)=>x.start-y.start)){if(range.start<cursor)continue;out+=code.slice(cursor,range.start);cursor=range.end;}return out+code.slice(cursor);};
const SESSION_START=/\bsession_start\s*\(/,SESSION_SET=/\$_SESSION\s*\[[^\]]+\]\s*=(?!=)/,PASSWORD_VERIFY=/\bpassword_verify\s*\(/,UPLOAD=/\$_FILES\s*\[|\bmove_uploaded_file\s*\(/;
const GUARD_BASE=(body:string)=>/\$_SESSION\s*\[/.test(body)&&/header\(\s*['"]\s*Location/i.test(body)&&/\b(?:exit|die)\b/.test(body);
const callsOf=(code:string,known:Iterable<string>)=>{const names=new Set<string>();for(const m of code.matchAll(/(?<![>$:\w])([A-Za-z_]\w*)\s*\(/g))names.add(m[1]);const hit=new Set<string>();for(const name of known)if(names.has(name))hit.add(name);return hit;};

interface ProjectIndex{
  sessionStarters:Set<string>;sessionSetters:Set<string>;guards:Set<string>;passwordVerifiers:Set<string>;uploaders:Set<string>;
  writes:Map<string,string[]>;reads:Map<string,string[]>;
}
/**
 * Helpers que escondem a autenticação, o envio e o SQL (iniciar_sessao(), exigirLogin(), inserir_canhoto()...) são resolvidos
 * por fecho transitivo: uma função "é" de sessão/guarda/upload/escrita se o corpo faz isso OU chama outra função que faz.
 */
function buildProjectIndex(codes:string[]):ProjectIndex{
  const fns=new Map<string,string>();
  for(const code of codes)for(const [name,body] of extractFunctions(code))fns.set(name,fns.has(name)?`${fns.get(name)}\n${body}`:body);
  const idx:ProjectIndex={sessionStarters:new Set(),sessionSetters:new Set(),guards:new Set(),passwordVerifiers:new Set(),uploaders:new Set(),writes:new Map(),reads:new Map()};
  const base:Array<[Set<string>,(body:string)=>boolean]>=[[idx.sessionStarters,b=>SESSION_START.test(b)],[idx.sessionSetters,b=>SESSION_SET.test(b)],[idx.guards,GUARD_BASE],[idx.passwordVerifiers,b=>PASSWORD_VERIFY.test(b)],[idx.uploaders,b=>UPLOAD.test(b)]];
  const own=new Map<string,{w:string[];r:string[]}>();
  for(const [name,body] of fns){for(const [set,test] of base)if(test(body))set.add(name);own.set(name,{w:tableNames(body,WRITE_SQL),r:tableNames(body,READ_SQL)});}
  for(let round=0;round<6;round++){
    let changed=false;
    for(const [name,body] of fns){
      const callees=callsOf(body,fns.keys());callees.delete(name);
      for(const [set] of base)if(!set.has(name)&&[...callees].some(c=>set.has(c))){set.add(name);changed=true;}
      const current=own.get(name)!;
      for(const callee of callees){const sub=own.get(callee);if(!sub)continue;for(const t of sub.w)if(!current.w.includes(t)){current.w.push(t);changed=true;}for(const t of sub.r)if(!current.r.includes(t)){current.r.push(t);changed=true;}}
    }
    if(!changed)break;
  }
  for(const [name,value] of own){idx.writes.set(name,value.w);idx.reads.set(name,value.r);}
  return idx;
}

function analyzePage(root:string,file:string,idx:ProjectIndex,known:Set<string>):FlowPage{
  const source=readFileSync(file,'utf8');const rel=posix(relative(root,file));const code=phpCode(source);
  const forms:FlowForm[]=[];
  for(const match of source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)){
    const attrs=match[1],body=match[2];
    const attr=(name:string)=>new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`,'i').exec(attrs)?.[1]||'';
    const fileFields=unique([...body.matchAll(/<input\b[^>]*type\s*=\s*["']file["'][^>]*>/gi)].map(m=>/name\s*=\s*["']([^"'\[\]]+)/i.exec(m[0])?.[1]||'').filter(Boolean));
    const fields=unique([...body.matchAll(/<(?:input|select|textarea)\b[^>]*name\s*=\s*["']([^"'\[\]]+)/gi)].map(m=>m[1]));
    forms.push({method:/post/i.test(attr('method'))?'POST':'GET',action:attr('action')||rel,fields,fileFields,multipart:/multipart\/form-data/i.test(attr('enctype'))||fileFields.length>0});
  }
  const redirects=unique([...code.matchAll(/header\(\s*['"]\s*Location:\s*([^'"\s]+)/gi)].map(m=>m[1]));
  const includes=unique([...code.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+)['"]/gi)].map(m=>m[1]));
  const calls=callsOf(code,known);
  const calledIn=(set:Set<string>)=>[...calls].some(name=>set.has(name));
  const topCalls=callsOf(topLevelCode(code),known);
  const topCalledIn=(set:Set<string>)=>[...topCalls].some(name=>set.has(name));
  const usesSession=SESSION_START.test(code)||calledIn(idx.sessionStarters)||topCalledIn(idx.guards);
  const readsSession=/\$_SESSION\s*\[/.test(code);
  const guardOld=/(?:!\s*isset\(\s*\$_SESSION|empty\(\s*\$_SESSION)[^;{]*\)\s*\{?[^}]*?(?:header\(\s*['"]\s*Location|exit|die)/is.test(code)||/(?:require|include)(?:_once)?\s*\(?\s*['"][^'"]*(?:auth|guard|session|login_check|verifica)[^'"]*['"]/i.test(code);
  const verifiesPassword=PASSWORD_VERIFY.test(code)||calledIn(idx.passwordVerifiers)||/\$_POST\s*\[\s*['"](?:senha|password|pass)['"]/i.test(code);
  const handlesUpload=UPLOAD.test(code)||calledIn(idx.uploaders);
  const setsSession=usesSession&&(SESSION_SET.test(code)||calledIn(idx.sessionSetters));
  const isEndpoint=!/<\/?(?:html|body|form|table)\b/i.test(source)&&/\bjson_encode\s*\(|Content-Type:\s*application\/json/i.test(source);
  const tablesWritten=tableNames(code,WRITE_SQL),tablesRead=tableNames(code,READ_SQL);
  for(const name of calls){for(const t of idx.writes.get(name)||[])if(!tablesWritten.includes(t))tablesWritten.push(t);for(const t of idx.reads.get(name)||[])if(!tablesRead.includes(t))tablesRead.push(t);}
  return{
    file:rel,route:`/${rel}`,kind:isEndpoint?'endpoint':'page',
    requiresAuth:topCalledIn(idx.guards)||(Boolean(usesSession||readsSession)&&guardOld),setsSession,verifiesPassword,handlesUpload,
    forms,tablesRead,tablesWritten,redirects,includes,
    usesOrqEnv:/getenv\(\s*['"]ORQ_DB_/.test(code)
  };
}

/** Une as tabelas lidas/gravadas pelos arquivos incluídos (parciais com SELECT/INSERT), até 3 níveis, entre as páginas analisadas. */
function mergeIncludedTables(pages:FlowPage[]){
  const byPath=new Map(pages.map(page=>[page.file,page]));
  const resolveInclude=(from:string,include:string)=>{const target=posixPath.normalize(posixPath.join(dirname(from),include.replace(/^\/+/,'')));return byPath.get(target)||byPath.get(posixPath.normalize(include.replace(/^\/+/,'')));};
  const original=new Map(pages.map(page=>[page.file,{w:[...page.tablesWritten],r:[...page.tablesRead]}]));
  for(const page of pages){
    const seen=new Set<string>([page.file]);let frontier=[page];
    for(let depth=0;depth<3;depth++){
      const next:FlowPage[]=[];
      for(const current of frontier)for(const include of current.includes){const target=resolveInclude(current.file,include);if(!target||seen.has(target.file))continue;seen.add(target.file);next.push(target);const o=original.get(target.file)!;for(const t of o.w)if(!page.tablesWritten.includes(t))page.tablesWritten.push(t);for(const t of o.r)if(!page.tablesRead.includes(t))page.tablesRead.push(t);}
      frontier=next;
    }
  }
}

const TOPICS:Array<{kind:Exclude<FlowKind,'composite'>;label:string;pattern:RegExp}>=[
  {kind:'auth',label:'autenticação (login)',pattern:/\b(?:login|logar|entrar|autentic\w*|senha|sess[aã]o|sign\s?in)\b/i},
  {kind:'upload',label:'envio de arquivo (upload)',pattern:/\b(?:upload|envi(?:ar|a|o|e|ado|ada|ados|adas|os)|anex\w*|fotos?|imagem|comprovante|canhotos?|arquivo|documento|cnh)\b/i},
  {kind:'listing',label:'listagem/conferência dos dados enviados',pattern:/\b(?:listar|lista|listagem|confer\w*|aprovar|aprova[cç][aã]o|visualizar|consultar|exibir|mostrar)\b/i}
];

export function analyzeProjectFlows(location:string,request=''):FlowPlan{
  const empty:FlowPlan={version:1,pages:[],auth:{guardedPages:[],certainty:'hypothesis'},database:{usesDatabase:false,usesOrqEnv:false,tables:[]},flows:[],criteria:[],facts:[],hypotheses:[],ambiguities:[],truncated:false};
  if(!location||!existsSync(location))return empty;
  const {files,truncated}=scan(location);
  const codes:string[]=[];for(const file of files){try{codes.push(phpCode(readFileSync(file,'utf8')));}catch{/* arquivo ilegível: ignorado */}}
  const idx=buildProjectIndex(codes);
  const known=new Set<string>([...idx.sessionStarters,...idx.sessionSetters,...idx.guards,...idx.passwordVerifiers,...idx.uploaders,...idx.writes.keys(),...idx.reads.keys()]);
  const pages:FlowPage[]=[];for(const file of files){try{pages.push(analyzePage(location,file,idx,known));}catch{/* arquivo ilegível: ignorado */}}
  mergeIncludedTables(pages);
  const facts:string[]=[],hypotheses:string[]=[],ambiguities:string[]=[];

  const loginPages=pages.filter(p=>p.verifiesPassword&&p.setsSession);
  const guarded=pages.filter(p=>p.requiresAuth).map(p=>p.file);
  const handlers=pages.filter(p=>p.handlesUpload);
  const formPages=pages.filter(p=>!p.handlesUpload&&p.forms.some(f=>f.fileFields.length));
  const uploadPages=handlers.length?handlers:formPages;
  const tableMap=new Map<string,{writtenBy:string[];readBy:string[]}>();
  for(const page of pages){
    for(const t of page.tablesWritten)(tableMap.get(t)||tableMap.set(t,{writtenBy:[],readBy:[]}).get(t)!).writtenBy.push(page.file);
    for(const t of page.tablesRead)(tableMap.get(t)||tableMap.set(t,{writtenBy:[],readBy:[]}).get(t)!).readBy.push(page.file);
  }
  const tables=[...tableMap.entries()].map(([name,v])=>({name,writtenBy:unique(v.writtenBy),readBy:unique(v.readBy)}));
  const usesDatabase=tables.length>0||pages.some(p=>p.usesOrqEnv);
  const usesOrqEnv=pages.some(p=>p.usesOrqEnv);

  for(const p of loginPages)facts.push(`${p.file} verifica senha e grava a sessão (página de login).`);
  if(guarded.length)facts.push(`Páginas protegidas por sessão: ${guarded.join(', ')}.`);
  for(const p of uploadPages)facts.push(`${p.file} ${p.handlesUpload?'processa $_FILES':'tem formulário com campo de arquivo'}${p.tablesWritten.length?` e grava em ${p.tablesWritten.join(', ')}`:''}.`);
  for(const t of tables)if(t.writtenBy.length&&t.readBy.length)facts.push(`Tabela ${t.name}: gravada por ${t.writtenBy.join(', ')} e lida por ${t.readBy.join(', ')}.`);
  if(usesDatabase&&!usesOrqEnv)hypotheses.push('O código usa banco de dados mas não lê ORQ_DB_*; no ambiente de teste ele precisaria ler essas variáveis para conectar.');

  const flows:FlowPlanFlow[]=[];
  const mentioned=Object.fromEntries(TOPICS.map(t=>[t.kind,t.pattern.test(request)])) as Record<'auth'|'upload'|'listing',boolean>;
  // Um tópico só vira fluxo OBRIGATÓRIO quando o pedido o descreve como fluxo (2+ tópicos) ou quando o código já tem a peça
  // correspondente; uma menção solta ("corrigir texto da tela de login") não exige validação de ponta a ponta.
  const mentionCount=Object.values(mentioned).filter(Boolean).length;
  const inCode:Record<'auth'|'upload'|'listing',boolean>={auth:loginPages.length>0,upload:uploadPages.length>0,listing:pages.some(p=>p.tablesRead.length>0&&!p.handlesUpload)};
  const asked={auth:mentioned.auth&&(mentionCount>=2||inCode.auth),upload:mentioned.upload&&(mentionCount>=2||inCode.upload),listing:mentioned.listing&&(mentionCount>=2||inCode.listing)};
  if(process.env.FLOW_REQUIRED==='0'){asked.auth=asked.upload=asked.listing=false;}

  const loginPage=loginPages[0];
  if(loginPages.length>1)ambiguities.push(`Há mais de uma página que parece ser o login (${loginPages.map(p=>p.file).join(', ')}); qual delas é a oficial?`);
  const authSteps:FlowStepPlan[]=loginPage?[
    {id:'auth-1',title:`Abrir ${loginPage.route}`,page:loginPage.file,certainty:'fact',evidence:`${loginPage.file} existe`},
    {id:'auth-2',title:'Enviar credenciais de teste e receber a sessão',page:loginPage.file,certainty:'fact',evidence:`${loginPage.file} verifica senha e grava $_SESSION`},
    ...(guarded.length?[{id:'auth-3',title:`Acessar uma página protegida (${guarded[0]}) com a sessão`,page:guarded[0],certainty:'fact' as Certainty,evidence:`${guarded[0]} exige sessão`}]:[])
  ]:[{id:'auth-1',title:'Autenticar com credenciais de teste',certainty:'hypothesis',evidence:'não há página de login identificada no código'}];
  flows.push({id:'flow-auth',name:'Autenticação',kind:'auth',required:asked.auth,source:asked.auth?'request':'code',certainty:loginPage?'fact':'hypothesis',steps:authSteps,files:loginPage?[loginPage.file,...guarded.slice(0,3)]:[]});

  if(uploadPages.length>1)ambiguities.push(`Há mais de um ponto de upload (${uploadPages.map(p=>p.file).join(', ')}); o pedido se refere a qual?`);
  const upload=uploadPages[0];
  const uploadForm=upload?formPages.flatMap(p=>p.forms.filter(f=>f.multipart&&posix(f.action).replace(/^\.?\//,'').split('?')[0]===upload.file)).at(0):undefined;
  const uploadSteps:FlowStepPlan[]=upload?[
    {id:'upload-1',title:`Enviar um arquivo de teste por multipart para ${upload.forms.find(f=>f.multipart)?.action||uploadForm?.action||upload.route}`,page:upload.file,certainty:'fact',evidence:`${upload.file} recebe arquivo`},
    ...(upload.tablesWritten.length?[{id:'upload-2',title:`Confirmar no MySQL o registro gravado em ${upload.tablesWritten.join(', ')}`,page:upload.file,certainty:'fact' as Certainty,evidence:`INSERT/UPDATE em ${upload.tablesWritten.join(', ')}`}]:[{id:'upload-2',title:'Confirmar onde o envio é registrado (banco ou disco)',page:upload.file,certainty:'hypothesis' as Certainty,evidence:'nenhuma gravação em tabela foi identificada no handler'}])
  ]:[{id:'upload-1',title:'Enviar um arquivo de teste',certainty:'hypothesis',evidence:'não há ponto de upload identificado no código'}];
  flows.push({id:'flow-upload',name:'Upload e gravação',kind:'upload',required:asked.upload,source:asked.upload?'request':'code',certainty:upload?'fact':'hypothesis',steps:uploadSteps,files:upload?[upload.file]:[]});

  const writtenTables=upload?upload.tablesWritten:[];
  const requestWords=unique(request.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(word=>word.length>=5));
  const score=(page:FlowPage)=>{
    const name=page.file.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return(requestWords.some(word=>name.includes(word.slice(0,6)))?3:0)+(page.requiresAuth?2:0)+(/\bconfer/.test(name)?2:0)+(page.kind==='page'?1:0)+(page.tablesWritten.some(t=>writtenTables.includes(t))?-3:0)+(page.forms.some(f=>f.method==='POST')?0:1);
  };
  const listers=pages.filter(p=>p!==upload&&p.tablesRead.some(t=>writtenTables.includes(t))).sort((a,b)=>score(b)-score(a)||a.file.localeCompare(b.file));
  if(listers.length>1&&score(listers[0])===score(listers[1]))ambiguities.push(`Mais de uma página lista os dados enviados (${listers.slice(0,3).map(p=>p.file).join(', ')}) sem um critério que as distinga; qual é a "conferência"?`);
  const lister=listers[0];
  const listingSteps:FlowStepPlan[]=lister?[
    {id:'listing-1',title:`Abrir ${lister.route} e ver o registro enviado na listagem`,page:lister.file,certainty:'fact',evidence:`${lister.file} lê ${lister.tablesRead.filter(t=>writtenTables.includes(t)).join(', ')}, a mesma tabela gravada por ${upload!.file}`}
  ]:[{id:'listing-1',title:'Ver o registro enviado em uma listagem',certainty:'hypothesis',evidence:upload?'nenhuma página lê a tabela gravada pelo upload':'sem upload identificado'}];
  flows.push({id:'flow-listing',name:'Listagem na conferência',kind:'listing',required:asked.listing,source:asked.listing?'request':'code',certainty:lister?'fact':'hypothesis',steps:listingSteps,files:lister?[lister.file]:[]});

  if(asked.auth&&asked.upload&&asked.listing){
    const connected=Boolean(loginPage&&upload&&lister);
    flows.push({id:'flow-completo',name:'Fluxo completo: login → upload → gravação → listagem',kind:'composite',required:true,source:'request',certainty:connected?'fact':'hypothesis',files:unique([...(loginPage?[loginPage.file]:[]),...(upload?[upload.file]:[]),...(lister?[lister.file]:[])]),steps:[
      {id:'full-1',title:'Login com credenciais de teste',page:loginPage?.file,certainty:loginPage?'fact':'hypothesis',evidence:loginPage?`${loginPage.file}`:'login ainda não existe'},
      {id:'full-2',title:'Upload autenticado de um arquivo de teste',page:upload?.file,certainty:upload?'fact':'hypothesis',evidence:upload?`${upload.file}`:'upload ainda não existe'},
      {id:'full-3',title:'Registro gravado no MySQL',certainty:upload?.tablesWritten.length?'fact':'hypothesis',evidence:upload?.tablesWritten.length?`tabela ${upload.tablesWritten.join(', ')}`:'tabela ainda não identificada'},
      {id:'full-4',title:'Registro aparece na listagem da conferência',page:lister?.file,certainty:lister?'fact':'hypothesis',evidence:lister?`${lister.file}`:'listagem ainda não existe'}
    ]});
    if(!connected)hypotheses.push('O pedido descreve login → upload → listagem, mas o código ainda não tem todas as peças; a ligação entre elas é hipótese até a implementação.');
  }

  // Fluxos que o pedido exige mas que o código ainda não sustenta são trabalho a implementar, nunca "validados" de antemão.
  const criteria:FlowCriterion[]=[];let n=0;
  for(const flow of flows.filter(f=>f.required)){
    for(const step of flow.steps){
      n++;
      criteria.push({id:`FLOW${n}`,flowId:flow.id,text:`${step.title}${step.certainty==='hypothesis'?' (hipótese: ainda não confirmado no código)':''}`,source:flow.source,certainty:step.certainty});
    }
  }
  for(const flow of flows.filter(f=>f.required&&f.certainty==='hypothesis'))hypotheses.push(`O fluxo "${flow.name}" foi pedido, mas ainda não existe no código.`);
  if(!pages.length)hypotheses.push('Nenhuma página PHP/HTML foi encontrada: o mapa do projeto está vazio e os fluxos são hipóteses derivadas só do pedido.');

  return{version:1,pages,auth:{loginPage:loginPage?.file,guardedPages:guarded,certainty:loginPage?'fact':'hypothesis'},database:{usesDatabase,usesOrqEnv,tables},flows,criteria,facts,hypotheses,ambiguities,truncated};
}

/** Fluxos que o Tester precisa validar de ponta a ponta para que a task possa ser aprovada. */
export const requiredFlows=(plan:FlowPlan|undefined)=>(plan?.flows||[]).filter(flow=>flow.required);

/** Texto do plano para o prompt de um papel. Fatos e hipóteses ficam separados; perguntas só quando há ambiguidade. */
export function renderFlowPlan(plan:FlowPlan|undefined,role:'developer'|'tester'|'reviewer'):string{
  if(!plan||(!plan.pages.length&&!plan.flows.some(f=>f.required)))return '';
  const lines:string[]=['FUNCTIONAL FLOW PLAN (generated by the orchestrator from the request and the existing code)'];
  if(plan.facts.length)lines.push('Facts identified in the code:',...plan.facts.slice(0,12).map(f=>`- ${f}`));
  if(plan.hypotheses.length)lines.push('Hypotheses (NOT confirmed):',...plan.hypotheses.slice(0,8).map(h=>`- ${h}`));
  const required=requiredFlows(plan);
  if(required.length){
    lines.push('Required flows (the task cannot be approved until each one is validated end to end):');
    for(const flow of required){
      lines.push(`- [${flow.id}] ${flow.name} (${flow.certainty})`);
      for(const step of flow.steps)lines.push(`    ${step.id}. ${step.title} [${step.certainty}]`);
    }
    lines.push('Acceptance criteria derived from the request and the code:',...plan.criteria.slice(0,20).map(c=>`- ${c.id} (${c.flowId}, ${c.certainty}): ${c.text}`));
  }
  if(plan.ambiguities.length)lines.push('Ambiguities that matter:',...plan.ambiguities.map(a=>`- ${a}`));
  if(role==='developer'){
    const existing=unique(required.flatMap(f=>f.files));
    lines.push(
      'Rules: reuse and edit the existing files above in place; do not recreate files or rewrite working code. In a fix round change only what the failing step needs.',
      'In your final JSON add "functionalFlows": one entry per required flow, {"flowId":"flow-...","name":"...","steps":[...]} so the Tester can run the flow. Step kinds: {"id","title","kind":"php","script":"database/seed.php"} (runs a script from database/, scripts/, tests/ or bin/ with ORQ_DB_*), {"kind":"http","method":"GET|POST","path":"/login.php","form":{"email":"..."},"files":{"field":{"name":"a.pdf","content":"...","contentType":"application/pdf"}},"expect":{"status":302,"redirectTo":"upload.php","bodyIncludes":["..."]}} (cookies are kept between steps; only the local PHP server is used), {"kind":"db","query":"SELECT COUNT(*) FROM t WHERE ...","expect":{"min":1}} (SELECT only). Use temporary test data only; list "cleanup":[{"kind":"db-exec","sql":"DELETE FROM t WHERE ..."}] for rows you create. Never claim a flow passed: the Tester runs it.',
      'Correlation rule for upload/MySQL/listing flows: use the SAME document/NF created by the test. The SELECT must cite a value sent in the upload (form field such as the NF token, or the file name) and either return the identifier shown in the listing (expect.firstValue, for example the NF number) or cite it in the query; the listing GET must expect that identifier (and any text that is NOT already there before the upload). Data that already existed before the upload is not accepted as proof.',
      'If one of the ambiguities above changes what you must build, set status BLOCKED and put the question in "questions"; otherwise choose the most likely reading and record the assumption in notes.',
      'If you cannot make a required flow testable (for example the test database is unavailable), say so in notes; an unvalidated required flow blocks approval.',
      existing.length?`Existing files involved: ${existing.join(', ')}.`:''
    );
  }else if(role==='tester'){
    lines.push('The Tester runs the declared functional flows against a local PHP server and the isolated test database, step by step, and records real evidence for each step.');
  }else{
    lines.push('Reviewer rule: do NOT approve when a required flow is missing, failed or was not validated by the Tester; list it as an issue instead. Verifications that could not be run must be reported as such, not assumed.');
  }
  return lines.filter(Boolean).join('\n');
}
