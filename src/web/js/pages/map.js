// MAP tab: LOCAL / WORLD views on one shared vector map.
import { h, fmt, escapeHtml } from '../util.js';
import { Page } from '../components.js';
import { VectorMap } from '../map.js';
import { sound } from '../sound.js';

export class MapPage extends Page {
  constructor(app) {
    super(app);
    this.mode = 'local';
    this.introDone = false;
  }

  build() {
    this.el.classList.add('map-page');
    this.canvas = h('canvas', { class: 'map-canvas' });
    this.map = new VectorMap(this.canvas, {
      onSelect: (a) => this._select(a, true),
      onViewChange: () => this._hud(),
    });
    this.map.setColors(this.app.rgb);
    this.hudTL = h('div', { class: 'map-hud tl' });
    this.hudTR = h('div', { class: 'map-hud tr' });
    this.card = h('div', { class: 'map-card hidden' });
    this.input = h('input', { class: 'map-input', placeholder: 'ICAO / NAME', maxlength: 24, spellcheck: 'false' });
    this.results = h('div', { class: 'map-results' });
    this.input.addEventListener('input', () => this._search());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const first = this.results.querySelector('.res'); if (first) first.click(); }
      if (e.key === 'Escape') { this.input.blur(); this.results.replaceChildren(); }
    });
    const btn = (label, fn, cls = '') => h('button', { class: `pip-btn ${cls}`, onclick: (e) => { e.stopPropagation(); sound.select(); fn(); } }, label);
    this.followBtn = btn('◎ MY POSITION', () => { this.map.recenter(); this._hud(); });
    const bar = h('div', { class: 'map-bar' },
      h('span', { class: 'lbl' }, 'AIRPORT CODE'), h('div', { class: 'map-search' }, this.input, this.results),
      btn('−', () => { this.map.zoomBy(1 / 1.6); this._hud(); }), btn('+', () => { this.map.zoomBy(1.6); this._hud(); }),
      this.followBtn,
      btn('✕ CLEAR DEST', () => this.app.net.send('destination', { ident: null }), 'clear-dest'));
    this.el.append(this.canvas, this.hudTL, this.hudTR, this.card, bar);
    this.map.load().then(() => {
      this._applyState();
      if (this.app.S.state) this.map.setTrail(this.app.S.state.flight?.track || []);
    });
  }

  show(arg) {
    const mode = arg || 'local';
    this.map.setColors(this.app.rgb);
    this.map.start();
    if (!this.introDone) {
      // Dramatic intro: start as a globe and dive into the aircraft position.
      this.introDone = true;
      this.map.zoomTo(this.map.globePpn(), true);
      if (mode === 'local') setTimeout(() => this.map.zoomTo(8), 250);
    } else if (mode !== this.mode) {
      this.map.zoomTo(mode === 'world' ? this.map.globePpn() : 8);
    }
    if (mode === 'world') this.map.zoomTo(this.map.globePpn());
    this.mode = mode;
    this._applyState();
    this._hud();
  }

  hide() { this.map.stop(); }

  state() { if (this.built) this._applyState(); }

  _applyState() {
    const s = this.app.S.state;
    if (!s || !this.map) return;
    this.map.setDestination(s.destination);
    const visited = new Set();
    for (const e of s.logbook) for (const l of e.landings) if (l.airport) visited.add(l.airport.ident);
    this.map.setVisited([...visited]);
    this.map.setHistory(this.mode === 'world' ? s.logbook.slice(0, 50).map((e) => (e.track || []).map((p) => [p[0], p[1]])) : s.logbook.slice(0, 5).map((e) => (e.track || []).map((p) => [p[0], p[1]])));
    if (this.selected) this._select(this.selected, false);
    if (!s.flight) this.map.setTrail([]);
  }

  tel(t) {
    if (!this.map) return;
    this.map.setAircraft({ lat: t.lat, lon: t.lon, hdg: t.hdgTrue });
    if (!t.onGround || t.gs > 3) this.map.addTrail(t.lat, t.lon);
    const endHr = t.fuelFlowPph > 1 ? t.fuelLb / t.fuelFlowPph : null;
    this.map.setRange(endHr && t.gs > 40 ? endHr * t.gs : null);
    this.lastTel = t;
    const now = Date.now();
    if (now - (this.lastHud || 0) > 250) { this.lastHud = now; this._hud(); }
  }

  _hud() {
    const t = this.lastTel;
    const r = this.map.viewRadiusNm();
    const scale = r > 2000 ? 'GLOBAL' : r > 100 ? `${Math.round(r / 10) * 10} NM` : `${r < 10 ? r.toFixed(1) : Math.round(r)} NM`;
    this.hudTL.innerHTML = `<div class="hud-title">${this.mode === 'world' ? 'WORLD MAP' : 'LOCAL MAP'}</div><div>RADIUS ${scale}</div>` +
      (t ? `<div>${fmtLat(t.lat)} ${fmtLon(t.lon)}</div><div>${fmt.fl(t.altFt)} · ${fmt.int(t.gs)} KT GS · TRK ${fmt.hdg(t.track)}</div>` : '<div>NO POSITION</div>');
    const n = t?.nearest;
    const nav = t?.nav;
    this.hudTR.innerHTML =
      (nav ? `<div class="hud-title">◆ ${escapeHtml(nav.ident)}</div><div>${fmt.int(nav.distNm)} NM · BRG ${fmt.hdg(nav.brg)}</div><div>ETE ${nav.eteSec ? fmt.dur(nav.eteSec) : '--:--'}</div>` : '<div class="hud-title dim">NO DESTINATION</div><div class="dim">CLICK AN AIRPORT</div>') +
      (n ? `<div class="hud-sep">NEAREST ${escapeHtml(n.ident)}</div><div>${fmt.num(n.distNm, 1)} NM · BRG ${fmt.hdg(n.brg)}</div>` : '');
    this.followBtn.classList.toggle('active', this.map.follow);
  }

  _select(a, withSound) {
    this.selected = a;
    this.map.setSelected(a);
    if (!a) { this.card.classList.add('hidden'); return; }
    if (withSound) sound.select();
    const t = this.lastTel;
    let distTxt = '';
    if (t) {
      const d = gcDist(t.lat, t.lon, a.lat, a.lon);
      distTxt = `${fmt.int(d)} NM FROM YOU`;
    }
    const isDest = this.app.S.state?.destination?.ident === a.ident;
    const rws = (a.runways || []).slice(0, 6).map((r) => `<div class="rw">RWY ${escapeHtml(r[1])}/${escapeHtml(r[4])} <span>${fmt.int(r[7])} FT ${escapeHtml(r[9])}</span></div>`).join('');
    this.card.innerHTML = `<div class="card-title">${escapeHtml(a.ident)}${a.iata ? ` / ${escapeHtml(a.iata)}` : ''}</div>
      <div class="card-name">${escapeHtml(a.name)}</div>
      <div class="card-sub">${escapeHtml(a.city || '')} · ELEV ${fmt.int(a.elev)} FT</div>
      <div class="card-sub">${distTxt}</div>${rws}`;
    const set = h('button', { class: `pip-btn ${isDest ? 'active' : ''}` }, isDest ? '◆ DESTINATION' : 'SET DESTINATION');
    set.addEventListener('click', () => {
      sound.select();
      this.app.net.send('destination', { ident: isDest ? null : a.ident });
      this.app.toast(isDest ? 'DESTINATION CLEARED' : `DESTINATION SET: ${a.ident}`);
    });
    const close = h('button', { class: 'pip-btn' }, 'CLOSE');
    close.addEventListener('click', () => this._select(null));
    this.card.append(h('div', { class: 'card-btns' }, set, close));
    this.card.classList.remove('hidden');
  }

  async _search() {
    const q = this.input.value.trim();
    if (q.length < 2) { this.results.replaceChildren(); return; }
    const res = await fetch(`api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => []);
    if (this.input.value.trim() !== q) return;
    this.results.replaceChildren(...res.slice(0, 8).map((a) => {
      const el = h('div', { class: 'res' }, h('b', {}, a.ident), ` ${a.name}`);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => {
        const info = this.map.airportInfo(a.ident) || a;
        this.map.follow = false;
        this.map.center = { lat: info.lat, lon: info.lon };
        this.map.zoomTo(Math.max(this.map.targetPpn, 12));
        this._select(info, true);
        this.results.replaceChildren();
        this.input.value = '';
        this.input.blur();
        this._hud();
      });
      return el;
    }));
  }

  key(e) {
    const k = e.key;
    const step = 60;
    if (k === '+' || k === '=') { this.map.zoomBy(1.5); this._hud(); return true; }
    if (k === '-' || k === '_') { this.map.zoomBy(1 / 1.5); this._hud(); return true; }
    if (k === 'ArrowUp') { this.map.pan(0, step); return true; }
    if (k === 'ArrowDown') { this.map.pan(0, -step); return true; }
    if (k === 'ArrowLeft') { this.map.pan(step, 0); return true; }
    if (k === 'ArrowRight') { this.map.pan(-step, 0); return true; }
    if (k === 'c' || k === 'C') { this.map.recenter(); this._hud(); return true; }
    if (k === '/' || k === 'f' || k === 'F') { this.input.focus(); e.preventDefault(); return true; }
    return false;
  }
}

function gcDist(la1, lo1, la2, lo2) {
  const r = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}
const fmtLat = (v) => `${v >= 0 ? 'N' : 'S'}${Math.abs(v).toFixed(4)}`;
const fmtLon = (v) => `${v >= 0 ? 'E' : 'W'}${Math.abs(v).toFixed(4)}`;
