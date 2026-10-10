'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { XPlaneAdapter, REFS } = require('../src/server/sim/xplane');

// A fake X-Plane that answers RREF subscriptions like the real simulator.
function fakeXPlane(values) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const subs = new Map();
    sock.on('message', (msg, rinfo) => {
      assert.strictEqual(msg.length, 413, 'RREF request must be 413 bytes');
      assert.strictEqual(msg.toString('ascii', 0, 5), 'RREF\0');
      const freq = msg.readInt32LE(5);
      const idx = msg.readInt32LE(9);
      const ref = msg.toString('ascii', 13).replace(/\0.*$/s, '');
      if (freq > 0) subs.set(idx, ref); else subs.delete(idx);
      const out = Buffer.alloc(5 + subs.size * 8);
      out.write('RREF,', 0, 'ascii');
      let o = 5;
      for (const [i, r] of subs) {
        out.writeInt32LE(i, o);
        out.writeFloatLE(values[r] ?? 0, o + 4);
        o += 8;
      }
      sock.send(out, rinfo.port, rinfo.address);
    });
    sock.bind(0, '127.0.0.1', () => resolve({ sock, port: sock.address().port, subs }));
  });
}

test('X-Plane adapter subscribes and normalises datarefs', async () => {
  const icao = 'B738';
  const values = {
    'sim/flightmodel/position/latitude': 47.45,
    'sim/flightmodel/position/longitude': -122.31,
    'sim/flightmodel/position/elevation': 1000, // metres
    'sim/flightmodel/position/indicated_airspeed': 250,
    'sim/flightmodel/position/groundspeed': 100, // m/s
    'sim/flightmodel/position/vh_ind_fpm': -700,
    'sim/flightmodel/position/mag_psi': 180,
    'sim/flightmodel/position/psi': 195,
    'sim/flightmodel/failures/onground_any': 0,
    'sim/flightmodel/weight/m_fuel_total': 1000,
    'sim/aircraft/weight/acf_m_fuel_tot': 2000,
    'sim/aircraft/engine/acf_num_engines': 2,
    'sim/flightmodel/engine/ENGN_running[0]': 1,
    'sim/flightmodel/engine/ENGN_running[1]': 1,
    'sim/cockpit2/engine/indicators/fuel_flow_kg_sec[0]': 0.5,
    'sim/cockpit2/engine/indicators/fuel_flow_kg_sec[1]': 0.5,
    'sim/cockpit2/radios/actuators/com1_frequency_hz_833': 121500,
    'sim/cockpit2/radios/actuators/nav1_frequency_hz': 11030,
    'sim/cockpit2/radios/actuators/transponder_code': 1200,
    'sim/cockpit2/gauges/indicators/wind_heading_deg_mag': 350,
    'sim/cockpit2/autopilot/servos_on': 1,
  };
  [...icao].forEach((c, i) => { values[`sim/aircraft/view/acf_ICAO[${i}]`] = c.charCodeAt(0); });
  const xp = await fakeXPlane(values);
  const a = new XPlaneAdapter({ host: '127.0.0.1', port: xp.port });
  const sample = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no data')), 3000);
    a.on('data', (d) => { if (d.aircraft === icao) { clearTimeout(to); resolve(d); } });
    a.start();
  });
  assert.strictEqual(xp.subs.size, REFS.length);
  assert.ok(Math.abs(sample.lat - 47.45) < 1e-4);
  assert.ok(Math.abs(sample.altFt - 3280.84) < 0.5);
  assert.ok(Math.abs(sample.gs - 194.38) < 0.1);
  assert.strictEqual(sample.vs, -700);
  assert.strictEqual(sample.onGround, false);
  assert.strictEqual(sample.numEngines, 2);
  assert.ok(Math.abs(sample.fuelFlowPph - 7936.6) < 1);
  assert.ok(Math.abs(sample.fuelLb / sample.fuelCapLb - 0.5) < 1e-6);
  assert.strictEqual(sample.com1, 121.5);
  assert.strictEqual(sample.nav1, 110.3);
  assert.strictEqual(sample.xpdr, '1200');
  assert.strictEqual(sample.windDir, 5); // magnetic 350 + 15 variation
  assert.strictEqual(sample.ap.master, true);
  a.stop();
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(xp.subs.size, 0, 'adapter unsubscribes on stop');
  xp.sock.close();
});
