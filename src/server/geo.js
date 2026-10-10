'use strict';
const fs = require('fs');
const path = require('path');

const R_NM = 3440.065;
const D2R = Math.PI / 180;

function distanceNm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * D2R) * Math.cos(lat2 * D2R);
  const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) -
    Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon2 - lon1) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/** Approximate solar elevation (degrees) for a position and UTC time. */
function solarElevation(lat, lon, dayOfYear, zuluSeconds) {
  const decl = -23.44 * Math.cos(((360 / 365) * (dayOfYear + 10)) * D2R);
  const solarHour = zuluSeconds / 3600 + lon / 15;
  const hourAngle = (solarHour - 12) * 15;
  const s = Math.sin(lat * D2R) * Math.sin(decl * D2R) +
    Math.cos(lat * D2R) * Math.cos(decl * D2R) * Math.cos(hourAngle * D2R);
  return Math.asin(Math.max(-1, Math.min(1, s))) / D2R;
}

/** Airport database with a 1x1 degree grid index for nearest lookups. */
class AirportDb {
  constructor(file = path.join(__dirname, '..', 'web', 'data', 'airports.json')) {
    this.list = [];
    this.byIdent = new Map();
    this.grid = new Map();
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [ident, name, lat, lon, elev, rank, city, iata] of rows) {
        const a = { ident, name, lat, lon, elev, rank, city, iata };
        this.list.push(a);
        if (!this.byIdent.has(ident)) this.byIdent.set(ident, a);
        if (iata && !this.byIdent.has(iata)) this.byIdent.set(iata, a);
        const k = this._key(lat, lon);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(a);
      }
    } catch (e) {
      console.warn('[geo] airport database unavailable:', e.message);
    }
  }

  _key(lat, lon) { return `${Math.floor(lat)},${Math.floor(lon)}`; }

  get(ident) { return ident ? this.byIdent.get(String(ident).toUpperCase().trim()) || null : null; }

  /** Nearest airports to a point, optionally filtered by minimum size rank. */
  nearest(lat, lon, { count = 1, minRank = 1, maxNm = 60 } = {}) {
    const found = [];
    const la = Math.floor(lat), lo = Math.floor(lon);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let x = lo + dx;
        if (x < -180) x += 360; else if (x >= 180) x -= 360;
        const cell = this.grid.get(`${la + dy},${x}`);
        if (!cell) continue;
        for (const a of cell) {
          if (a.rank < minRank) continue;
          const d = distanceNm(lat, lon, a.lat, a.lon);
          if (d <= maxNm) found.push({ ...a, distNm: d });
        }
      }
    }
    found.sort((p, q) => p.distNm - q.distNm);
    return found.slice(0, count);
  }

  search(query, limit = 12) {
    const q = String(query || '').toUpperCase().trim();
    if (!q) return [];
    const out = [];
    const exact = this.get(q);
    if (exact) out.push(exact);
    for (const a of this.list) {
      if (out.length >= limit) break;
      if (a === exact) continue;
      if (a.ident.startsWith(q) || a.name.toUpperCase().includes(q) || a.city.toUpperCase().includes(q)) out.push(a);
    }
    return out;
  }
}

module.exports = { distanceNm, bearingDeg, solarElevation, AirportDb, D2R };
