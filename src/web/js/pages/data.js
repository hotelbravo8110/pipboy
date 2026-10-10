// DATA tab: QUESTS (current flight objectives), LANDING report, LOGBOOK, CHECKLISTS.
import { h, fmt, local, escapeHtml } from '../util.js';
import { Page, List, statTable } from '../components.js';
import { sound } from '../sound.js';

const apt = (a) => (a ? a.ident : '????');

// ----------------------------------------------------------------- QUESTS --
export class QuestPage extends Page {
  build() {
    this.el.classList.add('split', 'quest-page');
    this.list = new List({ cls: 'quest-list', onSelect: (it) => this._detail(it) });
    this.detail = h('div', { class: 'detail quest-detail' });
    this.el.append(this.list.el, this.detail);
  }

  show() { if (this.app.S.state) this.state(this.app.S.state); }

  state(s) {
    const items = [];
    const f = s.flight;
    items.push({ id: 'current', label: f ? `◆ Flight ${apt(f.departure)} ▸ ${s.destination ? s.destination.ident : '???'}` : '◇ Awaiting Departure', kind: 'current' });
    for (const e of s.logbook.slice(0, 30)) {
      items.push({ id: e.id, label: `✓ ${apt(e.departure)} ▸ ${apt(e.arrival)}`, value: fmt.date(e.endedAt).slice(5), dim: true, kind: 'done', entry: e });
    }
    this.list.set(items);
    const cur = this.list.current();
    if (cur) this._detail(cur);
  }

  _detail(it) {
    const s = this.app.S.state;
    if (!s) return;
    if (it.kind === 'done') {
      const e = it.entry;
      const last = e.landings[e.landings.length - 1];
      this.detail.replaceChildren(
        h('div', { class: 'quest-title' }, `${apt(e.departure)} TO ${apt(e.arrival)}`),
        h('div', { class: 'quest-sub' }, `COMPLETED ${fmt.date(e.endedAt)} · ${escapeHtml(e.aircraft)}`),
        h('div', { class: 'desc' }, `You flew ${e.distanceNm} nautical miles in ${fmt.dur(e.durationSec)}. ${last ? `Final touchdown at ${last.fpm} fpm — rated "${last.label}".` : ''}`),
        h('div', { class: 'quest-reward' }, `REWARD: +${e.xp || 0} XP`),
      );
      return;
    }
    const f = s.flight;
    const dest = s.destination;
    const m = f ? f.milestones : {};
    const obj = (done, text, optional) => h('div', { class: `objective ${done ? 'done' : ''} ${optional ? 'opt' : ''}` }, h('span', { class: 'box' }, done ? '■' : '□'), text);
    const landedAtDest = f && dest && f.landings.some((l) => l.airport && l.airport.ident === dest.ident);
    const title = f ? `FLIGHT ${apt(f.departure)} ▸ ${dest ? dest.ident : 'UNKNOWN'}` : 'THE CALL OF THE SKY';
    const blurb = f
      ? (dest ? `Your mission: deliver yourself, your aircraft and your dignity to ${dest.name}.` : 'No destination has been set. Open the MAP and pick an airport to make this official.')
      : 'Somewhere out there a runway is waiting. Start taxiing to begin a new flight. Set a destination on the MAP tab for bonus perks.';
    const table = statTable([['time', 'ELAPSED'], ['dist', 'DISTANCE'], ['alt', 'MAX ALTITUDE'], ['ldg', 'LANDINGS']]);
    if (f) {
      table.set('time', fmt.durS(f.durationSec));
      table.set('dist', `${fmt.num(f.distanceNm, 1)} NM`);
      table.set('alt', `${fmt.int(f.maxAltFt)} FT`);
      table.set('ldg', String(f.landings.length));
    }
    this.detail.replaceChildren(
      h('div', { class: 'quest-title' }, title),
      h('div', { class: 'desc' }, blurb),
      h('div', { class: 'objectives' },
        obj(m.taxi, 'Taxi to the active runway'),
        obj(m.takeoff, 'Take off'),
        obj(m.climb, 'Climb out'),
        obj(m.cruise, 'Reach cruise'),
        obj(m.descent || m.approach, 'Begin your descent'),
        obj(m.landed, 'Touch down safely'),
        dest ? obj(landedAtDest, `Land at ${dest.ident}`, true) : null,
        obj(m.parked, 'Taxi to parking and shut down'),
      ),
      f ? table.el : '',
    );
  }

  tel() {
    // refresh elapsed time once a second
    const now = Date.now();
    if (now - (this.lastRefresh || 0) > 1000 && this.list.current()?.kind === 'current') {
      this.lastRefresh = now;
      this._detail(this.list.current());
    }
  }

  key(e) { return this.list.key(e); }
}

// ---------------------------------------------------------------- LANDING --
export class LandingPage extends Page {
  build() {
    this.el.classList.add('landing-page');
    this.grade = h('div', { class: 'grade' }, '?');
    this.label = h('div', { class: 'grade-label' }, 'NO LANDINGS YET');
    this.fpm = h('div', { class: 'grade-fpm' }, '');
    this.table = statTable([['g', 'TOUCHDOWN G'], ['ias', 'AIRSPEED'], ['wind', 'HEAD / CROSS'], ['att', 'PITCH / BANK'], ['bnc', 'BOUNCES'], ['apt', 'AIRPORT'], ['best', 'PERSONAL BEST']]);
    this.graph = h('canvas', { class: 'landing-graph' });
    this.el.append(
      h('div', { class: 'landing-left' }, h('div', { class: 'section-title' }, 'LAST TOUCHDOWN'), this.grade, this.label, this.fpm),
      h('div', { class: 'landing-right' }, this.table.el, h('div', { class: 'section-title' }, 'FINAL 10 SECONDS — V/S & HEIGHT'), this.graph),
    );
  }

  show() {
    if (this.app.S.state) this.state(this.app.S.state, true);
  }

  state(s, force) {
    const l = s.lastLanding;
    const key = l ? l.at : null;
    if (key === this.shown && !force) return;
    const isNew = key !== this.shown && this.shown !== undefined;
    this.shown = key;
    if (!l) return;
    this.grade.textContent = l.grade;
    this.grade.className = `grade g-${l.grade}`;
    if (isNew || force) {
      this.grade.classList.remove('stamp');
      void this.grade.offsetWidth;
      this.grade.classList.add('stamp');
    }
    this.label.textContent = l.label;
    this.fpm.textContent = `${l.fpm} FPM`;
    const T = this.table;
    T.set('g', `${l.g.toFixed(2)} G`);
    T.set('ias', `${l.ias} KT`);
    T.set('wind', `${l.headwindKt > 0 ? 'HEAD' : 'TAIL'} ${Math.abs(Math.round(l.headwindKt))} / X ${Math.abs(Math.round(l.crosswindKt))} KT`);
    T.set('att', `${l.pitch}° / ${l.bank}°`);
    T.set('bnc', String(l.bounces));
    T.set('apt', l.airport ? `${l.airport.ident} ${l.airport.name.toUpperCase().slice(0, 22)}` : 'OFF AIRPORT (!)');
    T.set('best', s.profile.bestLandingFpm !== null ? `${s.profile.bestLandingFpm} FPM` : '---');
    requestAnimationFrame(() => this._draw(l.graph || []));
  }

  _draw(pts) {
    const c = this.graph;
    const w = c.clientWidth, hh = c.clientHeight;
    if (!w || !hh) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = hh * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const rgb = this.app.rgb;
    const data = pts.filter((p) => p[0] >= -10 && p[0] <= 1.5);
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.strokeStyle = `rgba(${rgb},0.2)`;
    ctx.fillStyle = `rgba(${rgb},0.6)`;
    const x = (t) => ((t + 10) / 11.5) * (w - 40) + 34;
    const minVs = Math.min(-200, ...data.map((p) => p[1]));
    const maxAgl = Math.max(50, ...data.map((p) => p[2]));
    const yVs = (v) => 10 + ((0 - v) / -minVs) * (hh - 30);
    const yAgl = (a) => hh - 20 - (a / maxAgl) * (hh - 30);
    for (let t = -10; t <= 0; t += 2) {
      ctx.beginPath(); ctx.moveTo(x(t), 6); ctx.lineTo(x(t), hh - 18); ctx.stroke();
      ctx.fillText(`${t}s`, x(t) - 8, hh - 4);
    }
    ctx.fillText('0', 4, yVs(0) + 4);
    ctx.fillText(String(Math.round(minVs)), 0, hh - 22);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = `rgba(${rgb},0.5)`;
    ctx.beginPath(); ctx.moveTo(x(0), 0); ctx.lineTo(x(0), hh - 18); ctx.stroke();
    ctx.setLineDash([]);
    if (data.length < 2) return;
    // AGL (dim, filled)
    ctx.beginPath();
    data.forEach((p, i) => (i ? ctx.lineTo(x(p[0]), yAgl(p[2])) : ctx.moveTo(x(p[0]), yAgl(p[2]))));
    ctx.strokeStyle = `rgba(${rgb},0.45)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // V/S (bright)
    ctx.beginPath();
    data.forEach((p, i) => (i ? ctx.lineTo(x(p[0]), yVs(p[1])) : ctx.moveTo(x(p[0]), yVs(p[1]))));
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = `rgba(${rgb},0.8)`;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.fillText('V/S', w - 30, 16);
    ctx.fillStyle = `rgba(${rgb},0.5)`;
    ctx.fillText('AGL', w - 30, 30);
  }
}

// ---------------------------------------------------------------- LOGBOOK --
export class LogbookPage extends Page {
  build() {
    this.el.classList.add('log-page');
    this.totals = h('div', { class: 'log-totals' });
    this.list = new List({ cls: 'log-list', onSelect: (it) => this._detail(it.entry) });
    this.detail = h('div', { class: 'detail log-detail' });
    this.el.append(this.totals, h('div', { class: 'split' }, this.list.el, this.detail));
  }

  show() { if (this.app.S.state) this.state(this.app.S.state); }

  state(s) {
    const p = s.profile;
    this.totals.innerHTML = `<span>FLIGHTS <b>${p.flights}</b></span><span>HOURS <b>${(p.airborneSec / 3600).toFixed(1)}</b></span><span>DISTANCE <b>${Math.round(p.distanceNm).toLocaleString()} NM</b></span><span>LANDINGS <b>${p.landings}</b></span><span>AIRPORTS <b>${p.airports}</b></span><span>BEST <b>${p.bestLandingFpm ?? '---'} FPM</b></span>`;
    const items = s.logbook.map((e) => {
      const last = e.landings[e.landings.length - 1];
      return { id: e.id, label: `${apt(e.departure)} ▸ ${apt(e.arrival)}`, value: `${fmt.dur(e.durationSec)} ${last ? last.grade : '-'}`, entry: e };
    });
    if (!items.length) items.push({ id: 'empty', label: 'No flights logged yet', dim: true });
    this.list.set(items);
    const cur = this.list.current();
    if (cur) this._detail(cur.entry);
  }

  _detail(e) {
    if (!e) {
      this.detail.replaceChildren(h('div', { class: 'desc' }, 'Completed flights appear here automatically: take off, land, stop and shut down (or set the parking brake).'));
      return;
    }
    const t = statTable([['date', 'DATE'], ['ac', 'AIRCRAFT'], ['sim', 'SIMULATOR'], ['time', 'BLOCK / AIR'], ['dist', 'DISTANCE'], ['alt', 'MAX ALT'], ['g', 'MAX G'], ['xp', 'XP EARNED']]);
    t.set('date', `${fmt.date(e.startedAt)} ${fmt.time(e.startedAt)}`);
    t.set('ac', (e.aircraft || '').slice(0, 26));
    t.set('sim', { xplane: 'X-PLANE 12', msfs: 'MSFS', demo: 'DEMO' }[e.source] || '---');
    t.set('time', `${fmt.dur(e.durationSec)} / ${fmt.dur(e.airborneSec)}`);
    t.set('dist', `${e.distanceNm} NM`);
    t.set('alt', `${fmt.int(e.maxAltFt)} FT`);
    t.set('g', `${e.maxG} G`);
    t.set('xp', `+${e.xp || 0}`);
    const lands = h('div', { class: 'log-landings' }, ...e.landings.map((l) => h('div', { class: 'log-landing' }, h('b', {}, l.grade), ` ${l.fpm} FPM · ${l.airport ? l.airport.ident : 'OFF-FIELD'} · ${l.g} G`)));
    const cv = h('canvas', { class: 'log-track' });
    this.detail.replaceChildren(h('div', { class: 'quest-title' }, `${apt(e.departure)} ▸ ${apt(e.arrival)}`), cv, t.el, lands);
    requestAnimationFrame(() => this._drawTrack(cv, e.track || []));
  }

  _drawTrack(c, track) {
    const w = c.clientWidth, hh = c.clientHeight;
    if (!w || !hh || track.length < 2) return;
    c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    const rgb = this.app.rgb;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const [la, lo] of track) {
      minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); minLo = Math.min(minLo, lo); maxLo = Math.max(maxLo, lo);
    }
    const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
    const spanX = Math.max(0.01, (maxLo - minLo) * k), spanY = Math.max(0.01, maxLa - minLa);
    const sc = Math.min((w - 20) / spanX, (hh - 20) / spanY);
    const ox = (w - spanX * sc) / 2, oy = (hh - spanY * sc) / 2;
    const P = ([la, lo]) => [ox + (lo - minLo) * k * sc, hh - oy - (la - minLa) * sc];
    ctx.strokeStyle = `rgba(${rgb},0.15)`;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo((w * i) / 6, 0); ctx.lineTo((w * i) / 6, hh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (hh * i) / 6); ctx.lineTo(w, (hh * i) / 6); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${rgb},1)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    track.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},1)`;
    const [sx, sy] = P(track[0]);
    const [ex, ey] = P(track[track.length - 1]);
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();
  }

  key(e) { return this.list.key(e); }
}

// ------------------------------------------------------------- CHECKLISTS --
const CHECKLISTS = [
  { id: 'preflight', name: 'Before Start', items: ['Parking brake — SET', 'Fuel quantity — CHECKED', 'Flight plan / destination — SET', 'Altimeter — SET', 'Avionics — OFF', 'Beacon — ON'] },
  { id: 'start', name: 'Engine Start', items: ['Area — CLEAR', 'Fuel pump / mixture — AS REQUIRED', 'Engines — START', 'Oil pressure — CHECK', 'Avionics — ON', 'Nav lights — ON'] },
  { id: 'taxi', name: 'Taxi', items: ['Taxi clearance — RECEIVED', 'Taxi light — ON', 'Parking brake — RELEASED', 'Brakes — CHECKED', 'Flight instruments — CHECKED'] },
  { id: 'takeoff', name: 'Before Takeoff', items: ['Flaps — SET FOR TAKEOFF', 'Trim — SET', 'Flight controls — FREE & CORRECT', 'Transponder — ALT / ON', 'Strobes & landing lights — ON', 'Takeoff clearance — RECEIVED'] },
  { id: 'climb', name: 'Climb & Cruise', items: ['Gear — UP', 'Flaps — UP', 'Autopilot — AS REQUIRED', 'Altimeter — SET (TRANSITION ALT)', 'Landing lights — OFF above 10,000 ft'] },
  { id: 'descent', name: 'Descent & Approach', items: ['Destination weather — OBTAINED', 'Altimeter — SET', 'Approach briefing — COMPLETE', 'Landing lights — ON', 'Speed — REDUCE'] },
  { id: 'landing', name: 'Before Landing', items: ['Gear — DOWN, THREE GREEN', 'Flaps — LANDING', 'Autopilot — OFF', 'Landing clearance — RECEIVED', 'Stabilised by 500 ft — CHECK'] },
  { id: 'shutdown', name: 'After Landing & Shutdown', items: ['Flaps — UP', 'Strobes & landing lights — OFF', 'Transponder — STANDBY', 'Parking brake — SET', 'Engines — SHUT DOWN', 'Beacon — OFF'] },
];

export class ChecklistPage extends Page {
  build() {
    this.el.classList.add('split', 'check-page');
    this.done = local.get('checklists', {});
    this.list = new List({ cls: 'check-list', onSelect: (it) => this._open(it.cl), onActivate: () => { this.focus = 'items'; this._render(); } });
    this.items = new List({ cls: 'check-items', onActivate: (it) => this._toggle(it) });
    this.progress = h('div', { class: 'check-progress' });
    this.hint = h('div', { class: 'hint' }, '◀ ▶ SWITCH COLUMN · ENTER TOGGLE · R RESET');
    this.right = h('div', { class: 'detail check-detail' }, this.progress, this.items.el, this.hint);
    this.el.append(this.list.el, this.right);
    this.focus = 'lists';
    this._refreshLists();
  }

  _refreshLists() {
    this.list.set(CHECKLISTS.map((cl) => {
      const d = this.done[cl.id] || [];
      const n = cl.items.filter((_, i) => d[i]).length;
      return { id: cl.id, label: cl.name, value: n === cl.items.length ? '✓' : `${n}/${cl.items.length}`, cl, dim: n === cl.items.length };
    }));
  }

  _open(cl) {
    this.cur = cl;
    this._render();
  }

  _render() {
    const cl = this.cur;
    if (!cl) return;
    const d = this.done[cl.id] || [];
    this.items.set(cl.items.map((txt, i) => {
      const [what, action] = txt.split(' — ');
      return { id: `${cl.id}-${i}`, label: `<span class="cb">${d[i] ? '■' : '□'}</span> ${escapeHtml(what)}`, value: escapeHtml(action || ''), dim: !!d[i], idx: i };
    }));
    const n = cl.items.filter((_, i) => d[i]).length;
    this.progress.textContent = n === cl.items.length ? `${cl.name.toUpperCase()} — COMPLETE` : `${cl.name.toUpperCase()} — ${n} OF ${cl.items.length}`;
    this.progress.classList.toggle('complete', n === cl.items.length);
    this.right.classList.toggle('focused', this.focus === 'items');
    this.list.el.classList.toggle('unfocused', this.focus === 'items');
  }

  _toggle(it) {
    const cl = this.cur;
    const d = this.done[cl.id] || (this.done[cl.id] = []);
    d[it.idx] = !d[it.idx];
    local.set('checklists', this.done);
    const wasComplete = this.progress.classList.contains('complete');
    this._render();
    this._refreshLists();
    if (!wasComplete && this.progress.classList.contains('complete')) sound.xp();
    else if (d[it.idx] && it.idx < cl.items.length - 1) this.items.select(it.idx + 1, false);
  }

  key(e) {
    if (e.key === 'ArrowRight' && this.focus === 'lists') { this.focus = 'items'; this._render(); sound.move(); return true; }
    if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && this.focus === 'items') { this.focus = 'lists'; this._render(); sound.back(); return true; }
    if (e.key === 'r' || e.key === 'R') {
      delete this.done[this.cur.id];
      local.set('checklists', this.done);
      this._render();
      this._refreshLists();
      sound.back();
      return true;
    }
    return this.focus === 'items' ? this.items.key(e) : this.list.key(e);
  }
}
