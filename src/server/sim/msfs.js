'use strict';
/*
 * Microsoft Flight Simulator 2024 (and 2020) adapter using SimConnect.
 *
 * node-simconnect speaks the SimConnect wire protocol directly, so no
 * SimConnect.dll or SDK install is needed. It locates the running simulator
 * through its SimConnect.xml / named pipe automatically.
 */
const { EventEmitter } = require('events');

let sc = null;
try {
  sc = require('node-simconnect');
} catch {
  sc = null;
}

const DEF = 1;
const REQ = 1;
const EVT_PAUSE = 1;
const EVT_SIM = 2;
const MAX_ENG = 4;

// [key, simvar, units]; all read as FLOAT64 except TITLE.
const VARS = [
  ['lat', 'PLANE LATITUDE', 'degrees'],
  ['lon', 'PLANE LONGITUDE', 'degrees'],
  ['altFt', 'PLANE ALTITUDE', 'feet'],
  ['aglFt', 'PLANE ALT ABOVE GROUND', 'feet'],
  ['ias', 'AIRSPEED INDICATED', 'knots'],
  ['gs', 'GROUND VELOCITY', 'knots'],
  ['tas', 'AIRSPEED TRUE', 'knots'],
  ['vs', 'VERTICAL SPEED', 'feet per minute'],
  ['hdgMag', 'PLANE HEADING DEGREES MAGNETIC', 'degrees'],
  ['hdgTrue', 'PLANE HEADING DEGREES TRUE', 'degrees'],
  ['track', 'GPS GROUND TRUE TRACK', 'degrees'],
  ['pitch', 'PLANE PITCH DEGREES', 'degrees'],
  ['bank', 'PLANE BANK DEGREES', 'degrees'],
  ['gForce', 'G FORCE', 'gforce'],
  ['onGround', 'SIM ON GROUND', 'bool'],
  ['gear', 'GEAR TOTAL PCT EXTENDED', 'percent over 100'],
  ['flaps', 'FLAPS HANDLE PERCENT', 'percent over 100'],
  ['pbrake', 'BRAKE PARKING POSITION', 'bool'],
  ['fuelLb', 'FUEL TOTAL QUANTITY WEIGHT', 'pounds'],
  ['fuelCapGal', 'FUEL TOTAL CAPACITY', 'gallons'],
  ['fuelWpg', 'FUEL WEIGHT PER GALLON', 'pounds'],
  ['numEng', 'NUMBER OF ENGINES', 'number'],
  ['apMaster', 'AUTOPILOT MASTER', 'bool'],
  ['apHdg', 'AUTOPILOT HEADING LOCK DIR', 'degrees'],
  ['apAlt', 'AUTOPILOT ALTITUDE LOCK VAR', 'feet'],
  ['apVs', 'AUTOPILOT VERTICAL HOLD VAR', 'feet/minute'],
  ['apSpd', 'AUTOPILOT AIRSPEED HOLD VAR', 'knots'],
  ['apHdgMode', 'AUTOPILOT HEADING LOCK', 'bool'],
  ['apAltMode', 'AUTOPILOT ALTITUDE LOCK', 'bool'],
  ['com1', 'COM ACTIVE FREQUENCY:1', 'MHz'],
  ['com1sb', 'COM STANDBY FREQUENCY:1', 'MHz'],
  ['com2', 'COM ACTIVE FREQUENCY:2', 'MHz'],
  ['com2sb', 'COM STANDBY FREQUENCY:2', 'MHz'],
  ['nav1', 'NAV ACTIVE FREQUENCY:1', 'MHz'],
  ['nav2', 'NAV ACTIVE FREQUENCY:2', 'MHz'],
  ['xpdr', 'TRANSPONDER CODE:1', 'number'],
  ['lNav', 'LIGHT NAV', 'bool'],
  ['lBeacon', 'LIGHT BEACON', 'bool'],
  ['lStrobe', 'LIGHT STROBE', 'bool'],
  ['lLanding', 'LIGHT LANDING', 'bool'],
  ['lTaxi', 'LIGHT TAXI', 'bool'],
  ['windDir', 'AMBIENT WIND DIRECTION', 'degrees'],
  ['windKt', 'AMBIENT WIND VELOCITY', 'knots'],
  ['oat', 'AMBIENT TEMPERATURE', 'celsius'],
  ['baro', 'KOHLSMAN SETTING HG:1', 'inHg'],
  ['zulu', 'ZULU TIME', 'seconds'],
  ['doy', 'ZULU DAY OF YEAR', 'number'],
  ['tdVs', 'PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second'],
];
for (let i = 1; i <= MAX_ENG; i++) {
  VARS.push([`eRun${i}`, `GENERAL ENG COMBUSTION:${i}`, 'bool']);
  VARS.push([`eN1${i}`, `TURB ENG N1:${i}`, 'percent']);
  VARS.push([`eRpm${i}`, `GENERAL ENG RPM:${i}`, 'rpm']);
  VARS.push([`eFf${i}`, `ENG FUEL FLOW PPH:${i}`, 'pounds per hour']);
}

/** MSFS reports the squawk as BCD (e.g. 0x1200 = 4608); accept plain decimal too. */
function decodeSquawk(n) {
  n = Math.round(n || 0);
  const hex = n.toString(16);
  if (/^[0-7]{1,4}$/.test(hex)) return hex.padStart(4, '0');
  return String(n).padStart(4, '0').slice(-4);
}

class MsfsAdapter extends EventEmitter {
  constructor() {
    super();
    this.name = 'msfs';
    this.label = 'MSFS 2024';
    this.connected = false;
    this.paused = false;
    this.handle = null;
    this.stopped = false;
  }

  start() {
    if (!sc) {
      this.emit('log', 'node-simconnect not available; MSFS support disabled');
      return;
    }
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    if (this.handle) {
      try { this.handle.close(); } catch { /* ignore */ }
    }
    this.handle = null;
    this._setConnected(false);
  }

  _setConnected(c) {
    if (c !== this.connected) {
      this.connected = c;
      this.emit('status', c);
    }
  }

  _scheduleRetry() {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this._connect(), 5000);
  }

  async _connect() {
    if (this.stopped || this.handle) return;
    try {
      const { recvOpen, handle } = await sc.open('PIP-PILOT 3000', sc.Protocol.KittyHawk);
      if (this.stopped) { handle.close(); return; }
      this.handle = handle;
      this.label = /2024|sunrise/i.test(recvOpen.applicationName) ? 'MSFS 2024' : (recvOpen.applicationName || 'MSFS').toUpperCase();
      this.emit('log', `Connected to ${recvOpen.applicationName}`);
      this._setup(handle);
      this._setConnected(true);
    } catch (e) {
      this.handle = null;
      this._scheduleRetry();
    }
  }

  _setup(handle) {
    const T = sc.SimConnectDataType;
    handle.addToDataDefinition(DEF, 'TITLE', null, T.STRING256);
    for (const [, name, units] of VARS) handle.addToDataDefinition(DEF, name, units, T.FLOAT64);
    // Every 2nd sim frame (~15-30 Hz depending on frame rate).
    handle.requestDataOnSimObject(REQ, DEF, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SIM_FRAME, 0, 0, 2, 0);
    handle.subscribeToSystemEvent(EVT_PAUSE, 'Pause');
    handle.subscribeToSystemEvent(EVT_SIM, 'Sim');

    handle.on('simObjectData', (recv) => {
      if (recv.requestID !== REQ) return;
      const v = { title: recv.data.readString256() };
      for (const [k] of VARS) v[k] = recv.data.readFloat64();
      this.emit('data', this._normalize(v));
    });
    handle.on('event', (e) => {
      if (e.clientEventId === EVT_PAUSE) this.paused = e.data === 1;
    });
    handle.on('exception', (e) => this.emit('log', `SimConnect exception ${e.exception} (packet ${e.sendId})`));
    const onClose = () => {
      this.handle = null;
      this._setConnected(false);
      this._scheduleRetry();
    };
    handle.on('quit', onClose);
    handle.on('close', onClose);
    handle.on('error', onClose);
  }

  _normalize(v) {
    const numEngines = Math.max(1, Math.min(MAX_ENG, Math.round(v.numEng) || 1));
    const engines = [];
    let fuelFlow = 0;
    for (let i = 1; i <= numEngines; i++) {
      engines.push({ running: v[`eRun${i}`] > 0.5, n1: v[`eN1${i}`], rpm: v[`eRpm${i}`] });
      fuelFlow += Math.max(0, v[`eFf${i}`]);
    }
    return {
      lat: v.lat, lon: v.lon, altFt: v.altFt, aglFt: v.aglFt,
      ias: v.ias, gs: v.gs, tas: v.tas, vs: v.vs,
      hdgMag: v.hdgMag, hdgTrue: v.hdgTrue, track: v.track,
      // SimConnect pitch/bank are positive nose-down / left-wing-down.
      pitch: -v.pitch, bank: -v.bank, gForce: v.gForce,
      onGround: v.onGround > 0.5,
      gear: v.gear, flaps: v.flaps, parkingBrake: v.pbrake > 0.5,
      fuelLb: v.fuelLb, fuelCapLb: v.fuelCapGal * (v.fuelWpg || 6.7), fuelFlowPph: fuelFlow,
      numEngines, engines,
      ap: {
        master: v.apMaster > 0.5, hdgSel: v.apHdg, altSel: v.apAlt, vsSel: v.apVs, spdSel: v.apSpd,
        hdgMode: v.apHdgMode > 0.5, altMode: v.apAltMode > 0.5,
      },
      com1: v.com1, com1sb: v.com1sb, com2: v.com2, com2sb: v.com2sb, nav1: v.nav1, nav2: v.nav2,
      xpdr: decodeSquawk(v.xpdr),
      lights: { nav: v.lNav > 0.5, beacon: v.lBeacon > 0.5, strobe: v.lStrobe > 0.5, landing: v.lLanding > 0.5, taxi: v.lTaxi > 0.5 },
      windDir: v.windDir, windKt: v.windKt, oatC: v.oat, baroInHg: v.baro,
      zuluSec: v.zulu, dayOfYear: Math.round(v.doy),
      paused: this.paused,
      aircraft: (v.title || 'MSFS AIRCRAFT').toUpperCase(),
      touchdownFpm: v.tdVs ? Math.abs(v.tdVs) * 60 : null,
    };
  }
}

module.exports = { MsfsAdapter, decodeSquawk, available: !!sc };
