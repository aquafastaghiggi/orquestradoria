import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('task detail resolves workspace data and contextual actions without changing status values', () => {
  const main = source('../../web/src/main.tsx');

  assert.match(main, /workspace={selected||workspaces.find(w=>w.id===task.workspaceId)}/);
  assert.match(main, /Branch configurada/);
  assert.match(main, /Branch efetiva/);
  assert.match(main, /Esta task já foi aplicada à branch/);
  assert.match(main, /configSnapshot\?\.agentConfigs/);
  assert.match(main, /provider=x\?\.provider\|\|configured\?\.provider/);
  assert.match(main, /Resumo/);
  assert.match(main, /Técnico/);
  assert.match(main, /Sistema/);
  assert.match(main, /Tamanho enviado ao reviewer/);
  assert.match(main, /Contexto da task/);
  assert.match(main, /Contexto do projeto/);
  assert.match(main, /Pacote de revisão/);
  assert.match(main, /Pronto/);
  assert.match(main, /toLocaleString\('pt-BR'\)/);
  assert.match(main, /slice\(0,8\)/);
  assert.match(main, /Ver contexto enviado/);
  assert.match(main, /Copiar contexto/);
  assert.match(main, /project-context-stage-grid/);
  assert.match(main, /Aplicar na \{environment\.baseBranch/);
  assert.match(main, /Limite de tokens/);
  assert.match(main, /Sem limite/);
  assert.match(main, /humanizeStatus/);
});

test('new Codex reviewer prompts request Portuguese human-readable text and preserve statuses', () => {
  const codex = source('../../../packages/adapters/src/codex.ts');

  assert.match(codex, /Brazilian Portuguese \(pt-BR\)/);
  assert.match(codex, /APPROVED or NEEDS_FIX/);
});
