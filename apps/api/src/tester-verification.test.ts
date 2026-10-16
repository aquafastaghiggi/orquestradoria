import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommandTesterAdapter,planVerification} from '@orchestrator/adapters';

function project(files:Record<string,string>){const root=mkdtempSync(join(tmpdir(),'orq-verify-'));for(const [name,content] of Object.entries(files)){const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,content);}return root;}

test('planVerification only plans simple project scripts that the Developer reported as passed',()=>{
  const root=project({'database/seed.php':'<?php echo 1;','database/db.php':'<?php new PDO("x");','scripts/check.js':'process.exit(0)','src/app.php':'<?php','database/needs-url.php':'<?php'});
  try{
    const plan=planVerification([
      {command:'php database/seed.php',status:'passed'},
      {command:'php database/seed.php',status:'passed'},               // duplicado
      {command:'node scripts/check.js --fast',status:'passed'},
      {command:'php database/seed.php',status:'failed'},                // falhou: não reexecuta
      {command:'php -l database/seed.php',status:'passed'},             // lint: o Tester já faz
      {command:'php database/seed.php && php database/other.php',status:'passed'},
      {command:'php database/needs-url.php http://127.0.0.1:8099',status:'passed'},   // URL do servidor local: o Tester sobe o servidor (plan.servers)
      {command:'php database/needs-url.php https://example.com',status:'passed'},     // URL externa: nunca
      {command:'php src/app.php',status:'passed'},                      // fora das pastas de verificação
      {command:'php ../../etc/x.php',status:'passed'},
      {command:'php database/gone.php',status:'passed'},
      {command:'php database/db.php',status:'passed'},                  // usa banco e não há ORQ_DB_NAME
      {command:'cat database/seed.php | head',status:'passed'}
    ],{location:root,env:{}});
    assert.deepEqual(plan.commands.map(c=>[c.executable,...c.args].join(' ')),['php database/seed.php','node scripts/check.js --fast']);
    const reasons=plan.skipped.map(s=>s.reason).join(' | ');
    for(const expected of [/composto/,/não é o servidor local/,/fora das pastas/,/não existe/,/usa banco de dados/])assert.match(reasons,expected);
    assert.deepEqual(plan.servers.map(server=>[server.command.args.join(' '),server.urlArg,server.url]),[['database/needs-url.php http://127.0.0.1:8099',1,'http://127.0.0.1:8099']]);
    assert.equal(planVerification([{command:'php database/db.php',status:'passed'}],{location:root,env:{ORQ_DB_NAME:'orq_x'}}).commands.length,1,'with a test database the DB script is allowed');
    assert.equal(planVerification(undefined,{location:root}).commands.length,0);
  }finally{rmSync(root,{recursive:true,force:true});}
});

const input=(location:string):any=>({stage:'tester',task:{id:'t1',title:'x',description:'y'},workspaceContext:{location},previousArtifacts:[],projectRules:[]});
const tester=(developerTests:any[],env:Record<string,string>={})=>new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any,verification:{env,developerTests:()=>developerTests}});

test('Tester re-runs the verification script and passes only when it really passes (independent of the Developer\'s claim)',async()=>{
  const root=project({'scripts/ok.js':'console.log("tudo certo");process.exit(0);','scripts/bad.js':'console.error("login falhou: 404");process.exit(2);','scripts/env.js':'process.exit(process.env.ORQ_DB_NAME==="orq_teste"?0:3);'});
  try{
    const passed:any=(await tester([{command:'node scripts/ok.js',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(passed.status,'PASSED');assert.equal(passed.commands.length,1);assert.match(passed.commands[0].label,/verificar: node scripts\/ok\.js/);assert.match(passed.commands[0].stdout,/tudo certo/);

    const failed:any=(await tester([{command:'node scripts/bad.js',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(failed.status,'FAILED','the Developer said it passed, but the real re-run fails');
    assert.equal(failed.commands[0].exitCode,2);assert.match(failed.commands[0].stderr,/login falhou: 404/);assert.ok(failed.notes.some((n:string)=>/reexecutada falhou/.test(n)));

    const withEnv:any=(await tester([{command:'node scripts/env.js',status:'passed'}],{ORQ_DB_NAME:'orq_teste'}).execute(input(root))).structuredResult;
    assert.equal(withEnv.status,'PASSED','the task test database variables reach the verification script');
    const withoutEnv:any=(await tester([{command:'node scripts/env.js',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(withoutEnv.status,'FAILED');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('nothing to re-run keeps the previous behaviour (no verification, notes explain what was skipped)',async()=>{
  const root=project({'src/app.php':'<?php'});
  try{
    const none:any=(await tester([{command:'php src/app.php',status:'passed'},{command:'php database/x.php http://localhost:1',status:'passed'}]).execute(input(root))).structuredResult;
    assert.equal(none.commands.length,0);assert.equal(none.status,'BLOCKED');
    assert.ok(none.notes.some((n:string)=>/fora das pastas/.test(n)));
    const disabled=new CommandTesterAdapter({profile:{commands:[],notes:[],unvalidatedFiles:[]} as any});
    assert.equal(((await disabled.execute(input(root))).structuredResult as any).commands.length,0);
  }finally{rmSync(root,{recursive:true,force:true});}
});