import test from 'node:test';
import assert from 'node:assert/strict';
import {extractExplicitAcceptanceCriteria} from '@orchestrator/shared';
import {verifyAcceptanceCoverage,validateAcceptanceCoveragePlan} from '@orchestrator/adapters';

test('extracts only explicit acceptance criteria with stable IDs',()=>{
  assert.deepEqual(extractExplicitAcceptanceCriteria('Objetivo\nFazer algo\n\nCritérios de aceite:\n- Tela visível\n2. Salvar dados\n\nValidação:\npnpm test'),[{id:'AC1',text:'Tela visível'},{id:'AC2',text:'Salvar dados'}]);
  assert.deepEqual(extractExplicitAcceptanceCriteria('Sem seção explícita'),[]);
});
test('verifies command and workspace evidence without inventing coverage',()=>{
  const criteria=extractExplicitAcceptanceCriteria('Acceptance criteria:\n- QA passa\n- Nenhuma mudança');
  const passed=verifyAcceptanceCoverage({criteria,coveragePlan:[{criterionId:'AC1',evidence:[{type:'command_qa_passed'}]},{criterionId:'AC2',evidence:[{type:'workspace_no_changes'}]}],workspaceChanges:{filesChanged:[]},testerResult:{commandQa:{status:'PASSED'}}});
  assert.equal(passed.status,'PASSED');assert.equal(passed.summary,'2/2 acceptance criteria verified');
  const uncovered=verifyAcceptanceCoverage({criteria,coveragePlan:[],testerResult:{}});assert.equal(uncovered.status,'FAILED');assert.equal(uncovered.criteria[0].status,'UNCOVERED');
});
test('browser step requires a passed assertion and never accepts click as evidence',()=>{
  const criteria=extractExplicitAcceptanceCriteria('Acceptance criteria:\n- Item appears');
  const bad=verifyAcceptanceCoverage({criteria,coveragePlan:[{criterionId:'AC1',evidence:[{type:'browser_step',scenario:'CRUD',step:1}]}],testerResult:{browserQa:{scenarios:[{name:'CRUD',status:'PASSED',steps:[{index:0,action:'click',status:'PASSED'}]}]}}});
  assert.equal(bad.status,'FAILED');
  const good=verifyAcceptanceCoverage({criteria,coveragePlan:[{criterionId:'AC1',evidence:[{type:'browser_step',scenario:'CRUD',step:1}]}],testerResult:{browserQa:{scenarios:[{name:'CRUD',status:'PASSED',steps:[{index:0,action:'expectVisible',status:'PASSED'}]}]}}});
  assert.equal(good.status,'PASSED');
});
test('no explicit criteria is not required even when policy is enabled',()=>{const result=verifyAcceptanceCoverage({criteria:[],coveragePlan:undefined,testerResult:{}});assert.equal(result.status,'NOT_REQUIRED');});
test('strict coverage validation stays at the Tester trust boundary',()=>{const criteria=extractExplicitAcceptanceCriteria('Acceptance criteria:\n- Criar item');assert.equal(validateAcceptanceCoveragePlan(criteria,[{criterionId:'AC1',evidence:[{type:'unknown'}]}]).valid,false);assert.equal(validateAcceptanceCoveragePlan(criteria,[{criterionId:'AC9',evidence:[]}]).valid,false);assert.equal(validateAcceptanceCoveragePlan(criteria,[{criterionId:'AC1',evidence:[{type:'browser_step',scenario:'CRUD',step:0}]}]).valid,false);const coverage=verifyAcceptanceCoverage({criteria,coveragePlan:[{criterionId:'AC1',evidence:[{type:'unknown'}]}],testerResult:{}});assert.equal(coverage.errorType,'invalid_acceptance_coverage_plan');assert.equal(coverage.criteria[0].criterionText,'Criar item');});
