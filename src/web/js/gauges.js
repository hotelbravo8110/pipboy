// SVG instruments. Each factory returns { el, set(...) }. Needles animate via
// CSS transitions on transform (see .g-needle in pip.css).
import { s, clamp, SmoothAngle } from './util.js';

const C = 100; // all gauges use a 200x200 viewBox centred on (100,100)
const D2R = Math.PI / 180;
const pt = (r, deg) => [C + r * Math.sin(deg * D2R), C - r * Math.cos(deg * D2R)];

function arcPath(r, a0, a1) {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Generic round dial. `wrap` makes the needle go round more than once (altimeter). */
export function dial({ min = 0, max = 100, major = 10, minor = 2, start = -135, end = 135,
  label = '', unit = '', zones = [], labelEvery = 1, labelFmt = (v) => v, wrap = false, digits = (v) => Math.round(v) }) {
  const svg = s('svg', { viewBox: '0 0 200 200', class: 'gauge' });
  svg.append(s('circle', { cx: C, cy: C, r: 96, class: 'g-rim' }));
  svg.append(s('circle', { cx: C, cy: C, r: 90, class: 'g-face' }));
  const toAng = (v) => start + ((v - min) / (max - min)) * (end - start);
  for (const z of zones) svg.append(s('path', { d: arcPath(84, toAng(z.from), toAng(z.to)), class: `g-zone ${z.cls || ''}` }));
  let n = 0;
  for (let v = min; v <= max + 1e-9; v += minor, n++) {
    const isMajor = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
    const a = toAng(v);
    const [x0, y0] = pt(isMajor ? 72 : 78, a);
    const [x1, y1] = pt(86, a);
    svg.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: isMajor ? 'g-tick major' : 'g-tick' }));
    if (isMajor && Math.round((v - min) / major) % labelEvery === 0 && !(wrap && v === max)) {
      const [lx, ly] = pt(58, a);
      svg.append(s('text', { x: lx, y: ly + 5, class: 'g-num', 'text-anchor': 'middle' }, String(labelFmt(v))));
    }
  }
  svg.append(s('text', { x: C, y: 68, class: 'g-label', 'text-anchor': 'middle' }, label));
  const readout = s('text', { x: C, y: 146, class: 'g-read', 'text-anchor': 'middle' }, '---');
  svg.append(readout);
  svg.append(s('text', { x: C, y: 162, class: 'g-unit', 'text-anchor': 'middle' }, unit));
  const needle = s('g', { class: 'g-needle' },
    s('path', { d: `M${C - 4} ${C + 14} L${C} 22 L${C + 4} ${C + 14} Z`, class: 'g-needle-shape' }),
    s('circle', { cx: C, cy: C, r: 7, class: 'g-hub' }));
  svg.append(needle);
  const peak = s('path', { d: `M${C} 10 l-5 -8 h10 z`, class: 'g-peak', style: 'opacity:0' });
  svg.append(peak);
  let lastAng = null;
  return {
    el: svg,
    set(v, peakValue) {
      if (typeof v !== 'number' || !isFinite(v)) { readout.textContent = '---'; return; }
      let a;
      if (wrap) {
        const span = max - min;
        const turns = Math.floor((v - min) / span);
        a = turns * (end - start) + toAng(((v - min) % span + span) % span + min);
        // keep continuity for CSS transition
        if (lastAng !== null && Math.abs(a - lastAng) > 180) needle.style.transition = 'none';
        else needle.style.transition = '';
      } else {
        a = toAng(clamp(v, min, max));
      }
      lastAng = a;
      needle.style.transform = `rotate(${a}deg)`;
      readout.textContent = digits(v);
      if (typeof peakValue === 'number') {
        peak.style.opacity = 1;
        peak.style.transform = `rotate(${toAng(clamp(peakValue, min, max))}deg)`;
      }
    },
  };
}

/** Artificial horizon: pitch ladder + bank scale. */
export function horizon() {
  const svg = s('svg', { viewBox: '0 0 200 200', class: 'gauge horizon' });
  const id = `hz${Math.random().toString(36).slice(2, 7)}`;
  svg.append(s('defs', {}, s('clipPath', { id }, s('circle', { cx: C, cy: C, r: 88 }))));
  svg.append(s('circle', { cx: C, cy: C, r: 96, class: 'g-rim' }));
  const world = s('g', { class: 'hz-world' });
  world.append(s('rect', { x: -200, y: C, width: 600, height: 400, class: 'hz-ground' }));
  world.append(s('line', { x1: -200, y1: C, x2: 400, y2: C, class: 'hz-line' }));
  for (let p = -40; p <= 40; p += 5) {
    if (!p) continue;
    const y = C - p * 3;
    const w = p % 10 === 0 ? 30 : 14;
    world.append(s('line', { x1: C - w, y1: y, x2: C + w, y2: y, class: 'g-tick' }));
    if (p % 10 === 0) {
      world.append(s('text', { x: C - w - 12, y: y + 4, class: 'g-num small', 'text-anchor': 'middle' }, Math.abs(p)));
      world.append(s('text', { x: C + w + 12, y: y + 4, class: 'g-num small', 'text-anchor': 'middle' }, Math.abs(p)));
    }
  }
  const clip = s('g', { 'clip-path': `url(#${id})` }, world);
  svg.append(clip);
  // bank scale
  const scale = s('g', { class: 'hz-scale' });
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x0, y0] = pt(88, a);
    const [x1, y1] = pt(a % 30 === 0 ? 76 : 81, a);
    scale.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'g-tick major' }));
  }
  svg.append(scale);
  const pointer = s('path', { d: `M${C} 22 l-6 10 h12 z`, class: 'g-needle-shape hz-pointer' });
  svg.append(pointer);
  // fixed aircraft symbol
  svg.append(s('path', { d: `M${C - 50} ${C} H${C - 18} L${C - 9} ${C + 10} L${C} ${C} L${C + 9} ${C + 10} L${C + 18} ${C} H${C + 50}`, class: 'hz-plane' }));
  svg.append(s('circle', { cx: C, cy: C, r: 3, class: 'g-hub' }));
  return {
    el: svg,
    set(pitch, bank) {
      const p = clamp(pitch || 0, -40, 40);
      world.style.transform = `rotate(${-(bank || 0)}deg) translateY(${p * 3}px)`;
      pointer.style.transform = `rotate(${-(bank || 0)}deg)`;
    },
  };
}

/** Rotating compass card with optional heading / track bugs. */
export function compass() {
  const svg = s('svg', { viewBox: '0 0 200 200', class: 'gauge compass' });
  svg.append(s('circle', { cx: C, cy: C, r: 96, class: 'g-rim' }));
  svg.append(s('circle', { cx: C, cy: C, r: 90, class: 'g-face' }));
  const card = s('g', { class: 'g-needle' });
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    const [x0, y0] = pt(major ? 74 : a % 10 === 0 ? 80 : 84, a);
    const [x1, y1] = pt(88, a);
    card.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? 'g-tick major' : 'g-tick' }));
    if (major) {
      const [lx, ly] = pt(62, a);
      const txt = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10);
      card.append(s('text', { x: lx, y: ly + 5, class: `g-num ${a % 90 === 0 ? 'cardinal' : ''}`, 'text-anchor': 'middle', transform: `rotate(${a} ${lx} ${ly})` }, txt));
    }
  }
  const bug = s('path', { d: `M${C - 7} 6 h14 v8 l-7 -5 l-7 5 z`, class: 'g-bug' });
  card.append(bug);
  svg.append(card);
  svg.append(s('path', { d: `M${C} 4 l-6 -0 l6 14 l6 -14 z`, class: 'g-needle-shape' }));
  svg.append(s('path', { d: 'M100 70 q4 0 4 8 V92 L126 104 V110 L104 104 V118 L112 124 V128 L100 125 L88 128 V124 L96 118 V104 L74 110 V104 L96 92 V78 q0 -8 4 -8 Z', class: 'hz-plane-fill' }));
  const sa = new SmoothAngle();
  return {
    el: svg,
    set(hdg, bugHdg) {
      if (typeof hdg !== 'number') return;
      card.style.transform = `rotate(${-sa.to(hdg)}deg)`;
      if (typeof bugHdg === 'number') {
        bug.style.display = '';
        bug.setAttribute('transform', `rotate(${bugHdg} ${C} ${C})`);
      } else bug.style.display = 'none';
    },
  };
}

/** Turn / bank indicator: little aircraft that rolls with bank angle. */
export function bankIndicator() {
  const svg = s('svg', { viewBox: '0 0 200 200', class: 'gauge' });
  svg.append(s('circle', { cx: C, cy: C, r: 96, class: 'g-rim' }));
  svg.append(s('circle', { cx: C, cy: C, r: 90, class: 'g-face' }));
  for (const a of [-60, -45, -30, -15, 0, 15, 30, 45, 60]) {
    for (const base of [90, 270]) {
      const [x0, y0] = pt(88, base + a);
      const [x1, y1] = pt(a % 30 === 0 ? 72 : 78, base + a);
      svg.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: a % 30 === 0 ? 'g-tick major' : 'g-tick' }));
    }
  }
  svg.append(s('path', { d: arcPath(84, 90 - 30, 90 + 30), class: 'g-zone ok' }));
  svg.append(s('path', { d: arcPath(84, 270 - 30, 270 + 30), class: 'g-zone ok' }));
  svg.append(s('text', { x: C, y: 60, class: 'g-label', 'text-anchor': 'middle' }, 'BANK'));
  const plane = s('g', { class: 'g-needle' },
    s('path', { d: `M${C - 64} ${C} H${C - 12} a12 12 0 0 1 24 0 H${C + 64}`, class: 'hz-plane' }),
    s('path', { d: `M${C} ${C - 12} V${C - 24} M${C - 16} ${C + 18} H${C + 16}`, class: 'hz-plane' }),
    s('circle', { cx: C, cy: C, r: 5, class: 'g-hub' }));
  svg.append(plane);
  const readout = s('text', { x: C, y: 150, class: 'g-read', 'text-anchor': 'middle' }, '0°');
  svg.append(readout);
  return {
    el: svg,
    set(bank) {
      const b = clamp(bank || 0, -75, 75);
      plane.style.transform = `rotate(${b}deg)`;
      readout.textContent = `${Math.abs(Math.round(b))}° ${b > 1 ? 'R' : b < -1 ? 'L' : ''}`;
    },
  };
}
