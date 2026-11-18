// The cabinet's announcer: a big slanted shout across the screen, plus the
// browser's speech synth pitched down into a cheap 90s voice ROM.

export class Announcer {
  constructor(el) {
    this.el = el;
    this.voiceOn = true;
    this.lang = 'en';
    this.voices = [];
    const load = () => { this.voices = window.speechSynthesis?.getVoices() ?? []; };
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
  }

  say(text, { pitch = 0.25, rate = 0.82, lang = this.lang } = {}) {
    const synth = window.speechSynthesis;
    if (!this.voiceOn || !synth || !window.SpeechSynthesisUtterance) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const prefix = lang === 'de' ? 'de' : 'en';
      u.voice = this.voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null;
      u.lang = lang === 'de' ? 'de-DE' : 'en-US';
      u.pitch = pitch;
      u.rate = rate;
      u.volume = 0.9;
      synth.speak(u);
    } catch { /* no voice ROM fitted */ }
  }

  // kind: '' (amber), 'good' (green), 'bad' (red), 'cool' (cyan)
  shout(text, kind = '', sub = '') {
    this.el.innerHTML = ''; // one shout at a time, the newest wins
    const d = document.createElement('div');
    d.className = `shout ${kind}`;
    d.innerHTML = `<span>${text}</span>${sub ? `<small>${sub}</small>` : ''}`;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }

  clear() {
    this.el.innerHTML = '';
    window.speechSynthesis?.cancel();
  }
}
