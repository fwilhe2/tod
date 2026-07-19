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

    // canal-alley reverb: generated exponential-decay impulse
    const vlen = Math.floor(this.ctx.sampleRate * 1.6);
    const ir = this.ctx.createBuffer(2, vlen, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const vd = ir.getChannelData(ch);
      for (let i = 0; i < vlen; i++) {
        vd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / vlen, 3);
      }
    }
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = ir;
    const verbGain = this.ctx.createGain();
    verbGain.gain.value = 0.45;
    this.verb.connect(verbGain).connect(this.master);

    this.startAmbience();
    this.startMusic();
  }

  now() { return this.ctx.currentTime; }

  // ---- adaptive music director ----
  // intensity 0: silence. 1: sub pulse. 2: + creeping arp. 3: + hats & dissonance.
  startMusic() {
    this.intensity = 0;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0001;
    this.musicGain.connect(this.master);
    const send = this.ctx.createGain();
    send.gain.value = 0.5;
    this.musicGain.connect(send).connect(this.verb);
    this.mstep = 0;
    this.mnext = this.now() + 0.2;
    setInterval(() => this.pumpMusic(), 110);
  }

  mtone(t, dur, type, f0, peak, f1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.01, dur);
    o.connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  mnoise(t, dur, freq, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    src.connect(f).connect(g).connect(this.musicGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  pumpMusic() {
    const spb = 60 / 92 / 2; // 8th notes at 92 bpm
    while (this.mnext < this.now() + 0.35) {
      this.playStep(this.mstep, this.mnext);
      this.mstep = (this.mstep + 1) % 32;
      this.mnext += spb;
    }
  }

  playStep(s, t) {
    const I = this.intensity;
    if (!I) return;
    const bar = Math.floor(s / 8) % 4;
    const root = [41.2, 41.2, 49.0, 38.9][bar]; // E1 E1 G1 Eb1 — uneasy ground
    if (s % 8 === 0) this.mtone(t, 0.42, 'sine', root * 2, 0.5, root); // sub thump
    if (I >= 1 && s % 8 === 4) this.mtone(t, 0.3, 'sine', root * 2, 0.28, root);
    if (I >= 2 && s % 2 === 1) {
      const arp = [root * 4, root * 6, root * 8, root * 6];
      this.mtone(t, 0.13, 'triangle', arp[(s >> 1) % 4], 0.06);
    }
    if (I >= 3) {
      if (s % 2 === 0) this.mnoise(t, 0.04, 5500, s % 8 === 6 ? 0.09 : 0.045); // hats
      if (s % 16 === 14) this.mtone(t, 0.5, 'sawtooth', root * 3.02, 0.05, root * 2.96); // dissonant scrape
    }
  }

  setIntensity(i) {
    if (!this.ctx || i === this.intensity) return;
    this.intensity = i;
    this.musicGain.gain.setTargetAtTime(i > 0 ? 0.85 : 0.0001, this.now(), 1.2);
  }

  env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  noise(t0, dur, filterType, freq, peak, freqEnd, wet = 0) {
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
    if (wet) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.verb);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  tone(t0, dur, type, f0, f1, peak, wet = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, 0.008, dur);
    o.connect(g).connect(this.master);
    if (wet) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.verb);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // one shot per correct keystroke; pitch creeps up with the combo
  shot(combo = 0) {
    if (!this.ctx) return;
    const t = this.now();
    const k = Math.min(combo, 30) / 30;
    this.noise(t, 0.05, 'highpass', 1500, 0.3, 5000, 0.35);          // crack
    this.noise(t, 0.09, 'lowpass', 2600, 0.5, 300, 0.25);            // body
    this.tone(t, 0.07, 'square', 850 * (1 + k * 0.45), 140, 0.18);   // report
    this.tone(t, 0.16, 'sine', 120, 45, 0.35, 0.3);                  // chest thump
  }

  miss() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 0.12, 'square', 130, 90, 0.22);
    this.noise(t, 0.08, 'bandpass', 300, 0.15);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.28, 'lowpass', 500, 0.55, 120, 0.4);   // splat
    this.noise(t + 0.05, 0.2, 'bandpass', 900, 0.3, 250);  // wet squelch
    this.tone(t, 0.45, 'sawtooth', 130, 55, 0.22, 0.3);    // groan drop
    this.tone(t + 0.03, 0.4, 'sawtooth', 97, 48, 0.15);    // detuned layer
    this.tone(t, 0.3, 'sine', 85, 30, 0.5);                // sub thump
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 0.25, 'sine', 70, 40, 0.7);
    this.noise(t, 0.18, 'lowpass', 900, 0.4, 200, 0.4);
    this.tone(t, 0.35, 'sawtooth', 220, 60, 0.12, 0.5); // ring in the ears
  }

  waveChime() {
    if (!this.ctx) return;
    const t = this.now();
    [440, 554, 659].forEach((f, i) =>
      this.tone(t + i * 0.09, 0.22, 'triangle', f, null, 0.18, 0.5));
  }

  bossRoar() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 1.0, 'sawtooth', 75, 38, 0.4, 0.5);
    this.tone(t, 1.0, 'sawtooth', 62, 30, 0.35, 0.5);
    this.noise(t, 0.9, 'lowpass', 350, 0.35, 90, 0.6);
    this.tone(t, 1.2, 'sine', 45, 22, 0.5);
  }

  bossHit() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.3, 'lowpass', 800, 0.6, 150, 0.4);
    this.tone(t, 0.5, 'sawtooth', 180, 45, 0.3, 0.4);
    [880, 1109].forEach((f, i) => this.tone(t + i * 0.06, 0.15, 'triangle', f, null, 0.12, 0.5));
  }

  thunder() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 2.6, 'lowpass', 320, 0.5, 45, 0.8);
    this.noise(t + 0.4, 2.0, 'lowpass', 200, 0.35, 40, 0.8);
    this.tone(t, 1.8, 'sine', 55, 24, 0.45, 0.5);
  }

  // distant zombie moan, panned across the street
  groan(pan = 0) {
    if (!this.ctx) return;
    const t = this.now();
    const dur = 0.9 + Math.random() * 0.8;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 45;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + dur);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 4 + Math.random() * 2.5;
    const vibGain = this.ctx.createGain();
    vibGain.gain.value = 6;
    vib.connect(vibGain).connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.25, dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(f).connect(g).connect(p).connect(this.master);
    const s = this.ctx.createGain();
    s.gain.value = 0.8;
    g.connect(s).connect(this.verb);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
    this.noise(t + 0.1, dur * 0.6, 'bandpass', 700, 0.02, 400, 0.6); // breath
  }

  heartbeat() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 0.1, 'sine', 62, 35, 0.55);
    this.tone(t + 0.17, 0.09, 'sine', 55, 30, 0.4);
  }

  // something heavy surfacing from the canal
  splash() {
    if (!this.ctx) return;
    const t = this.now();
    this.noise(t, 0.45, 'bandpass', 1400, 0.3, 350, 0.5);
    this.noise(t + 0.06, 0.3, 'lowpass', 700, 0.25, 150, 0.4);
    this.tone(t, 0.3, 'sine', 260, 70, 0.18, 0.3);
  }

  // coffee acquired: one heart back
  heart() {
    if (!this.ctx) return;
    const t = this.now();
    [523, 659, 784].forEach((f, i) =>
      this.tone(t + i * 0.07, 0.3, 'triangle', f, null, 0.15, 0.6));
  }

  bell() {
    if (!this.ctx) return;
    const t = this.now();
    this.tone(t, 2.8, 'triangle', 233, 231, 0.05, 0.9);
    this.tone(t, 2.2, 'triangle', 349.6, 348, 0.03, 0.9);
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
    // slow-breathing drone layer
    const pad = this.ctx.createGain();
    pad.gain.value = 0.02;
    pad.connect(this.master);
    const padVerb = this.ctx.createGain();
    padVerb.gain.value = 0.7;
    pad.connect(padVerb).connect(this.verb);
    const padLfo = this.ctx.createOscillator();
    padLfo.frequency.value = 0.07;
    const padLfoGain = this.ctx.createGain();
    padLfoGain.gain.value = 0.014;
    padLfo.connect(padLfoGain).connect(pad.gain);
    [82.4, 123.5].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      o.connect(pad);
      o.start(t);
    });
    padLfo.start(t);
    // slow wind + rain hiss
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
    const hiss = this.ctx.createBufferSource();
    hiss.buffer = this.noiseBuf;
    hiss.loop = true;
    const hf = this.ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 5000;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.006;
    hiss.connect(hf).connect(hg).connect(this.master);
    hiss.start(t);
    // a distant bell, now and then
    setInterval(() => { if (Math.random() < 0.45) this.bell(); }, 21000);
  }
}
