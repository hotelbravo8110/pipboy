'use strict';
/*
 * Flight tracker: turns the raw telemetry stream into flight phases, landing
 * reports, a logbook, pilot XP / levels and perk unlocks.
 */
const { EventEmitter } = require('events');
const { distanceNm, solarElevation, D2R } = require('../geo');
const { PERKS, xpForLevel, levelForXp } = require('./perks');

const PROFILE_DEFAULT = {
  callsign: 'WANDERER',
  xp: 0,
  flights: 0,
  landings: 0,
  smoothLandings: 0,
  airborneSec: 0,
  distanceNm: 0,
  bestLandingFpm: null,
  airports: [],
  perks: {},
  destination: null,
};

const GRADES = [
  [60, 'S', 'BUTTER', 75],
  [120, 'A', 'SMOOTH', 50],
  [240, 'B', 'FIRM', 25],
  [400, 'C', 'HARD', 10],
  [600, 'D', 'VERY HARD', 0],
  [Infinity, 'F', 'INSPECT GEAR', 0],
];

function gradeLanding(fpm) {
  const [, grade, label, bonus] = GRADES.find(([max]) => fpm <= max);
  return { grade, label, bonus };
}

class FlightTracker extends EventEmitter {
  constructor({ store, airports }) {
    super();
    this.store = store;
    this.airports = airports;
    this.profile = store.load('profile', PROFILE_DEFAULT);
    this.logbook = store.load('logbook', []);
    this.flight = null;
    this.phase = 'NO SIGNAL';
    this.prev = null;
    this.vsAvg = 0;
    this.history = []; // last ~12 s of [simT, vs, agl, g] for landing graphs
    this.simT = 0;
    this.lastTick = 0;
    this.lastLanding = this.logbook.find((f) => f.landings && f.landings.length)?.landings.slice(-1)[0] || null;
  }

  // ---- public API --------------------------------------------------------

  setSource(source) {
    if (this.source && source !== this.source && this.flight) {
      // Simulator went away or changed: keep a flight that already landed, drop the rest.
      if (this.flight.landings.length) this._endFlight();
      else this.flight = null;
    }
    this.source = source;
    this.prev = null;
    this.phase = source ? 'PREFLIGHT' : 'NO SIGNAL';
    this.emit('change');
  }

  setDestination(ident) {
    const a = ident ? this.airports.get(ident) : null;
    this.profile.destination = a ? { ident: a.ident, name: a.name, lat: a.lat, lon: a.lon, elev: a.elev } : null;
    this._saveProfile();
    this.emit('change');
    return this.profile.destination;
  }

  setCallsign(name) {
    this.profile.callsign = String(name || '').toUpperCase().replace(/[^A-Z0-9 \-_]/g, '').slice(0, 16) || 'WANDERER';
    this._saveProfile();
    this.emit('change');
  }

  resetProfile() {
    const keepDest = this.profile.destination;
    this.profile = { ...PROFILE_DEFAULT, perks: {}, airports: [], destination: keepDest };
    this.logbook = [];
    this.lastLanding = null;
    this.store.save('logbook', this.logbook);
    this._saveProfile();
    this.emit('change');
  }

  snapshot({ withTrack = false } = {}) {
    const p = this.profile;
    const level = levelForXp(p.xp);
    const f = this.flight;
    return {
      phase: this.phase,
      profile: {
        callsign: p.callsign, xp: p.xp, level,
        levelXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1),
        flights: p.flights, landings: p.landings, airborneSec: p.airborneSec,
        distanceNm: p.distanceNm, bestLandingFpm: p.bestLandingFpm, airports: p.airports.length,
      },
      destination: p.destination,
      perks: PERKS.map((k) => ({
        id: k.id, name: k.name, desc: k.desc, icon: k.icon, xp: k.xp,
        unlocked: p.perks[k.id] || null,
        progress: k.progress ? k.progress(p) : null,
      })),
      flight: f ? {
        id: f.id, startedAt: f.startedAt, departure: f.departure, aircraft: f.aircraft,
        durationSec: f.durationSec, airborneSec: f.airborneSec, distanceNm: f.distanceNm,
        maxAltFt: f.maxAltFt, maxG: f.maxG, milestones: f.milestones, landings: f.landings,
        track: withTrack ? f.track : undefined,
      } : null,
      lastLanding: this.lastLanding,
      logbook: this.logbook.slice(0, 100),
    };
  }

  // ---- telemetry ingestion -----------------------------------------------

  ingest(t) {
    const prev = this.prev;
    let dt = 0;
    if (prev) {
      const dz = t.zuluSec - prev.zuluSec;
      dt = dz > 0 && dz < 5 ? dz : (Date.now() - prev._wall) / 1000;
      dt = Math.max(0, Math.min(2, dt));
    }
    t._wall = Date.now();
    this.prev = t;
    if (!prev || t.paused) return;
    this.simT += dt;

    const k = 1 - Math.exp(-dt / 2.5);
    this.vsAvg += (t.vs - this.vsAvg) * k;
    this.history.push([this.simT, t.vs, t.aglFt, t.gForce]);
    while (this.history.length && this.simT - this.history[0][0] > 12) this.history.shift();

    // Start a flight once the aircraft moves.
    if (!this.flight && (t.gs > 3 || !t.onGround)) this._startFlight(t);
    const f = this.flight;

    if (f) {
      f.durationSec += dt;
      if (t.gs > 1) f.distanceNm += (t.gs * dt) / 3600;
      if (!t.onGround) {
        f.airborneSec += dt;
        f.airStreak += dt;
        if (t.ap && t.ap.master) f.apSec += dt;
        f.maxAltFt = Math.max(f.maxAltFt, t.altFt);
        f.maxG = Math.max(f.maxG, t.gForce);
      } else {
        f.groundStreak += dt;
      }
      this._trackPoint(f, t);
      this._detectTouchdown(f, prev, t);
      this._detectTakeoff(f, prev, t);
      this._updatePending(f, t);
    }

    this._updatePhase(t);

    if (f && this._shouldEnd(f, t, dt)) this._endFlight();

    if (Date.now() - this.lastTick > 1000) {
      this.lastTick = Date.now();
      this._checkPerks({ kind: 'tick', t, flight: this.flight });
    }
  }

  _startFlight(t) {
    const dep = t.onGround ? this.airports.nearest(t.lat, t.lon, { maxNm: 4 })[0] : null;
    this.flight = {
      id: Date.now().toString(36),
      startedAt: new Date().toISOString(),
      departure: dep ? { ident: dep.ident, name: dep.name } : null,
      startedAirborne: !t.onGround,
      aircraft: t.aircraft,
      source: this.source,
      durationSec: 0, airborneSec: 0, apSec: 0, distanceNm: 0,
      maxAltFt: t.altFt, maxG: 1,
      airStreak: t.onGround ? 0 : 999, groundStreak: 0, stoppedSec: 0,
      landings: [], touchAndGos: 0,
      track: [[+t.lat.toFixed(5), +t.lon.toFixed(5), Math.round(t.altFt)]],
      lastTrackT: this.simT,
      milestones: { taxi: false, takeoff: !t.onGround, climb: false, cruise: false, descent: false, approach: false, landed: false, parked: false },
      pending: null,
    };
    this.emit('change');
  }

  _trackPoint(f, t) {
    const last = f.track[f.track.length - 1];
    const moved = distanceNm(last[0], last[1], t.lat, t.lon);
    if (moved > 0.4 || (moved > 0.02 && this.simT - f.lastTrackT > 15)) {
      f.track.push([+t.lat.toFixed(5), +t.lon.toFixed(5), Math.round(t.altFt)]);
      f.lastTrackT = this.simT;
      if (f.track.length > 4000) f.track = f.track.filter((_, i) => i % 2 === 0 || i === f.track.length - 1);
    }
  }

  _detectTakeoff(f, prev, t) {
    if (prev.onGround && !t.onGround) {
      f.groundStreak = 0;
    }
    if (!t.onGround && f.airStreak > 3 && !f.milestones.takeoff) {
      f.milestones.takeoff = true;
      this.emit('event', { kind: 'takeoff', airport: f.departure });
    }
    // Touch-and-go: airborne again for >15 s after a completed landing.
    if (!t.onGround && f.landings.length && !f.tgCounted && f.airStreak > 15) {
      f.tgCounted = true;
      f.touchAndGos++;
      f.milestones.landed = false;
    }
  }

  _detectTouchdown(f, prev, t) {
    if (!(!prev.onGround && t.onGround)) return;
    const airborne = f.airStreak;
    f.airStreak = 0;
    f.groundStreak = 0;
    if (f.pending) { f.pending.bounces++; return; }
    if (f.lastLandingAt && this.simT - f.lastLandingAt < 5) {
      const l = f.landings[f.landings.length - 1];
      if (l) l.bounces++;
      return;
    }
    if (airborne < 5) return;
    // Use the most negative V/S over the final second before contact.
    const lastSec = this.history.filter(([ts]) => this.simT - ts < 1.2);
    const vsAtTd = Math.min(prev.vs, ...lastSec.map((h) => h[1]));
    f.pending = {
      at: this.simT,
      vsFpm: Math.abs(Math.min(0, vsAtTd)),
      tdBefore: prev.touchdownFpm,
      t,
      gMax: t.gForce,
      bounces: 0,
      graph: this.history.map(([ts, vs, agl]) => [+(ts - this.simT).toFixed(2), Math.round(vs), Math.round(agl)]),
    };
  }

  _updatePending(f, t) {
    const p = f.pending;
    if (!p) return;
    p.gMax = Math.max(p.gMax, t.gForce);
    if (this.simT - p.at < 1.5) return;
    f.pending = null;
    f.lastLandingAt = p.at;
    f.tgCounted = false;

    const td = p.t;
    let fpm = p.vsFpm;
    if (typeof t.touchdownFpm === 'number' && t.touchdownFpm > 0 && t.touchdownFpm !== p.tdBefore) fpm = t.touchdownFpm;
    fpm = Math.round(fpm);
    const apt = this.airports.nearest(td.lat, td.lon, { maxNm: 3 })[0] || null;
    const xw = td.windKt * Math.sin((td.windDir - td.hdgTrue) * D2R);
    const hw = td.windKt * Math.cos((td.windDir - td.hdgTrue) * D2R);
    const sun = solarElevation(td.lat, td.lon, td.dayOfYear || 172, td.zuluSec || 43200);
    const g = gradeLanding(fpm);
    const dest = this.profile.destination;
    const landing = {
      at: new Date().toISOString(),
      fpm,
      g: +p.gMax.toFixed(2),
      ias: Math.round(td.ias),
      gs: Math.round(td.gs),
      pitch: +td.pitch.toFixed(1),
      bank: +td.bank.toFixed(1),
      crosswindKt: +xw.toFixed(1),
      headwindKt: +hw.toFixed(1),
      bounces: p.bounces,
      airport: apt ? { ident: apt.ident, name: apt.name } : null,
      night: sun < -6,
      fuelPct: td.fuelCapLb > 0 ? +((td.fuelLb / td.fuelCapLb) * 100).toFixed(1) : null,
      atDestination: !!(dest && apt && apt.ident === dest.ident),
      grade: g.grade,
      label: g.label,
      xp: 25 + g.bonus,
      graph: p.graph,
      aircraft: td.aircraft,
    };
    f.landings.push(landing);
    f.milestones.landed = true;
    this.lastLanding = landing;

    const pr = this.profile;
    pr.landings++;
    if (fpm < 120) pr.smoothLandings = (pr.smoothLandings || 0) + 1;
    if (pr.bestLandingFpm === null || fpm < pr.bestLandingFpm) pr.bestLandingFpm = fpm;
    if (apt && !pr.airports.includes(apt.ident)) pr.airports.push(apt.ident);
    this._addXp(landing.xp, `LANDING ${landing.grade}`);
    this.emit('event', { kind: 'landing', landing });
    this._checkPerks({ kind: 'landing', landing, flight: f });
    this._saveProfile();
    this.emit('change');
  }

  _updatePhase(t) {
    const f = this.flight;
    let phase;
    if (!f) {
      phase = t.engines.some((e) => e.running) ? 'ENGINES RUNNING' : 'PREFLIGHT';
    } else if (t.onGround) {
      const landed = f.landings.length > 0 || f.pending;
      if (t.gs > 40) phase = landed ? 'LANDING ROLL' : 'TAKEOFF ROLL';
      else if (t.gs > 2) phase = landed ? 'TAXI IN' : 'TAXI OUT';
      else phase = landed ? 'PARKED' : (f.milestones.taxi ? 'HOLDING' : 'PREFLIGHT');
      if (phase === 'TAXI OUT') f.milestones.taxi = true;
      if (phase === 'PARKED') f.milestones.parked = true;
    } else {
      const agl = t.aglFt;
      const was = this.phase;
      if (agl < 1500 && (f.airStreak < 30 || (f.airStreak < 90 && this.vsAvg > 0)) && !f.pending) phase = 'TAKEOFF';
      else if (agl < 2500 && this.vsAvg < -150 && (t.gear > 0.5 || agl < 1200)) phase = 'APPROACH';
      else if (this.vsAvg > 400 || (was === 'CLIMB' && this.vsAvg > 150)) phase = 'CLIMB';
      else if (this.vsAvg < -400 || ((was === 'DESCENT' || was === 'APPROACH') && this.vsAvg < -150)) phase = 'DESCENT';
      else phase = 'CRUISE';
      const m = { CLIMB: 'climb', CRUISE: 'cruise', DESCENT: 'descent', APPROACH: 'approach' }[phase];
      if (m) f.milestones[m] = true;
      if (phase === 'TAKEOFF') f.milestones.takeoff = true;
    }
    if (phase !== this.phase) {
      this.phase = phase;
      this.emit('event', { kind: 'phase', phase });
      this.emit('change');
    }
  }

  _shouldEnd(f, t, dt) {
    if (!f.landings.length || f.pending || !t.onGround || t.gs > 1) {
      f.stoppedSec = 0;
      return false;
    }
    f.stoppedSec += dt;
    const enginesOff = t.engines.every((e) => !e.running);
    return (enginesOff && f.stoppedSec > 3) || (t.parkingBrake && f.stoppedSec > 30);
  }

  _endFlight() {
    const f = this.flight;
    this.flight = null;
    if (!f) return;
    const last = f.landings[f.landings.length - 1];
    const entry = {
      id: f.id,
      startedAt: f.startedAt,
      endedAt: new Date().toISOString(),
      aircraft: f.aircraft,
      source: f.source,
      departure: f.departure,
      arrival: last ? last.airport : null,
      durationSec: Math.round(f.durationSec),
      airborneSec: Math.round(f.airborneSec),
      distanceNm: +f.distanceNm.toFixed(1),
      maxAltFt: Math.round(f.maxAltFt),
      maxG: +f.maxG.toFixed(2),
      landings: f.landings.map(({ graph, ...rest }) => rest),
      track: f.track.filter((_, i, a) => a.length < 600 || i % Math.ceil(a.length / 600) === 0),
    };
    if (last) entry.landings[entry.landings.length - 1].graph = last.graph;
    const xp = Math.max(10, Math.round(f.distanceNm + f.airborneSec / 30));
    entry.xp = xp + f.landings.reduce((s, l) => s + l.xp, 0);
    this.logbook.unshift(entry);
    if (this.logbook.length > 500) this.logbook.length = 500;
    const pr = this.profile;
    pr.flights++;
    pr.airborneSec += f.airborneSec;
    pr.distanceNm += f.distanceNm;
    this._addXp(xp, 'FLIGHT COMPLETE');
    this.store.save('logbook', this.logbook);
    this.emit('event', { kind: 'flightEnd', flight: entry });
    this._checkPerks({ kind: 'flightEnd', flight: f });
    this._saveProfile();
    this.emit('change');
  }

  _addXp(amount, reason) {
    const pr = this.profile;
    const before = levelForXp(pr.xp);
    pr.xp += amount;
    const after = levelForXp(pr.xp);
    this.emit('event', { kind: 'xp', amount, reason });
    if (after > before) this.emit('event', { kind: 'levelup', level: after });
  }

  _checkPerks(ctx) {
    const pr = this.profile;
    for (const perk of PERKS) {
      if (pr.perks[perk.id]) continue;
      let ok = false;
      try { ok = perk.check({ ...ctx, profile: pr }); } catch { ok = false; }
      if (!ok) continue;
      pr.perks[perk.id] = new Date().toISOString();
      this.emit('event', { kind: 'perk', perk: { id: perk.id, name: perk.name, desc: perk.desc, icon: perk.icon, xp: perk.xp } });
      this._addXp(perk.xp, perk.name.toUpperCase());
      this._saveProfile();
      this.emit('change');
    }
  }

  _saveProfile() { this.store.save('profile', this.profile); }
}

module.exports = { FlightTracker, gradeLanding };
