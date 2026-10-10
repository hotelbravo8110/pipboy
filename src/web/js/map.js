// Vector moving map rendered on a canvas with an orthographic projection.
// Because the projection is a true globe, zooming out smoothly turns the local
// map into a spinning planet and zooming in goes all the way to runways.

const R_NM = 3440.065;
const D2R = Math.PI / 180;
const MIN_PPN = 0.00005; // px per nm (clamped to globe-fit at runtime)
const MAX_PPN = 600;

function toXYZ(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

export function movePoint(lat, lon, brgDeg, distNm) {
  const d = distNm / R_NM, b = brgDeg * D2R, la1 = lat * D2R, lo1 = lon * D2R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 / D2R, ((lo2 / D2R + 540) % 360) - 180];
}

function packLines(lines) {
  let n = 0;
  for (const l of lines) n += l.length / 2;
  const xyz = new Float32Array(n * 3);
  const starts = new Int32Array(lines.length + 1);
  let i = 0;
  lines.forEach((l, li) => {
    starts[li] = i;
    for (let k = 0; k < l.length; k += 2) {
      const [x, y, z] = toXYZ(l[k + 1], l[k]);
      xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z;
      i++;
    }
  });
  starts[lines.length] = i;
  return { xyz, starts, count: lines.length };
}

export class VectorMap {
  constructor(canvas, { onSelect, onViewChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.onViewChange = onViewChange || (() => {});
    this.center = { lat: 47.5, lon: -122.3 };
    this.ppn = 0.001;
    this.targetPpn = 0.001;
    this.follow = true;
    this.aircraft = null;
    this.drawPos = null;
    this.trail = [];
    this.history = [];
    this.destination = null;
    this.rangeNm = null;
    this.selected = null;
    this.visited = new Set();
    this.layers = null;
    this.airports = null;
    this.runways = null;
    this.hits = [];
    this.running = false;
    this.t0 = performance.now();
    this._bindInput();
  }

  async load() {
    const [world, airports, runways] = await Promise.all([
      fetch('data/world.json').then((r) => r.json()),
      fetch('data/airports.json').then((r) => r.json()),
      fetch('data/runways.json').then((r) => r.json()),
    ]);
    this.layers = {
      coast: packLines(world.coast),
      lakes: packLines(world.lakes),
      borders: packLines(world.borders),
      states: packLines(world.states),
    };
    const n = airports.length;
    const a = { xyz: new Float32Array(n * 3), rank: new Uint8Array(n), info: airports, byIdent: new Map() };
    airports.forEach((ap, i) => {
      const [x, y, z] = toXYZ(ap[2], ap[3]);
      a.xyz[i * 3] = x; a.xyz[i * 3 + 1] = y; a.xyz[i * 3 + 2] = z;
      a.rank[i] = ap[5];
      if (!a.byIdent.has(ap[0])) a.byIdent.set(ap[0], i);
    });
    this.airports = a;
    const rw = { xyz: new Float32Array(runways.length * 6), info: runways, byAirport: new Map() };
    runways.forEach((r, i) => {
      const p1 = toXYZ(r[2], r[3]);
      const p2 = toXYZ(r[5], r[6]);
      rw.xyz.set(p1, i * 6);
      rw.xyz.set(p2, i * 6 + 3);
      if (!rw.byAirport.has(r[0])) rw.byAirport.set(r[0], []);
      rw.byAirport.get(r[0]).push(r);
    });
    this.runways = rw;
  }

  airportInfo(ident) {
    if (!this.airports) return null;
    const i = this.airports.byIdent.get(ident);
    if (i === undefined) return null;
    const [id, name, lat, lon, elev, rank, city, iata] = this.airports.info[i];
    return { ident: id, name, lat, lon, elev, rank, city, iata, runways: this.runways.byAirport.get(id) || [] };
  }

  // ---- state setters ------------------------------------------------------
  setColors(rgb) { this.rgb = rgb; }
  setAircraft(a) {
    this.aircraft = a;
    if (!this.drawPos && a) this.drawPos = { lat: a.lat, lon: a.lon, hdg: a.hdg };
  }
  setTrail(points) { this.trail = (points || []).map((p) => [p[0], p[1]]); }
  addTrail(lat, lon) {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.abs(last[0] - lat) + Math.abs(last[1] - lon) > 0.004) {
      this.trail.push([lat, lon]);
      if (this.trail.length > 5000) this.trail.splice(0, 1000);
    }
  }
  setHistory(tracks) { this.history = tracks || []; }
  setDestination(d) { this.destination = d; }
  setRange(nm) { this.rangeNm = nm; }
  setSelected(a) { this.selected = a; }
  setVisited(list) { this.visited = new Set(list || []); }

  globePpn() {
    const { w, h } = this._size();
    return (Math.min(w, h) * 0.42) / R_NM;
  }

  zoomBy(f) {
    this.targetPpn = Math.max(this.globePpn() * 0.9, Math.min(MAX_PPN, this.targetPpn * f));
  }
  zoomTo(ppn, instant = false) {
    this.targetPpn = Math.max(this.globePpn() * 0.9, Math.min(MAX_PPN, ppn));
    if (instant) this.ppn = this.targetPpn;
  }
  recenter() { this.follow = true; }
  pan(dxPx, dyPx) {
    this.follow = false;
    const lat = this.center.lat;
    this.center.lat = Math.max(-89, Math.min(89, lat + dyPx / (this.ppn * 60)));
    this.center.lon = ((this.center.lon - dxPx / (this.ppn * 60 * Math.max(0.1, Math.cos(lat * D2R))) + 540) % 360) - 180;
    this.onViewChange();
  }

  /** Visible radius in nm, rounded for the scale readout. */
  viewRadiusNm() {
    const { w, h } = this._size();
    return Math.min(w, h) / 2 / this.ppn;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }

  // ---- input --------------------------------------------------------------
  _bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved > 4) this.pan(dx, dy);
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && drag.moved <= 4) this._click(e);
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.35 : 1 / 1.35);
      this.onViewChange();
    }, { passive: false });
  }

  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 16 * 16;
    for (const hit of this.hits) {
      const d = (hit.x - x) ** 2 + (hit.y - y) ** 2;
      if (d < bd) { bd = d; best = hit; }
    }
    this.onSelect(best ? this.airportInfo(best.ident) : null);
  }

  // ---- rendering ----------------------------------------------------------
  _size() {
    return { w: this.canvas.clientWidth || 1, h: this.canvas.clientHeight || 1 };
  }

  _frame() {
    const { w, h } = this._size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.layers) {
      this._loading(ctx, w, h);
      return;
    }

    // Smooth aircraft position and camera.
    const a = this.aircraft;
    if (a && this.drawPos) {
      const k = 0.25;
      this.drawPos.lat += (a.lat - this.drawPos.lat) * k;
      let dLon = a.lon - this.drawPos.lon;
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      this.drawPos.lon += dLon * k;
      let dh = ((a.hdg - this.drawPos.hdg + 540) % 360) - 180;
      this.drawPos.hdg = (this.drawPos.hdg + dh * k + 360) % 360;
    }
    if (this.follow && this.drawPos) {
      const k = 0.15;
      this.center.lat += (this.drawPos.lat - this.center.lat) * k;
      let dLon = this.drawPos.lon - this.center.lon;
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      this.center.lon += dLon * k;
    }
    const minP = this.globePpn() * 0.9;
    if (this.targetPpn < minP) this.targetPpn = minP;
    this.ppn = Math.exp(Math.log(this.ppn) + (Math.log(this.targetPpn) - Math.log(this.ppn)) * 0.12);
    if (Math.abs(this.ppn / this.targetPpn - 1) < 0.001) this.ppn = this.targetPpn;

    const la = this.center.lat * D2R, lo = this.center.lon * D2R;
    const cv = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const ev = [-Math.sin(lo), Math.cos(lo), 0];
    const nv = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const R = R_NM * this.ppn;
    const cx = w / 2, cy = h / 2;
    const viewAng = Math.hypot(w, h) / 2 / R;
    const minDot = viewAng >= Math.PI / 2 ? 0 : Math.max(0, Math.cos(Math.min(Math.PI / 2, viewAng + 0.004)));
    this.proj = { cv, ev, nv, R, cx, cy, minDot };
    const rgb = this.rgb || '26,255,128';
    const col = (al) => `rgba(${rgb},${al})`;
    const t = (performance.now() - this.t0) / 1000;

    // Globe disc + atmosphere
    const globeVisible = R < Math.hypot(w, h);
    if (globeVisible) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.12);
      g.addColorStop(0, col(0.06));
      g.addColorStop(0.89, col(0.10));
      g.addColorStop(0.9, col(0.35));
      g.addColorStop(1, col(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col(0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }

    this._graticule(ctx, col);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this._lines(ctx, this.layers.states, col(this.ppn > 0.02 ? 0.22 : 0.1), 0.8, [3, 4]);
    this._lines(ctx, this.layers.borders, col(0.4), 1, [6, 3]);
    this._lines(ctx, this.layers.lakes, col(0.55), 1);
    this._lines(ctx, this.layers.coast, col(0.95), 1.4);

    this._historyTracks(ctx, col);
    if (this.ppn > 3) this._runways(ctx, col);
    this._airports(ctx, col);
    this._range(ctx, col);
    this._destination(ctx, col, t);
    this._trail(ctx, col);
    this._aircraft(ctx, col, t);
    this._selection(ctx, col, t);
  }

  _p(x, y, z) {
    const { cv, ev, nv, R, cx, cy, minDot } = this.proj;
    const d = x * cv[0] + y * cv[1] + z * cv[2];
    if (d < minDot) return null;
    return [cx + (x * ev[0] + y * ev[1] + z * ev[2]) * R, cy - (x * nv[0] + y * nv[1] + z * nv[2]) * R];
  }

  _pLL(lat, lon) {
    const [x, y, z] = toXYZ(lat, lon);
    return this._p(x, y, z);
  }

  _lines(ctx, layer, style, width, dash) {
    const { xyz, starts, count } = layer;
    const { cv, ev, nv, R, cx, cy, minDot } = this.proj;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let li = 0; li < count; li++) {
      let pen = false;
      for (let i = starts[li]; i < starts[li + 1]; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        const d = x * cv[0] + y * cv[1] + z * cv[2];
        if (d < minDot) { pen = false; continue; }
        const sx = cx + (x * ev[0] + y * ev[1] + z * ev[2]) * R;
        const sy = cy - (x * nv[0] + y * nv[1] + z * nv[2]) * R;
        if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _graticule(ctx, col) {
    let step;
    if (this.ppn < 0.01) step = 15;
    else if (this.ppn < 0.08) step = 5;
    else if (this.ppn < 1.5) step = 1;
    else return;
    ctx.strokeStyle = col(0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const seg = Math.min(step, 2);
    for (let lat = -90 + step; lat < 90; lat += step) {
      let pen = false;
      for (let lon = -180; lon <= 180; lon += seg) {
        const p = this._pLL(lat, lon);
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
      }
    }
    for (let lon = -180; lon < 180; lon += step) {
      let pen = false;
      for (let lat = -88; lat <= 88; lat += seg) {
        const p = this._pLL(lat, lon);
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
      }
    }
    ctx.stroke();
  }

  _airports(ctx, col) {
    const A = this.airports;
    const ppn = this.ppn;
    const minRank = ppn > 2.5 ? 1 : ppn > 0.35 ? 2 : ppn > 0.12 ? 3 : 4;
    const labelRank = ppn > 9 ? 1 : ppn > 1.5 ? 2 : ppn > 0.45 ? 3 : 4;
    this.hits = [];
    const { w, h } = this._size();
    if (minRank > 3) {
      // Globe view: only hubs as tiny dots, plus visited airports highlighted.
      ctx.fillStyle = col(0.5);
      for (let i = 0; i < A.rank.length && A.rank[i] === 3; i++) {
        const p = this._p(A.xyz[i * 3], A.xyz[i * 3 + 1], A.xyz[i * 3 + 2]);
        if (p) ctx.fillRect(p[0] - 0.75, p[1] - 0.75, 1.5, 1.5);
      }
      ctx.fillStyle = col(1);
      for (const ident of this.visited) {
        const i = A.byIdent.get(ident);
        if (i === undefined) continue;
        const p = this._p(A.xyz[i * 3], A.xyz[i * 3 + 1], A.xyz[i * 3 + 2]);
        if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill(); }
      }
      return;
    }
    ctx.font = `${ppn > 9 ? 13 : 11}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const labels = [];
    for (let i = 0; i < A.rank.length; i++) {
      const r = A.rank[i];
      if (r < minRank) break; // sorted by rank descending
      const p = this._p(A.xyz[i * 3], A.xyz[i * 3 + 1], A.xyz[i * 3 + 2]);
      if (!p || p[0] < -20 || p[1] < -20 || p[0] > w + 20 || p[1] > h + 20) continue;
      const info = A.info[i];
      const visited = this.visited.has(info[0]);
      ctx.strokeStyle = col(r === 3 ? 1 : r === 2 ? 0.85 : 0.6);
      ctx.lineWidth = r === 3 ? 1.6 : 1.2;
      const rad = r === 3 ? 5 : r === 2 ? 3.6 : 2.4;
      ctx.beginPath();
      ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
      ctx.stroke();
      if (r === 3) {
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const an = (k * Math.PI) / 2;
          ctx.moveTo(p[0] + Math.cos(an) * rad, p[1] + Math.sin(an) * rad);
          ctx.lineTo(p[0] + Math.cos(an) * (rad + 3), p[1] + Math.sin(an) * (rad + 3));
        }
        ctx.stroke();
      }
      if (visited) {
        ctx.fillStyle = col(0.9);
        ctx.beginPath();
        ctx.arc(p[0], p[1], rad * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      this.hits.push({ x: p[0], y: p[1], ident: info[0] });
      if (r >= labelRank) labels.push([info[0], p[0] + rad + 4, p[1], r]);
    }
    // labels after symbols, skipping overlaps
    const placed = [];
    for (const [txt, x, y, r] of labels) {
      if (placed.some(([px, py]) => Math.abs(px - x) < 40 && Math.abs(py - y) < 12)) continue;
      placed.push([x, y]);
      ctx.fillStyle = col(r === 3 ? 1 : 0.75);
      ctx.fillText(txt, x, y);
      if (placed.length > 250) break;
    }
  }

  _runways(ctx, col) {
    const RW = this.runways;
    const { w, h } = this._size();
    const ppn = this.ppn;
    ctx.lineCap = 'butt';
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < RW.info.length; i++) {
      const o = i * 6;
      const p1 = this._p(RW.xyz[o], RW.xyz[o + 1], RW.xyz[o + 2]);
      if (!p1) continue;
      const p2 = this._p(RW.xyz[o + 3], RW.xyz[o + 4], RW.xyz[o + 5]);
      if (!p2) continue;
      if (Math.max(p1[0], p2[0]) < 0 || Math.min(p1[0], p2[0]) > w || Math.max(p1[1], p2[1]) < 0 || Math.min(p1[1], p2[1]) > h) continue;
      const r = RW.info[i];
      const width = Math.max(1.5, (r[8] / 6076) * ppn);
      ctx.strokeStyle = col(0.9);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
      if (ppn > 40) {
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        ctx.fillStyle = col(1);
        ctx.fillText(r[1], p1[0] - ux * 14, p1[1] - uy * 14);
        ctx.fillText(r[4], p2[0] + ux * 14, p2[1] + uy * 14);
        if (width > 6) {
          // centreline dashes
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = Math.max(1, width / 10);
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(p1[0] + ux * 10, p1[1] + uy * 10);
          ctx.lineTo(p2[0] - ux * 10, p2[1] - uy * 10);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.lineCap = 'round';
  }

  _polyLL(ctx, pts) {
    let pen = false;
    ctx.beginPath();
    for (const [lat, lon] of pts) {
      const p = this._pLL(lat, lon);
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.stroke();
  }

  _historyTracks(ctx, col) {
    if (!this.history.length) return;
    ctx.strokeStyle = col(0.3);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    for (const tr of this.history) this._polyLL(ctx, tr);
    ctx.setLineDash([]);
  }

  _trail(ctx, col) {
    if (this.trail.length < 1) return;
    const pts = this.drawPos ? [...this.trail, [this.drawPos.lat, this.drawPos.lon]] : this.trail;
    ctx.strokeStyle = col(0.75);
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    this._polyLL(ctx, pts);
  }

  _gcPoints(lat1, lon1, lat2, lon2, n = 64) {
    const a = toXYZ(lat1, lon1), b = toXYZ(lat2, lon2);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const om = Math.acos(dot);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      let x, y, z;
      if (om < 1e-6) { [x, y, z] = a; } else {
        const s1 = Math.sin((1 - f) * om) / Math.sin(om), s2 = Math.sin(f * om) / Math.sin(om);
        x = s1 * a[0] + s2 * b[0]; y = s1 * a[1] + s2 * b[1]; z = s1 * a[2] + s2 * b[2];
      }
      out.push([Math.asin(z) / D2R, Math.atan2(y, x) / D2R]);
    }
    return out;
  }

  _destination(ctx, col, t) {
    const d = this.destination;
    if (!d) return;
    const p = this._pLL(d.lat, d.lon);
    if (this.drawPos) {
      ctx.strokeStyle = col(0.8);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 20;
      this._polyLL(ctx, this._gcPoints(this.drawPos.lat, this.drawPos.lon, d.lat, d.lon));
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    if (p) {
      const s = 9 + Math.sin(t * 4) * 2;
      ctx.strokeStyle = col(1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - s); ctx.lineTo(p[0] + s, p[1]); ctx.lineTo(p[0], p[1] + s); ctx.lineTo(p[0] - s, p[1]); ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = col(1);
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`◆ ${d.ident}`, p[0] + 14, p[1] - 12);
    }
  }

  _range(ctx, col) {
    if (!this.rangeNm || !this.drawPos || this.rangeNm < 1) return;
    const pts = [];
    for (let b = 0; b <= 360; b += 4) pts.push(movePoint(this.drawPos.lat, this.drawPos.lon, b, this.rangeNm));
    ctx.strokeStyle = col(0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    this._polyLL(ctx, pts);
    ctx.setLineDash([]);
    const top = this._pLL(pts[0][0], pts[0][1]);
    if (top) {
      ctx.fillStyle = col(0.6);
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`FUEL RANGE ${Math.round(this.rangeNm)} NM`, top[0], top[1] - 8);
    }
  }

  _aircraft(ctx, col, t) {
    if (!this.drawPos) return;
    const p = this._pLL(this.drawPos.lat, this.drawPos.lon);
    if (!p) return;
    const { w, h } = this._size();
    // radar sweep (local views only)
    if (ctx.createConicGradient && this.ppn > 0.3) {
      const rad = Math.min(w, h) * 0.48;
      const ang = (t * 1.2) % (Math.PI * 2);
      const g = ctx.createConicGradient(ang - Math.PI / 2, p[0], p[1]);
      g.addColorStop(0, col(0.16));
      g.addColorStop(0.12, col(0));
      g.addColorStop(1, col(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // pulse ring
    const pr = (t % 2) / 2;
    ctx.strokeStyle = col(0.6 * (1 - pr));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 8 + pr * 34, 0, Math.PI * 2);
    ctx.stroke();
    // plane
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(this.drawPos.hdg * D2R);
    const sc = 1.1;
    ctx.scale(sc, sc);
    ctx.shadowColor = col(1);
    ctx.shadowBlur = 10;
    ctx.fillStyle = col(1);
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(2, -9); ctx.lineTo(2, -3); ctx.lineTo(13, 3); ctx.lineTo(13, 6); ctx.lineTo(2, 3);
    ctx.lineTo(2, 9); ctx.lineTo(6, 12); ctx.lineTo(6, 14); ctx.lineTo(0, 12.5); ctx.lineTo(-6, 14); ctx.lineTo(-6, 12);
    ctx.lineTo(-2, 9); ctx.lineTo(-2, 3); ctx.lineTo(-13, 6); ctx.lineTo(-13, 3); ctx.lineTo(-2, -3); ctx.lineTo(-2, -9);
    ctx.closePath();
    ctx.fill();
    // heading line
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col(0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, -Math.min(w, h) * 0.3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _selection(ctx, col, t) {
    const s = this.selected;
    if (!s) return;
    const p = this._pLL(s.lat, s.lon);
    if (!p) return;
    const r = 14 + Math.sin(t * 5) * 2;
    ctx.strokeStyle = col(1);
    ctx.lineWidth = 2;
    const c = 6;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(p[0] + sx * r, p[1] + sy * (r - c));
      ctx.lineTo(p[0] + sx * r, p[1] + sy * r);
      ctx.lineTo(p[0] + sx * (r - c), p[1] + sy * r);
    }
    ctx.stroke();
  }

  _loading(ctx, w, h) {
    const rgb = this.rgb || '26,255,128';
    ctx.fillStyle = `rgba(${rgb},0.8)`;
    ctx.font = '16px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOADING CARTOGRAPHIC DATA' + '.'.repeat(1 + (Math.floor(performance.now() / 300) % 3)), w / 2, h / 2);
  }
}
