import {chromium} from 'playwright';
const ID='0aGzdkuRf-mU7zd3fmLYQ',BASE=0.07758985,STOP=BASE+0.10;
const get=async u=>(await fetch('http://localhost:5173'+u)).json();
const cost=async()=>{const t=await get('/api/tasks/'+ID);return{t,sum:(t.executions||[]).reduce((a,e)=>a+Number(e.estimatedCost||0),0)};};
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1100}});
p.on('pageerror',e=>console.log('PAGEERROR',e.message));
await p.goto('http://localhost:5173');await p.waitForTimeout(1500);
const row=p.locator('article,div,li').filter({hasText:/crie o banco de dados/}).filter({has:p.getByText('Abrir task')}).last();
await row.getByText('Abrir task').first().click();await p.waitForTimeout(1500);
await p.getByRole('button',{name:'Criar correção a partir desta revisão'}).click();await p.waitForTimeout(800);
const ta=p.locator('textarea[id^=adjust-]');
await ta.focus();await p.keyboard.press('Control+End');
await p.keyboard.type('A verificação deve falhar se a página protegida não devolver 200 com o conteúdo esperado. Rode o seed e a verificação no banco de teste (variáveis ORQ_DB_*) e corrija o que falhar.');
console.log('PROMPT SENT:\n'+await ta.inputValue());
await p.screenshot({path:'C:/Users/aghiggi/AppData/Local/Temp/claude/C--Users-aghiggi/46a31299-9d7f-457d-ab0e-05b193380188/scratchpad/run-before.png'});
await p.getByRole('button',{name:'Solicitar ajuste'}).click();
console.log('ajuste solicitado',new Date().toISOString());
const start=Date.now();let last='';
while(Date.now()-start<9*60*1000){
  await new Promise(r=>setTimeout(r,12000));
  const {t,sum}=await cost();const ex=(t.executions||[]).slice(-1)[0]||{};
  const line=`task= env= stage= lastExec=/ spentThisRound=`;
  if(line!==last){console.log(new Date().toISOString().slice(11,19),line);last=line;}
  if(sum>STOP){console.log('COST CAP REACHED -> cancelling');await fetch('http://localhost:5173/api/tasks/'+ID+'/cancel',{method:'POST'});break;}
  if(['approved','needs_manual_review','failed','cancelled','human_review_required'].includes(t.status)||(t.status==='needs_fix'&&!['running'].includes(ex.status)&&Date.now()-start>30000&&ex.role==='reviewer'&&ex.status==='completed'))break;
}
const f=await cost();console.log('FINAL',f.t.status,f.t.environment?.environmentStatus,'spent this round',(f.sum-BASE).toFixed(4),'total',f.sum.toFixed(4));
await p.screenshot({path:'C:/Users/aghiggi/AppData/Local/Temp/claude/C--Users-aghiggi/46a31299-9d7f-457d-ab0e-05b193380188/scratchpad/run-after.png'});
await b.close();
