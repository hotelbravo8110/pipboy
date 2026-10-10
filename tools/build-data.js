#!/usr/bin/env node
/*
 * Builds the compact map / airport datasets shipped in src/web/data.
 *
 * Sources (both public domain):
 *   - OurAirports           https://github.com/davidmegginson/ourairports-data
 *   - Natural Earth vectors https://github.com/nvkelso/natural-earth-vector
 *
 * Usage: node tools/build-data.js <download-dir>
 * The download dir must contain airports.csv, runways.csv and the
 * ne_50m_*.geojson files. Run without a dir to download them first.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'src', 'web', 'data');
const SOURCES = {
  'airports.csv': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
  'runways.csv': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv',
  'ne_50m_coastline.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson',
  'ne_50m_admin_0_boundary_lines_land.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson',
  'ne_50m_admin_1_states_provinces_lines.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson',
  'ne_50m_lakes.geojson': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson',
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
    }).on('error', reject);
  });
}

// Minimal RFC4180 CSV parser (handles quotes and embedded commas).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r3 = (v) => Math.round(v * 1e3) / 1e3;

function buildAirports(dir) {
  const TYPES = { large_airport: 3, medium_airport: 2, small_airport: 1 };
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'airports.csv'), 'utf8'));
  const airports = [];
  const keep = new Set();
  for (const a of rows) {
    const t = TYPES[a.type];
    if (!t) continue;
    const lat = parseFloat(a.latitude_deg), lon = parseFloat(a.longitude_deg);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const ident = a.icao_code || a.gps_code || a.ident;
    // [ident, name, lat, lon, elevationFt, typeRank, municipality, iata]
    airports.push([ident, a.name, r4(lat), r4(lon), parseInt(a.elevation_ft, 10) || 0, t, a.municipality || '', a.iata_code || '']);
    keep.add(a.ident);
  }
  // Larger airports first so the renderer can draw/label them on top.
  airports.sort((x, y) => y[5] - x[5]);

  const identMap = new Map(rows.filter((a) => keep.has(a.ident)).map((a) => [a.ident, a.icao_code || a.gps_code || a.ident]));
  const rwRows = parseCsv(fs.readFileSync(path.join(dir, 'runways.csv'), 'utf8'));
  const runways = [];
  for (const r of rwRows) {
    if (r.closed === '1' || !identMap.has(r.airport_ident)) continue;
    const a1 = parseFloat(r.le_latitude_deg), o1 = parseFloat(r.le_longitude_deg);
    const a2 = parseFloat(r.he_latitude_deg), o2 = parseFloat(r.he_longitude_deg);
    if (![a1, o1, a2, o2].every(isFinite)) continue;
    // [airportIdent, leIdent, lat1, lon1, heIdent, lat2, lon2, lengthFt, widthFt, surface]
    runways.push([identMap.get(r.airport_ident), r.le_ident, r4(a1), r4(o1), r.he_ident, r4(a2), r4(o2),
      parseInt(r.length_ft, 10) || 0, parseInt(r.width_ft, 10) || 0, (r.surface || '').slice(0, 4).toUpperCase()]);
  }
  return { airports, runways };
}

function buildLines(dir, file, minLen = 0) {
  const gj = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const out = [];
  const push = (coords) => {
    const line = [];
    let prev = null;
    for (const [lon, lat] of coords) {
      const p = [r3(lon), r3(lat)];
      if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
      line.push(p[0], p[1]);
      prev = p;
    }
    if (line.length >= 4 + minLen * 2) out.push(line);
  };
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') push(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(push);
    else if (g.type === 'Polygon') g.coordinates.forEach(push);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach(push));
  }
  return out; // flat [lon,lat,lon,lat,...] arrays
}

async function main() {
  let dir = process.argv[2];
  if (!dir) {
    dir = path.join(__dirname, '.cache');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, url] of Object.entries(SOURCES)) {
      const dest = path.join(dir, name);
      if (fs.existsSync(dest)) continue;
      console.log('downloading', url);
      await download(url, dest);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { airports, runways } = buildAirports(dir);
  fs.writeFileSync(path.join(OUT, 'airports.json'), JSON.stringify(airports));
  fs.writeFileSync(path.join(OUT, 'runways.json'), JSON.stringify(runways));
  const world = {
    coast: buildLines(dir, 'ne_50m_coastline.geojson'),
    borders: buildLines(dir, 'ne_50m_admin_0_boundary_lines_land.geojson'),
    states: buildLines(dir, 'ne_50m_admin_1_states_provinces_lines.geojson'),
    lakes: buildLines(dir, 'ne_50m_lakes.geojson'),
  };
  fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(world));
  for (const f of fs.readdirSync(OUT)) {
    console.log(f.padEnd(16), (fs.statSync(path.join(OUT, f)).size / 1024 / 1024).toFixed(2), 'MB');
  }
  console.log(`${airports.length} airports, ${runways.length} runways`);
}

main().catch((e) => { console.error(e); process.exit(1); });
