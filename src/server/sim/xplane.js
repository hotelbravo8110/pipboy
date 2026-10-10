'use strict';
/*
 * X-Plane 12 adapter.
 *
 * Uses X-Plane's built-in UDP "RREF" protocol, so nothing has to be installed
 * inside the simulator. We ask X-Plane (default 127.0.0.1:49000) to stream a
 * list of datarefs at a fixed rate; it answers to whatever port we sent from.
 */
const dgram = require('dgram');
const { EventEmitter } = require('events');

const M2FT = 3.28084;
const MS2KT = 1.943844;
const KG2LB = 2.204623;
const MAX_ENG = 4;

// [key, dataref]. Array datarefs use the "path[index]" syntax RREF supports.
const REFS = [
  ['lat', 'sim/flightmodel/position/latitude'],
  ['lon', 'sim/flightmodel/position/longitude'],
  ['elevM', 'sim/flightmodel/position/elevation'],
  ['aglM', 'sim/flightmodel/position/y_agl'],
  ['ias', 'sim/flightmodel/position/indicated_airspeed'],
  ['gsMs', 'sim/flightmodel/position/groundspeed'],
  ['tasMs', 'sim/flightmodel/position/true_airspeed'],
  ['vs', 'sim/flightmodel/position/vh_ind_fpm'],
  ['hdgMag', 'sim/flightmodel/position/mag_psi'],
  ['hdgTrue', 'sim/flightmodel/position/psi'],
  ['track', 'sim/flightmodel/position/hpath'],
  ['pitch', 'sim/flightmodel/position/theta'],
  ['bank', 'sim/flightmodel/position/phi'],
  ['gForce', 'sim/flightmodel/forces/g_nrml'],
  ['onGround', 'sim/flightmodel/failures/onground_any'],
  ['gear', 'sim/flightmodel2/gear/deploy_ratio[0]'],
  ['flaps', 'sim/cockpit2/controls/flap_handle_deploy_ratio'],
  ['pbrake', 'sim/cockpit2/controls/parking_brake_ratio'],
  ['fuelKg', 'sim/flightmodel/weight/m_fuel_total'],
  ['fuelCapKg', 'sim/aircraft/weight/acf_m_fuel_tot'],
  ['numEng', 'sim/aircraft/engine/acf_num_engines'],
  ['apServos', 'sim/cockpit2/autopilot/servos_on'],
  ['apHdg', 'sim/cockpit2/autopilot/heading_dial_deg_mag_pilot'],
  ['apAlt', 'sim/cockpit2/autopilot/altitude_dial_ft'],
  ['apVs', 'sim/cockpit2/autopilot/vvi_dial_fpm'],
  ['apSpd', 'sim/cockpit2/autopilot/airspeed_dial_kts_mach'],
  ['apHdgMode', 'sim/cockpit2/autopilot/heading_mode'],
  ['apAltMode', 'sim/cockpit2/autopilot/altitude_hold_status'],
  ['com1', 'sim/cockpit2/radios/actuators/com1_frequency_hz_833'],
  ['com1sb', 'sim/cockpit2/radios/actuators/com1_standby_frequency_hz_833'],
  ['com2', 'sim/cockpit2/radios/actuators/com2_frequency_hz_833'],
  ['com2sb', 'sim/cockpit2/radios/actuators/com2_standby_frequency_hz_833'],
  ['nav1', 'sim/cockpit2/radios/actuators/nav1_frequency_hz'],
  ['nav2', 'sim/cockpit2/radios/actuators/nav2_frequency_hz'],
  ['xpdr', 'sim/cockpit2/radios/actuators/transponder_code'],
  ['lNav', 'sim/cockpit2/switches/navigation_lights_on'],
  ['lBeacon', 'sim/cockpit2/switches/beacon_on'],
  ['lStrobe', 'sim/cockpit2/switches/strobe_lights_on'],
  ['lLanding', 'sim/cockpit2/switches/landing_lights_on'],
  ['lTaxi', 'sim/cockpit2/switches/taxi_light_on'],
  ['windMag', 'sim/cockpit2/gauges/indicators/wind_heading_deg_mag'],
  ['windKt', 'sim/cockpit2/gauges/indicators/wind_speed_kts'],
  ['oat', 'sim/cockpit2/temperature/outside_air_temp_degc'],
  ['baro', 'sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot'],
  ['zulu', 'sim/time/zulu_time_sec'],
  ['doy', 'sim/time/local_date_days'],
  ['paused', 'sim/time/paused'],
];
for (let i = 0; i < MAX_ENG; i++) {
  REFS.push([`eRun${i}`, `sim/flightmodel/engine/ENGN_running[${i}]`]);
  REFS.push([`eN1${i}`, `sim/cockpit2/engine/indicators/N1_percent[${i}]`]);
  REFS.push([`eRpm${i}`, `sim/cockpit2/engine/indicators/engine_speed_rpm[${i}]`]);
  REFS.push([`eFf${i}`, `sim/cockpit2/engine/indicators/fuel_flow_kg_sec[${i}]`]);
}
// Aircraft ICAO type code, one byte per dataref.
for (let i = 0; i < 8; i++) REFS.push([`icao${i}`, `sim/aircraft/view/acf_ICAO[${i}]`]);

class XPlaneAdapter extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 49000, rate = 20 } = {}) {
    super();
    this.name = 'xplane';
    this.label = 'X-PLANE 12';
    this.host = host;
    this.port = port;
    this.rate = rate;
    this.values = new Float32Array(REFS.length);
    this.lastData = 0;
    this.connected = false;
  }

  start() {
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => this.emit('log', `X-Plane socket error: ${e.message}`));
    this.sock.on('message', (msg) => this._onMessage(msg));
    this.sock.bind(0, () => this._subscribe(this.rate));
    // Re-subscribe periodically while silent (X-Plane started later or restarted).
    this.timer = setInterval(() => {
      const silent = Date.now() - this.lastData > 3000;
      if (silent) {
        if (this.connected) {
          this.connected = false;
          this.emit('status', false);
        }
        this._subscribe(this.rate);
      }
    }, 2000);
    this.emitTimer = setInterval(() => {
      if (this.connected) this.emit('data', this._normalize());
    }, 1000 / this.rate);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.emitTimer);
    if (this.sock) {
      try { this._subscribe(0); } catch { /* socket may be closed */ }
      const s = this.sock;
      this.sock = null;
      setTimeout(() => { try { s.close(); } catch { /* ignore */ } }, 100);
    }
    this.connected = false;
  }

  _subscribe(freq) {
    if (!this.sock) return;
    REFS.forEach(([, ref], idx) => {
      const buf = Buffer.alloc(413);
      buf.write('RREF\0', 0, 'ascii');
      buf.writeInt32LE(freq, 5);
      buf.writeInt32LE(idx, 9);
      buf.write(ref, 13, 'ascii');
      this.sock.send(buf, this.port, this.host);
    });
  }

  _onMessage(msg) {
    if (msg.length < 5 || msg.toString('ascii', 0, 4) !== 'RREF') return;
    for (let o = 5; o + 8 <= msg.length; o += 8) {
      const idx = msg.readInt32LE(o);
      if (idx >= 0 && idx < REFS.length) this.values[idx] = msg.readFloatLE(o + 4);
    }
    this.lastData = Date.now();
    if (!this.connected) {
      this.connected = true;
      this.emit('status', true);
    }
  }

  _normalize() {
    const v = {};
    REFS.forEach(([k], i) => { v[k] = this.values[i]; });
    const numEngines = Math.max(1, Math.min(MAX_ENG, Math.round(v.numEng) || 1));
    const engines = [];
    let fuelFlow = 0;
    for (let i = 0; i < numEngines; i++) {
      engines.push({ running: v[`eRun${i}`] > 0.5, n1: v[`eN1${i}`], rpm: v[`eRpm${i}`] });
      fuelFlow += Math.max(0, v[`eFf${i}`]) * 3600 * KG2LB;
    }
    let icao = '';
    for (let i = 0; i < 8; i++) {
      const c = Math.round(v[`icao${i}`]);
      if (c <= 0) break;
      icao += String.fromCharCode(c);
    }
    const magVar = v.hdgTrue - v.hdgMag;
    return {
      lat: v.lat, lon: v.lon,
      altFt: v.elevM * M2FT, aglFt: v.aglM * M2FT,
      ias: v.ias, gs: v.gsMs * MS2KT, tas: v.tasMs * MS2KT, vs: v.vs,
      hdgMag: v.hdgMag, hdgTrue: v.hdgTrue, track: v.track,
      pitch: v.pitch, bank: v.bank, gForce: v.gForce,
      onGround: v.onGround > 0.5,
      gear: v.gear, flaps: v.flaps, parkingBrake: v.pbrake > 0.5,
      fuelLb: v.fuelKg * KG2LB, fuelCapLb: v.fuelCapKg * KG2LB, fuelFlowPph: fuelFlow,
      numEngines, engines,
      ap: {
        master: v.apServos > 0.5, hdgSel: v.apHdg, altSel: v.apAlt, vsSel: v.apVs, spdSel: v.apSpd,
        hdgMode: v.apHdgMode > 0, altMode: v.apAltMode > 0,
      },
      com1: v.com1 / 1000, com1sb: v.com1sb / 1000, com2: v.com2 / 1000, com2sb: v.com2sb / 1000,
      nav1: v.nav1 / 100, nav2: v.nav2 / 100,
      xpdr: String(Math.round(v.xpdr)).padStart(4, '0'),
      lights: { nav: v.lNav > 0.5, beacon: v.lBeacon > 0.5, strobe: v.lStrobe > 0.5, landing: v.lLanding > 0.5, taxi: v.lTaxi > 0.5 },
      windDir: ((v.windMag + magVar) % 360 + 360) % 360, windKt: v.windKt,
      oatC: v.oat, baroInHg: v.baro,
      zuluSec: v.zulu, dayOfYear: Math.round(v.doy),
      paused: v.paused > 0.5,
      aircraft: icao || 'X-PLANE AIRCRAFT',
      touchdownFpm: null,
    };
  }
}

module.exports = { XPlaneAdapter, REFS };
