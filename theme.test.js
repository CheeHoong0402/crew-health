import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function loadTheme(saved, systemDark = false, blocked = false) {
  const root = { dataset: {} };
  const meta = {};
  const toggle = { setAttribute: (_, value) => toggle.pressed = value, addEventListener: (_, fn) => toggle.click = fn };
  let ready;
  const context = {
    document: { documentElement: root, querySelector: () => meta, getElementById: () => toggle, addEventListener: (_, fn) => ready = fn },
    localStorage: { getItem() { if (blocked) throw Error('blocked'); return saved; }, setItem(_, value) { if (blocked) throw Error('blocked'); saved = value; } },
    matchMedia: () => ({ matches: systemDark })
  };
  vm.runInNewContext(source, context);
  ready();
  return { root, meta, toggle, saved: () => saved };
}
test('theme follows first-use device preference and a saved choice overrides it', () => {
  assert.equal(loadTheme(null, true).root.dataset.theme, 'dark');
  assert.equal(loadTheme('light', true).root.dataset.theme, 'light');
  assert.equal(loadTheme('dark', false).root.dataset.theme, 'dark');
});
test('theme toggle updates accessibility, browser color and persisted reload choice', () => {
  const page = loadTheme('light');
  page.toggle.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.toggle.pressed, 'true');
  assert.equal(page.meta.content, '#13151e');
  assert.equal(loadTheme(page.saved()).root.dataset.theme, 'dark');
  page.toggle.click();
  assert.equal(page.toggle.pressed, 'false');
  assert.equal(page.saved(), 'light');
});
test('theme switching still works when preference storage is blocked', () => {
  const page = loadTheme(null, false, true);
  page.toggle.click();
  assert.equal(page.root.dataset.theme, 'dark');
});
