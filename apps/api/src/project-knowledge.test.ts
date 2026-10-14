import assert from 'node:assert/strict';
import test from 'node:test';
import {AUTO_HEADING,MAX_KNOWLEDGE_CHARS,extractLearnings,knowledgeForPrompt,mergeLearnings,validateKnowledge} from './project-knowledge.js';
import {buildStageContext} from '@orchestrator/core';

test('learnings keep KNOWLEDGE facts and simple passed commands, and ignore noise, compound commands and failures',()=>{
  const lines=extractLearnings({
    notes:['KNOWLEDGE: O login demo é demo / demo123 e o preview usa php -S.','Servidor temporário encerrado com TaskStop.','knowledge:   o banco de teste vem de ORQ_DB_*  '],
    testsRun:[
      {command:'php database/seed_usuario_demo.php',status:'passed'},
      {command:'php -l a.php && php -l b.php',status:'passed'},
      {command:'php database/verificar.php http://x',status:'failed'},
      {command:'cat database/schema.sql | head',status:'passed'},
      {command:'echo "$X"',status:'passed'},
      {command:'node --check app.js',status:'passed'}
    ]
  });
  assert.deepEqual(lines,[
    '- O login demo é demo / demo123 e o preview usa php -S.',
    '- o banco de teste vem de ORQ_DB_*',
    '- Comando verificado que funcionou: `php database/seed_usuario_demo.php`',
    '- Comando verificado que funcionou: `node --check app.js`'
  ]);
  assert.deepEqual(extractLearnings(undefined),[]);assert.deepEqual(extractLearnings({}),[]);
});

test('merge appends under the auto heading without duplicates, never touches the user text and keeps the 20 most recent',()=>{
  const user='Projeto PHP puro.\nNão usar framework.';
  const once=mergeLearnings(user,['- a','- b']);
  assert.ok(once.startsWith(user));assert.ok(once.includes(`${AUTO_HEADING}\n- a\n- b`));
  const twice=mergeLearnings(once,['- b','- c']);
  assert.equal(twice.split('- b').length-1,1);assert.ok(twice.includes('- c'));
  const many=mergeLearnings(user,Array.from({length:30},(_,i)=>`- fato ${i}`));
  assert.equal(many.split('\n').filter(line=>line.startsWith('- fato')).length,20);assert.ok(many.includes('- fato 29')&&!many.includes('- fato 5\n'));
  assert.ok(many.startsWith(user));
  const huge=mergeLearnings('u'.repeat(MAX_KNOWLEDGE_CHARS-30),['- '+'x'.repeat(200)]);
  assert.ok(huge.length<=MAX_KNOWLEDGE_CHARS+1,String(huge.length));assert.ok(huge.startsWith('u'.repeat(100)));
  assert.equal(mergeLearnings('só texto',[]),'só texto\n');
});

test('validation and prompt trimming',()=>{
  assert.equal(validateKnowledge('a\r\nb'),'a\nb');
  assert.throws(()=>validateKnowledge('x'.repeat(MAX_KNOWLEDGE_CHARS+1)),/no máximo/);
  assert.throws(()=>validateKnowledge(undefined),/obrigatório/);
  assert.equal(knowledgeForPrompt('  oi  '),'oi');assert.equal(knowledgeForPrompt(null),'');assert.equal(knowledgeForPrompt('x'.repeat(9000)).length,4000);
});

test('the knowledge reaches the Developer and Reviewer prompts, but not the Tester',()=>{
  const task:any={id:'t',title:'Login',description:'ajuste o login',pipeline:['developer'],status:'pending',configSnapshot:'{}'};
  const ctx={id:'w',type:'local' as const,location:'C:\\x'};
  const withKnowledge=(role:any)=>buildStageContext({task,role,workspaceContext:ctx,projectKnowledge:'Login demo: demo/demo123. Rodar com php -S.'} as any);
  for(const role of ['developer','reviewer'])assert.match(withKnowledge(role).prompt,/PROJECT KNOWLEDGE[\s\S]*demo\/demo123/,role);
  assert.doesNotMatch(withKnowledge('tester').prompt,/PROJECT KNOWLEDGE/);
  assert.doesNotMatch(buildStageContext({task,role:'developer',workspaceContext:ctx} as any).prompt,/PROJECT KNOWLEDGE/);
});