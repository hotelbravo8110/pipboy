'use strict';
/*
 * Demo "simulator": flies a scripted King Air shuttle between Boeing Field
 * (KBFI) and Paine Field (KPAE) forever, so the whole UI can be explored
 * without X-Plane or MSFS running. `speed` compresses time.
 */
const { EventEmitter } = require('events');
const { distanceNm, bearingDeg, D2R } = require('../geo');

const LEGS = [
  { from: 'KBFI', depRwy: [47.5167, -122.2913, 47.5405, -122.3114], depElev: 21,
    to: 'KPAE', arrRwy: [47.8966, -122.2853, 47.9213, -122.2859], arrElev: 606, cruise: 5500 },
  { from: 'KPAE', depRwy: [47.9213, -122.2859, 47.8966, -122.2853], depElev: 606,
    to: 'KBFI', arrRwy: [47.5405, -122.3114, 47.5167, -122.2913], arrElev: 21, cruise: 4500 },
];

const WIND_DIR = 300;
const WIND_KT = 9;
const HZ = 20;

function angleDiff(a, b) { return ((b - a + 540) % 360) - 180; }

function movePoint(lat, lon, brgDeg, distNm) {
  const d = distNm / 3440.065;
  const b = brgDeg * D2R;
  const la1 = lat * D2R, lo1 = lon * D2R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 / D2R, lo2 / D2R];
}

class DemoAdapter extends EventEmitter {
  constructor({ speed = 1 } = {}) {
    super();
    this.name = 'demo';
    this.label = 'DEMO SIM';
    this.speed = Math.max(0.25, Math.min(20, Number(speed) || 1));
    this.connected = false;
    this.legIndex = 0;
    this.zulu = 15 * 3600;
    this.fuel = 2600;
  }

  start() {
    this._startLeg();
    this.connected = true;
    this.emit('status', true);
    this.timer = setInterval(() => {
      const dt = this.speed / HZ;
      this._step(dt);
      this.emit('data', this._telemetry());
    }, 1000 / HZ);
  }

  stop() {
    clearInterval(this.timer);
    if (this.connected) {
      this.connected = false;
      this.emit('status', false);
    }
  }

  _startLeg() {
    const leg = LEGS[this.legIndex % LEGS.length];
    this.leg = leg;
    const [la1, lo1, la2, lo2] = leg.depRwy;
    this.rwyHdg = bearingDeg(la1, lo1, la2, lo2);
    // Start parked just behind the threshold, slightly off to the side.
    [this.lat, this.lon] = movePoint(la1, lo1, this.rwyHdg + 180, 0.08);
    this.hdg = this.rwyHdg;
    this.alt = leg.depElev;
    this.ground = leg.depElev;
    this.ias = 0;
    this.vs = 0;
    this.bank = 0;
    this.onGround = true;
    this.gear = 1;
    this.flaps = 0;
    this.rpm = 0;
    this.running = false;
    this.phase = 'parked';
    this.t = 0;
    this.gExtra = 0;
    this.ap = false;
    // Final approach fix: 8 nm out on the extended centreline.
    const [aa1, ao1, aa2, ao2] = leg.arrRwy;
    this.arrHdg = bearingDeg(aa1, ao1, aa2, ao2);
    this.faf = movePoint(aa1, ao1, this.arrHdg + 180, 8);
    this.fafAlt = leg.arrElev + 8 * 318;
    this.tdTarget = -(40 + Math.random() * 240);
  }

  _step(dt) {
    this.t += dt;
    this.zulu = (this.zulu + dt) % 86400;
    const leg = this.leg;
    const [aa1, ao1] = leg.arrRwy;
    let targetHdg = this.hdg;
    let targetIas = this.ias;
    let targetVs = 0;

    switch (this.phase) {
      case 'parked':
        if (this.t > 4) this.running = true;
        if (this.t > 10) this._go('taxi');
        break;
      case 'taxi':
        targetIas = 14;
        if (this.t > 18) this._go('roll');
        break;
      case 'roll':
        targetIas = 110;
        this.flaps = 0.4;
        if (this.ias > 96) { this.onGround = false; this._go('climb'); }
        break;
      case 'climb': {
        targetIas = 150;
        targetVs = 1200;
        const agl = this.alt - this.ground;
        if (agl > 300) this.gear = Math.max(0, this.gear - dt / 4);
        if (agl > 900) this.flaps = Math.max(0, this.flaps - dt / 6);
        if (agl > 1500) {
          targetHdg = bearingDeg(this.lat, this.lon, this.faf[0], this.faf[1]);
          this.ap = true;
        }
        if (this.alt >= leg.cruise - 50) this._go('cruise');
        break;
      }
      case 'cruise': {
        targetIas = 210;
        targetHdg = bearingDeg(this.lat, this.lon, this.faf[0], this.faf[1]);
        targetVs = (leg.cruise - this.alt) * 2;
        const d = distanceNm(this.lat, this.lon, this.faf[0], this.faf[1]);
        const descentNm = ((this.alt - this.fafAlt) / 900) * (this._gs() / 60);
        if (d <= descentNm + 0.5) this._go('descent');
        break;
      }
      case 'descent': {
        targetIas = 170;
        targetVs = -900;
        targetHdg = bearingDeg(this.lat, this.lon, this.faf[0], this.faf[1]);
        if (this.alt < this.fafAlt + 100) targetVs = (this.fafAlt - this.alt) * 2;
        const d = distanceNm(this.lat, this.lon, this.faf[0], this.faf[1]);
        if (d < 0.6) this._go('approach');
        break;
      }
      case 'approach': {
        this.ap = false;
        const d = distanceNm(this.lat, this.lon, aa1, ao1);
        targetHdg = bearingDeg(this.lat, this.lon, aa1, ao1);
        if (d < 0.3) targetHdg = this.arrHdg;
        targetIas = d > 4 ? 130 : 105;
        this.gear = Math.min(1, this.gear + dt / 5);
        this.flaps = Math.min(d > 4 ? 0.5 : 1, this.flaps + dt / 6);
        const glideAlt = leg.arrElev + d * 318 + 30;
        targetVs = (glideAlt - this.alt) * 3 - (this._gs() * 101.3 * 0.0524);
        this.ground = leg.arrElev;
        if (this.alt - this.ground < 40) this._go('flare');
        break;
      }
      case 'flare':
        targetHdg = this.arrHdg;
        targetIas = 95;
        targetVs = this.tdTarget;
        if (this.alt - this.ground <= 0.5) {
          this.onGround = true;
          this.alt = this.ground;
          this.gExtra = Math.min(1.2, Math.abs(this.vs) / 450);
          this.vs = 0;
          this._go('rollout');
        }
        break;
      case 'rollout':
        targetIas = 12;
        this.flaps = Math.max(0, this.flaps - dt / 8);
        if (this.ias < 16) this._go('taxiin');
        break;
      case 'taxiin':
        targetIas = 12;
        if (this.t > 15) this._go('stop');
        break;
      case 'stop':
        targetIas = 0;
        if (this.t > 5) this.running = false;
        if (this.t > 14) {
          this.legIndex++;
          this._startLeg();
        }
        break;
      default:
        break;
    }

    // Simple dynamics.
    const accel = this.onGround ? (targetIas > this.ias ? 4 : 3) : 2;
    this.ias += Math.max(-accel * dt, Math.min(accel * dt, targetIas - this.ias));
    if (!this.onGround) {
      const vsRate = this.phase === 'flare' ? 600 : 400;
      this.vs += Math.max(-vsRate * dt, Math.min(vsRate * dt, targetVs - this.vs));
      this.vs = Math.max(-1800, Math.min(1800, this.vs));
      const diff = angleDiff(this.hdg, targetHdg);
      const rate = Math.max(-3, Math.min(3, diff * 0.6));
      this.hdg = (this.hdg + rate * dt + 360) % 360;
      const targetBank = rate * 8;
      this.bank += (targetBank - this.bank) * Math.min(1, dt * 1.5);
      this.alt += (this.vs / 60) * dt;
      if (this.alt < this.ground) this.alt = this.ground;
    } else {
      this.bank *= 0.9;
    }
    this.gExtra *= Math.pow(0.02, dt);
    const gs = this._gs();
    [this.lat, this.lon] = movePoint(this.lat, this.lon, this.hdg, (gs / 3600) * dt);
    const targetRpm = this.running ? (this.onGround && this.ias < 30 ? 1050 : 1700) : 0;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 0.8);
    const flow = this.running ? (this.rpm / 1700) * 310 * 2 : 0;
    this.fuel = Math.max(0, this.fuel - (flow / 3600) * dt);
    if (this.fuel < 900) this.fuel = 2600; // refuel between laps
    this.flow = flow;
  }

  _go(phase) { this.phase = phase; this.t = 0; }

  _gs() {
    if (this.onGround) return this.ias;
    const tas = this.ias * (1 + this.alt / 1000 * 0.017);
    const headwind = WIND_KT * Math.cos((WIND_DIR - this.hdg) * D2R);
    return Math.max(0, tas - headwind);
  }

  _telemetry() {
    const pitch = this.onGround ? (this.phase === 'roll' && this.ias > 85 ? 6 : 0)
      : Math.atan2(this.vs / 60, Math.max(30, this._gs()) * 1.688) / D2R + 2.5;
    const n1 = this.running ? (this.rpm / 1700) * 98 : 0;
    const jitter = () => (Math.random() - 0.5) * 0.04;
    return {
      lat: this.lat, lon: this.lon,
      altFt: this.alt, aglFt: Math.max(0, this.alt - this.ground),
      ias: this.ias, gs: this._gs(), tas: this.ias * (1 + this.alt / 1000 * 0.017), vs: this.onGround ? 0 : this.vs,
      hdgMag: (this.hdg - 15 + 360) % 360, hdgTrue: this.hdg, track: this.hdg,
      pitch, bank: this.bank,
      gForce: 1 / Math.cos(Math.min(60, Math.abs(this.bank)) * D2R) + this.gExtra + jitter(),
      onGround: this.onGround,
      gear: this.gear, flaps: this.flaps, parkingBrake: this.phase === 'parked' || (this.phase === 'stop' && this.t > 3),
      fuelLb: this.fuel, fuelCapLb: 3611, fuelFlowPph: this.flow,
      numEngines: 2,
      engines: [0, 1].map(() => ({ running: this.running, n1, rpm: this.rpm })),
      ap: { master: this.ap, hdgSel: Math.round((this.hdg - 15 + 360) % 360), altSel: this.leg.cruise, vsSel: 1000, spdSel: 210, hdgMode: this.ap, altMode: this.ap && this.phase === 'cruise' },
      com1: this.leg.from === 'KBFI' ? 120.6 : 132.95, com1sb: 121.9, com2: 121.5, com2sb: 128.5,
      nav1: 110.5, nav2: 116.8, xpdr: '4521',
      lights: {
        nav: this.running, beacon: this.running, strobe: !this.onGround || this.phase === 'roll',
        landing: !this.onGround ? this.alt - this.ground < 3000 : this.phase === 'roll' || this.phase === 'rollout',
        taxi: this.onGround && this.running,
      },
      windDir: WIND_DIR, windKt: WIND_KT, oatC: 15 - (this.alt / 1000) * 2, baroInHg: 29.92,
      zuluSec: this.zulu, dayOfYear: 172,
      paused: false,
      aircraft: 'KING AIR 350 (DEMO)',
      touchdownFpm: null,
    };
  }
}

module.exports = { DemoAdapter };
