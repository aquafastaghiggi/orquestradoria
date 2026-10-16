import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommandTesterAdapter} from '@orchestrator/adapters';

/**
 * O Developer relata `php database/verificar_fluxo.php http://127.0.0.1:8099`. O Tester antes ignorava ("precisa de um servidor"),
 * o Reviewer cobrava a prova e o ciclo se repetia. Agora o Tester sobe um servidor PHP local temporário, roda o script com a porta
 * dele, encerra o servidor, e só faz isso com o isolamento do banco comprovado. Sem banco e sem servidor externo.
 */
const PHP=process.platform==='win32'?'C:/xampp/php/php.exe':'php';
const phpOk=spawnSync(PHP,['-v'],{encoding:'utf8'}).status===0;
const run=phpOk?test:test.skip;

function project(files:Record<string,string>){
  const root=mkdtempSync(join(tmpdir(),'orq-srvverify-'));
  for(const [name,content] of Object.entries(files)){const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,content);}
  return root;
}
const CHECK=`<?php
$base = rtrim($argv[1] ?? '', '/');
$body = @file_get_contents($base . '/pagina.php');
if ($body === false) { fwrite(STDERR, "não consegui abrir $base/pagina.php\\n"); exit(2); }
if (strpos($body, 'ola-motorista') === false) { fwrite(STDERR, "a página não tem o texto esperado\\n"); exit(3); }
echo "verificado em $base\\n";
`;
const PAGE=(text:string)=>`<?php echo '${text}';`;
const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location},previousArtifacts:[],projectRules:[]});
const tester=(tests:any[],env:Record<string,string>={})=>new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,verification:{env,developerTests:()=>tests}});
const portFree=(port:number)=>new Promise<boolean>(resolvePort=>{const s=createServer();(s as unknown as NodeJS.EventEmitter).once('error',()=>resolvePort(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolvePort(true)));});

run('Tester sobe o servidor PHP local temporário e reexecuta o script de verificação, com a porta dele',async()=>{
  const root=project({'database/verificar.php':CHECK,'pagina.php':PAGE('ola-motorista')});
  try{
    const result:any=(await tester([{command:'php database/verificar.php http://127.0.0.1:8099',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(result.status,'PASSED',JSON.stringify(result.notes));
    const item=result.commands.find((c:any)=>c.label.includes('servidor PHP local temporário'));
    assert.ok(item,JSON.stringify(result.commands.map((c:any)=>c.label)));
    assert.equal(item.status,'passed');assert.match(item.stdout,/verificado em http:\/\/127\.0\.0\.1:\d+/);
    const port=Number(/127\.0\.0\.1:(\d+)/.exec(item.stdout)![1]);
    assert.notEqual(port,8099,'a porta do relato do Developer é trocada por uma porta livre do Tester');
    assert.match(item.command,new RegExp(`php database/verificar\\.php http://127\\.0\\.0\\.1:${port}`));
    assert.ok(result.notes.some((n:string)=>/reexecutada com sucesso \(servidor PHP local temporário\)/.test(n)));
    assert.equal(await portFree(port),true,'o servidor temporário foi encerrado');
  }finally{rmSync(root,{recursive:true,force:true});}
});

run('script de verificação que falha de verdade reprova o Tester, com o erro real',async()=>{
  const root=project({'database/verificar.php':CHECK,'pagina.php':PAGE('texto-errado')});
  try{
    const result:any=(await tester([{command:'php database/verificar.php http://localhost:8099',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(result.status,'FAILED');
    const item=result.commands.find((c:any)=>c.label.includes('servidor PHP local temporário'));
    assert.equal(item.status,'failed');assert.equal(item.exitCode,3);assert.match(item.stderr,/a página não tem o texto esperado/);
    assert.ok(result.notes.some((n:string)=>/A verificação reexecutada falhou/.test(n)));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('URL externa, outra forma de URL ou comando composto nunca sobem servidor nem executam',async()=>{
  const root=project({'database/verificar.php':`<?php file_put_contents(__DIR__.'/../executado.flag','x');`,'pagina.php':PAGE('ola-motorista')});
  try{
    const tests=['php database/verificar.php https://example.com','php database/verificar.php http://10.0.0.5:8080','php database/verificar.php http://127.0.0.1@evil.test:80','php database/verificar.php http://127.0.0.1:8099/admin','php database/verificar.php http://127.0.0.1:8099 https://example.com','php -S 127.0.0.1:8099 -t . && php database/verificar.php http://127.0.0.1:8099'].map(command=>({command,status:'passed'}));
    const result:any=(await tester(tests).execute(input(root))).structuredResult;
    assert.equal(existsSync(join(root,'executado.flag')),false,'nenhum script foi executado');
    assert.equal(result.commands.length,0);
    assert.equal(result.notes.filter((n:string)=>/Verificação não reexecutada/.test(n)).length>=6,true,result.notes.join(' | '));
  }finally{rmSync(root,{recursive:true,force:true});}
});

run('com código que usa o banco real, a verificação com servidor é BLOQUEADA antes de executar qualquer PHP',async()=>{
  const root=project({
    'database/verificar.php':`<?php file_put_contents(__DIR__.'/../executado.flag','x');echo 'ok';`,
    'pagina.php':PAGE('ola-motorista'),
    'conexao.php':`<?php file_put_contents(__DIR__.'/servidor-tocou.flag','x');$pdo=new PDO('mysql:host=127.0.0.1;dbname=controle_notas','app','segredo-real');`,
    'login.php':`<?php require __DIR__.'/conexao.php';`
  });
  try{
    for(const orq of [{} as Record<string,string>,{ORQ_DB_HOST:'127.0.0.1',ORQ_DB_PORT:'3306',ORQ_DB_USER:'orquestradoria',ORQ_DB_PASSWORD:'x',ORQ_DB_NAME:'orq_fake1234'}]){
      const result:any=(await tester([{command:'php database/verificar.php http://127.0.0.1:8099',status:'passed'}],orq).execute(input(root))).structuredResult;
      assert.equal(result.commands.length,0,'a verificação não rodou');
      assert.ok(result.notes.some((n:string)=>/Verificação não reexecutada \(bloqueada por segurança, nenhum PHP foi executado: .*controle_notas/.test(n)),result.notes.join(' | '));
      assert.equal(existsSync(join(root,'executado.flag')),false);assert.equal(existsSync(join(root,'servidor-tocou.flag')),false,'o servidor nunca serviu a página que conecta ao banco real');
      assert.equal(JSON.stringify(result).includes('segredo-real'),false);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
