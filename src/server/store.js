'use strict';
const fs = require('fs');
const path = require('path');

/** Tiny JSON file store with debounced, atomic writes. */
class JsonStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.timers = new Map();
    this.cache = new Map();
  }

  load(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let value;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, `${name}.json`), 'utf8'));
      value = Array.isArray(fallback) ? (Array.isArray(raw) ? raw : [...fallback]) : { ...fallback, ...raw };
    } catch {
      value = Array.isArray(fallback) ? [...fallback] : { ...fallback };
    }
    this.cache.set(name, value);
    return value;
  }

  save(name, value, delay = 1000) {
    this.cache.set(name, value);
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => this.flush(name), delay));
  }

  flush(name) {
    const names = name ? [name] : [...this.cache.keys()];
    for (const n of names) {
      clearTimeout(this.timers.get(n));
      this.timers.delete(n);
      const file = path.join(this.dir, `${n}.json`);
      try {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.cache.get(n), null, 1));
        fs.renameSync(`${file}.tmp`, file);
      } catch (e) {
        console.warn('[store] failed to write', file, e.message);
      }
    }
  }
}

module.exports = { JsonStore };
