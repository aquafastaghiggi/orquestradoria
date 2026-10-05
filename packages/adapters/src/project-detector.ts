import {existsSync,readFileSync} from 'node:fs';
import {basename,join,relative} from 'node:path';

export type ProjectType='node'|'php'|'python'|'unknown';
export type PackageManager='pnpm'|'npm'|'yarn';
export interface TestCommand{id:string;label:string;executable:string;args:string[];cwd:string;timeoutMs:number;}
export interface ProjectTestProfile{projectType:ProjectType;packageManager?:PackageManager;commands:TestCommand[];notes:string[];}
export interface ProjectDetectorOptions{location:string;assignedFiles?:string[];allowedScripts?:string[];env?:NodeJS.ProcessEnv;timeoutMs?:number;}

const managers:PackageManager[]=['pnpm','npm','yarn'];
const exists=(path:string)=>existsSync(path);
const readJson=(path:string):Record<string,unknown>|undefined=>{try{return JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;}catch{return undefined;}};
const script=(pkg:Record<string,unknown>,name:string)=>typeof (pkg.scripts as Record<string,unknown>|undefined)?.[name]==='string';
const commandFor=(manager:PackageManager,name:string,cwd:string,timeoutMs:number):TestCommand=>({id:`${manager}:${name}`,label:name,executable:manager,args:name==='test'?[name]:['run',name],cwd,timeoutMs});

export function detectProjectProfile(options:ProjectDetectorOptions):ProjectTestProfile{
  const cwd=options.location;const timeoutMs=options.timeoutMs||Number(options.env?.TEST_COMMAND_TIMEOUT_MS||120000);const notes:string[]=[];
  const packagePath=join(cwd,'package.json');const packageJson=readJson(packagePath);
  if(packageJson){const manager=exists(join(cwd,'pnpm-lock.yaml'))?'pnpm':exists(join(cwd,'yarn.lock'))?'yarn':exists(join(cwd,'package-lock.json'))?'npm':'npm';const allowed=[...(options.allowedScripts||[])].map(item=>item.trim()).filter(Boolean);const names=[...new Set(['typecheck','test','build',...allowed])];const commands=names.filter(name=>script(packageJson,name)).map(name=>commandFor(manager,name,cwd,timeoutMs));if(!commands.length)notes.push('package.json has no safe detected or allowlisted scripts');const missing=allowed.filter(name=>!script(packageJson,name));if(missing.length)notes.push(`Allowlisted scripts not found: ${missing.join(', ')}`);return{projectType:'node',packageManager:manager,commands,notes};}
  const assigned=options.assignedFiles||[];const phpFiles=assigned.filter(file=>/\.php$/i.test(file));if(phpFiles.length){return{projectType:'php',commands:phpFiles.map(file=>({id:`php:lint:${file}`,label:`php -l ${basename(file)}`,executable:'php',args:['-l',relative(cwd,file)],cwd,timeoutMs})),notes:['PHP profile lints only explicitly assigned files']};}
  const pythonFiles=assigned.filter(file=>/\.py$/i.test(file));if(pythonFiles.length||exists(join(cwd,'pyproject.toml'))||exists(join(cwd,'requirements.txt'))){return{projectType:'python',commands:[],notes:['Python detected; no command was inferred without an explicit project test configuration']};}
  return{projectType:'unknown',commands:[],notes:['No supported project test profile detected']};
}
