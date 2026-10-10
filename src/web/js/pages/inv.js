// INV tab: SYSTEMS (aircraft "inventory"), FUEL (tank + endurance), ENGINES.
import { h, fmt, isNum, clamp } from '../util.js';
import { Page, List, meter, statTable } from '../components.js';
import { icon } from '../icons.js';

const onoff = (v) => (v ? 'ON' : 'OFF');

const SYSTEMS = [
  { id: 'gear', name: 'Landing Gear', ico: 'gear', val: (t) => (t.gear > 0.99 ? 'DOWN' : t.gear < 0.01 ? 'UP' : `${Math.round(t.gear * 100)}%`),
    flavor: 'Three wheels and a dream. Highly recommended for landings.',
    rows: [['pos', 'EXTENSION', (t) => `${Math.round(t.gear * 100)}%`], ['gnd', 'ON GROUND', (t) => (t.onGround ? 'YES' : 'NO')], ['agl', 'HEIGHT AGL', (t) => `${fmt.int(t.aglFt)} FT`]] },
  { id: 'flaps', name: 'Flaps', ico: 'flaps', val: (t) => `${Math.round(t.flaps * 100)}%`,
    flavor: 'Wing extensions for flying slowly without falling out of the sky.',
    rows: [['pos', 'HANDLE', (t) => `${Math.round(t.flaps * 100)}%`], ['ias', 'AIRSPEED', (t) => `${fmt.int(t.ias)} KT`]] },
  { id: 'pbrake', name: 'Parking Brake', ico: 'brake', val: (t) => (t.parkingBrake ? 'SET' : 'OFF'),
    flavor: 'Prevents the aircraft from wandering off while you get coffee.',
    rows: [['st', 'STATUS', (t) => (t.parkingBrake ? 'SET' : 'RELEASED')], ['gs', 'GROUND SPEED', (t) => `${fmt.int(t.gs)} KT`]] },
  { id: 'ap', name: 'Autopilot', ico: 'ap', val: (t) => (t.ap?.master ? 'ENGAGED' : 'OFF'),
    flavor: 'A tireless robot co-pilot. Does not complain, does not drink the coffee.',
    rows: [['m', 'MASTER', (t) => onoff(t.ap?.master)], ['hdg', 'HDG BUG', (t) => fmt.hdg(t.ap?.hdgSel)], ['alt', 'ALT SEL', (t) => `${fmt.int(t.ap?.altSel)} FT`], ['vs', 'V/S SEL', (t) => `${fmt.signed(t.ap?.vsSel)} FPM`], ['spd', 'SPD SEL', (t) => `${fmt.int(t.ap?.spdSel)} KT`]] },
  { id: 'xpdr', name: 'Transponder', ico: 'xpdr', val: (t) => t.xpdr,
    flavor: 'Tells everyone where you are. 7500, 7600 and 7700 will get you a lot of attention.',
    rows: [['code', 'SQUAWK', (t) => t.xpdr], ['meaning', 'MEANING', (t) => ({ 1200: 'VFR (US)', 7000: 'VFR (EU)', 2000: 'IFR ENTRY', 7500: 'HIJACK', 7600: 'RADIO FAIL', 7700: 'EMERGENCY' }[t.xpdr] || 'ASSIGNED')]] },
  { id: 'baro', name: 'Altimeter Setting', ico: 'baro', val: (t) => `${fmt.num(t.baroInHg, 2)}`,
    flavor: 'Set it wrong and the mountains will be closer than they appear.',
    rows: [['inhg', 'INCHES HG', (t) => fmt.num(t.baroInHg, 2)], ['hpa', 'HECTOPASCAL', (t) => fmt.int(t.baroInHg * 33.8639)], ['std', 'STANDARD', (t) => (Math.abs(t.baroInHg - 29.92) < 0.01 ? 'YES' : 'NO')]] },
  { id: 'nav', name: 'Nav Lights', ico: 'bulb', val: (t) => onoff(t.lights?.nav), flavor: 'Red on the left, green on the right. Port wine is red.', rows: [['st', 'STATUS', (t) => onoff(t.lights?.nav)]] },
  { id: 'beacon', name: 'Beacon', ico: 'beacon', val: (t) => onoff(t.lights?.beacon), flavor: 'The red blinky light that means "engines running, stay clear".', rows: [['st', 'STATUS', (t) => onoff(t.lights?.beacon)]] },
  { id: 'strobe', name: 'Strobe Lights', ico: 'strobe', val: (t) => onoff(t.lights?.strobe), flavor: 'Bright white flashes. Turn them on when you enter the runway.', rows: [['st', 'STATUS', (t) => onoff(t.lights?.strobe)]] },
  { id: 'landing', name: 'Landing Lights', ico: 'bulb', val: (t) => onoff(t.lights?.landing), flavor: 'For seeing the runway. And for the runway seeing you.', rows: [['st', 'STATUS', (t) => onoff(t.lights?.landing)], ['agl', 'HEIGHT AGL', (t) => `${fmt.int(t.aglFt)} FT`]] },
  { id: 'taxi', name: 'Taxi Light', ico: 'bulb', val: (t) => onoff(t.lights?.taxi), flavor: 'Lights the way to the gate, the hangar, or the grass.', rows: [['st', 'STATUS', (t) => onoff(t.lights?.taxi)]] },
];

export class SystemsPage extends Page {
  build() {
    this.el.classList.add('split', 'inv-page');
    this.list = new List({ cls: 'inv-list', onSelect: (it) => this._detail(it.sys) });
    this.detail = h('div', { class: 'detail inv-detail' });
    this.el.append(this.list.el, this.detail);
    this.list.set(SYSTEMS.map((sys) => ({ id: sys.id, label: sys.name, value: '---', sys })));
  }

  _detail(sys) {
    this.cur = sys;
    this.table = statTable(sys.rows.map(([k, l]) => [k, l]));
    this.big = h('div', { class: 'inv-big' }, '---');
    this.art = h('div', { class: 'inv-art', html: icon(sys.ico) });
    this.detail.replaceChildren(this.art, this.big, this.table.el, h('div', { class: 'desc' }, sys.flavor));
    this.detail.classList.remove('flicker-in');
    void this.detail.offsetWidth;
    this.detail.classList.add('flicker-in');
    if (this.app.S.tel) this.tel(this.app.S.tel);
  }

  tel(t) {
    this.list.values((it) => it.sys.val(t));
    for (const it of this.list.items) {
      const on = ['ON', 'SET', 'DOWN', 'ENGAGED'].includes(it.value);
      const r = this.list.rows[this.list.items.indexOf(it)];
      if (r) r.el.classList.toggle('active', on);
    }
    if (this.cur) {
      const v = this.cur.val(t);
      if (this.big.textContent !== v) this.big.textContent = v;
      this.art.classList.toggle('on', ['ON', 'SET', 'DOWN', 'ENGAGED'].includes(v));
      for (const [k, , fn] of this.cur.rows) this.table.set(k, fn(t));
    }
  }

  key(e) { return this.list.key(e); }
}

// ------------------------------------------------------------------- FUEL --
export class FuelPage extends Page {
  build() {
    this.el.classList.add('fuel-page');
    this.tank = h('div', { class: 'tank' });
    this.liquid = h('div', { class: 'tank-liquid' },
      h('div', { class: 'tank-wave w1' }), h('div', { class: 'tank-wave w2' }),
      ...Array.from({ length: 7 }, (_, i) => h('span', { class: 'bubble', style: { left: `${10 + i * 12}%`, animationDelay: `${i * 0.7}s` } })));
    this.pct = h('div', { class: 'tank-pct' }, '--%');
    const marks = h('div', { class: 'tank-marks' }, ...['F', '¾', '½', '¼', 'E'].map((m) => h('span', {}, m)));
    this.tank.append(this.liquid, marks, this.pct);
    this.table = statTable([
      ['qty', 'QUANTITY'], ['cap', 'CAPACITY'], ['flow', 'FUEL FLOW'], ['end', 'ENDURANCE'],
      ['range', 'RANGE (AT GS)'], ['dest', 'FUEL AT DEST'], ['res', 'RESERVE STATUS'],
    ]);
    this.spark = h('canvas', { class: 'spark' });
    this.warn = h('div', { class: 'fuel-warn' }, '⚠ LOW FUEL');
    this.el.append(
      h('div', { class: 'fuel-left' }, this.tank),
      h('div', { class: 'fuel-right' }, h('div', { class: 'section-title' }, 'FUEL MANAGEMENT'), this.table.el,
        h('div', { class: 'section-title' }, 'QUANTITY HISTORY'), this.spark, this.warn),
    );
    this.hist = [];
    this.lastHist = 0;
  }

  tel(t) {
    const pct = t.fuelCapLb > 0 ? clamp(t.fuelLb / t.fuelCapLb, 0, 1) : 0;
    this.liquid.style.height = `${pct * 100}%`;
    this.pct.textContent = `${Math.round(pct * 100)}%`;
    this.tank.classList.toggle('low', pct < 0.15);
    this.warn.classList.toggle('show', pct < 0.15 && pct > 0);
    const T = this.table;
    T.set('qty', `${fmt.int(t.fuelLb)} LB  (${fmt.int(t.fuelLb / 6.7)} GAL)`);
    T.set('cap', `${fmt.int(t.fuelCapLb)} LB`);
    T.set('flow', `${fmt.int(t.fuelFlowPph)} LB/HR`);
    const endHr = t.fuelFlowPph > 1 ? t.fuelLb / t.fuelFlowPph : null;
    T.set('end', endHr !== null ? fmt.dur(endHr * 3600) : '---');
    T.set('range', endHr !== null && t.gs > 30 ? `${fmt.int(endHr * t.gs)} NM` : '---');
    T.set('dest', t.nav && isNum(t.nav.fuelAtArrLb) ? `${fmt.int(t.nav.fuelAtArrLb)} LB @ ${t.nav.ident}` : '---');
    const resMin = endHr !== null ? endHr * 60 : null;
    T.set('res', resMin === null ? '---' : resMin > 45 ? 'NOMINAL' : resMin > 30 ? 'CAUTION' : 'CRITICAL');
    const now = Date.now();
    if (now - this.lastHist > 5000) {
      this.lastHist = now;
      this.hist.push(pct);
      if (this.hist.length > 240) this.hist.shift();
      this._drawSpark();
    }
  }

  show() { requestAnimationFrame(() => this._drawSpark()); }

  _drawSpark() {
    const c = this.spark;
    const w = c.clientWidth, hgt = c.clientHeight;
    if (!w || !hgt) return;
    c.width = w; c.height = hgt;
    const ctx = c.getContext('2d');
    const rgb = this.app.rgb;
    ctx.strokeStyle = `rgba(${rgb},0.2)`;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (hgt * i) / 4); ctx.lineTo(w, (hgt * i) / 4); ctx.stroke(); }
    if (this.hist.length < 2) return;
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.hist.forEach((v, i) => {
      const x = (i / (this.hist.length - 1)) * w, y = hgt - v * hgt;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.lineTo(w, hgt); ctx.lineTo(0, hgt); ctx.closePath();
    ctx.fillStyle = `rgba(${rgb},0.12)`;
    ctx.fill();
  }
}

// ---------------------------------------------------------------- ENGINES --
export class EnginesPage extends Page {
  build() {
    this.el.classList.add('engines-page');
    this.grid = h('div', { class: 'engine-grid' });
    this.el.append(this.grid);
    this.cards = [];
    this.maxRpm = [];
  }

  _ensure(n) {
    if (this.cards.length === n) return;
    this.grid.replaceChildren();
    this.grid.dataset.n = n;
    this.cards = Array.from({ length: n }, (_, i) => {
      const fan = h('div', { class: 'fan', html: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="fan-ring"/><g class="fan-blades">' +
        [0, 60, 120, 180, 240, 300].map((a) => `<path d="M50 50 C46 34 44 18 50 8 C58 18 56 34 50 50 Z" transform="rotate(${a} 50 50)"/>`).join('') +
        '</g><circle cx="50" cy="50" r="8" class="fan-hub"/></svg>' });
      const n1 = meter('N1'), rpm = meter('RPM');
      const status = h('div', { class: 'eng-status' }, 'OFF');
      const el = h('div', { class: 'engine-card' }, h('div', { class: 'eng-title' }, `ENGINE ${i + 1}`), fan, status, n1.el, rpm.el);
      return { el, fan, n1, rpm, status };
    });
    this.grid.append(...this.cards.map((c) => c.el));
  }

  tel(t) {
    const engs = t.engines || [];
    this._ensure(engs.length || 1);
    engs.forEach((e, i) => {
      const c = this.cards[i];
      this.maxRpm[i] = Math.max(this.maxRpm[i] || 2700, e.rpm || 0);
      const frac = isNum(e.n1) && e.n1 > 1 ? e.n1 / 100 : (e.rpm || 0) / this.maxRpm[i];
      c.n1.set((e.n1 || 0) / 100, `${fmt.num(e.n1, 1)}%`);
      c.rpm.set((e.rpm || 0) / this.maxRpm[i], fmt.int(e.rpm));
      c.status.textContent = e.running ? 'RUNNING' : 'SHUTDOWN';
      c.el.classList.toggle('off', !e.running);
      // spin speed ~ power; keep a minimum so a windmilling fan still turns
      const blades = c.fan.querySelector('.fan-blades');
      const dur = frac > 0.02 ? clamp(0.9 / frac, 0.12, 6) : 0;
      const want = dur ? `${dur.toFixed(2)}s` : '';
      if (blades.dataset.dur !== want) {
        blades.dataset.dur = want;
        blades.style.animationDuration = want || '0s';
        blades.style.animationPlayState = dur ? 'running' : 'paused';
      }
    });
  }
}
