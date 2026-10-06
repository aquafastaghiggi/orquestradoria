import assert from 'node:assert/strict';
import test from 'node:test';
import { humanizeStatus, humanizeWarning, shortTaskDescription } from '../../web/src/ui-helpers.js';

test('shortTaskDescription extracts Summary from structured markdown', () => {
  assert.equal(
    shortTaskDescription({
      description: '# Create worktree validation marker file\n## Summary\nCreate a single JavaScript file for validation.\n## Objective\nKeep the task isolated.',
    }),
    'Create a single JavaScript file for validation.',
  );
});

test('shortTaskDescription falls back to Objective and removes markdown', () => {
  assert.equal(
    shortTaskDescription({
      description: '# Task\n## Objective\n***Validate the worktree*** without exposing raw headings.',
    }),
    'Validate the worktree without exposing raw headings.',
  );
});

test('humanizeStatus translates operational health labels', () => {
  assert.equal(humanizeStatus('active'), 'Ativo');
  assert.equal(humanizeStatus('inactive'), 'Inativo');
  assert.equal(humanizeStatus('healthy'), 'Disponível');
  assert.equal(humanizeStatus('unavailable'), 'Indisponível');
});

test('humanizeWarning translates configured branch fallback', () => {
  assert.equal(
    humanizeWarning('Configured branch main was not found; using master.'),
    "A branch configurada 'main' não foi encontrada. Utilizando 'master'.",
  );
});
