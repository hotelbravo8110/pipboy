// All UI sounds are synthesized with WebAudio — no audio assets needed.

class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.5;
    this.master = null;
    this._noise = null;
    this._hum = null;
  }

  /** Lazily create the AudioContext (browsers need a user gesture). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _tone({ freq = 1000, to = null, type = 'square', dur = 0.05, vol = 0.15, delay = 0, attack = 0.002 }) {
    if (!this.enabled || !this.ensure()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseBurst({ dur = 0.05, vol = 0.2, freq = 3000, q = 1, delay = 0, type = 'bandpass' }) {
    if (!this.enabled || !this.ensure()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.02);
  }

  // ---- UI vocabulary ------------------------------------------------------
  tab() {
    this._noiseBurst({ dur: 0.03, vol: 0.35, freq: 2500, q: 0.8 });
    this._noiseBurst({ dur: 0.04, vol: 0.25, freq: 1200, q: 2, delay: 0.045 });
    this._tone({ freq: 140, to: 60, type: 'triangle', dur: 0.08, vol: 0.2 });
  }
  sub() {
    this._noiseBurst({ dur: 0.025, vol: 0.25, freq: 3500, q: 1 });
    this._tone({ freq: 900, type: 'square', dur: 0.03, vol: 0.05 });
  }
  move() { this._tone({ freq: 1900, type: 'square', dur: 0.022, vol: 0.04 }); }
  select() {
    this._tone({ freq: 1200, type: 'square', dur: 0.04, vol: 0.06 });
    this._tone({ freq: 1800, type: 'square', dur: 0.05, vol: 0.06, delay: 0.05 });
  }
  back() { this._tone({ freq: 900, to: 500, type: 'square', dur: 0.08, vol: 0.06 }); }
  warn() {
    this._tone({ freq: 440, type: 'sawtooth', dur: 0.18, vol: 0.08 });
    this._tone({ freq: 330, type: 'sawtooth', dur: 0.25, vol: 0.08, delay: 0.2 });
  }
  xp() {
    [880, 1320].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.1, delay: i * 0.08 }));
  }
  perk() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: i === 5 ? 0.6 : 0.16, vol: 0.14, delay: i * 0.11 }));
    this._tone({ freq: 262, type: 'sine', dur: 0.9, vol: 0.1, delay: 0.44 });
  }
  levelup() {
    const seq = [392, 523, 659, 784, 659, 784, 1047];
    seq.forEach((f, i) => this._tone({ freq: f, type: 'square', dur: i === seq.length - 1 ? 0.8 : 0.12, vol: 0.07, delay: i * 0.12 }));
    seq.forEach((f, i) => this._tone({ freq: f / 2, type: 'triangle', dur: 0.14, vol: 0.1, delay: i * 0.12 }));
  }
  landing(good) {
    if (good) [660, 880, 1100].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.12, delay: i * 0.1 }));
    else [300, 220].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.25, vol: 0.08, delay: i * 0.18 }));
  }
  static(dur = 0.6, vol = 0.12) {
    this._noiseBurst({ dur, vol, freq: 1800, q: 0.4 });
  }
  boot() {
    if (!this.enabled || !this.ensure()) return;
    this._tone({ freq: 50, to: 120, type: 'sawtooth', dur: 1.2, vol: 0.06, attack: 0.3 });
    for (let i = 0; i < 6; i++) this._noiseBurst({ dur: 0.02, vol: 0.3, freq: 2000 + i * 300, q: 3, delay: 0.2 + i * 0.13 + Math.random() * 0.05 });
  }
  type() { this._noiseBurst({ dur: 0.012, vol: 0.12, freq: 4000 + Math.random() * 2000, q: 4 }); }
  power() {
    this._tone({ freq: 2000, to: 8000, type: 'sine', dur: 0.4, vol: 0.03 });
    this._noiseBurst({ dur: 0.3, vol: 0.2, freq: 600, q: 0.3 });
  }
}

export const sound = new Sound();
