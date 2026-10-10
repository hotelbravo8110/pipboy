'use strict';
/*
 * Owns the simulator adapters. In "auto" mode X-Plane and MSFS are both
 * listened for and whichever is delivering data becomes the active source.
 */
const { EventEmitter } = require('events');
const { XPlaneAdapter } = require('./xplane');
const { MsfsAdapter } = require('./msfs');
const { DemoAdapter } = require('./demo');

class SimManager extends EventEmitter {
  constructor(settings) {
    super();
    this.adapters = [];
    this.active = null;
    this.lastSample = null;
    this.configure(settings);
  }

  configure(settings) {
    this.stop();
    this.mode = settings.sim || 'auto';
    const make = {
      xplane: () => new XPlaneAdapter({ host: settings.xplaneHost, port: Number(settings.xplanePort) || 49000 }),
      msfs: () => new MsfsAdapter(),
      demo: () => new DemoAdapter({ speed: settings.demoSpeed }),
    };
    const names = this.mode === 'auto' ? ['xplane', 'msfs'] : [this.mode].filter((n) => make[n]);
    this.adapters = names.map((n) => make[n]());
    for (const a of this.adapters) {
      a.on('data', (d) => this._onData(a, d));
      a.on('status', () => this._recompute());
      a.on('log', (m) => this.emit('log', m));
    }
  }

  start() {
    for (const a of this.adapters) a.start();
    this.watch = setInterval(() => this._recompute(), 1000);
  }

  stop() {
    clearInterval(this.watch);
    for (const a of this.adapters) a.stop();
    this.adapters = [];
    this._setActive(null);
  }

  _onData(adapter, d) {
    adapter.lastSampleAt = Date.now();
    if (!this.active) this._setActive(adapter);
    if (adapter !== this.active) return;
    this.lastSample = d;
    this.emit('telemetry', d);
  }

  _recompute() {
    const now = Date.now();
    const live = this.adapters.filter((a) => a.connected && now - (a.lastSampleAt || 0) < 4000);
    if (this.active && live.includes(this.active)) return;
    this._setActive(live[0] || null);
  }

  _setActive(a) {
    if (a === this.active) return;
    this.active = a;
    if (!a) this.lastSample = null;
    this.emit('source', this.status());
  }

  status() {
    return {
      mode: this.mode,
      source: this.active ? this.active.name : null,
      label: this.active ? this.active.label : null,
      listening: this.adapters.map((a) => a.name),
    };
  }
}

module.exports = { SimManager };
