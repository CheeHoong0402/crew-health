import Lenis from './assets/lenis.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const seen = new Set();
const active = new Set();
let scroller;
let observer;
let currentPage;
let keyboard = false;

function finishReveals() {
  for (const animation of active) animation.finish();
  active.clear();
}

function stopSmoothing() {
  scroller?.destroy();
  scroller = undefined;
}

function startSmoothing() {
  if (scroller || currentPage !== 'home' || keyboard || reducedMotion.matches || !finePointer.matches || document.querySelector('dialog[open]')) return;
  scroller = new Lenis({ autoRaf: true, lerp: 0.1, syncTouch: false });
}

function playReveal(target, frames, timing) {
  const animation = target.animate(frames, { ...timing, fill: 'backwards' });
  active.add(animation);
  animation.onfinish = animation.oncancel = () => active.delete(animation);
}

// The live portfolio uses this 1500ms spring: stiffness 210, damping 13, 91 samples.
function springFrames() {
  const decay = 13 / 2;
  const frequency = Math.sqrt(210 - decay * decay);
  return Array.from({ length: 91 }, (_, index) => {
    const time = index / 60;
    const displacement = index === 90 ? 0 : Math.exp(-decay * time) * (Math.cos(frequency * time) + decay / frequency * Math.sin(frequency * time));
    return { offset: index / 90, opacity: Math.min(1, time / 0.2), transform: `translateY(${-28 * displacement}px) rotate(${-3.2 * displacement}deg)` };
  });
}

function revealHeadline(target, delay) {
  target.setAttribute('aria-label', target.innerText.replace(/\s+/g, ' ').trim());
  const words = [];
  for (const node of [...target.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const fragment = document.createDocumentFragment();
    for (const word of node.textContent.split(/(\s+)/)) {
      if (!word) continue;
      if (!word.trim()) { fragment.append(document.createTextNode(word)); continue; }
      const span = document.createElement('span');
      span.className = 'motion-word';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = word;
      fragment.append(span);
      words.push(span);
    }
    node.replaceWith(fragment);
  }
  words.forEach((word, index) => playReveal(word,
    [{ opacity: 0, transform: 'translateY(.5em)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 500, delay: delay + index * 50, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  ));
}


export function updateMotion(page) {
  const entering = currentPage !== page;
  observer?.disconnect();
  finishReveals();
  stopSmoothing();
  currentPage = page;
  if (page !== 'home') {
    // Re-entering a workspace gets a brief entrance; saves and evidence changes stay immediate.
    if (!entering || keyboard || document.querySelector('dialog[open]')) return;
    const targets = document.querySelectorAll('#main .mission-bar > div:first-child, #main .latest, #main .anatomy, #main .evidence, #main .profile-grid > .panel, #main .timeline > .panel-heading, #main .timeline-list > li:nth-child(-n+6)');
    [...targets].forEach((target, index) => {
      if (!target.animate) return;
      playReveal(target, reducedMotion.matches
        ? [{ opacity: 0.65 }, { opacity: 1 }]
        : [{ opacity: 0.65, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: reducedMotion.matches ? 180 : 280, delay: reducedMotion.matches ? 0 : Math.min(index, 3) * 40, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    });
    return;
  }
  startSmoothing();
  if (!('IntersectionObserver' in window)) return;

  const targets = [...document.querySelectorAll('.hero-intro h1, .hero-intro > p, .hero-actions, .hero-gallery > a, .mediva-section-heading h2, .mediva-section-heading > p, .service-card, .feature-copy, .feature-photo, .specialty-card, .pathway-menu, .pathway-content h2, .crew-fan, .mediva-scope, .mediva-closing > p, .mediva-closing h2, .mediva-closing > a')];
  observer = new IntersectionObserver(entries => {
    let order = 0;
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting || !target.isConnected || currentPage !== 'home') continue;
      observer.unobserve(target);
      const key = targets.indexOf(target);
      if (seen.has(key)) continue;
      seen.add(key);
      // Longer homepage storytelling stays separate from immediate keyboard and data-entry feedback.
      if (keyboard || !target.animate || document.querySelector('dialog[open]')) continue;
      let delay = Math.min(order++, 3) * 50;
      const imagery = target.matches('.hero-gallery > a, .feature-photo, .specialty-card, .crew-fan');
      if (target.matches('.hero-gallery > a, .specialty-card, .service-card')) {
        delay = [...target.parentElement.children].indexOf(target) * (imagery ? 150 : 100);
      }
      if (reducedMotion.matches) {
        playReveal(target, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 0, easing: 'ease-out' });
      } else if (target.matches('.hero-intro h1, .mediva-section-heading h2, .pathway-content h2, .mediva-closing h2')) {
        // Use the reference's 50ms stagger on words so longer health headlines stay readable.
        revealHeadline(target, delay);
      } else if (imagery) {
        playReveal(target, springFrames(), { duration: 1500, delay, easing: 'linear' });
      } else {
        playReveal(target, [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'translateY(0)' }], {
          duration: 650, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        });
      }
    }
  }, { threshold: 0.08 });
  targets.forEach((target, index) => { if (!seen.has(index)) observer.observe(target); });
}

window.addEventListener('keydown', () => {
  keyboard = true;
  stopSmoothing();
  finishReveals();
}, true);
window.addEventListener('pointerdown', () => {
  keyboard = false;
  stopSmoothing();
  if (currentPage !== 'home') finishReveals();
}, { passive: true, capture: true });
window.addEventListener('wheel', () => { keyboard = false; startSmoothing(); }, { passive: true, capture: true });
document.addEventListener('focusin', event => {
  const dialogOpen = document.querySelector('dialog[open]');
  if (keyboard || dialogOpen || (currentPage !== 'home' && event?.target?.closest('input, select, textarea, button, a, summary, [contenteditable]'))) finishReveals();
  if (dialogOpen) stopSmoothing();
});
for (const preference of [reducedMotion, finePointer]) preference.addEventListener('change', () => {
  finishReveals();
  stopSmoothing();
  startSmoothing();
});
