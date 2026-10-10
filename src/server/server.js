'use strict';
/*
 * Local companion server: serves the UI, streams telemetry over WebSocket and
 * proxies radio streams (so the browser audio analyser works cross-origin).
 * The Electron app embeds it; it can also run standalone (see standalone.js)
 * so phones / tablets on the LAN can be used as a second screen.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const { JsonStore } = require('./store');
const { AirportDb, distanceNm, bearingDeg } = require('./geo');
const { SimManager } = require('./sim/manager');
const { FlightTracker } = require('./flight/tracker');

const WEB_ROOT = path.join(__dirname, '..', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};

const SETTINGS_DEFAULT = {
  sim: 'auto',
  xplaneHost: '127.0.0.1',
  xplanePort: 49000,
  port: 8155,
  lanAccess: false,
  demoSpeed: 1,
  stations: [
    { id: 'lounge', name: 'Illinois Street Lounge', note: 'Classic bachelor-pad lounge & exotica', url: 'https://ice1.somafm.com/illstreet-128-mp3' },
    { id: 'secret', name: 'Secret Agent', note: 'Spy-movie soundtrack for cruising altitude', url: 'https://ice1.somafm.com/secretagent-128-mp3' },
    { id: 'groove', name: 'Groove Salad', note: 'Ambient downtempo for long hauls', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  ],
};

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
    }
  }
  return out;
}

class PipServer extends EventEmitter {
  constructor({ dataDir, overrides = {} }) {
    super();
    this.store = new JsonStore(dataDir);
    this.settings = { ...this.store.load('settings', SETTINGS_DEFAULT), ...overrides };
    this.airports = new AirportDb();
    this.tracker = new FlightTracker({ store: this.store, airports: this.airports });
    this.sim = new SimManager(this.settings);
    this.clients = new Set();
    this.latest = null;
    this.nearest = null;
    this.lastNearestAt = 0;

    this.sim.on('telemetry', (t) => {
      this.tracker.ingest(t);
      this.latest = t;
    });
    this.sim.on('source', (s) => {
      this.tracker.setSource(s.source);
      this.broadcast({ t: 'source', d: s });
      if (!s.source) this.latest = null;
    });
    this.sim.on('log', (m) => console.log('[sim]', m));
    this.tracker.on('change', () => this._scheduleState());
    this.tracker.on('event', (e) => this.broadcast({ t: 'event', d: e }));
  }

  async start() {
    this.sim.start();
    await this._listen();
    this.telemetryTimer = setInterval(() => this._pushTelemetry(), 1000 / 15);
    return this.url;
  }

  async stop() {
    clearInterval(this.telemetryTimer);
    this.sim.stop();
    this.store.flush();
    for (const c of this.clients) c.terminate();
    await new Promise((r) => (this.http ? this.http.close(() => r()) : r()));
  }

  _listen() {
    const host = this.settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
    const base = Number(this.settings.port) || 8155;
    return new Promise((resolve, reject) => {
      const tryPort = (port, attempts) => {
        const srv = http.createServer((req, res) => this._onRequest(req, res));
        srv.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && attempts > 0) tryPort(port + 1, attempts - 1);
          else reject(e);
        });
        srv.listen(port, host, () => {
          this.http = srv;
          this.port = port;
          this.url = `http://127.0.0.1:${port}`;
          this.wss = new WebSocketServer({ server: srv, path: '/ws' });
          this.wss.on('connection', (ws) => this._onSocket(ws));
          console.log(`[server] listening on ${host}:${port}`);
          resolve();
        });
      };
      tryPort(base, 10);
    });
  }

  async restartHttp() {
    for (const c of this.clients) c.terminate();
    await new Promise((r) => this.http.close(() => r()));
    await this._listen();
  }

  // ---- HTTP ---------------------------------------------------------------

  _onRequest(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/search') return this._json(res, this.airports.search(url.searchParams.get('q')));
    if (url.pathname === '/api/state') return this._json(res, this._fullState(true));
    if (url.pathname.startsWith('/radio/')) return this._radio(req, res, decodeURIComponent(url.pathname.slice(7)));
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(WEB_ROOT, rel));
    if (!file.startsWith(WEB_ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': rel.startsWith('/data/') ? 'max-age=86400' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  _json(res, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
  }

  /** Proxy one of the configured stations (never arbitrary URLs). */
  _radio(req, res, id) {
    const st = (this.settings.stations || []).find((s) => s.id === id);
    if (!st) { res.writeHead(404); return res.end(); }
    let upstream;
    const fetchUrl = (u, hops) => {
      let lib;
      try { lib = new URL(u).protocol === 'http:' ? http : https; } catch { res.writeHead(400); return res.end(); }
      upstream = lib.get(u, { headers: { 'User-Agent': 'PIP-PILOT-3000', 'Icy-MetaData': '0' } }, (up) => {
        if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && hops > 0) {
          up.resume();
          return fetchUrl(new URL(up.headers.location, u).toString(), hops - 1);
        }
        res.writeHead(up.statusCode || 502, { 'Content-Type': up.headers['content-type'] || 'audio/mpeg', 'Cache-Control': 'no-cache' });
        up.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    };
    fetchUrl(st.url, 5);
    req.on('close', () => upstream && upstream.destroy());
  }

  // ---- WebSocket ----------------------------------------------------------

  _onSocket(ws) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this._onClientMessage(ws, msg);
    });
    this._send(ws, { t: 'hello', d: this._fullState(true) });
  }

  _onClientMessage(ws, { t, d }) {
    switch (t) {
      case 'destination':
        this.tracker.setDestination(d && d.ident);
        break;
      case 'callsign':
        this.tracker.setCallsign(d && d.name);
        break;
      case 'resetProfile':
        this.tracker.resetProfile();
        break;
      case 'settings':
        this._applySettings(d || {});
        break;
      case 'demo':
        this._applySettings({ sim: 'demo' });
        break;
      default:
        break;
    }
  }

  async _applySettings(patch) {
    const allowed = ['sim', 'xplaneHost', 'xplanePort', 'lanAccess', 'demoSpeed', 'stations', 'port'];
    const prev = { ...this.settings };
    for (const k of allowed) if (k in patch) this.settings[k] = patch[k];
    if (Array.isArray(this.settings.stations)) {
      this.settings.stations = this.settings.stations
        .filter((s) => s && /^https?:\/\//i.test(s.url || ''))
        .map((s, i) => ({ id: String(s.id || `st${i}`).replace(/[^\w-]/g, '').slice(0, 24) || `st${i}`, name: String(s.name || 'Station').slice(0, 40), note: String(s.note || '').slice(0, 80), url: String(s.url) }));
    }
    this.store.save('settings', this.settings, 0);
    const simChanged = ['sim', 'xplaneHost', 'xplanePort', 'demoSpeed'].some((k) => prev[k] !== this.settings[k]);
    if (simChanged) {
      this.sim.configure(this.settings);
      this.sim.start();
    }
    this.broadcast({ t: 'settings', d: this._publicSettings() });
    if (prev.lanAccess !== this.settings.lanAccess || prev.port !== this.settings.port) {
      setTimeout(() => this.restartHttp().catch((e) => console.error(e)), 200);
    }
  }

  _publicSettings() {
    return { ...this.settings, lanUrls: this.settings.lanAccess ? lanAddresses(this.port) : [], port: this.port };
  }

  _fullState(withTrack) {
    return {
      settings: this._publicSettings(),
      source: this.sim.status(),
      state: this.tracker.snapshot({ withTrack }),
    };
  }

  _scheduleState() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.broadcast({ t: 'state', d: this.tracker.snapshot() });
    }, 150);
  }

  _pushTelemetry() {
    const t = this.latest;
    if (!t || !this.clients.size) return;
    const now = Date.now();
    if (now - this.lastNearestAt > 2000) {
      this.lastNearestAt = now;
      const n = this.airports.nearest(t.lat, t.lon, { count: 1, maxNm: 80, minRank: 1 })[0];
      this.nearest = n ? { ident: n.ident, name: n.name, distNm: n.distNm, brg: bearingDeg(t.lat, t.lon, n.lat, n.lon) } : null;
    }
    const dest = this.tracker.profile.destination;
    let nav = null;
    if (dest) {
      const d = distanceNm(t.lat, t.lon, dest.lat, dest.lon);
      const eteSec = t.gs > 30 ? (d / t.gs) * 3600 : null;
      nav = {
        ident: dest.ident, distNm: d, brg: bearingDeg(t.lat, t.lon, dest.lat, dest.lon), eteSec,
        fuelAtArrLb: eteSec !== null && t.fuelFlowPph > 0 ? t.fuelLb - (t.fuelFlowPph * eteSec) / 3600 : null,
      };
    }
    const { _wall, ...clean } = t;
    this.broadcast({ t: 'tel', d: { ...clean, phase: this.tracker.phase, nearest: this.nearest, nav } });
  }

  _send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === 1) c.send(s);
  }
}

module.exports = { PipServer, SETTINGS_DEFAULT };
