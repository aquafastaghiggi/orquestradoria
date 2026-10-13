import {existsSync,statSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {RuntimeDetector,inspectRepository,type RepositoryInspection} from '@orchestrator/workspace';
import {detectProjectProfile} from '@orchestrator/adapters';

export interface ReadinessIssue{level:'error'|'warning'|'info';code:string;message:string;}
export interface WorkspaceInspection{
  location:string;suggestedName:string;exists:boolean;isDirectory:boolean;
  git:RepositoryInspection|null;
  stack:{runtime:string;projectType:string;packageManager?:string;testCommands:string[]}|null;
  issues:ReadinessIssue[];ready:boolean;
}

/** Valida uma pasta local e devolve o que o usuário precisa saber antes de registrar o workspace. Somente leitura. */
export function inspectWorkspaceFolder(rawLocation:string,configuredBranch?:string):WorkspaceInspection{
  const location=resolve(String(rawLocation||'').trim().replace(/^"|"$/g,''));
  const empty={location,suggestedName:basename(location),exists:false,isDirectory:false,git:null,stack:null};
  const issues:ReadinessIssue[]=[];
  if(!String(rawLocation||'').trim()){issues.push({level:'error',code:'path_required',message:'Informe o caminho da pasta do projeto.'});return{...empty,issues,ready:false};}
  if(!existsSync(location)){issues.push({level:'error',code:'path_missing',message:'A pasta não existe.'});return{...empty,issues,ready:false};}
  if(!statSync(location).isDirectory()){issues.push({level:'error',code:'not_directory',message:'O caminho informado não é uma pasta.'});return{...empty,exists:true,issues,ready:false};}

  const git=inspectRepository(location,configuredBranch);
  if(!git.isGitRepository)issues.push({level:'warning',code:'not_git',message:'A pasta não é um repositório Git. Sem Git não há isolamento por worktree nem Apply/Discard seguros; rode git init e faça um commit inicial.'});
  else if(!git.hasCommits)issues.push({level:'error',code:'no_commits',message:'O repositório não tem nenhum commit. Faça um commit inicial para permitir o isolamento por worktree.'});
  else{
    if(git.dirty)issues.push({level:'warning',code:'dirty',message:`A branch ${git.currentBranch||'atual'} tem alterações não commitadas (${git.untrackedCount} arquivos não rastreados). O Apply fica bloqueado até a pasta ficar limpa.`});
    if(git.branchMismatch)issues.push({level:'info',code:'branch_mismatch',message:`A branch configurada (${git.configuredBranch}) não existe; será usada ${git.resolvedBaseBranch}.`});
  }

  const runtime=new RuntimeDetector().detect(location);
  const profile=detectProjectProfile({location,env:process.env});
  if(runtime.type==='unsupported')issues.push({level:'info',code:'no_preview_runtime',message:'Nenhum runtime de preview detectado (index.php, index.html ou script dev do Vite). O preview não estará disponível.'});
  if(!profile.commands.length)issues.push({level:'info',code:'no_test_commands',message:'Nenhum comando de teste seguro detectado; o Tester usará verificações de arquivo.'});

  return{
    location,suggestedName:basename(location),exists:true,isDirectory:true,git:git.isGitRepository?git:null,
    stack:{runtime:runtime.type,projectType:profile.projectType,packageManager:profile.packageManager,testCommands:profile.commands.map((command:any)=>String(command.label||command.name||command.command||'comando'))},
    issues,ready:!issues.some(issue=>issue.level==='error'),
  };
}

/** Abre o seletor nativo de pastas do Windows (API local, sem entrada do usuário no comando). */
export function pickFolderDialog():Promise<string|null>{
  if(process.platform!=='win32')return Promise.reject(new Error('Seletor de pasta disponível apenas no Windows; digite o caminho.'));
  const script="Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Escolha a pasta do projeto'; $f.ShowNewFolderButton=$false; $o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; if($f.ShowDialog($o) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $f.SelectedPath}";
  return new Promise((resolvePath,reject)=>{
    execFile('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:false,timeout:300000,encoding:'utf8'},(error,stdout)=>{
      if(error)return reject(error);
      const value=String(stdout).trim();
      resolvePath(value||null);
    });
  });
}
