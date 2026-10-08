import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const main=readFileSync(new URL('../../web/src/main.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../../web/src/styles.css',import.meta.url),'utf8');

test('global Modal uses a portal and deterministic stack layers',()=>{
  assert.match(main,/createPortal\(/);
  assert.match(main,/modalStackBaseZIndex=1000/);
  assert.match(main,/modalStackStep=20/);
  assert.match(main,/zIndex:backdropZ/);
  assert.match(main,/zIndex:dialogZ/);
});

test('only the top modal handles close interactions and locked modals stay open',()=>{
  assert.match(main,/isTop&&closable&&closeOnBackdrop/);
  assert.match(main,/isTop&&<button className="icon-button"/);
  assert.match(main,/!isTop\|\|!closable/);
  assert.match(main,/closable=\{!busy\} closeOnBackdrop=\{!busy\}/);
});

test('modal stack locks and restores body scrolling and restores focus',()=>{
  assert.match(main,/document\.body\.style\.overflow='hidden'/);
  assert.match(main,/document\.body\.style\.overflow=modalBodyOverflow/);
  assert.match(main,/previousFocus\.current\?\.isConnected/);
});

test('modal CSS has no fixed legacy z-index and mission diff remains nested',()=>{
  assert.doesNotMatch(styles,/\.modal-backdrop\{[^}]*z-index:30/);
  assert.match(styles,/--modal-backdrop-z/);
  assert.match(main,/missionDiff&&<Modal title="Alterações da missão"/);
});
