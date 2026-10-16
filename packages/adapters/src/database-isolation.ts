import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';

/**
 * Garantia de isolamento do banco antes de executar PHP/HTTP em testes funcionais.
 *
 * Princípio: só executa quando é possível COMPROVAR, lendo o código alcançável pelo teste, que toda conexão ao MySQL usa
 * exclusivamente o banco isolado (ORQ_DB_*). O que não puder ser determinado com segurança é BLOQUEADO, nunca assumido:
 *  - cada conexão (PDO/mysqli) tem host, usuário, senha e banco RASTREADOS até leituras de ORQ_DB_* (ler a variável em
 *    algum lugar não basta: o DSN/argumentos precisam derivar dela);
 *  - includes dinâmicos, eval, `new $classe`, autoload dinâmico, includes fora do projeto e camadas de banco de terceiros
 *    podem ocultar a conexão e bloqueiam;
 *  - outros motores/extensões legadas, `USE outro_banco` e `outro_banco.tabela` bloqueiam.
 */
export interface FlowTestLike{steps:Array<{kind:string;script?:string;path?:string}>;cleanup?:unknown[]}
export interface IsolationVerdict{safe:boolean;reasons:string[];notes:string[];connects:boolean}

const DB_NAME=/^orq_[a-z0-9]{1,24}$/;
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','::1']);

// ---------- leitura de arquivos e includes ----------
const rel=(root:string,file:string)=>relative(root,file).replace(/\\/g,'/');
function readSource(path:string){try{const stat=lstatSync(path);if(!stat.isFile()||stat.size>400*1024)return null;return readFileSync(path,'utf8');}catch{return null;}}
const insideRoot=(root:string,path:string)=>path.startsWith(resolve(root)+sep);

function targetFiles(location:string,test:FlowTestLike):string[]{
  const files=new Set<string>();
  const add=(relPath:string)=>{const abs=resolve(location,relPath);if(insideRoot(location,abs)&&existsSync(abs)&&lstatSync(abs).isFile())files.add(abs);};
  for(const step of test.steps){
    if(step.kind==='php'&&step.script)add(step.script);
    if(step.kind==='http'&&step.path){
      let pathname=step.path.split('?')[0].split('#')[0];try{pathname=decodeURIComponent(pathname);}catch{/* mantém */}
      pathname=pathname.replace(/^\/+/,'');
      if(!pathname||pathname.endsWith('/')){add(join(pathname,'index.php'));continue;}
      const abs=resolve(location,pathname);
      if(insideRoot(location,abs)&&existsSync(abs)&&lstatSync(abs).isFile())add(pathname);
      else add('index.php'); // o servidor embutido do PHP cai no index.php da raiz
    }
  }
  return[...files];
}

// ---------- só o código PHP (sem HTML nem comentários) ----------
export function phpCode(source:string):string{
  let out='',i=0,php=false;
  while(i<source.length){
    if(!php){
      const m=/<\?(?:php\b|=)?/.exec(source.slice(i));
      if(!m)break;
      i+=m.index+m[0].length;php=true;if(m[0]==='<?=')out+=' echo ';continue;
    }
    const c=source[i];
    if(c==="'"||c==='"'){let j=i+1;while(j<source.length&&source[j]!==c){if(source[j]==='\\')j++;j++;}out+=source.slice(i,j+1);i=j+1;continue;}
    if(source.startsWith('?>',i)){php=false;out+=';';i+=2;continue;}
    if(source.startsWith('/*',i)){const j=source.indexOf('*/',i+2);i=j<0?source.length:j+2;continue;}
    if(source.startsWith('//',i)||(c==='#'&&source[i+1]!=='[')){while(i<source.length&&source[i]!=='\n'&&!source.startsWith('?>',i))i++;continue;}
    out+=c;i++;
  }
  return out;
}

// ---------- mini-parser de expressões PHP ----------
/** Divide `expr` nos operadores de nível superior, respeitando aspas e (), [], {}. */
function splitTop(expr:string,ops:string[]):string[]{
  const parts:string[]=[];let depth=0,quote='',start=0;
  for(let i=0;i<expr.length;i++){
    const c=expr[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if('([{'.includes(c)){depth++;continue;}
    if(')]}'.includes(c)){depth--;continue;}
    if(depth===0){
      const op=ops.find(o=>expr.startsWith(o,i)&&!(o==='.'&&(expr[i+1]==='='||/\d/.test(expr[i-1]||'')&&/\d/.test(expr[i+1]||''))));
      if(op){parts.push(expr.slice(start,i));i+=op.length-1;start=i+1;}
    }
  }
  parts.push(expr.slice(start));return parts;
}
/** Conteúdo entre parênteses balanceados a partir de `open` (índice do "("). */
function balanced(source:string,open:number):string|null{
  let depth=0,quote='';
  for(let i=open;i<source.length;i++){
    const c=source[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(c==='(')depth++;
    else if(c===')'){depth--;if(depth===0)return source.slice(open+1,i);}
  }
  return null;
}

/** Índice do ';' de nível superior que termina a instrução que começa em `from` (respeita aspas e parênteses). */
function statementEnd(source:string,from:number):number{
  let depth=0,quote='';
  for(let i=from;i<source.length;i++){
    const c=source[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if('([{'.includes(c))depth++;
    else if(')]}'.includes(c))depth--;
    else if(c===';'&&depth<=0)return i;
  }
  return source.length;
}
type Tok={k:'lit';v:string}|{k:'orq';n:string}|{k:'unk';why:string};
const unk=(why:string):Tok[]=>[{k:'unk',why}];
const isUnk=(tokens:Tok[])=>tokens.some(t=>t.k==='unk');
const signature=(tokens:Tok[])=>tokens.map(t=>t.k==='lit'?`L:${t.v}`:t.k==='orq'?`O:${t.n}`:'U').join('|');
const compact=(tokens:Tok[]):Tok[]=>{const out:Tok[]=[];for(const t of tokens){const last=out[out.length-1];if(t.k==='lit'&&t.v==='')continue;if(t.k==='lit'&&last?.k==='lit')last.v+=t.v;else out.push({...t});}return out;};
export const joined=(tokens:Tok[])=>compact(tokens).map(t=>t.k==='lit'?t.v:t.k==='orq'?`⟦${t.n}⟧`:'⟦?⟧').join('');

class Resolver{
  private assigns=new Map<string,Array<{op:'='|'.=';expr:string}>>();
  private consts=new Map<string,string>();
  notes:string[]=[];
  constructor(sources:Array<{file:string;source:string}>){
    for(const {source} of sources){
      for(const m of source.matchAll(/\$([A-Za-z_]\w*)\s*(\.?=)(?![=>])\s*/g)){
        const start=(m.index||0)+m[0].length;const end=statementEnd(source,start);
        const list=this.assigns.get(m[1])||[];list.push({op:m[2] as '='|'.=',expr:source.slice(start,end).trim()});this.assigns.set(m[1],list);
      }
      for(const m of source.matchAll(/\bdefine\s*\(/g)){
        const open=(m.index||0)+m[0].length-1;const body=balanced(source,open);if(body===null)continue;
        const args=splitTop(body,[',']);const name=/^\s*['"](\w+)['"]\s*$/.exec(args[0]||'');
        if(name&&args.length>=2)this.consts.set(name[1],args.slice(1).join(',').trim());
      }
      for(const m of source.matchAll(/\bconst\s+(\w+)\s*=\s*/g)){const start=(m.index||0)+m[0].length;this.consts.set(m[1],source.slice(start,statementEnd(source,start)).trim());}
    }
  }
  flatten(raw:string,seen:Set<string>=new Set(),depth=0):Tok[]{
    if(depth>12)return unk('expressão muito profunda');
    let expr=raw.trim().replace(/;$/,'').trim();
    expr=expr.replace(/^\((?:string|int|integer)\)\s*/,'').trim();
    while(expr.startsWith('(')&&balanced(expr,0)===expr.slice(1,-1)&&expr.endsWith(')'))expr=expr.slice(1,-1).trim();
    const coalesce=splitTop(expr,['??','?:']);
    if(coalesce.length>1){
      const first=compact(this.flatten(coalesce[0],seen,depth+1));
      if(first.length===1&&first[0].k==='orq'){this.notes.push('O código tem valores padrão para ORQ_DB_*; como o ambiente do teste define todas as variáveis, o padrão não é usado.');return first;}
      return unk('valor padrão (?: / ??) cuja origem principal não é ORQ_DB_*');
    }
    if(splitTop(expr,['?']).length>1)return unk('expressão condicional');
    const pieces=splitTop(expr,['.']);
    if(pieces.length>1)return pieces.flatMap(piece=>this.flatten(piece,seen,depth+1));
    return this.atom(expr,seen,depth);
  }
  private atom(expr:string,seen:Set<string>,depth:number):Tok[]{
    let m:RegExpExecArray|null;
    if((m=/^'((?:[^'\\]|\\.)*)'$/s.exec(expr)))return[{k:'lit',v:m[1].replace(/\\(['\\])/g,'$1')}];
    if((m=/^"((?:[^"\\]|\\.)*)"$/s.exec(expr))){
      const out:Tok[]=[];let last=0;const text=m[1];
      for(const v of text.matchAll(/\{\$([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g)){
        out.push({k:'lit',v:text.slice(last,v.index)});
        const after=text.slice((v.index||0)+v[0].length);
        if(!v[1]&&/^(?:\[|->)/.test(after))return unk('interpolação com índice ou propriedade');
        out.push(...this.variable(v[1]||v[2],seen,depth));last=(v.index||0)+v[0].length;
      }
      out.push({k:'lit',v:text.slice(last)});return out;
    }
    if((m=/^getenv\(\s*(['"])([A-Za-z0-9_]+)\1\s*\)$/.exec(expr)))return /^ORQ_DB_[A-Z]+$/.test(m[2])?[{k:'orq',n:m[2]}]:unk(`getenv("${m[2]}") não é ORQ_DB_*`);
    if((m=/^\$_(?:ENV|SERVER)\[\s*(['"])([A-Za-z0-9_]+)\1\s*\]$/.exec(expr)))return /^ORQ_DB_[A-Z]+$/.test(m[2])?[{k:'orq',n:m[2]}]:unk(`$_ENV["${m[2]}"] não é ORQ_DB_*`);
    if(/^(?:__DIR__|dirname\(\s*__FILE__\s*\))$/.test(expr))return[{k:'lit',v:'@DIR@'}];
    if((m=/^\$([A-Za-z_]\w*)$/.exec(expr)))return this.variable(m[1],seen,depth);
    if(/^\d+$/.test(expr)||/^(?:true|false|null)$/i.test(expr))return[{k:'lit',v:expr}];
    if(/^[A-Z_][A-Z0-9_]*$/.test(expr)){
      const value=this.consts.get(expr);
      if(value===undefined)return unk(`constante ${expr} sem definição analisável`);
      if(seen.has(`const:${expr}`))return unk(`constante ${expr} recursiva`);
      return this.flatten(value,new Set([...seen,`const:${expr}`]),depth+1);
    }
    if((m=/^sprintf\s*\(([\s\S]*)\)$/.exec(expr))){
      const args=splitTop(m[1],[',']);const format=compact(this.flatten(args[0],seen,depth+1));
      if(format.length!==1||format[0].k!=='lit')return unk('sprintf com formato não literal');
      const pieces=format[0].v.split(/%[sd]/);const out:Tok[]=[];
      pieces.forEach((text,i)=>{out.push({k:'lit',v:text});if(i<pieces.length-1)out.push(...(args[i+1]?this.flatten(args[i+1],seen,depth+1):unk('sprintf sem argumento')));});
      return out;
    }
    return unk(`expressão não analisável: ${expr.slice(0,40)}`);
  }
  private variable(name:string,seen:Set<string>,depth:number):Tok[]{
    if(seen.has(`var:${name}`))return unk(`variável $${name} recursiva`);
    const list=this.assigns.get(name);
    if(!list?.length)return unk(`variável $${name} sem atribuição analisável (parâmetro, include, array ou retorno de função)`);
    const next=new Set([...seen,`var:${name}`]);
    const bases=list.filter(a=>a.op==='='),appends=list.filter(a=>a.op==='.=');
    if(!bases.length)return unk(`variável $${name} só recebe concatenações`);
    const variants=bases.map(a=>compact(this.flatten(a.expr,next,depth+1)));
    if(new Set(variants.map(signature)).size>1)return unk(`variável $${name} recebe valores diferentes em pontos diferentes do código`);
    return[...variants[0],...appends.flatMap(a=>this.flatten(a.expr,next,depth+1))];
  }
}

// ---------- análise de conexões ----------
const CONNECT=/\bnew\s+\\?(?:PDO|mysqli)\s*\(|\bmysqli_connect\s*\(|\bmysqli_real_connect\s*\(|->\s*real_connect\s*\(|\bmysql_p?connect\s*\(/g;
const OTHER_ENGINE=/\b(?:pg_p?connect|oci_p?connect|sqlsrv_connect|ibase_p?connect|odbc_connect|mssql_connect|sqlite_open)\s*\(|\bnew\s+\\?(?:SQLite3|MongoDB\\Client|Mongo|PDO_[A-Z]+)\b/i;
const THIRD_PARTY_DB=/\b(?:DriverManager::getConnection|Illuminate\\Database|Capsule|ADONewConnection|R::setup|new\s+\\?Medoo|Doctrine\\DBAL|\$wpdb\b|CI_DB|Zend_Db|Nette\\Database)\b/;
const DYNAMIC_FEATURES:Array<[RegExp,string]>=[
  [/\beval\s*\(/,'eval()'],[/\bnew\s+\$\w+/,'instanciação dinâmica (new $classe)'],[/\$\$\w+/,'variável variável'],
  [/\b(?:call_user_func(?:_array)?|forward_static_call(?:_array)?)\s*\(\s*\$/,'chamada dinâmica de função'],
  [/\bspl_autoload_register\s*\(/,'autoload dinâmico'],[/\bcreate_function\s*\(/,'create_function()'],[/\bpreg_replace\s*\([^)]*\/[a-z]*e[a-z]*['"]/,'preg_replace com /e'],
  [/\bini_set\s*\(\s*['"](?:auto_prepend_file|auto_append_file|mysqli\.default_|pdo_mysql\.default_socket)/i,'ini_set de configuração de banco/prepend']
];
const INCLUDE_STMT=/(?<![$\w>:])(?:require|include)(?:_once)?\b\s*\(?/g;

export function checkDatabaseIsolation(location:string,test:FlowTestLike,env:Record<string,string|undefined>):IsolationVerdict{
  const reasons:string[]=[],notes:string[]=[];
  const root=resolve(location);

  // 1) alvos + fecho de includes (literais); includes dinâmicos/fora do projeto bloqueiam
  const seen=new Set<string>(),queue=targetFiles(location,test);
  const sources:Array<{file:string;abs:string;source:string}>=[];
  for(const file of ['.user.ini','php.ini']){const abs=join(root,file);const text=existsSync(abs)?readSource(abs):null;if(text&&/auto_(?:prepend|append)_file\s*=/.test(text))reasons.push(`${file}: define auto_prepend_file/auto_append_file, que pode executar código fora da análise`);}
  while(queue.length&&seen.size<60){
    const abs=queue.shift()!;if(seen.has(abs))continue;seen.add(abs);
    const source=readSource(abs);
    if(source===null){reasons.push(`${rel(root,abs)}: arquivo ilegível ou grande demais para a análise de isolamento`);continue;}
    const code=phpCode(source);
    sources.push({file:rel(root,abs),abs,source:code});
    const resolver=new Resolver([{file:rel(root,abs),source:code}]);
    for(const match of code.matchAll(INCLUDE_STMT)){
      const startIndex=(match.index||0)+match[0].length;let statementEnd=code.indexOf(';',startIndex);if(statementEnd<0)statementEnd=code.length;
      const argument=code.slice(startIndex,statementEnd).trim();
      const tokens=compact(resolver.flatten(argument));
      if(isUnk(tokens)||tokens.some(t=>t.k==='orq')){reasons.push(`${rel(root,abs)}: include dinâmico (${argument.slice(0,50)}) pode ocultar a conexão; não é possível provar o isolamento`);continue;}
      const includePath=tokens.map(t=>t.k==='lit'?t.v:'').join('').replace(/^@DIR@/,'');
      if(/^(?:https?|ftp|php|data|phar):/i.test(includePath)){reasons.push(`${rel(root,abs)}: include de recurso externo (${includePath.slice(0,40)})`);continue;}
      const candidates=[resolve(dirname(abs),includePath.replace(/^[\\/]+/,'')),resolve(root,includePath.replace(/^[\\/]+/,''))];
      const found=candidates.find(candidate=>insideRoot(root,candidate)&&existsSync(candidate)&&lstatSync(candidate).isFile());
      if(!found){reasons.push(`${rel(root,abs)}: include "${includePath.slice(0,50)}" não resolve para um arquivo do projeto (fora do projeto ou inexistente); não é possível provar o isolamento`);continue;}
      if(/(?:^|[\\/])vendor[\\/]/.test(rel(root,found)))continue; // dependências de terceiros: ver THIRD_PARTY_DB
      queue.push(found);
    }
  }

  const all=sources.map(item=>item.source).join('\n');
  const resolver=new Resolver(sources);

  // 2) construções que podem ocultar a conexão, outros motores e camadas de terceiros
  for(const item of sources){
    for(const [pattern,label] of DYNAMIC_FEATURES)if(pattern.test(item.source))reasons.push(`${item.file}: usa ${label}, o que pode ocultar a conexão; não é possível provar o isolamento`);
    if(OTHER_ENGINE.test(item.source))reasons.push(`${item.file}: conecta a um banco que não é o MySQL isolado de teste`);
    if(THIRD_PARTY_DB.test(item.source))reasons.push(`${item.file}: usa uma camada de banco de terceiros cuja conexão não é analisável`);
    if(/\bmysql_p?connect\s*\(|\bmysql_select_db\s*\(/.test(item.source))reasons.push(`${item.file}: usa a extensão mysql_* legada, cuja seleção de banco não é analisável`);
    for(const m of item.source.matchAll(/['"`]\s*USE\s+`?([A-Za-z_]\w*)`?\s*(?:['";`]|$)/gi))if(!DB_NAME.test(m[1]))reasons.push(`${item.file}: executa USE ${m[1]} (outro banco)`);
    for(const m of item.source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+`?([A-Za-z_]\w*)`?\.`?[A-Za-z_]\w*/gi))if(!DB_NAME.test(m[1])&&!/^(?:information_schema|performance_schema)$/i.test(m[1]))reasons.push(`${item.file}: consulta ${m[1]}.<tabela>, que referencia outro banco`);
  }

  // 3) cada conexão: host, usuário, senha e banco precisam derivar de ORQ_DB_*
  let connects=false;
  const only=(tokens:Tok[],name:string)=>{const c=compact(tokens);return c.length===1&&c[0].k==='orq'&&c[0].n===name;};
  const hostOk=(tokens:Tok[])=>{const c=compact(tokens);return only(tokens,'ORQ_DB_HOST')||(c.length===1&&c[0].k==='lit'&&LOCAL_HOSTS.has(c[0].v.toLowerCase()));};
  const dbOk=(tokens:Tok[])=>{const c=compact(tokens);return only(tokens,'ORQ_DB_NAME')||(c.length===1&&c[0].k==='lit'&&DB_NAME.test(c[0].v));};
  const describe=(tokens:Tok[])=>{const text=joined(tokens);return text.length>40?`${text.slice(0,40)}…`:text||'(vazio)';};
  for(const item of sources){
    for(const match of item.source.matchAll(CONNECT)){
      connects=true;
      const open=(match.index||0)+match[0].length-1;const body=balanced(item.source,open);
      const label=match[0].replace(/\s*\($/,'').replace(/^->\s*/,'').trim();
      const fail=(why:string)=>reasons.push(`${item.file}: a conexão ${label} ${why}`);
      if(body===null){fail('não pôde ser lida (parênteses desbalanceados)');continue;}
      const args=body.trim()?splitTop(body,[',']).map(arg=>arg.trim()):[];
      if(/^new\s+\\?PDO/.test(label)){
        const dsn=resolver.flatten(args[0]||'');
        if(!args[0]||isUnk(dsn)){fail(`tem um DSN que não pode ser determinado com segurança (${isUnk(dsn)?(dsn.find(t=>t.k==='unk') as {why:string}).why:'sem argumentos'})`);continue;}
        const text=joined(dsn);
        if(!text.startsWith('mysql:')){fail(`usa um DSN que não é mysql: (${describe(dsn)})`);continue;}
        const params=new Map(text.slice(6).split(';').filter(Boolean).map(p=>{const i=p.indexOf('=');return[p.slice(0,i).trim().toLowerCase(),p.slice(i+1).trim()];}));
        if(params.has('unix_socket')){fail('usa unix_socket, cujo destino não é determinável');continue;}
        const dbname=params.get('dbname');
        if(dbname===undefined){fail('não define dbname no DSN (o banco seria escolhido fora da análise)');continue;}
        if(dbname!=='⟦ORQ_DB_NAME⟧'&&!DB_NAME.test(dbname)){reasons.push(dbname.includes('⟦')?`${item.file}: a conexão ${label} monta dbname com valor misto (${dbname}); o banco precisa vir só de ORQ_DB_NAME`:`${item.file}: o banco "${dbname}" está fixo no código (a conexão ${label} deveria usar ORQ_DB_NAME)`);continue;}
        const host=params.get('host');
        if(host!==undefined&&host!=='⟦ORQ_DB_HOST⟧'&&!LOCAL_HOSTS.has(host.toLowerCase())){fail(`usa o host "${host}", que não vem de ORQ_DB_HOST nem é local`);continue;}
        const port=params.get('port');
        if(port!==undefined&&port!=='⟦ORQ_DB_PORT⟧'&&!/^\d+$/.test(port)){fail(`usa uma porta não determinável (${port})`);continue;}
        const user=resolver.flatten(args[1]||'');const pass=resolver.flatten(args[2]||'');
        if(!only(user,'ORQ_DB_USER')){fail(joined(user)==="root"?'usa o usuário root':`não lê ORQ_DB_USER: o usuário (${describe(user)}) não vem do banco isolado`);}
        if(!only(pass,'ORQ_DB_PASSWORD')){fail('não lê ORQ_DB_PASSWORD: a senha não vem do banco isolado');}
      }else{
        // mysqli: new mysqli(host,user,pass,db,port) · mysqli_connect(...) · $m->real_connect(...) · mysqli_real_connect($link,...)
        const offset=/^mysqli_real_connect/.test(label)?1:0;
        const [host,user,pass,db,port]=[0,1,2,3,4].map(i=>args[i+offset]);
        if(args.length<4+offset){fail('não informa host, usuário, senha e banco explicitamente (usaria os padrões do php.ini)');continue;}
        const h=resolver.flatten(host),u=resolver.flatten(user),p=resolver.flatten(pass),d=resolver.flatten(db);
        if(!hostOk(h))fail(`usa um host (${describe(h)}) que não vem de ORQ_DB_HOST nem é local`);
        if(!only(u,'ORQ_DB_USER'))fail(joined(u)==='root'?'usa o usuário root':`não lê ORQ_DB_USER: o usuário (${describe(u)}) não vem do banco isolado`);
        if(!only(p,'ORQ_DB_PASSWORD'))fail('não lê ORQ_DB_PASSWORD: a senha não vem do banco isolado');
        if(!dbOk(d))reasons.push(compact(d).length===1&&compact(d)[0].k==='lit'?`${item.file}: o banco "${joined(d)}" está fixo no código (a conexão ${label} deveria usar ORQ_DB_NAME)`:`${item.file}: a conexão ${label} usa um banco (${describe(d)}) que não vem de ORQ_DB_NAME`);
        if(port!==undefined){const pt=resolver.flatten(port);if(isUnk(pt))fail('usa uma porta não determinável');}
      }
    }
  }
  for(const note of resolver.notes)if(!notes.includes(note))notes.push(note);

  // 4) o ambiente do teste precisa mesmo fornecer o banco isolado
  const envOk=Boolean(env.ORQ_DB_NAME&&DB_NAME.test(env.ORQ_DB_NAME)&&env.ORQ_DB_USER&&env.ORQ_DB_USER.toLowerCase()!=='root'&&env.ORQ_DB_HOST&&LOCAL_HOSTS.has(env.ORQ_DB_HOST.toLowerCase())&&env.ORQ_DB_PORT&&env.ORQ_DB_PASSWORD!==undefined);
  const usesDb=connects||test.steps.some(s=>s.kind==='db'||s.kind==='php')||Boolean(test.cleanup?.length);
  if(usesDb&&!envOk)reasons.push('o banco de teste isolado (ORQ_DB_*: banco orq_*, host local, usuário diferente de root) não está disponível');
  if(!all&&usesDb&&!test.steps.some(s=>s.kind==='db'))notes.push('Nenhum código PHP alcançável foi encontrado para as etapas do teste.');
  return{safe:reasons.length===0,reasons:[...new Set(reasons)],notes,connects};
}
