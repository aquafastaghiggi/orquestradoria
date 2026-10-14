import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {TestCommand} from './project-detector.js';

/**
 * O Tester reexecuta, de forma independente, os scripts de verificação que o Developer disse ter rodado com sucesso
 * (ex.: `php database/verificar_login_demo.php`). Só scripts simples dentro de pastas conhecidas do próprio projeto, sem
 * encadeamento de comandos; qualquer coisa fora disso é ignorada com um motivo, nunca executada.
 */
export interface DeveloperTest{command?:string;status?:string}
export interface VerificationPlan{commands:TestCommand[];skipped:Array<{command:string;reason:string}>}

const SCRIPT=/^(?:database|scripts?|tests?|bin)\/[\w./-]+\.(?:php|js|mjs|cjs)$/;
const ARG=/^[\w.:@=/-]+$/;
const SHELL_META=/[&|;<>`$()'"\\*?{}[\]!#~^%\n\r]/;
const USES_DATABASE=/\b(?:PDO|mysqli|mysql_connect)\b|getenv\(\s*['"]ORQ_DB|\bDB_(?:HOST|NAME|USER|PASS)/;
const MAX_COMMANDS=4;
export const VERIFICATION_TIMEOUT_MS=60000;

export function planVerification(tests:DeveloperTest[]|undefined,options:{location:string;env?:Record<string,string|undefined>}):VerificationPlan{
  const commands:TestCommand[]=[],skipped:Array<{command:string;reason:string}>=[],seen=new Set<string>();
  for(const test of tests||[]){
    const raw=String(test.command||'').trim();
    if(test.status!=='passed'||!raw||seen.has(raw))continue;
    seen.add(raw);
    const skip=(reason:string)=>{skipped.push({command:raw.slice(0,140),reason});};
    if(!/^(?:php|node)\s/.test(raw))continue;                      // não é um script nosso (ex.: lint, comandos de leitura)
    if(SHELL_META.test(raw)){skip('comando composto ou com caracteres de shell');continue;}
    const tokens=raw.split(/\s+/);
    const [runner,script,...args]=tokens;
    if(!script||script.startsWith('-'))continue;                   // php -l, node --check: o Tester já faz isso
    if(!SCRIPT.test(script)||script.split('/').includes('..')){skip('script fora das pastas de verificação do projeto (database, scripts, tests, bin)');continue;}
    if(args.some(arg=>!ARG.test(arg))){skip('argumentos fora do padrão simples');continue;}
    if(args.some(arg=>/^https?:/i.test(arg))){skip('precisa de um servidor em execução, que o Tester não sobe');continue;}
    const file=resolve(options.location,script);
    if(!existsSync(file)){skip('o arquivo não existe neste ambiente');continue;}
    let source='';try{source=readFileSync(file,'utf8').slice(0,20000);}catch{}
    if(USES_DATABASE.test(source)&&!options.env?.ORQ_DB_NAME){skip('usa banco de dados e não há banco de teste configurado');continue;}
    if(commands.length>=MAX_COMMANDS){skip('limite de verificações por rodada');continue;}
    commands.push({id:`verify-${commands.length+1}`,label:`verificar: ${raw.slice(0,100)}`,executable:runner,args:[script,...args],cwd:options.location,timeoutMs:VERIFICATION_TIMEOUT_MS});
  }
  return finish(commands,skipped);
}
const finish=(commands:TestCommand[],skipped:Array<{command:string;reason:string}>):VerificationPlan=>({commands,skipped});
