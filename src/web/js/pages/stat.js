// STAT tab: STATUS (mascot + condition bars), S.P.E.C.I.A.L. (instruments), PERKS.
import { h, fmt, isNum, clamp } from '../util.js';
import { Page, List, meter, statTable } from '../components.js';
import { Mascot } from '../mascot.js';
import { dial, horizon, compass, bankIndicator } from '../gauges.js';
import { icon } from '../icons.js';

// ---------------------------------------------------------------- STATUS --
export class StatusPage extends Page {
  build() {
    this.el.classList.add('status-page');
    this.mascot = new Mascot('idle');
    const bar = (cls, label) => {
      const fill = h('div', { class: 'cbar-fill' });
      const lbl = h('div', { class: 'cbar-lbl' }, label);
      const el = h('div', { class: `cbar ${cls}` }, h('div', { class: 'cbar-track' }, fill), lbl);
      return { el, fill, lbl };
    };
    this.bars = {
      fuel: bar('pos-top', 'FUEL'),
      e1: bar('pos-ul', 'ENG 1'),
      e2: bar('pos-ur', 'ENG 2'),
      gear: bar('pos-ll', 'GEAR'),
      flaps: bar('pos-lr', 'FLAPS'),
      g: bar('pos-bottom', 'G-LOAD'),
    };
    const stage = h('div', { class: 'status-stage' }, this.mascot.el, ...Object.values(this.bars).map((b) => b.el));
    const tile = (ico, label) => {
      const v = h('div', { class: 'tile-v' }, '---');
      const el = h('div', { class: 'tile' }, h('div', { class: 'tile-i', html: ico ? icon(ico) : '' }), h('div', { class: 'tile-l' }, label), v);
      return { el, v };
    };
    this.tiles = {
      ias: tile(null, 'IAS KT'), alt: tile(null, 'ALT FT'), hdg: tile(null, 'HDG'), vs: tile(null, 'V/S FPM'), gs: tile(null, 'GS KT'),
    };
    this.tiles.ias.el.classList.add('tile-wide');
    this.name = h('div', { class: 'status-name' }, '---');
    this.phase = h('div', { class: 'status-phase' }, h('span', { class: 'blink' }, '▶ '), h('span', { class: 'ph' }, 'NO SIGNAL'));
    this.side = h('div', { class: 'status-side' });
    this.sideTable = statTable([['zulu', 'ZULU'], ['oat', 'OAT'], ['wind', 'WIND'], ['baro', 'BARO'], ['near', 'NEAREST'], ['dest', 'DEST']]);
    this.side.append(this.sideTable.el);
    this.el.append(
      h('div', { class: 'status-main' }, stage, h('div', { class: 'tiles' }, ...Object.values(this.tiles).map((t) => t.el)), this.name, this.phase),
      this.side,
    );
    this.maxRpm = [2700, 2700, 2700, 2700];
    this.goodLandingUntil = 0;
  }

  _setBar(b, frac, text, warn) {
    b.fill.style.width = `${clamp(isNum(frac) ? frac : 0, 0, 1) * 100}%`;
    b.el.classList.toggle('warn', !!warn);
    if (text !== undefined && b.lbl.textContent !== text) b.lbl.textContent = text;
  }

  _engFrac(e, i) {
    if (!e) return null;
    if (isNum(e.n1) && e.n1 > 1) return e.n1 / 100;
    this.maxRpm[i] = Math.max(this.maxRpm[i], e.rpm || 0);
    return (e.rpm || 0) / this.maxRpm[i];
  }

  celebrate() {
    this.goodLandingUntil = Date.now() + 8000;
  }

  tel(t) {
    const b = this.bars;
    const fuelPct = t.fuelCapLb > 0 ? t.fuelLb / t.fuelCapLb : 0;
    this._setBar(b.fuel, fuelPct, `FUEL ${Math.round(fuelPct * 100)}%`, fuelPct < 0.15);
    const engs = t.engines || [];
    const n = engs.length;
    const group = (idxs) => {
      const fr = idxs.map((i) => this._engFrac(engs[i], i)).filter(isNum);
      return fr.length ? fr.reduce((a, c) => a + c, 0) / fr.length : null;
    };
    if (n <= 1) {
      this._setBar(b.e1, this._engFrac(engs[0], 0), engs[0]?.running ? 'ENGINE' : 'ENGINE OFF', !engs[0]?.running);
      this.maxFlow = Math.max(this.maxFlow || 1, t.fuelFlowPph || 0);
      this._setBar(b.e2, (t.fuelFlowPph || 0) / this.maxFlow, `FLOW ${Math.round(t.fuelFlowPph || 0)} PPH`, false);
    } else {
      const left = [...Array(Math.ceil(n / 2)).keys()];
      const right = [...Array(n).keys()].slice(Math.ceil(n / 2));
      const lr = left.some((i) => engs[i].running), rr = right.some((i) => engs[i].running);
      this._setBar(b.e1, group(left), n === 2 ? (lr ? 'ENG 1' : 'ENG 1 OFF') : (lr ? 'ENG L' : 'ENG L OFF'), !lr);
      this._setBar(b.e2, group(right), n === 2 ? (rr ? 'ENG 2' : 'ENG 2 OFF') : (rr ? 'ENG R' : 'ENG R OFF'), !rr);
    }
    const gearTxt = t.gear > 0.99 ? 'GEAR DN' : t.gear < 0.01 ? 'GEAR UP' : 'GEAR TRANSIT';
    this._setBar(b.gear, t.gear, gearTxt, !t.onGround && t.aglFt < 1000 && t.gear < 0.99 && t.vs < -200);
    this._setBar(b.flaps, t.flaps, `FLAPS ${Math.round((t.flaps || 0) * 100)}%`);
    this._setBar(b.g, (t.gForce || 0) / 3, `G ${fmt.num(t.gForce, 2)}`, t.gForce > 2 || t.gForce < 0);

    const tl = this.tiles;
    tl.ias.v.textContent = fmt.int(t.ias);
    tl.alt.v.textContent = fmt.int(t.altFt);
    tl.hdg.v.textContent = fmt.hdg(t.hdgMag);
    tl.vs.v.textContent = fmt.signed(t.vs);
    tl.gs.v.textContent = fmt.int(t.gs);
    if (this.name.textContent !== t.aircraft) this.name.textContent = t.aircraft;
    this.phase.querySelector('.ph').textContent = t.phase || '';

    const st = this.sideTable;
    st.set('zulu', fmt.zulu(t.zuluSec));
    st.set('oat', `${fmt.num(t.oatC, 0)}°C`);
    st.set('wind', `${fmt.hdg(t.windDir)} / ${fmt.int(t.windKt)} KT`);
    st.set('baro', `${fmt.num(t.baroInHg, 2)} IN`);
    st.set('near', t.nearest ? `${t.nearest.ident} ${fmt.num(t.nearest.distNm, 1)} NM` : '---');
    st.set('dest', t.nav ? `${t.nav.ident} ${fmt.int(t.nav.distNm)} NM` : 'NONE');

    // Mascot reacts to what is going on.
    const m = this.mascot;
    const scary = Math.abs(t.bank) > 50 || t.gForce > 2.2 || t.gForce < 0.2 || t.vs < -4000 || (fuelPct < 0.08 && fuelPct > 0);
    m.setMood(scary ? 'worried' : 'happy');
    if (Date.now() < this.goodLandingUntil) m.setPose('thumbs');
    else if (scary) m.setPose('idle');
    else if (!t.onGround) m.setPose('fly');
    else if (t.gs > 2) m.setPose('walk');
    else m.setPose('idle');
  }
}

// ---------------------------------------------------------------- SPECIAL --
const SPECIAL = [
  { id: 'S', name: 'Speed', unit: 'KT', get: (t) => t.ias, fmt: (v) => fmt.int(v),
    desc: 'Speed is a measure of how fast you are slicing through the air. It affects lift, how fast you get places and how loud the passengers scream.',
    gauge: () => dial({ min: 0, max: 400, major: 50, minor: 10, label: 'AIRSPEED', unit: 'KNOTS', labelFmt: (v) => v, zones: [{ from: 60, to: 250, cls: 'ok' }, { from: 330, to: 400, cls: 'bad' }] }),
    extra: [['tas', 'TRUE AIRSPEED', (t) => `${fmt.int(t.tas)} KT`], ['gs', 'GROUND SPEED', (t) => `${fmt.int(t.gs)} KT`], ['spd', 'A/P SPEED', (t) => (t.ap?.spdSel ? `${fmt.int(t.ap.spdSel)} KT` : '---')]],
    set: (g, t) => g.set(t.ias) },
  { id: 'P', name: 'Pitch', unit: '°', get: (t) => t.pitch, fmt: (v) => fmt.num(v, 1),
    desc: 'Pitch is the attitude of your nose relative to the horizon. Too much up and the wing gives up; too much down and the ground gets very interested in you.',
    gauge: () => horizon(),
    extra: [['p', 'PITCH', (t) => `${fmt.num(t.pitch, 1)}°`], ['b', 'BANK', (t) => `${fmt.num(t.bank, 1)}°`], ['g', 'G-LOAD', (t) => fmt.num(t.gForce, 2)]],
    set: (g, t) => g.set(t.pitch, t.bank) },
  { id: 'E', name: 'Elevation', unit: 'FT', get: (t) => t.altFt, fmt: (v) => fmt.int(v),
    desc: 'Elevation is how far you are above sea level. Altitude is money in the bank: you can always trade it for speed, but you cannot get it back for free.',
    gauge: () => dial({ min: 0, max: 1000, major: 100, minor: 20, label: 'ALTIMETER', unit: 'FEET', labelFmt: (v) => v / 100, wrap: true, start: 0, end: 360, digits: (v) => fmt.int(v) }),
    extra: [['agl', 'ABOVE GROUND', (t) => `${fmt.int(t.aglFt)} FT`], ['fl', 'FLIGHT LEVEL', (t) => fmt.fl(t.altFt)], ['sel', 'A/P ALTITUDE', (t) => (t.ap?.altSel ? `${fmt.int(t.ap.altSel)} FT` : '---')], ['baro', 'BAROMETER', (t) => `${fmt.num(t.baroInHg, 2)} IN`]],
    set: (g, t) => g.set(t.altFt) },
  { id: 'C', name: 'Climb', unit: 'FPM', get: (t) => t.vs, fmt: (v) => fmt.signed(v),
    desc: 'Climb is your rate of ascent or descent. Positive means the sky is getting closer. Large negative numbers near the ground are frowned upon by insurers.',
    gauge: () => dial({ min: -4000, max: 4000, major: 1000, minor: 250, start: -150, end: 150, label: 'VERTICAL SPEED', unit: 'FT / MIN', labelFmt: (v) => Math.abs(v / 1000), digits: (v) => fmt.signed(v), zones: [{ from: -4000, to: -2000, cls: 'bad' }] }),
    extra: [['sel', 'A/P V/S', (t) => (t.ap?.vsSel ? `${fmt.signed(t.ap.vsSel)} FPM` : '---')], ['agl', 'ABOVE GROUND', (t) => `${fmt.int(t.aglFt)} FT`]],
    set: (g, t) => g.set(t.vs) },
  { id: 'I', name: 'Inertia', unit: 'G', get: (t) => t.gForce, fmt: (v) => fmt.num(v, 2),
    desc: 'Inertia measures the load pressing you into your seat. One G is a lazy Sunday. Above three your lunch starts filing complaints.',
    gauge: () => dial({ min: -1, max: 4, major: 1, minor: 0.25, label: 'G-METER', unit: 'G', digits: (v) => v.toFixed(2), zones: [{ from: -1, to: 0, cls: 'bad' }, { from: 2.5, to: 4, cls: 'bad' }, { from: 0.5, to: 1.5, cls: 'ok' }] }),
    extra: [['max', 'FLIGHT MAX', (_t, app) => fmt.num(app.S.state?.flight?.maxG, 2)], ['bank', 'BANK', (t) => `${fmt.num(t.bank, 0)}°`]],
    set: (g, t, app) => g.set(t.gForce, app.S.state?.flight?.maxG) },
  { id: 'A', name: 'Azimuth', unit: '°', get: (t) => t.hdgMag, fmt: (v) => fmt.hdg(v),
    desc: 'Azimuth is the direction your nose is pointing. Knowing it is the difference between arriving in Seattle and arriving in the ocean next to Seattle.',
    gauge: () => compass(),
    extra: [['trk', 'GROUND TRACK', (t) => fmt.hdg(t.track)], ['true', 'TRUE HEADING', (t) => fmt.hdg(t.hdgTrue)], ['bug', 'A/P HEADING', (t) => (t.ap ? fmt.hdg(t.ap.hdgSel) : '---')], ['wind', 'WIND', (t) => `${fmt.hdg(t.windDir)} / ${fmt.int(t.windKt)} KT`]],
    set: (g, t) => g.set(t.hdgMag, t.ap ? t.ap.hdgSel : undefined) },
  { id: 'L', name: 'Lateral', unit: '°', get: (t) => t.bank, fmt: (v) => fmt.num(v, 1),
    desc: 'Lateral is your bank angle. A gentle lean makes graceful turns. Past sixty degrees you are either an aerobatic pilot or about to become a cautionary tale.',
    gauge: () => bankIndicator(),
    extra: [['b', 'BANK', (t) => `${fmt.num(t.bank, 1)}°`], ['g', 'G-LOAD', (t) => fmt.num(t.gForce, 2)]],
    set: (g, t) => g.set(t.bank) },
];

export class SpecialPage extends Page {
  build() {
    this.el.classList.add('split', 'special-page');
    this.list = new List({ cls: 'special-list', onSelect: (it) => this._showStat(it.stat) });
    this.gaugeBox = h('div', { class: 'gauge-box' });
    this.desc = h('div', { class: 'desc' });
    this.extraBox = h('div', { class: 'extra' });
    this.el.append(this.list.el, h('div', { class: 'detail' }, this.gaugeBox, this.extraBox, this.desc));
    this.list.set(SPECIAL.map((st) => ({ id: st.id, label: `<b class="sp-letter">${st.id}</b>${st.name}`, value: '---', stat: st })));
  }

  _showStat(st) {
    this.cur = st;
    this.gauge = st.gauge();
    this.gaugeBox.replaceChildren(this.gauge.el);
    this.gaugeBox.classList.remove('flicker-in');
    void this.gaugeBox.offsetWidth;
    this.gaugeBox.classList.add('flicker-in');
    this.desc.textContent = st.desc;
    this.extra = statTable(st.extra.map(([k, l]) => [k, l]));
    this.extraBox.replaceChildren(this.extra.el);
    if (this.app.S.tel) this.tel(this.app.S.tel);
  }

  tel(t) {
    this.list.values((it) => it.stat.fmt(it.stat.get(t)));
    if (this.cur) {
      this.cur.set(this.gauge, t, this.app);
      for (const [k, , fn] of this.cur.extra) this.extra.set(k, fn(t, this.app));
    }
  }

  key(e) { return this.list.key(e); }
}

// ------------------------------------------------------------------ PERKS --
export class PerksPage extends Page {
  build() {
    this.el.classList.add('perks-page');
    this.head = h('div', { class: 'perk-head' });
    this.callsign = h('span', { class: 'callsign' });
    this.lvl = h('span', { class: 'lvl' });
    this.xpMeter = meter('XP', 'xp-meter');
    this.head.append(this.callsign, this.lvl, this.xpMeter.el);
    this.list = new List({ cls: 'perk-list', onSelect: (it) => this._detail(it.perk) });
    this.detail = h('div', { class: 'detail perk-detail' });
    this.el.append(this.head, h('div', { class: 'split' }, this.list.el, this.detail));
  }

  show() { if (this.app.S.state) this.state(this.app.S.state); }

  state(s) {
    const p = s.profile;
    this.callsign.textContent = p.callsign;
    this.lvl.textContent = `LEVEL ${p.level}`;
    const span = p.nextLevelXp - p.levelXp;
    this.xpMeter.set((p.xp - p.levelXp) / span, `${p.xp - p.levelXp} / ${span}`);
    const perks = [...s.perks].sort((a, b) => (!!b.unlocked - !!a.unlocked));
    const got = perks.filter((k) => k.unlocked).length;
    this.lvl.textContent = `LEVEL ${p.level}  ·  PERKS ${got}/${perks.length}`;
    this.list.set(perks.map((k) => ({
      id: k.id,
      label: `${k.unlocked ? '★' : '☆'} ${k.name}`,
      value: k.unlocked ? '' : (k.progress ? `${Math.min(k.progress[0], k.progress[1])}/${k.progress[1]}` : ''),
      dim: !k.unlocked,
      perk: k,
    })));
    const cur = this.list.current();
    if (cur) this._detail(cur.perk);
  }

  _detail(k) {
    if (!k) return;
    const prog = k.progress ? meter('PROGRESS') : null;
    if (prog) prog.set(k.progress[0] / k.progress[1], `${Math.min(k.progress[0], k.progress[1])} / ${k.progress[1]}`);
    this.detail.replaceChildren(
      h('div', { class: `perk-art ${k.unlocked ? 'on' : 'off'}`, html: icon(k.unlocked ? k.icon : 'lock') + (k.unlocked ? '' : `<div class="perk-ghost">${icon(k.icon)}</div>`) }),
      h('div', { class: 'perk-name' }, k.name.toUpperCase()),
      h('div', { class: 'perk-status' }, k.unlocked ? `UNLOCKED ${fmt.date(k.unlocked)}` : 'LOCKED', h('span', { class: 'perk-xp' }, `+${k.xp} XP`)),
      prog ? prog.el : '',
      h('div', { class: 'desc' }, k.desc),
    );
  }

  key(e) { return this.list.key(e); }
}
