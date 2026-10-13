import {existsSync,mkdirSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

export class ProjectBootstrapError extends Error{
  constructor(readonly code:'invalid_name'|'invalid_parent'|'folder_exists'|'git_failed',message:string){super(message);}
}

export const MAX_PROJECT_NAME=80;
export const MAX_PROJECT_IDEA=8000;

/** Nome de pasta seguro: minúsculas, sem acentos, só [a-z0-9-]. Nunca contém separadores de caminho. */
export function slugifyProjectName(name:string){
  return String(name||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/g,'');
}

const git=(cwd:string,args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
const readme=(name:string,idea:string)=>`# ${name}\n\n## Ideia\n\n${idea.trim()}\n`;
const GITIGNORE='node_modules/\n.env\n*.log\n.DS_Store\n';

/**
 * Cria a pasta do projeto dentro de parentDir, inicializa o Git com um commit inicial (necessário
 * para o isolamento por worktree) e devolve o caminho. Em caso de falha remove o que criou.
 */
export function createProjectFolder(input:{name:string;parentDir:string;idea:string}){
  const name=String(input.name||'').trim(),idea=String(input.idea||'').trim();
  const slug=slugifyProjectName(name);
  if(!name||!slug||name.length>MAX_PROJECT_NAME)throw new ProjectBootstrapError('invalid_name',`Informe um nome de projeto com letras ou números (máx. ${MAX_PROJECT_NAME} caracteres).`);
  const parent=resolve(String(input.parentDir||'').trim());
  if(!String(input.parentDir||'').trim()||!existsSync(parent)||!statSync(parent).isDirectory())throw new ProjectBootstrapError('invalid_parent','A pasta onde o projeto será criado não existe.');
  const path=join(parent,slug);
  if(existsSync(path)&&(!statSync(path).isDirectory()||readdirSync(path).length>0))throw new ProjectBootstrapError('folder_exists',`Já existe uma pasta não vazia em ${path}. Escolha outro nome ou outra pasta.`);
  const created=!existsSync(path);
  try{
    mkdirSync(path,{recursive:true});
    writeFileSync(join(path,'README.md'),readme(name,idea));
    writeFileSync(join(path,'.gitignore'),GITIGNORE);
    git(path,['init','-q','-b','main']);
    git(path,['add','.']);
    let hasIdentity=true;try{hasIdentity=Boolean(git(path,['config','user.name'])&&git(path,['config','user.email']));}catch{hasIdentity=false;}
    git(path,[...(hasIdentity?[]:['-c','user.name=Orquestradoria','-c','user.email=orquestradoria@localhost']),'commit','-q','-m','chore: initial commit (Orquestradoria)']);
    return{path,slug,branch:'main',commitSha:git(path,['rev-parse','HEAD'])};
  }catch(error){
    if(created)try{rmSync(path,{recursive:true,force:true});}catch{}
    throw error instanceof ProjectBootstrapError?error:new ProjectBootstrapError('git_failed',`Não foi possível criar o repositório Git: ${error instanceof Error?error.message:String(error)}`);
  }
}
