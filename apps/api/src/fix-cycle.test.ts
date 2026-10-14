import assert from 'node:assert/strict';
import test from 'node:test';
import {PipelineRunner,assessDeveloper,assessReviewer,sameIssues,denialGuidanceText} from '@orchestrator/core';
import {suggestAnswer} from '@orchestrator/shared';

// Frases reais da task "login antigo..." (ciclos 4 e 5), que repetiram o mesmo problema.
const cycle4=[{severity:'high',file:'database/criar_usuario.php',description:'O script somente disponibiliza uma ferramenta genérica e não cria o usuário solicitado `motorista` nem corrige o acesso de `demo`/`demo123`. A tarefa permanece sem uma conclusão.'},{severity:'medium',file:'README.md',description:'A documentação orienta o operador a executar manualmente o script, mas não informa quais credenciais foram criadas nem demonstra que o login solicitado funciona.'}];
const cycle5=[{severity:'high',file:'database/criar_usuario.php',description:'O script continua sendo apenas uma ferramenta genérica e não cria automaticamente o usuário solicitado `motorista`, nem corrige ou comprova o acesso de `demo` com a senha.'},{severity:'medium',file:'README.md',description:'A documentação apenas orienta a execução manual do script; não informa credenciais efetivamente criadas nem demonstra que o login solicitado funciona.'}];

test('the same reviewer findings in consecutive rounds are recognised (real data), different ones are not',()=>{
  assert.equal(sameIssues(cycle5,cycle4),true);
  assert.equal(sameIssues([{severity:'high',file:'login.php',description:'A senha é gravada em texto puro no banco de dados.'}],cycle4),false);
  assert.equal(sameIssues([],cycle4),false);assert.equal(sameIssues(cycle5,[]),false);
  assert.equal(assessReviewer(cycle5,cycle4)?.kind,'repeated_issue');
  assert.equal(assessReviewer(cycle5,undefined),null);
});

test('a blocked Developer or one with questions stops asking the user, and says which commands were refused',()=>{
  const blocked=assessDeveloper({status:'BLOCKED',summary:'sem permissão',filesChanged:[],testsRun:[],permissionDenials:[{tool:'Bash',command:'echo "$X"; cat a | head'}]},0)!;
  assert.equal(blocked.kind,'needs_input');assert.match(blocked.reason,/bloqueado/);assert.match(blocked.reason,/echo/);
  const asking=assessDeveloper({status:'BLOCKED',questions:['Qual a senha do motorista?']},0)!;
  assert.deepEqual(asking.questions,['Qual a senha do motorista?']);assert.match(asking.reason,/informação sua/);
  assert.equal(assessDeveloper({status:'COMPLETED',questions:['Posso usar a porta 8080?'],filesChanged:['a.php']},0)?.kind,'needs_input');
});

test('a fix round that changes and runs nothing is "no progress"; a first round or a round with real work is not',()=>{
  const idle={status:'COMPLETED',filesChanged:[],testsRun:[{status:'skipped'},{status:'skipped'}]};
  assert.equal(assessDeveloper(idle,1)?.kind,'no_progress');
  assert.equal(assessDeveloper(idle,0),null);
  assert.equal(assessDeveloper({...idle,filesChanged:['a.php']},1),null);
  assert.equal(assessDeveloper({...idle,testsRun:[{status:'passed'}]},1),null);
  assert.equal(assessDeveloper(undefined,1),null);
  assert.equal(assessDeveloper({status:'COMPLETED'},1),null,'a result that does not report the lists is not judged');
});

test('denial guidance tells the Developer Bash is still available',()=>{
  const text=denialGuidanceText([{tool:'Bash',command:'cat a; env | grep X'}]);
  assert.match(text,/TOOL DENIALS/);assert.match(text,/does NOT mean Bash is unavailable/);assert.equal(denialGuidanceText([]),'');
});

const adapterOf=(script:Array<(ctx:any)=>any>,prompts:string[]=[])=>{let call=0;return{id:'fake',name:'fake',capabilities:{streaming:false,cancel:true,usageReporting:false,modelSelection:false,toolUse:false,filesystemAccess:false,sessionResume:false,structuredOutput:true},checkAvailability:()=>Promise.resolve(true),getModels:()=>Promise.resolve([]),getUsage:()=>Promise.resolve({tokenUsage:0,estimatedCost:0}),cancel:()=>Promise.resolve(),execute:async(ctx:any)=>{prompts.push(`${ctx.stage}::${ctx.stageContext?.prompt||''}`);const out=script[call++](ctx);return{output:JSON.stringify(out),structuredResult:out,stdout:'',stderr:'',progressEvents:[]} as any;}} as any;};
const hooks=()=>{const stages:string[]=[];return{stages,h:{onStageStart(role:string){stages.push(role);},onStageComplete(){},onProgress(){},onHeartbeat(){},onFailure(){}} as any};};
const ctx:any={task:{id:'t',workspaceId:'w',title:'x',description:'y',pipeline:['developer','reviewer'],status:'implementing',configSnapshot:'{}',fixCycle:0},workspaceContext:{id:'w',type:'local',location:'C:\\x'},projectRules:[],previousArtifacts:[],constraints:{timeoutSeconds:1,tokenBudget:100,budgetUsd:1}};
const stageCtx=(role:string,base:any):any=>({...base,stage:role,stageContext:{prompt:`P-${role}`,contextChars:3}});

test('pipeline: Developer BLOCKED stops before any Reviewer runs (no money spent on a doomed review)',async()=>{
  const {stages,h}=hooks();
  const runner=new PipelineRunner(adapterOf([()=>({status:'BLOCKED',summary:'faltou a senha',filesChanged:[],testsRun:[],notes:[],questions:['Qual a senha do motorista?']})]),h);
  await assert.rejects(runner.run(ctx,['developer','reviewer'],0,undefined,undefined,stageCtx),(error:any)=>error.kind==='needs_input'&&error.details.questions[0]==='Qual a senha do motorista?'&&error.details.stopKind==='needs_input');
  assert.deepEqual(stages,['developer']);
});

test('pipeline: the same review finding twice in a row stops the loop instead of burning more cycles',async()=>{
  const {stages,h}=hooks();const prompts:string[]=[];
  const work={status:'COMPLETED',summary:'ok',filesChanged:['a.php'],testsRun:[{status:'passed',command:'php -l a.php'}],notes:[]};
  const adapter=adapterOf([()=>({...work,permissionDenials:[{tool:'Bash',command:'cat a; head b'}]}),()=>({status:'NEEDS_FIX',summary:'x',issues:cycle4}),()=>work,()=>({status:'NEEDS_FIX',summary:'x',issues:cycle5}),()=>work,()=>({status:'APPROVED',summary:'never reached'})],prompts);
  await assert.rejects(new PipelineRunner(adapter,h).run(ctx,['developer','reviewer'],0,undefined,undefined,stageCtx,{enabled:true,maxCycles:5} as any),(error:any)=>error.kind==='needs_input'&&error.details.stopKind==='repeated_issue');
  assert.deepEqual(stages,['developer','reviewer','developer','reviewer'],'stopped right after the second identical finding, before a third developer round');
  const secondDeveloper=prompts.find((p,i)=>p.startsWith('developer::')&&i>0&&p.includes('REVIEW ISSUES'))||'';
  assert.match(secondDeveloper,/TOOL DENIALS FROM YOUR PREVIOUS RUN/);assert.match(secondDeveloper,/cat a; head b/);
});

test('pipeline: a different finding each round keeps going until approved',async()=>{
  const {stages,h}=hooks();
  const work={status:'COMPLETED',summary:'ok',filesChanged:['a.php'],testsRun:[{status:'passed',command:'x'}],notes:[]};
  const adapter=adapterOf([()=>work,()=>({status:'NEEDS_FIX',summary:'x',issues:cycle4}),()=>work,()=>({status:'NEEDS_FIX',summary:'y',issues:[{severity:'high',file:'login.php',description:'A senha é gravada em texto puro no banco.'}]}),()=>work,()=>({status:'APPROVED',summary:'ok'})]);
  const outputs=await new PipelineRunner(adapter,h).run(ctx,['developer','reviewer'],0,undefined,undefined,stageCtx,{enabled:true,maxCycles:5} as any);
  assert.equal(outputs.length,6);assert.equal(stages.length,6);
});

test('the answer is suggested for the questions the Developer really asked (real wording from the failed task)',()=>{
  const q1='Confirma que eu crie as contas demo e motorista diretamente em controle_notas? A política do ambiente proíbe root e outros bancos, então não executei; se confirmar, eu rodo com a configuração padrão do projeto.';
  const q2='Posso usar curl (ou equivalente) para comprovar o login.php via HTTP em 127.0.0.1? A chamada foi negada nesta sessão; se não for permitida, a verificação fica para você na máquina local.';
  const a1=suggestAnswer(q1),a2=suggestAnswer(q2);
  assert.match(a1,/Não crie nada no banco real/);assert.match(a1,/script idempotente/);assert.match(a1,/ORQ_DB_\*/);assert.match(a1,/motorista \/ motorista123/);
  assert.match(a2,/curl contra http:\/\/127\.0\.0\.1/);assert.match(a2,/php -S/);assert.doesNotMatch(a2,/banco real/);
  assert.match(suggestAnswer('Qual deve ser a senha do usuário motorista?'),/motorista123/);
  assert.equal(suggestAnswer('Qual a cor do botão?'),'');assert.equal(suggestAnswer(''),'');
});