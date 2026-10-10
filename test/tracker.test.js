'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FlightTracker, gradeLanding } = require('../src/server/flight/tracker');
const { JsonStore } = require('../src/server/store');
const { AirportDb } = require('../src/server/geo');
const { decodeSquawk } = require('../src/server/sim/msfs');
const { levelForXp, xpForLevel } = require('../src/server/flight/perks');

test('landing grades', () => {
  assert.strictEqual(gradeLanding(45).grade, 'S');
  assert.strictEqual(gradeLanding(110).grade, 'A');
  assert.strictEqual(gradeLanding(200).grade, 'B');
  assert.strictEqual(gradeLanding(350).grade, 'C');
  assert.strictEqual(gradeLanding(550).grade, 'D');
  assert.strictEqual(gradeLanding(900).grade, 'F');
});

test('squawk decoding handles BCD and decimal', () => {
  assert.strictEqual(decodeSquawk(0x1200), '1200');
  assert.strictEqual(decodeSquawk(0x7700), '7700');
  assert.strictEqual(decodeSquawk(4521), '4521');
});

test('levels', () => {
  assert.strictEqual(levelForXp(0), 1);
  assert.strictEqual(levelForXp(99), 1);
  assert.strictEqual(levelForXp(100), 2);
  assert.strictEqual(levelForXp(xpForLevel(7)), 7);
});

test('airport lookups', () => {
  const db = new AirportDb();
  assert.strictEqual(db.get('ksea').name.includes('Seattle'), true);
  assert.strictEqual(db.get('SEA').ident, 'KSEA');
  const n = db.nearest(47.449, -122.309, { maxNm: 5 })[0];
  assert.strictEqual(n.ident, 'KSEA');
});

function sample(over) {
  return {
    lat: 47.4489, lon: -122.3094, altFt: 433, aglFt: 0, ias: 0, gs: 0, tas: 0, vs: 0,
    hdgMag: 160, hdgTrue: 175, track: 175, pitch: 0, bank: 0, gForce: 1, onGround: true,
    gear: 1, flaps: 0, parkingBrake: false, fuelLb: 10000, fuelCapLb: 20000, fuelFlowPph: 4000,
    numEngines: 2, engines: [{ running: true, n1: 30, rpm: 0 }, { running: true, n1: 30, rpm: 0 }],
    ap: { master: false }, windDir: 175, windKt: 10, zuluSec: 0, dayOfYear: 172, paused: false,
    aircraft: 'TEST', touchdownFpm: null, ...over,
  };
}

test('tracker detects a full flight with a graded landing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-'));
  const tr = new FlightTracker({ store: new JsonStore(dir), airports: new AirportDb() });
  const events = [];
  tr.on('event', (e) => events.push(e));
  tr.setSource('test');
  let z = 1000;
  const feed = (over, secs, hz = 10) => {
    for (let i = 0; i < secs * hz; i++) { z += 1 / hz; tr.ingest(sample({ zuluSec: z, ...over })); }
  };
  feed({}, 2);
  feed({ gs: 15 }, 10);                                  // taxi
  feed({ gs: 140, ias: 140 }, 5);                        // roll
  feed({ onGround: false, aglFt: 2000, altFt: 2400, vs: 1500, ias: 180, gs: 180 }, 60); // climb
  feed({ onGround: false, aglFt: 100, altFt: 533, vs: -150, ias: 140, gs: 140 }, 3);    // flare
  feed({ gs: 120, ias: 120, gForce: 1.3 }, 3);           // touchdown + rollout
  feed({ gs: 0, engines: [{ running: false }, { running: false }] }, 5); // shutdown
  const landing = events.find((e) => e.kind === 'landing');
  assert.ok(landing, 'landing event');
  assert.strictEqual(landing.landing.fpm, 150);
  assert.strictEqual(landing.landing.grade, 'B');
  assert.strictEqual(landing.landing.airport.ident, 'KSEA');
  assert.ok(Math.abs(landing.landing.g - 1.3) < 1e-6);
  assert.ok(events.some((e) => e.kind === 'flightEnd'), 'flight logged');
  assert.ok(events.some((e) => e.kind === 'perk' && e.perk.id === 'first_flight'));
  const snap = tr.snapshot();
  assert.strictEqual(snap.logbook.length, 1);
  assert.strictEqual(snap.logbook[0].departure.ident, 'KSEA');
  assert.strictEqual(snap.profile.flights, 1);
  assert.ok(snap.profile.xp > 0);
});
