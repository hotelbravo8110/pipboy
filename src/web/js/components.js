// Reusable UI pieces: the selectable list with a sliding highlight bar, and
// the base Page class every screen extends.
import { h } from './util.js';
import { sound } from './sound.js';

export class Page {
  constructor(app) {
    this.app = app;
    this.el = h('div', { class: 'page' });
    this.built = false;
  }
  ensureBuilt() {
    if (!this.built) {
      this.built = true;
      this.build();
    }
  }
  build() {}
  show() {}
  hide() {}
  tel() {}
  state() {}
  /** Return true when the key was consumed. */
  key() { return false; }
}

/**
 * List rows: { id, label, value?, cls?, dim? }. Selection is shown by a
 * highlight bar that glides between rows (Pip-Boy style).
 */
export class List {
  constructor({ onSelect, onActivate, cls = '' } = {}) {
    this.onSelect = onSelect || (() => {});
    this.onActivate = onActivate || (() => {});
    this.el = h('div', { class: `list ${cls}` });
    this.inner = h('div', { class: 'list-inner' });
    this.hl = h('div', { class: 'list-hl' });
    this.inner.append(this.hl);
    this.el.append(this.inner);
    this.items = [];
    this.rows = [];
    this.index = 0;
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.move(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  set(items) {
    const sameIds = items.length === this.items.length && items.every((it, i) => it.id === this.items[i].id);
    this.items = items;
    if (!sameIds) {
      for (const r of this.rows) r.el.remove();
      this.rows = items.map((it, i) => {
        const label = h('span', { class: 'lbl' });
        const value = h('span', { class: 'val' });
        const el = h('div', { class: 'row' }, label, value);
        el.addEventListener('mouseenter', () => this.select(i));
        el.addEventListener('click', () => {
          this.select(i, false);
          sound.select();
          this.onActivate(this.items[i], i);
        });
        this.inner.append(el);
        return { el, label, value };
      });
      if (this.index >= items.length) this.index = Math.max(0, items.length - 1);
    }
    items.forEach((it, i) => this._paint(i));
    requestAnimationFrame(() => this._placeHl(true));
    if (!sameIds && items.length) this.onSelect(this.items[this.index], this.index);
  }

  _paint(i) {
    const it = this.items[i];
    const r = this.rows[i];
    if (!r) return;
    if (r.label.innerHTML !== it.label) r.label.innerHTML = it.label;
    const v = it.value === undefined || it.value === null ? '' : String(it.value);
    if (r.value.innerHTML !== v) r.value.innerHTML = v;
    r.el.className = `row ${it.cls || ''} ${it.dim ? 'dim' : ''} ${i === this.index ? 'sel' : ''}`;
  }

  /** Update only the value column (cheap, for live telemetry). */
  values(fn) {
    this.items.forEach((it, i) => {
      const v = fn(it, i);
      if (v === undefined) return;
      it.value = v;
      const r = this.rows[i];
      if (r && r.value.innerHTML !== String(v)) r.value.innerHTML = v;
    });
  }

  select(i, withSound = true) {
    if (!this.items.length) return;
    i = Math.max(0, Math.min(this.items.length - 1, i));
    if (i === this.index && this.rows[i]?.el.classList.contains('sel')) return;
    const prev = this.rows[this.index];
    if (prev) prev.el.classList.remove('sel');
    this.index = i;
    this.rows[i].el.classList.add('sel');
    this._placeHl();
    if (withSound) sound.move();
    this.onSelect(this.items[i], i);
  }

  move(d) { this.select(this.index + d); }

  activate() {
    if (!this.items.length) return;
    sound.select();
    this.onActivate(this.items[this.index], this.index);
  }

  current() { return this.items[this.index]; }

  _placeHl(instant) {
    const r = this.rows[this.index];
    if (!r) { this.hl.style.opacity = 0; return; }
    this.hl.style.opacity = 1;
    if (instant) this.hl.style.transition = 'none';
    this.hl.style.transform = `translateY(${r.el.offsetTop}px)`;
    this.hl.style.height = `${r.el.offsetHeight}px`;
    if (instant) requestAnimationFrame(() => { this.hl.style.transition = ''; });
    const top = r.el.offsetTop, bottom = top + r.el.offsetHeight;
    if (top < this.el.scrollTop) this.el.scrollTop = top;
    else if (bottom > this.el.scrollTop + this.el.clientHeight) this.el.scrollTop = bottom - this.el.clientHeight;
  }

  /** Standard list key handling; returns true if consumed. */
  key(e) {
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') { this.move(1); return true; }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { this.move(-1); return true; }
    if (k === 'Enter' || k === ' ') { this.activate(); return true; }
    if (k === 'PageDown') { this.move(8); return true; }
    if (k === 'PageUp') { this.move(-8); return true; }
    return false;
  }
}

/** Horizontal meter: returns {el, set(fraction, text)} */
export function meter(label, cls = '') {
  const fill = h('div', { class: 'meter-fill' });
  const txt = h('span', { class: 'meter-txt' });
  const el = h('div', { class: `meter ${cls}` }, h('span', { class: 'meter-lbl' }, label), h('div', { class: 'meter-track' }, fill), txt);
  return {
    el,
    set(f, text = '') {
      const v = Math.max(0, Math.min(1, isFinite(f) ? f : 0));
      fill.style.width = `${v * 100}%`;
      if (txt.textContent !== text) txt.textContent = text;
    },
  };
}

/** Key/value stat rows for detail panels. */
export function statTable(rows) {
  const el = h('div', { class: 'stat-table' });
  const cells = {};
  for (const [key, label] of rows) {
    const v = h('span', { class: 'st-v' }, '---');
    cells[key] = v;
    el.append(h('div', { class: 'st-row' }, h('span', { class: 'st-k' }, label), v));
  }
  return {
    el,
    set(key, value) {
      const c = cells[key];
      if (c && c.textContent !== String(value)) c.textContent = value;
    },
  };
}
