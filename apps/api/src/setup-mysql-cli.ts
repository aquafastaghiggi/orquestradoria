import {existsSync} from 'node:fs';
import {DEFAULT_MYSQL_BIN,DEFAULT_PROJECT_DB,projectDbConfigPath,provisionProjectLogin,saveProjectDbConfig,testProjectDb} from './project-database.js';

/**
 * pnpm db:setup — cria o login "orquestradoria" no MySQL (só enxerga bancos orq_*) e guarda a senha gerada em
 * apps/api/storage/project-database.json. A senha do root só é usada nesta execução e nunca é gravada.
 * Opcional: ORQ_MYSQL_ROOT_PASSWORD (sem prompt), ORQ_MYSQL_BIN, ORQ_MYSQL_HOST, ORQ_MYSQL_PORT.
 */
function askHidden(question:string):Promise<string>{
  return new Promise(resolve=>{
    process.stdout.write(question);
    const stdin=process.stdin;let value='';
    if(!stdin.isTTY){stdin.once('data',chunk=>resolve(String(chunk).split(/\r?\n/)[0]));return;}
    stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
    const onData=(char:string)=>{
      for(const c of char){
        if(c==='\r'||c==='\n'){stdin.setRawMode(false);stdin.pause();stdin.removeListener('data',onData);process.stdout.write('\n');return resolve(value);}
        if(c==='\u0003'){process.stdout.write('\n');process.exit(130);}
        if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue;}
        value+=c;
      }
    };
    stdin.on('data',onData);
  });
}

async function main(){
  const mysqlBin=process.env.ORQ_MYSQL_BIN||DEFAULT_MYSQL_BIN;
  const host=process.env.ORQ_MYSQL_HOST||DEFAULT_PROJECT_DB.host;
  const port=Number(process.env.ORQ_MYSQL_PORT||DEFAULT_PROJECT_DB.port);
  console.log('\nOrquestradoria · login do MySQL para os bancos de teste\n');
  console.log(`MySQL: ${host}:${port} · programa: ${mysqlBin}`);
  if(!existsSync(mysqlBin)&&/[\\/]/.test(mysqlBin)){console.error(`\nNão encontrei ${mysqlBin}. Defina ORQ_MYSQL_BIN com o caminho do mysql.exe.`);process.exit(1);}
  console.log('Será criado o login "orquestradoria", com acesso SOMENTE a bancos orq_* (descartáveis). Nenhum banco de projeto é tocado.');
  console.log('A senha do root é usada só agora, não é gravada em lugar nenhum.\n');
  const rootPassword=process.env.ORQ_MYSQL_ROOT_PASSWORD??await askHidden('Senha do usuário root do MySQL (Enter se não tiver senha): ');
  const result=await provisionProjectLogin(rootPassword,{host,port,mysqlBin});
  if(!result.ok){console.error(`\nNão foi possível criar o login: ${result.message}`);process.exit(1);}
  saveProjectDbConfig(result.config);
  const check=await testProjectDb(result.config);
  if(!check.ok){console.error(`\nLogin criado, mas o teste de conexão falhou: ${check.message}`);process.exit(1);}
  console.log(`\nPronto. Login "${result.config.user}" criado e testado. Credenciais guardadas em ${projectDbConfigPath()} (fora do Git).`);
  console.log('Você pode revisar ou trocar isso depois em Configurações > Banco MySQL dos projetos.\n');
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exit(1);});
