// All sound is synthesized at runtime with WebAudio — no audio assets.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbience();
  }

  now() { return this.ctx.currentTime; }

  env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  noise(t0, dur, filterType, freq, peak, freqEnd) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, 0.005, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  tone(t0, dur, type, f0, f1, peak) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, 0.008, dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // one shot per correct keystroke
  shot() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.09, 'lowpass', 2600, 0.5, 300);
    this.tone(t, 0.07, 'square', 850, 140, 0.18);
  }

  miss() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 0.12, 'square', 130, 90, 0.22);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.28, 'lowpass', 500, 0.55, 120);      // splat
    this.tone(t, 0.45, 'sawtooth', 130, 55, 0.22);       // groan drop
    this.tone(t + 0.03, 0.4, 'sawtooth', 97, 48, 0.15);  // detuned layer
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 0.25, 'sine', 70, 40, 0.7);
    this.noise(t, 0.18, 'lowpass', 900, 0.4, 200);
  }

  waveChime() {
    if (!this.ctx) return;
    const t = this.now();
    [440, 554, 659].forEach((f, i) =>
      this.tone(t + i * 0.09, 0.22, 'triangle', f, null, 0.18));
  }

  bossRoar() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 1.0, 'sawtooth', 75, 38, 0.4);
    this.tone(t, 1.0, 'sawtooth', 62, 30, 0.35);
    this.noise(t, 0.9, 'lowpass', 350, 0.35, 90);
  }

  bossHit() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.3, 'lowpass', 800, 0.6, 150);
    this.tone(t, 0.5, 'sawtooth', 180, 45, 0.3);
    [880, 1109].forEach((f, i) => this.tone(t + i * 0.06, 0.15, 'triangle', f, null, 0.12));
  }

  startAmbience() {
    const t = this.now();
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);
    [55, 55.6, 110.4].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
    });
    // slow wind
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300;
    f.Q.value = 0.6;
    const wg = this.ctx.createGain();
    wg.gain.value = 0.018;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(wg.gain);
    src.connect(f).connect(wg).connect(this.master);
    src.start(t);
    lfo.start(t);
  }
}
