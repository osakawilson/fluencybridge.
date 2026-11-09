/**
 * DOM + formatting helpers shared by the student view and the inspector.
 * No framework: everything is plain DOM built with `el()`.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  });
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------- view mode -------------------------------- */

/**
 * Reads the demo's view flags from the query string:
 *   ?mode=inspector  -> full researcher layout (default: student)
 *   ?scripted=0      -> start with unscripted scoring (default: scripted)
 */
export function readModeFlags(search = window.location.search) {
  const params = new URLSearchParams(search || '');
  return {
    mode: params.get('mode') === 'inspector' ? 'inspector' : 'student',
    scripted: params.get('scripted') !== '0',
    vowels: params.get('vowels') === '1'
  };
}

/** Inline speaker glyph shared by the model-sentence and chip play buttons. */
export const SPEAKER_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-3.7v7.4a4.5 4.5 0 0 0 2-3.7Z"/></svg>';

/* ------------------------------ score helpers ----------------------------- */

export const BAND_COLORS = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626', none: '#94a3b8' };

/**
 * Display bands (calibrated for L1-accented A2 speech):
 *   good  >= 88  Clear / intelligible
 *   warn  65-87  Accent drift / epenthetic vowels / one distorted phoneme
 *   bad    < 65  Mispronounced / unintelligible
 */
export const BAND_THRESHOLDS = { good: 88, warn: 65 };

export const BAND_LABELS = {
  good: 'Clear',
  warn: 'Accent drift',
  bad: 'Mispronounced',
  none: 'no score'
};

export function scoreBand(score) {
  if (score === null || score === undefined || score === '' || Number.isNaN(Number(score))) return 'none';
  const value = Number(score);
  if (value >= BAND_THRESHOLDS.good) return 'good';
  if (value >= BAND_THRESHOLDS.warn) return 'warn';
  return 'bad';
}

export function bandLabel(score) {
  return BAND_LABELS[scoreBand(score)];
}

export function scoreHex(score) {
  return BAND_COLORS[scoreBand(score)];
}

export function formatScore(score, digits = 1) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return '—';
  return Number(score).toFixed(digits);
}

export function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
  const value = Math.round(Number(ms));
  if (value >= 10000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toLocaleString('en-US')} ms`;
}

export function formatOffset(ms) {
  if (!Number.isFinite(Number(ms))) return '—';
  return `${(Number(ms) / 1000).toFixed(2)}s`;
}

export function chipTag(text, band = '') {
  return el('span', { class: `chip-tag ${band}`.trim(), text });
}

/* -------------------------------- tooltip -------------------------------- */

let tooltipEl = null;
let activeTip = null;

function positionTooltip(target) {
  if (!tooltipEl) return;
  const rect = target.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();
  const margin = 8;
  let top = rect.top - tipRect.height - margin;
  if (top < margin) top = rect.bottom + margin;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(window.innerWidth - tipRect.width - margin, left));
  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
}

function showTooltip(target) {
  if (!tooltipEl) return;
  const text = target.getAttribute('data-tip');
  if (!text) return;
  activeTip = target;
  tooltipEl.textContent = text;
  tooltipEl.classList.add('is-visible');
  tooltipEl.setAttribute('aria-hidden', 'false');
  positionTooltip(target);
}

function hideTooltip() {
  if (!tooltipEl) return;
  activeTip = null;
  tooltipEl.classList.remove('is-visible');
  tooltipEl.setAttribute('aria-hidden', 'true');
}

export function initTooltips() {
  tooltipEl = document.getElementById('tooltip');
  if (!tooltipEl) return;
  document.addEventListener('pointerover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (target) showTooltip(target);
  });
  document.addEventListener('pointerout', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (target && target === activeTip) hideTooltip();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    if (target) showTooltip(target);
  });
  document.addEventListener('focusout', hideTooltip);
  window.addEventListener('scroll', () => { if (activeTip) positionTooltip(activeTip); }, true);
  window.addEventListener('resize', hideTooltip);
}

/* ------------------------------ JSON render ------------------------------ */

function leafNode(value) {
  if (value === null) return el('span', { class: 'jt-null', text: 'null' });
  if (typeof value === 'boolean') return el('span', { class: 'jt-bool', text: String(value) });
  if (typeof value === 'number') return el('span', { class: 'jt-num', text: String(value) });
  if (typeof value === 'string') return el('span', { class: 'jt-str', text: `"${value}"` });
  return el('span', { class: 'jt-str', text: String(value) });
}

/**
 * Collapsible JSON tree (native <details>, no dependencies).
 * @param {*} value
 * @param {{depth?:number, keyName?:string|null}} options
 */
export function jsonTree(value, { depth = 0, keyName = null } = {}) {
  const wrap = el('div', { class: 'jt-node' });
  const isObject = value !== null && typeof value === 'object';

  if (!isObject) {
    const row = el('div', { class: 'jt-leaf' });
    if (keyName !== null) row.appendChild(el('span', { class: 'jt-key', text: `${keyName}:` }));
    row.appendChild(leafNode(value));
    wrap.appendChild(row);
    return wrap;
  }

  const entries = Object.entries(value);
  const isArray = Array.isArray(value);

  if (entries.length === 0) {
    const row = el('div', { class: 'jt-leaf' });
    if (keyName !== null) row.appendChild(el('span', { class: 'jt-key', text: `${keyName}:` }));
    row.appendChild(el('span', { class: 'jt-null', text: isArray ? '[ ]' : '{ }' }));
    wrap.appendChild(row);
    return wrap;
  }

  const details = el('details');
  if (depth < 2) details.open = true;
  const summary = el('summary');
  if (keyName !== null) summary.appendChild(el('span', { class: 'jt-key', text: `${keyName}:` }));
  summary.appendChild(el('span', {
    class: 'jt-count',
    text: isArray ? `[${entries.length}]` : `{${entries.length}}`
  }));
  details.appendChild(summary);

  const children = el('div', { class: 'jt-children' });
  entries.forEach(([key, child]) => {
    children.appendChild(jsonTree(child, { depth: depth + 1, keyName: isArray ? `[${key}]` : key }));
  });
  details.appendChild(children);
  wrap.appendChild(details);
  return wrap;
}

/** Pretty JSON string with span-based syntax highlighting (escape-safe). */
export function highlightJson(value, space = 2) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, space);
  if (text === undefined) return '';

  // Tokenise the RAW json, then escape each emitted chunk: escaping first would
  // turn `&`/`'` into entities that the token pattern could split apart.
  const pattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let html = '';
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    const [whole, str, colon, literal] = match;
    if (str) {
      html += colon
        ? `<span class="j-key">${escapeHtml(str)}</span>${escapeHtml(colon)}`
        : `<span class="j-str">${escapeHtml(str)}</span>`;
    } else if (literal) {
      html += `<span class="${literal === 'null' ? 'j-null' : 'j-bool'}">${literal}</span>`;
    } else {
      html += `<span class="j-num">${whole}</span>`;
    }
    lastIndex = match.index + whole.length;
    match = pattern.exec(text);
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

/** <pre> block with a copy button. */
export function jsonBlock(title, value, { copyLabel = 'Copy' } = {}) {
  const pre = el('pre', { class: 'json-pre', html: highlightJson(value) });
  const copyBtn = el('button', {
    class: 'mini-btn',
    type: 'button',
    title: 'Copy JSON',
    onclick: async () => {
      const ok = await copyText(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
      copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      window.setTimeout(() => { copyBtn.textContent = copyLabel; }, 1400);
    }
  }, [el('span', { text: copyLabel })]);

  const head = el('div', { class: 'panel-head' }, [
    el('span', { class: 'panel-title', text: title }),
    el('div', { class: 'panel-actions' }, [copyBtn])
  ]);
  return el('div', { class: 'panel-card' }, [head, pre]);
}

/** <details> payload wrapper used by the Raw JSON tab. */
export function payloadDetails(title, meta, contentNode, open = false) {
  const details = el('details', { class: 'payload' });
  if (open) details.open = true;
  const summary = el('summary', {}, [
    el('span', { text: title }),
    el('span', { class: 'summary-meta', text: meta || '' })
  ]);
  details.appendChild(summary);
  details.appendChild(el('div', { class: 'payload-body' }, [contentNode]));
  return details;
}


const TOAST_ICONS = { error: '⚠', ok: '✓', warn: '!', info: 'i' };

export function toast(message, type = 'info', timeout = 4200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast-${type}`, role: 'status' }, [
    el('span', { class: 'toast-icon', text: TOAST_ICONS[type] || TOAST_ICONS.info }),
    el('span', { text: message })
  ]);
  host.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 220);
  }, timeout);
}

export async function copyText(text) {
  const value = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (err) {
    try {
      const area = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
      area.value = value;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err2) {
      return false;
    }
  }
}
