/**
 * React Bits-inspired interactions for the DOM-based renderer.
 *
 * The upstream snippets are React components, but the current UI is plain
 * TypeScript + HTML. This module applies equivalent behavior to existing DOM
 * nodes without adding React islands or animation dependencies.
 */

const MAGIC_CARD_SELECTOR = '.playlist-card, .playlist-hero, .track-item, .track-candidate';
const BORDER_GLOW_SELECTOR = [
  '.playlist-card',
  '.playlist-hero',
  '.track-item',
  '.track-candidate',
  '#room-section',
  '#members-section',
  '#player-container',
  '.modal',
].join(', ');
const STAR_BORDER_SELECTOR = '.btn-primary, .control-btn.play';
const ANIMATED_LIST_SELECTOR = [
  '#playlist-grid',
  '#playlist-track-list',
  '#queue-list',
  '#history-list',
  '#audio-search-results',
  '#members-list',
  '.track-candidate-list',
].join(', ');
const ANIMATED_ITEM_SELECTOR = [
  '.playlist-card',
  '.track-item',
  '.track-candidate',
  '.member-item',
  '.member-group-label',
  '.empty-state',
  '.track-candidate-progress',
  '.track-candidate-error',
].join(', ');
const ELASTIC_SLIDER_SELECTOR = 'input[type="range"]';

const sliders = new Set<HTMLInputElement>();
const sliderDragState = new WeakMap<HTMLInputElement, { pointerId: number | null }>();

let effectsInitialized = false;
let sliderAnimationFrame = 0;
let listObserver: MutationObserver | null = null;

export function initializeReactBitsEffects(): void {
  if (effectsInitialized) return;
  effectsInitialized = true;

  document.body.classList.add('react-bits-effects-ready');
  applyReactBitsClasses(document);
  installMutationObserver();
  installBorderGlowTracking();
  installMagicBentoTracking();
  installAnimatedListNavigation();
  startSliderProgressLoop();
}

function installMutationObserver(): void {
  listObserver?.disconnect();
  listObserver = new MutationObserver((records) => {
    const roots = new Set<Element>();

    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) roots.add(node);
      });

      if (record.target instanceof Element) roots.add(record.target);
    });

    roots.forEach((root) => applyReactBitsClasses(root));
  });

  listObserver.observe(document.body, { childList: true, subtree: true });
}

function applyReactBitsClasses(root: Document | Element): void {
  getElements(root, MAGIC_CARD_SELECTOR).forEach((element) => {
    element.classList.add('rb-magic-card');
    ensureLayer(element, 'rb-magic-spotlight');
  });

  getElements(root, BORDER_GLOW_SELECTOR).forEach((element) => {
    element.classList.add('rb-border-glow');
    ensureLayer(element, 'rb-border-mesh');
    ensureLayer(element, 'rb-edge-light');
  });

  getElements(root, STAR_BORDER_SELECTOR).forEach((element) => {
    element.classList.add('rb-star-border');
    wrapDirectTextNodes(element);
  });

  getElements(root, ELASTIC_SLIDER_SELECTOR).forEach((element) => {
    if (element instanceof HTMLInputElement) applyElasticSlider(element);
  });

  getElements(root, ANIMATED_LIST_SELECTOR).forEach((element) => {
    element.classList.add('rb-animated-list');
    if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0');
    refreshAnimatedItems(element);
  });
}

function ensureLayer(element: HTMLElement, className: string): void {
  if (element.querySelector(`:scope > .${className}`)) return;

  const layer = document.createElement('span');
  layer.className = className;
  layer.setAttribute('aria-hidden', 'true');
  element.appendChild(layer);
}

function wrapDirectTextNodes(element: HTMLElement): void {
  Array.from(element.childNodes).forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'rb-star-content';
    wrapper.textContent = node.textContent;
    element.replaceChild(wrapper, node);
  });
}

function getElements(root: Document | Element, selector: string): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(selector)) {
    elements.push(root);
  }
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => elements.push(element));
  return elements;
}

function refreshAnimatedItems(list: Element): void {
  Array.from(list.children).forEach((child, index) => {
    if (!(child instanceof HTMLElement) || !child.matches(ANIMATED_ITEM_SELECTOR)) return;

    child.classList.add('rb-animated-item');
    child.style.setProperty('--rb-item-delay', `${Math.min(index * 28, 280)}ms`);
  });
}

function installAnimatedListNavigation(): void {
  document.addEventListener('pointerover', (event) => {
    const item = closestHTMLElement(event.target, '.rb-animated-item');
    const list = item?.parentElement?.closest('.rb-animated-list');
    if (!item || !list) return;

    list.querySelectorAll('.rb-list-selected').forEach((element) => {
      if (element !== item) element.classList.remove('rb-list-selected');
    });
    item.classList.add('rb-list-selected');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;

    const list = document.activeElement;
    if (!(list instanceof HTMLElement) || !list.classList.contains('rb-animated-list')) return;

    const items = Array.from(list.children).filter((child): child is HTMLElement => {
      return child instanceof HTMLElement && child.classList.contains('rb-animated-item') && child.offsetParent !== null;
    });
    if (items.length === 0) return;

    const selected = list.querySelector<HTMLElement>('.rb-list-selected');
    let nextIndex = selected ? items.indexOf(selected) : -1;

    if (event.key === 'Enter') {
      selected?.click();
      return;
    }

    event.preventDefault();
    nextIndex += event.key === 'ArrowDown' ? 1 : -1;
    nextIndex = Math.min(Math.max(nextIndex, 0), items.length - 1);

    list.querySelectorAll('.rb-list-selected').forEach((element) => element.classList.remove('rb-list-selected'));
    items[nextIndex].classList.add('rb-list-selected');
    items[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function installBorderGlowTracking(): void {
  document.addEventListener('pointermove', (event) => {
    const card = closestHTMLElement(event.target, '.rb-border-glow');
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const edge = getEdgeProximity(rect.width, rect.height, x, y);
    const angle = getCursorAngle(rect.width, rect.height, x, y);
    const edgePercent = edge * 100;

    card.style.setProperty('--rb-edge-proximity', `${edgePercent.toFixed(3)}`);
    card.style.setProperty('--rb-border-opacity', `${clamp((edgePercent - 24) / 76, 0, 1).toFixed(3)}`);
    card.style.setProperty('--rb-light-opacity', `${clamp((edgePercent - 30) / 70, 0, 1).toFixed(3)}`);
    card.style.setProperty('--rb-cursor-angle', `${angle.toFixed(3)}deg`);
  });
}

function installMagicBentoTracking(): void {
  document.addEventListener('pointerover', (event) => {
    const card = closestHTMLElement(event.target, '.rb-magic-card');
    if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
    spawnParticles(card);
  });

  document.addEventListener('pointermove', (event) => {
    const card = closestHTMLElement(event.target, '.rb-magic-card');
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateY = ((x - centerX) / Math.max(centerX, 1)) * 4;
    const rotateX = ((y - centerY) / Math.max(centerY, 1)) * -4;
    const magnetX = ((x - centerX) / Math.max(centerX, 1)) * 2.5;
    const magnetY = ((y - centerY) / Math.max(centerY, 1)) * 2.5;

    card.style.setProperty('--rb-glow-x', `${(x / Math.max(rect.width, 1)) * 100}%`);
    card.style.setProperty('--rb-glow-y', `${(y / Math.max(rect.height, 1)) * 100}%`);
    card.style.setProperty('--rb-tilt-x', `${rotateX.toFixed(2)}deg`);
    card.style.setProperty('--rb-tilt-y', `${rotateY.toFixed(2)}deg`);
    card.style.setProperty('--rb-magnet-x', `${magnetX.toFixed(2)}px`);
    card.style.setProperty('--rb-magnet-y', `${magnetY.toFixed(2)}px`);
  });

  document.addEventListener('pointerout', (event) => {
    const card = closestHTMLElement(event.target, '.rb-magic-card');
    if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
    resetMagicCard(card);
  });

  document.addEventListener('click', (event) => {
    const card = closestHTMLElement(event.target, '.rb-magic-card');
    if (!card) return;
    createRipple(card, event.clientX, event.clientY);
  });
}

function applyElasticSlider(input: HTMLInputElement): void {
  if (sliders.has(input)) return;

  sliders.add(input);
  input.classList.add('rb-elastic-slider');
  sliderDragState.set(input, { pointerId: null });
  updateSliderProgress(input);

  input.addEventListener('input', () => updateSliderProgress(input));
  input.addEventListener('change', () => updateSliderProgress(input));
  input.addEventListener('pointerdown', (event) => {
    sliderDragState.set(input, { pointerId: event.pointerId });
    input.classList.add('is-dragging');
    input.setPointerCapture(event.pointerId);
    updateSliderOverflow(input, event.clientX);
  });
  input.addEventListener('pointermove', (event) => {
    const dragState = sliderDragState.get(input);
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    updateSliderOverflow(input, event.clientX);
  });

  const release = () => {
    sliderDragState.set(input, { pointerId: null });
    input.classList.remove('is-dragging');
    input.classList.add('is-settling');
    input.style.setProperty('--rb-slider-scale-x', '1');
    input.style.setProperty('--rb-slider-scale-y', '1');
    window.setTimeout(() => input.classList.remove('is-settling'), 260);
  };

  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
  input.addEventListener('lostpointercapture', release);
}

function startSliderProgressLoop(): void {
  if (sliderAnimationFrame) return;

  const tick = () => {
    sliders.forEach((input) => {
      if (!document.body.contains(input)) {
        sliders.delete(input);
        return;
      }
      updateSliderProgress(input);
    });
    sliderAnimationFrame = window.requestAnimationFrame(tick);
  };

  sliderAnimationFrame = window.requestAnimationFrame(tick);
}

function updateSliderProgress(input: HTMLInputElement): void {
  const min = toFiniteNumber(input.min, 0);
  const max = toFiniteNumber(input.max, 100);
  const value = toFiniteNumber(input.value, min);
  const range = max - min;
  const progress = range === 0 ? 0 : ((value - min) / range) * 100;
  input.style.setProperty('--rb-slider-progress', `${Math.min(Math.max(progress, 0), 100).toFixed(2)}%`);
}

function updateSliderOverflow(input: HTMLInputElement, clientX: number): void {
  const rect = input.getBoundingClientRect();
  const leftOverflow = Math.max(0, rect.left - clientX);
  const rightOverflow = Math.max(0, clientX - rect.right);
  const overflow = decay(Math.max(leftOverflow, rightOverflow), 44);
  const scaleX = 1 + overflow / Math.max(rect.width, 1);
  const scaleY = 1 - Math.min(overflow / 150, 0.22);

  input.style.setProperty('--rb-slider-scale-x', scaleX.toFixed(3));
  input.style.setProperty('--rb-slider-scale-y', scaleY.toFixed(3));
  input.style.setProperty('--rb-slider-origin', leftOverflow > rightOverflow ? 'right center' : 'left center');
}

function createRipple(card: HTMLElement, clientX: number, clientY: number): void {
  const rect = card.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const maxDistance = Math.max(
    Math.hypot(x, y),
    Math.hypot(x - rect.width, y),
    Math.hypot(x, y - rect.height),
    Math.hypot(x - rect.width, y - rect.height),
  );

  const ripple = document.createElement('span');
  ripple.className = 'rb-card-ripple';
  ripple.style.width = `${maxDistance * 2}px`;
  ripple.style.height = `${maxDistance * 2}px`;
  ripple.style.left = `${x - maxDistance}px`;
  ripple.style.top = `${y - maxDistance}px`;
  card.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function spawnParticles(card: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (card.dataset.rbParticles === 'active') return;

  card.dataset.rbParticles = 'active';
  const rect = card.getBoundingClientRect();
  const count = Math.min(Math.max(Math.round((rect.width * rect.height) / 9000), 4), 10);

  for (let i = 0; i < count; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'rb-card-particle';
    particle.style.left = `${Math.random() * rect.width}px`;
    particle.style.top = `${Math.random() * rect.height}px`;
    particle.style.setProperty('--rb-particle-x', `${(Math.random() - 0.5) * 84}px`);
    particle.style.setProperty('--rb-particle-y', `${(Math.random() - 0.5) * 84}px`);
    particle.style.setProperty('--rb-particle-delay', `${i * 45}ms`);
    card.appendChild(particle);
    particle.addEventListener('animationend', () => particle.remove(), { once: true });
  }

  window.setTimeout(() => {
    delete card.dataset.rbParticles;
  }, 700);
}

function resetMagicCard(card: HTMLElement): void {
  card.style.setProperty('--rb-tilt-x', '0deg');
  card.style.setProperty('--rb-tilt-y', '0deg');
  card.style.setProperty('--rb-magnet-x', '0px');
  card.style.setProperty('--rb-magnet-y', '0px');
}

function getEdgeProximity(width: number, height: number, x: number, y: number): number {
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const kx = dx === 0 ? Infinity : centerX / Math.abs(dx);
  const ky = dy === 0 ? Infinity : centerY / Math.abs(dy);
  return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
}

function getCursorAngle(width: number, height: number, x: number, y: number): number {
  const radians = Math.atan2(y - height / 2, x - width / 2);
  const degrees = radians * (180 / Math.PI) + 90;
  return degrees < 0 ? degrees + 360 : degrees;
}

function closestHTMLElement(target: EventTarget | Element | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

function toFiniteNumber(value: string, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
