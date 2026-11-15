import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function environment({ reduced = false, fine = true } = {}) {
  const events = {}, documentEvents = {}, instances = [], observers = [];
  const preferences = [reduced, fine].map(matches => ({ matches, addEventListener(_, callback) { this.change = callback; } }));
  let modal = false;
  let targets = [];
  const context = {
    Set, Lenis: class { constructor(options) { this.options = options; instances.push(this); } destroy() { this.destroyed = true; } },
    matchMedia: query => preferences[query.includes('reduced-motion') ? 0 : 1],
    window: { IntersectionObserver: true, addEventListener: (name, callback) => { events[name] = callback; } },
    document: { querySelector: () => modal, querySelectorAll: () => targets, addEventListener: (name, callback) => { documentEvents[name] = callback; } },
    IntersectionObserver: class { constructor(callback) { this.callback = callback; this.watched = []; observers.push(this); } observe(target) { this.watched.push(target); } unobserve() {} disconnect() { this.disconnected = true; } }
  };
  const source = readFileSync(new URL('./motion.js', import.meta.url), 'utf8').replace(/^import Lenis[^\n]+\n/, '').replace('export function updateMotion', 'function updateMotion');
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, events, documentEvents, instances, observers, preferences, modal(value) { modal = value; }, targets(count) {
    targets = Array.from({ length: count }, () => ({ isConnected: true, matches: () => false, calls: [], animate(frames, options) { const animation = { finish() { this.finished = true; this.onfinish?.(); } }; this.calls.push({ frames, options, animation }); return animation; } }));
    return targets;
  }, enter() { const current = observers.at(-1); current.callback(current.watched.map(target => ({ target, isIntersecting: true }))); } };
}

test('smoothing runs only on the desktop homepage and is destroyed on application routes', () => {
  const env = environment();
  env.context.updateMotion('home');
  assert.equal(env.instances.length, 1);
  assert.equal(env.instances[0].options.syncTouch, false);
  assert.equal(env.instances[0].options.lerp, 0.1);
  env.context.updateMotion('profile');
  assert.equal(env.instances[0].destroyed, true);
  env.events.wheel();
  assert.equal(env.instances.length, 1);
});

test('reveals stagger once and repeated rendering neither replays nor stacks observers', () => {
  const env = environment();
  const targets = env.targets(4);
  env.context.updateMotion('home'); env.enter();
  assert.deepEqual(targets.map(target => target.calls[0].options.delay), [0, 50, 100, 150]);
  assert.equal(targets[0].calls[0].frames[0].transform, 'translateY(28px)');
  assert.equal(targets[0].calls[0].options.duration, 650);
  env.context.updateMotion('home'); env.enter();
  assert.equal(env.observers[0].disconnected, true);
  assert.equal(targets[0].calls.length, 1);
  assert.equal(targets[0].calls[0].animation.finished, true);
});

test('keyboard completes in-flight reveals and keeps later focus navigation instant', () => {
  const env = environment();
  const targets = env.targets(1);
  env.context.updateMotion('home'); env.enter(); env.events.keydown();
  assert.equal(targets[0].calls[0].animation.finished, true);
  assert.equal(env.instances[0].destroyed, true);
  const next = env.targets(2);
  env.context.updateMotion('home'); env.enter();
  assert.equal(next[1].calls.length, 0);
  env.events.wheel();
  assert.equal(env.instances.length, 2);
});

test('reduced motion uses native scrolling and opacity only, and updates live', () => {
  const env = environment({ reduced: true });
  const [target] = env.targets(1);
  env.context.updateMotion('home'); env.enter();
  assert.equal(env.instances.length, 0);
  assert.equal(target.calls[0].frames[0].transform, undefined);
  assert.equal(target.calls[0].options.duration, 180);
  assert.equal(target.calls[0].options.delay, 0);
  env.preferences[0].matches = false; env.preferences[0].change();
  assert.equal(env.instances.length, 1);
  env.preferences[0].matches = true; env.preferences[0].change();
  assert.equal(env.instances[0].destroyed, true);
});

test('touch devices, open dialogs and unavailable observers retain native usable content', () => {
  const touch = environment({ fine: false });
  touch.context.updateMotion('home'); touch.events.wheel();
  assert.equal(touch.instances.length, 0);
  const env = environment();
  env.context.updateMotion('home'); env.modal(true); env.documentEvents.focusin(); env.events.wheel();
  assert.equal(env.instances[0].destroyed, true);
  assert.equal(env.instances.length, 1);
  delete env.context.window.IntersectionObserver;
  assert.doesNotThrow(() => env.context.updateMotion('home'));
});


test('pointer activation stops inertia without snapping ongoing section reveals', () => {
  const env = environment();
  const [target] = env.targets(1);
  env.context.updateMotion('home'); env.enter();
  env.events.pointerdown();
  assert.equal(env.instances[0].destroyed, true);
  assert.equal(target.calls[0].animation.finished, undefined);
  env.events.wheel();
  assert.equal(env.instances.length, 2);
});


test('pointer focus preserves reveal timing, while an opened dialog settles the background', () => {
  const env = environment();
  const [target] = env.targets(1);
  env.context.updateMotion('home'); env.enter();
  env.documentEvents.focusin();
  assert.equal(target.calls[0].animation.finished, undefined);
  env.modal(true); env.documentEvents.focusin();
  assert.equal(target.calls[0].animation.finished, true);
  assert.equal(env.instances[0].destroyed, true);
});


test('reference imagery uses the sampled 1500ms spring and settles precisely', () => {
  const env = environment();
  const [target] = env.targets(1);
  target.matches = selector => selector.includes('.feature-photo');
  env.context.updateMotion('home'); env.enter();
  const { frames, options } = target.calls[0];
  assert.equal(options.duration, 1500);
  assert.equal(options.easing, 'linear');
  assert.equal(frames.length, 91);
  assert.equal(frames[0].transform, 'translateY(-28px) rotate(-3.2deg)');
  assert.equal(frames.at(-1).transform, 'translateY(0px) rotate(0deg)');
  assert.equal(frames.at(-1).opacity, 1);
  assert.ok(frames.some(frame => parseFloat(frame.transform.slice(11)) > 0), 'spring passes its resting point before settling');
  assert.ok(frames.every(frame => !frame.transform.includes('NaN')));
});


test('all workspaces enter with bounded staggering and never replay on data rerenders', () => {
  for (const page of ['dashboard', 'profile', 'log']) {
    const env = environment();
    const targets = env.targets(5);
    env.context.updateMotion(page);
    assert.equal(env.instances.length, 0, 'workspace scrolling stays native');
    assert.deepEqual(targets.map(target => target.calls[0].options.delay), [0, 40, 80, 120, 120]);
    assert.equal(targets[0].calls[0].options.duration, 200);
    assert.equal(targets[0].calls[0].frames[0].opacity, 0.65);
    assert.equal(targets[0].calls[0].frames[0].transform, page === 'log' ? 'translateX(8px)' : 'scale(.97)');
    env.context.updateMotion(page);
    assert.equal(targets[0].calls.length, 1);
    assert.equal(targets[0].calls[0].animation.finished, true);
    env.context.updateMotion('home');
    env.context.updateMotion(page);
    assert.equal(targets[0].calls.length, 2, 'later route entry animates again');
  }
});

test('workspace entrances respect reduced motion, keyboard and existing dialogs', () => {
  const reduced = environment({ reduced: true });
  const [target] = reduced.targets(1);
  reduced.context.updateMotion('profile');
  assert.equal(target.calls[0].options.duration, 180);
  assert.equal(target.calls[0].options.delay, 0);
  assert.equal(target.calls[0].frames[0].transform, undefined);
  for (const mode of ['keyboard', 'dialog']) {
    const env = environment();
    const [target] = env.targets(1);
    if (mode === 'keyboard') env.events.keydown();
    else env.modal(true);
    env.context.updateMotion('log');
    assert.equal(target.calls.length, 0);
  }
});

test('workspace interaction settles motion but programmatic main focus preserves entry', () => {
  for (const interaction of ['pointer', 'focus', 'keyboard']) {
    const env = environment();
    const [target] = env.targets(1);
    env.context.updateMotion('dashboard');
    env.documentEvents.focusin({ target: { closest: () => null } });
    assert.equal(target.calls[0].animation.finished, undefined);
    if (interaction === 'pointer') env.events.pointerdown();
    else if (interaction === 'focus') env.documentEvents.focusin({ target: { closest: () => ({}) } });
    else env.events.keydown();
    assert.equal(target.calls[0].animation.finished, true);
  }
});


test('dashboard sections reveal once per route and settle on keyboard input', () => {
  const env = environment();
  const targets = env.targets(2);
  env.context.updateMotion('dashboard', '#dashboard');
  assert.equal(env.instances.length, 0);
  env.enter();
  assert.equal(targets[0].calls[0].frames[0].transform, 'scale(.97)');
  env.enter();
  assert.equal(targets[0].calls.length, 1);
  env.context.updateMotion('dashboard', '#dashboard');
  assert.equal(targets[0].calls.length, 1);
  env.context.updateMotion('dashboard', '#dashboard/categories');
  env.enter();
  assert.equal(targets[0].calls.length, 2);
  env.events.keydown();
  assert.equal(targets[0].calls[1].animation.finished, true);
});
test('dashboard reduced motion uses opacity without transforms', () => {
  const env = environment({ reduced: true });
  const [target] = env.targets(1);
  env.context.updateMotion('dashboard', '#dashboard');
  env.enter();
  assert.equal(target.calls[0].frames[0].transform, undefined);
  assert.equal(target.calls[0].options.delay, 0);
});


test('dashboard routes have distinct motion with no upward translation', () => {
  for (const [route, transform, duration] of [
    ['#dashboard', 'scale(.97)', 480],
    ['#dashboard/categories', 'translateX(-14px)', 380],
    ['#dashboard/heart', 'translateX(24px)', 480],
    ['#dashboard/anatomy', 'scale(.94)', 560]
  ]) {
    const env = environment();
    const [target] = env.targets(1);
    env.context.updateMotion('dashboard', route); env.enter();
    assert.equal(target.calls[0].frames[0].transform, transform);
    assert.equal(target.calls[0].options.duration, duration);
  }
});


test('switching between individual health categories stays instant', () => {
  const env = environment();
  const [target] = env.targets(1);
  env.context.updateMotion('dashboard', '#dashboard/heart'); env.enter();
  assert.equal(target.calls.length, 1);
  env.context.updateMotion('dashboard', '#dashboard/sleep');
  assert.equal(target.calls.length, 1);
  assert.equal(target.calls[0].animation.finished, true);
});


test('Summary return with a trailing slash uses the Summary motion', () => {
  const env = environment();
  const [target] = env.targets(1);
  env.context.updateMotion('dashboard', '#dashboard/'); env.enter();
  assert.equal(target.calls[0].frames[0].transform, 'scale(.97)');
  env.context.updateMotion('dashboard', '#dashboard');
  assert.equal(target.calls.length, 1);
});
