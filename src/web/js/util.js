// Small DOM / formatting helpers shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an HTML element: h('div', {class: 'x', onclick}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const isNum = (v) => typeof v === 'number' && isFinite(v);

export const fmt = {
  int: (v) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : '---'),
  num: (v, d = 1) => (isNum(v) ? v.toFixed(d) : '---'),
  signed: (v) => (isNum(v) ? (v > 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') : '---'),
  hdg: (v) => (isNum(v) ? String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0') + '°' : '---°'),
  freq: (v, d = 3) => (isNum(v) && v > 0 ? v.toFixed(d) : '---.---'),
  fl: (ft) => (isNum(ft) ? 'FL' + String(Math.max(0, Math.round(ft / 100))).padStart(3, '0') : 'FL---'),
  dur(sec) {
    if (!isNum(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  },
  durS(sec) {
    if (!isNum(sec)) return '--:--:--';
    const s = Math.floor(sec);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  },
  zulu(sec) {
    if (!isNum(sec)) return '--:--Z';
    const m = Math.floor(sec / 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}Z`;
  },
  date(iso) {
    if (!iso) return '----';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  },
  time(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
};

/** localStorage wrapper that never throws (private windows, blocked storage). */
export const local = {
  get(key, def) {
    try {
      const v = localStorage.getItem(`pip.${key}`);
      return v === null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try { localStorage.setItem(`pip.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

/** Shortest signed angle difference a -> b in degrees. */
export const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

/** Keeps a continuously increasing angle so CSS transitions never spin the long way. */
export class SmoothAngle {
  constructor() { this.v = null; }
  to(target) {
    if (this.v === null) this.v = target;
    else this.v += angDiff(this.v, target);
    return this.v;
  }
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
