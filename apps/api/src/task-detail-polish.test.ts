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
  assert.match(main, /Esta task já foi aplicada ao workspace./);
  assert.match(main, /Limite de tokens/);
  assert.match(main, /Sem limite/);
  assert.match(main, /humanizeStatus/);
});

test('new Codex reviewer prompts request Portuguese human-readable text and preserve statuses', () => {
  const codex = source('../../../packages/adapters/src/codex.ts');

  assert.match(codex, /Brazilian Portuguese \(pt-BR\)/);
  assert.match(codex, /APPROVED or NEEDS_FIX/);
});
