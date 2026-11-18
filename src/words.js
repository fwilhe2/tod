// Dictionary selection: language, theme, and umlaut handling. All words,
// phrases, and story text are original to this game (see ./dict).
import en from './dict/en.js';
import de from './dict/de.js';

export const LANGS = { en, de };
export const LANG_ORDER = ['en', 'de'];
export const THEME_ORDER = ['horror', 'office', 'kitchen', 'tech', 'classic', 'mixed'];
export const TIER_COUNT = 5;

// characters the keyboard handler accepts as typing
export const TYPEABLE = /^[a-zäöüß '\-]$/;

// Without a German layout, umlauts are typed the old typewriter way.
const ASCII = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
const toAscii = (s) => s.replace(/[äöüß]/g, (c) => ASCII[c]);

const cfg = { lang: 'en', theme: 'horror', umlauts: true };
let tiers = [];

function build() {
  const L = LANGS[cfg.lang];
  const themes = cfg.theme === 'mixed'
    ? Object.values(L.themes)
    : [L.themes[cfg.theme] ?? L.themes.horror];
  const fix = cfg.lang === 'de' && !cfg.umlauts ? toAscii : (s) => s;
  tiers = Array.from({ length: TIER_COUNT }, (_, i) =>
    [...new Set(themes.flatMap((t) => t.tiers[i]).map(fix))]);
}
build();

export function configureWords({ lang, theme, umlauts }) {
  if (lang && LANGS[lang]) cfg.lang = lang;
  if (theme) cfg.theme = theme;
  if (umlauts !== undefined) cfg.umlauts = umlauts;
  build();
}

export function lang() { return LANGS[cfg.lang]; }

export function themeLabel(theme, langCode = cfg.lang) {
  if (theme === 'mixed') return langCode === 'de' ? 'ALLES' : 'MIXED';
  return LANGS[langCode].themes[theme].label;
}

// localized text with umlauts folded when they're switched off (typed text only)
export function typed(s) { return cfg.lang === 'de' && !cfg.umlauts ? toAscii(s) : s; }

export function bossText(kind) {
  const b = LANGS[cfg.lang].bosses[kind];
  return { ...b, phrases: b.phrases.map(typed) };
}

export function question() {
  const q = LANGS[cfg.lang].question;
  return { prompt: q.prompt, answers: q.answers.map((a) => ({ ...a, text: typed(a.text) })) };
}

export function endings() { return LANGS[cfg.lang].endings; }

export function wordCount() { return tiers.reduce((n, t) => n + t.length, 0); }

// Guarantees the returned word never shares a first letter with any word in
// use, so lock-on targeting is always unambiguous. Falls back to neighboring
// tiers if the requested pool has no safe candidates left.
export function pickWord(tier, inUse) {
  const t = Math.max(0, Math.min(tier, TIER_COUNT - 1));
  const used = new Set(inUse);
  const firsts = new Set(inUse.map((w) => w[0]));
  const tierOrder = [t, t - 1, t + 1, t - 2, t + 2, t - 3, t + 3]
    .filter((i, idx, arr) => i >= 0 && i < TIER_COUNT && arr.indexOf(i) === idx);
  for (const ti of tierOrder) {
    const safe = tiers[ti].filter((w) => !used.has(w) && !firsts.has(w[0]));
    if (safe.length) return safe[Math.floor(Math.random() * safe.length)];
  }
  // more simultaneous targets than starting letters: give up on uniqueness
  return tiers[t][Math.floor(Math.random() * tiers[t].length)];
}
