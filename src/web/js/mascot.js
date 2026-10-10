// "Flyboy" — the original cartoon aviator mascot, drawn as an animatable SVG.
// Limbs are drawn as capsules (a thick stroke under a thinner background
// stroke) so they read as outlined cartoon shapes. Poses / moods are CSS
// classes on the root, see `.mascot` rules in pip.css.

const capsule = (d, w = 20) =>
  `<path d="${d}" class="m-line" stroke-width="${w}"/><path d="${d}" class="m-fillline" stroke-width="${w - 6}"/>`;

const SVG = `
<svg class="mascot-svg" viewBox="0 0 200 300" aria-hidden="true">
  <ellipse class="m-shadow" cx="100" cy="266" rx="46" ry="6"/>
  <g class="m-jump">
  <g class="m-bob">
    <g class="m-leg m-leg-l">${capsule('M88 188 L86 224 L85 250')}<path class="m-part" d="M70 262 q0 -12 14 -13 q12 0 14 9 l0 5 z"/></g>
    <g class="m-leg m-leg-r">${capsule('M112 188 L114 224 L115 250')}<path class="m-part" d="M130 262 q0 -12 -14 -13 q-12 0 -14 9 l0 5 z"/></g>
    <g class="m-arm m-arm-l">${capsule('M76 126 L63 155 L58 180', 19)}<circle class="m-part" cx="58" cy="184" r="9"/></g>
    <g class="m-torso">
      <path class="m-part m-suit" d="M72 126 q0 -14 14 -14 h28 q14 0 14 14 v58 q0 12 -12 12 h-32 q-12 0 -12 -12 z"/>
      <path class="m-detail" d="M100 116 v60"/>
      <path class="m-detail" d="M73 176 h54"/>
      <rect class="m-part" x="93" y="171" width="14" height="10" rx="2"/>
      <path class="m-detail" d="M106 136 q8 -6 16 -4 q-6 2 -8 6 q-4 -2 -8 -2 z M106 136 q-2 -4 -6 -4"/>
      <path class="m-detail" d="M78 150 h12 v10 h-12 z"/>
    </g>
    <g class="m-arm m-arm-r">${capsule('M124 126 L137 155 L142 180', 19)}<circle class="m-part" cx="142" cy="184" r="9"/>
      <path class="m-thumb m-part" d="M146 186 l11 8 q4 3 1 6 q-3 2 -6 -1 l-9 -7 z"/></g>
    <g class="m-head">
      ${capsule('M100 104 L100 116', 18)}
      <g class="m-scarf"><path class="m-part m-scarf-tail" d="M104 112 C122 106 138 118 162 108 L160 122 C140 130 122 120 104 122 Z"/><circle class="m-part" cx="101" cy="116" r="8"/></g>
      <ellipse class="m-part" cx="63" cy="86" rx="8" ry="14"/>
      <ellipse class="m-part" cx="137" cy="86" rx="8" ry="14"/>
      <circle class="m-part" cx="100" cy="74" r="38"/>
      <path class="m-part m-cap" d="M60 76 A40 40 0 0 1 140 76 Q100 60 60 76 Z"/>
      <path class="m-detail" d="M62 60 L74 56 M138 60 L126 56"/>
      <g class="m-goggles"><circle class="m-part" cx="87" cy="54" r="10"/><circle class="m-part" cx="113" cy="54" r="10"/>
        <path class="m-detail" d="M97 54 h6"/><circle class="m-glint" cx="84" cy="51" r="2.5"/><circle class="m-glint" cx="110" cy="51" r="2.5"/></g>
      <path class="m-detail" d="M80 67 q5 5 10 0 q5 5 10 0"/>
      <g class="m-eyes"><ellipse class="m-eye" cx="86" cy="83" rx="3.6" ry="5.2"/><ellipse class="m-eye" cx="114" cy="83" rx="3.6" ry="5.2"/></g>
      <path class="m-detail m-brow" d="M80 74 q6 -4 12 0 M108 74 q6 -4 12 0"/>
      <path class="m-detail" d="M100 86 q5 6 -1 9"/>
      <path class="m-grin" d="M80 96 Q100 120 120 96 Q100 106 80 96 Z"/>
      <path class="m-detail m-worry" d="M84 108 Q100 97 116 108"/>
      <path class="m-detail" d="M74 94 q-3 2 -2 6 M126 94 q3 2 2 6"/>
    </g>
  </g>
  </g>
</svg>`;

export class Mascot {
  constructor(pose = 'idle') {
    this.el = document.createElement('div');
    this.el.className = 'mascot';
    this.el.innerHTML = SVG;
    this.pose = null;
    this.mood = null;
    this.setPose(pose);
    this.setMood('happy');
  }

  setPose(pose) {
    if (pose === this.pose) return;
    if (this.pose) this.el.classList.remove(`pose-${this.pose}`);
    this.pose = pose;
    this.el.classList.add(`pose-${pose}`);
  }

  setMood(mood) {
    if (mood === this.mood) return;
    if (this.mood) this.el.classList.remove(`mood-${this.mood}`);
    this.mood = mood;
    this.el.classList.add(`mood-${mood}`);
  }
}
