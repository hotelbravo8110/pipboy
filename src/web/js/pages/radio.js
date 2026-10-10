// RADIO tab: the avionics radio stack plus internet radio stations, with an
// oscilloscope that shows the real audio waveform while a station plays.
import { h, fmt, escapeHtml } from '../util.js';
import { Page, List } from '../components.js';
import { sound } from '../sound.js';

export class RadioPage extends Page {
  build() {
    this.el.classList.add('split', 'radio-page');
    this.list = new List({ cls: 'radio-list', onSelect: (it) => this._selected(it), onActivate: (it) => this._activate(it) });
    this.scope = h('canvas', { class: 'scope' });
    this.readout = h('div', { class: 'radio-readout' });
    this.vol = h('div', { class: 'radio-vol' });
    this.el.append(this.list.el, h('div', { class: 'detail radio-detail' }, this.scope, this.readout, this.vol));
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'none';
    this.playing = null;
    this.volume = 0.7;
    this.audio.volume = this.volume;
    this.audio.addEventListener('playing', () => { this.buffering = false; this._paintList(); this._readout(); });
    this.audio.addEventListener('error', () => {
      if (this.playing) this.app.toast('SIGNAL LOST — STATION UNREACHABLE');
      this.playing = null;
      this.buffering = false;
      this._paintList();
      this._readout();
    });
    this.phase = 0;
    this._rebuild();
    this._paintVol();
  }

  _rebuild() {
    const stations = this.app.S.settings?.stations || [];
    const items = [
      { id: 'h-av', label: '— AVIONICS —', cls: 'section', kind: 'header' },
      { id: 'com1', label: 'COM 1', kind: 'av', key: 'com1', sb: 'com1sb', d: 3 },
      { id: 'com2', label: 'COM 2', kind: 'av', key: 'com2', sb: 'com2sb', d: 3 },
      { id: 'nav1', label: 'NAV 1', kind: 'av', key: 'nav1', d: 2 },
      { id: 'nav2', label: 'NAV 2', kind: 'av', key: 'nav2', d: 2 },
      { id: 'xpdr', label: 'TRANSPONDER', kind: 'xpdr' },
      { id: 'h-st', label: '— STATIONS —', cls: 'section', kind: 'header' },
      ...stations.map((s) => ({ id: `st-${s.id}`, label: escapeHtml(s.name), kind: 'station', st: s })),
    ];
    this.list.set(items);
    if (this.list.current()?.kind === 'header') this.list.select(1, false);
    this._paintList();
  }

  settings() { if (this.built) this._rebuild(); }

  _paintList() {
    this.list.values((it) => {
      if (it.kind === 'station') return this.playing === it.st.id ? (this.buffering ? '<span class="blink">TUNING</span>' : '♪ ON AIR') : '';
      return undefined;
    });
  }

  _selected(it) {
    if (it.kind === 'header') {
      // skip headers when moving with the keyboard
      const dir = this.list.index > (this.lastIndex ?? 0) ? 1 : -1;
      this.lastIndex = this.list.index;
      const next = this.list.index + dir;
      if (next >= 0 && next < this.list.items.length) setTimeout(() => this.list.select(next, false));
      return;
    }
    this.lastIndex = this.list.index;
    this._readout();
  }

  _activate(it) {
    if (it.kind !== 'station') return;
    if (this.playing === it.st.id) {
      this.stopStation();
      return;
    }
    sound.static(0.9, 0.18);
    this.playing = it.st.id;
    this.buffering = true;
    this._ensureGraph();
    this.audio.src = `radio/${encodeURIComponent(it.st.id)}`;
    this.audio.play().catch(() => {});
    this._paintList();
    this._readout();
  }

  stopStation() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.playing = null;
    this.buffering = false;
    sound.back();
    this._paintList();
    this._readout();
  }

  _ensureGraph() {
    if (this.analyser) return;
    const ctx = sound.ensure();
    if (!ctx) return;
    try {
      const src = ctx.createMediaElementSource(this.audio);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.wave = new Uint8Array(this.analyser.fftSize);
    } catch (e) {
      console.warn('analyser unavailable', e);
    }
  }

  _readout() {
    const it = this.list.current();
    const t = this.app.S.tel;
    if (!it) return;
    let html = '';
    if (it.kind === 'av') {
      const v = t ? t[it.key] : null;
      html = `<div class="ro-label">${it.label}</div><div class="ro-freq">${fmt.freq(v, it.d)}</div>` +
        (it.sb ? `<div class="ro-sub">STANDBY ${fmt.freq(t ? t[it.sb] : null, 3)}</div>` : '<div class="ro-sub">ACTIVE</div>');
    } else if (it.kind === 'xpdr') {
      html = `<div class="ro-label">TRANSPONDER</div><div class="ro-freq">${t ? t.xpdr : '----'}</div><div class="ro-sub">SQUAWK</div>`;
    } else if (it.kind === 'station') {
      const on = this.playing === it.st.id;
      html = `<div class="ro-label">${escapeHtml(it.st.name)}</div><div class="ro-sub">${escapeHtml(it.st.note || '')}</div>` +
        `<div class="ro-state">${on ? (this.buffering ? 'TUNING…' : '♪ NOW PLAYING — ENTER TO STOP') : 'ENTER / CLICK TO TUNE IN'}</div>`;
    }
    if (this.readout.innerHTML !== html) this.readout.innerHTML = html;
  }

  _paintVol() {
    const n = Math.round(this.volume * 10);
    this.vol.innerHTML = `VOLUME <span class="vbar">${'▮'.repeat(n)}<i>${'▯'.repeat(10 - n)}</i></span> <span class="dim">[ + / − ]</span>`;
  }

  show() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._drawScope();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  hide() { this.running = false; }

  tel() {
    const now = Date.now();
    if (now - (this.lastRo || 0) > 300) { this.lastRo = now; this._readout(); }
  }

  _drawScope() {
    const c = this.scope;
    const w = c.clientWidth, hh = c.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const rgb = this.app.rgb;
    // F4-style axis with tick marks
    ctx.strokeStyle = `rgba(${rgb},0.8)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w - 10, 4); ctx.lineTo(w - 10, hh - 10); ctx.lineTo(10, hh - 10);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 20; i++) {
      const x = 10 + ((w - 20) * i) / 20;
      ctx.beginPath(); ctx.moveTo(x, hh - 10); ctx.lineTo(x, hh - (i % 5 === 0 ? 20 : 15)); ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const y = 4 + ((hh - 14) * i) / 10;
      ctx.beginPath(); ctx.moveTo(w - 10, y); ctx.lineTo(w - (i % 5 === 0 ? 20 : 15), y); ctx.stroke();
    }
    const mid = (hh - 10) / 2;
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.shadowColor = `rgba(${rgb},0.9)`;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.phase += 0.06;
    const it = this.list.current();
    if (this.playing && this.analyser && !this.buffering) {
      this.analyser.getByteTimeDomainData(this.wave);
      const n = this.wave.length;
      for (let i = 0; i < n; i += 4) {
        const x = 10 + (i / n) * (w - 30);
        const y = mid + ((this.wave[i] - 128) / 128) * mid * 0.9;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    } else {
      // Synthetic carrier: frequency derived from the selected channel.
      const t = this.app.S.tel;
      let cycles = 3, amp = 0.05;
      if (it && t && it.kind === 'av' && t[it.key] > 0) { cycles = 2 + (t[it.key] % 1) * 8; amp = 0.55; }
      else if (it && it.kind === 'xpdr') { cycles = 6; amp = 0.4; }
      else if (it && it.kind === 'station') { cycles = 4; amp = this.buffering ? 0.2 : 0.08; }
      for (let x = 10; x <= w - 20; x += 2) {
        const f = (x - 10) / (w - 30);
        const noise = (Math.random() - 0.5) * (this.buffering ? 0.5 : 0.04);
        const y = mid + (Math.sin(f * Math.PI * 2 * cycles + this.phase * 3) * amp + noise) * mid;
        x === 10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  key(e) {
    if (e.key === '+' || e.key === '=') { this.volume = Math.min(1, this.volume + 0.1); this.audio.volume = this.volume; this._paintVol(); sound.move(); return true; }
    if (e.key === '-' || e.key === '_') { this.volume = Math.max(0, this.volume - 0.1); this.audio.volume = this.volume; this._paintVol(); sound.move(); return true; }
    return this.list.key(e);
  }
}
