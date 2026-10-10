// Line-art pictograms (64x64 viewBox) used for perks and inventory items.

const P = {
  door: '<rect x="14" y="8" width="30" height="48"/><path d="M14 8 L34 14 V60 L14 56 Z" class="f"/><circle cx="29" cy="36" r="1.8" class="solid"/><path d="M42 32 H58 M52 26 L58 32 L52 38"/>',
  butter: '<path d="M8 36 L30 24 L56 32 L34 46 Z" class="f"/><path d="M8 36 V44 L34 54 V46 M34 54 L56 40 V32"/><path d="M16 20 q4 -6 8 0 M36 14 q4 -6 8 0"/>',
  wave: '<path d="M4 24 q8 -10 14 0 t14 0 t14 0 t14 0"/><path d="M4 36 q8 -10 14 0 t14 0 t14 0 t14 0"/><path d="M4 48 q8 -10 14 0 t14 0 t14 0 t14 0"/>',
  anvil: '<path d="M8 18 H48 q8 0 10 6 q-8 0 -12 4 L38 34 V42 H46 V50 H18 V42 H26 V34 L14 30 Q8 26 8 18 Z" class="f"/>',
  rocket: '<path d="M32 4 q14 12 10 36 H22 Q18 16 32 4 Z" class="f"/><circle cx="32" cy="22" r="5"/><path d="M22 34 L12 46 L22 44 M42 34 L52 46 L42 44 M26 44 L32 60 L38 44"/>',
  bolt: '<path d="M36 4 L14 36 H30 L24 60 L50 26 H34 Z" class="f"/>',
  fist: '<text x="32" y="44" text-anchor="middle" font-size="34" font-weight="700" class="solid">G</text><path d="M6 20 H18 M4 32 H14 M6 44 H18 M46 20 H58 M50 32 H60 M46 44 H58"/>',
  skull: '<path d="M32 6 C14 6 10 20 12 32 C13 38 18 40 18 46 V54 H46 V46 C46 40 51 38 52 32 C54 20 50 6 32 6 Z" class="f"/><circle cx="24" cy="30" r="6" class="solid"/><circle cx="40" cy="30" r="6" class="solid"/><path d="M32 36 L28 42 H36 Z M26 54 V48 M32 54 V48 M38 54 V48"/>',
  wind: '<path d="M4 22 H40 a8 8 0 1 0 -8 -8"/><path d="M4 34 H50 a8 8 0 1 1 -8 8"/><path d="M4 46 H28 a6 6 0 1 1 -6 6"/>',
  moon: '<path d="M40 8 A24 24 0 1 0 56 44 A20 20 0 0 1 40 8 Z" class="f"/><path d="M14 12 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2 z M50 14 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1 z"/>',
  road: '<path d="M24 6 L6 58 M40 6 L58 58"/><path d="M32 10 V18 M32 26 V36 M32 44 V58" stroke-width="4"/>',
  clock: '<circle cx="32" cy="34" r="24" class="f"/><path d="M32 34 V18 M32 34 L44 40 M26 6 H38 M32 6 V10"/>',
  globe: '<circle cx="32" cy="32" r="26" class="f"/><ellipse cx="32" cy="32" rx="11" ry="26"/><path d="M6 32 H58 M10 18 H54 M10 46 H54"/>',
  ticket: '<path d="M6 18 H58 V28 a5 5 0 0 0 0 10 V48 H6 V38 a5 5 0 0 0 0 -10 Z" class="f"/><path d="M42 18 V48" stroke-dasharray="3 3"/><path d="M14 28 H34 M14 36 H30"/>',
  spring: '<path d="M8 52 H56"/><path d="M32 52 L18 46 L46 40 L18 34 L46 28 L18 22 L32 16"/><circle cx="32" cy="10" r="5" class="f"/>',
  can: '<path d="M16 14 H40 L50 24 V58 H16 Z" class="f"/><path d="M22 8 H34 V14 M44 10 L52 18 M22 26 L42 50 M42 26 L22 50"/>',
  flag: '<path d="M14 6 V60"/><path d="M14 8 H50 L42 20 L50 32 H14" class="f"/>',
  robot: '<rect x="14" y="18" width="36" height="30" rx="4" class="f"/><circle cx="25" cy="31" r="4" class="solid"/><circle cx="39" cy="31" r="4" class="solid"/><path d="M24 41 H40 M32 18 V8 M8 28 V38 M56 28 V38 M22 48 V56 M42 48 V56"/><circle cx="32" cy="7" r="3"/>',
  star: '<path d="M32 4 L40 24 L60 24 L44 37 L50 58 L32 45 L14 58 L20 37 L4 24 L24 24 Z" class="f"/>',
  lock: '<rect x="14" y="28" width="36" height="28" rx="3" class="f"/><path d="M20 28 V20 a12 12 0 0 1 24 0 V28"/><circle cx="32" cy="40" r="4" class="solid"/><path d="M32 44 V50"/>',
  plane: '<path d="M32 4 q4 0 4 8 V24 L58 36 V42 L36 36 V50 L44 56 V60 L32 57 L20 60 V56 L28 50 V36 L6 42 V36 L28 24 V12 q0 -8 4 -8 Z" class="f"/>',
  gear: '<path d="M32 6 V22"/><circle cx="32" cy="38" r="16" class="f"/><circle cx="32" cy="38" r="6"/><path d="M20 10 H44"/>',
  flaps: '<path d="M4 30 Q20 18 44 24 L50 28 L4 34 Z" class="f"/><path d="M50 30 L60 42 L54 44 L46 34"/>',
  brake: '<circle cx="32" cy="32" r="24" class="f"/><text x="32" y="42" text-anchor="middle" font-size="28" font-weight="700" class="solid">P</text>',
  bulb: '<path d="M22 40 a16 16 0 1 1 20 0 V48 H22 Z" class="f"/><path d="M24 54 H40 M26 59 H38"/>',
  beacon: '<path d="M22 44 V28 a10 10 0 0 1 20 0 V44" class="f"/><path d="M16 48 H48 M10 18 L16 22 M54 18 L48 22 M32 6 V12"/>',
  strobe: '<path d="M6 32 H24 M40 32 H58 M32 6 V24 M32 40 V58 M14 14 L26 26 M50 14 L38 26 M14 50 L26 38 M50 50 L38 38"/><circle cx="32" cy="32" r="5" class="solid"/>',
  ap: '<rect x="6" y="16" width="52" height="32" rx="4" class="f"/><text x="32" y="40" text-anchor="middle" font-size="20" font-weight="700" class="solid">A/P</text>',
  xpdr: '<rect x="6" y="18" width="52" height="28" rx="3" class="f"/><path d="M14 26 V38 M24 26 V38 M34 26 V38 M44 26 V38"/><path d="M50 10 q6 6 0 12 M44 12 q3 3 0 6"/>',
  baro: '<circle cx="32" cy="32" r="24" class="f"/><path d="M32 32 L46 20"/><path d="M14 40 a20 20 0 0 1 0 -16 M50 24 a20 20 0 0 1 0 16"/><circle cx="32" cy="32" r="3" class="solid"/>',
  engine: '<circle cx="32" cy="32" r="24" class="f"/><path d="M32 32 L32 10 M32 32 L52 42 M32 32 L12 42"/><circle cx="32" cy="32" r="5"/>',
  fuel: '<path d="M14 12 H38 V58 H14 Z" class="f"/><path d="M38 22 L50 30 V48 a4 4 0 0 0 8 0 V20 L52 14"/><rect x="18" y="18" width="16" height="10"/>',
  radio: '<rect x="6" y="22" width="52" height="34" rx="4" class="f"/><circle cx="20" cy="39" r="9"/><path d="M36 32 H52 M36 39 H52 M36 46 H52 M14 22 L46 8"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 64 64" aria-hidden="true">${P[name] || P.star}</svg>`;
}
