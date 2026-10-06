import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const webSource = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../web/src/${name}`, import.meta.url)), 'utf8');

test('app sidebar styles do not collide with workspace and task rails', () => {
  const mainSource = webSource('main.tsx');
  const stylesSource = webSource('styles.css');

  assert.match(mainSource, /<aside className="app-sidebar">/);
  assert.match(mainSource, /className="workspace-rail"/);
  assert.match(mainSource, /className="task-side-column"/);
  assert.match(mainSource, /Workspaces/);
  assert.match(stylesSource, /.shell > \.app-sidebar/);
  assert.match(stylesSource, /.shell\.sidebar-open > \.app-sidebar/);
  assert.doesNotMatch(stylesSource, /\.shell aside/);
  assert.doesNotMatch(stylesSource, /\.shell\.sidebar-open aside/);
});
