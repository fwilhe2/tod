// The cabinet's attract loop: a boot ROM check, the publisher card, the chrome
// logo slamming in, then a cycle of menu / story / enemy roster / high
// scores / how-to pages before the machine plays a demo by itself.
import { LANGS, LANG_ORDER, THEME_ORDER, themeLabel, wordCount, configureWords } from './words.js';
import { KINDS, PICKUPS } from './levels.js';

const $ = (id) => document.getElementById(id);

const PAGES = [
  { id: 'menu', time: 14 },
  { id: 'story', time: 16 },
  { id: 'roster', time: 10 },
  { id: 'scores', time: 9 },
  { id: 'howto', time: 10 },
];

const DEFAULT_SCORES = [
  ['VRD', 250000], ['BOD', 200000], ['ERG', 160000], ['QWE', 120000], ['ASD', 90000],
  ['ZXC', 60000], ['KEY', 40000], ['TYP', 25000], ['ZZZ', 12000], ['LOL', 5000],
].map(([name, score]) => ({ name, score }));

const BOOT_LINES = [
  'TOD-96 ARCADE SYSTEM  BIOS V1.03',
  '',
  'PROGRAM ROM ............ <span class="ok">OK</span>',
  'WORK RAM ............... <span class="ok">OK</span>',
  'VIDEO RAM .............. <span class="ok">OK</span>',
  'VOICE ROM .............. <span class="ok">OK</span>',
  'KEYBOARD ............... <span class="ok">DETECTED</span>',
  'DREAD CALIBRATION ...... <span class="ok">OK</span>',
  'BRAINS ................. <span style="color:#ff5a5a">MISSING</span>',
];

export function loadSettings() {
  const s = { speed: 1, horde: 1, lang: 'en', theme: 'horror', umlauts: true, crt: true, voice: true };
  try { Object.assign(s, JSON.parse(localStorage.getItem('tod-settings') || '{}')); } catch { /* defaults */ }
  if (!LANGS[s.lang]) s.lang = 'en';
  if (!THEME_ORDER.includes(s.theme)) s.theme = 'horror';
  return s;
}

export function loadScores() {
  try {
    const s = JSON.parse(localStorage.getItem('tod-scores') || 'null');
    if (Array.isArray(s) && s.length) return s.slice(0, 10);
  } catch { /* fresh table */ }
  return DEFAULT_SCORES.map((e) => ({ ...e }));
}

export function saveScores(list) {
  try { localStorage.setItem('tod-scores', JSON.stringify(list.slice(0, 10))); } catch { /* private mode */ }
}

export class Attract {
  constructor(game) {
    this.game = game;
    this.phase = 'boot';
    this.t = 0;
    this.page = 0;
    this.pageT = 0;
    this.sel = 0;
    this.credits = 0;
    this.freshScore = -1;
    this.storyChars = 0;
    this.slammed = false;
    this.rows = [
      { key: 'speed', label: 'GAME SPEED', fmt: (v) => Math.round(v * 100) + '%',
        step: (v, d) => Math.min(2, Math.max(0.5, Math.round((v + d * 0.25) * 4) / 4)) },
      { key: 'horde', label: 'HORDE SIZE', fmt: (v) => Math.round(v * 100) + '%',
        step: (v, d) => Math.min(2, Math.max(0.5, Math.round((v + d * 0.25) * 4) / 4)) },
      { key: 'lang', label: 'LANGUAGE', fmt: (v) => LANGS[v].name, step: (v, d) => cycle(LANG_ORDER, v, d) },
      { key: 'theme', label: 'DICTIONARY', fmt: (v) => themeLabel(v, this.game.settings.lang), step: (v, d) => cycle(THEME_ORDER, v, d) },
      { key: 'umlauts', label: 'UMLAUTS', fmt: (v) => (v ? 'ÄÖÜ' : 'AE OE UE'), step: (v) => !v, hide: () => this.game.settings.lang !== 'de' },
      { key: 'crt', label: 'CRT FILTER', fmt: (v) => (v ? 'ON' : 'OFF'), step: (v) => !v },
      { key: 'voice', label: 'ANNOUNCER', fmt: (v) => (v ? 'ON' : 'OFF'), step: (v) => !v },
    ];
    this.applySettings();
    this.drawRoster();
    this.drawScores();
    this.enter('boot');
  }

  visibleRows() { return this.rows.filter((r) => !r.hide?.()); }

  applySettings() {
    const s = this.game.settings;
    configureWords({ lang: s.lang, theme: s.theme, umlauts: s.umlauts });
    document.body.classList.toggle('crt', !!s.crt);
    this.game.post && (this.game.post.crt = s.crt ? 1 : 0);
    this.game.announcer.voiceOn = s.voice;
    this.game.announcer.lang = s.lang;
    document.documentElement.lang = s.lang;
    try { localStorage.setItem('tod-settings', JSON.stringify(s)); } catch { /* private mode */ }
    this.drawSettings();
    this.drawRoster();
    $('howto-text').innerHTML = LANGS[s.lang].howto
      + '<br/><br/>' + Object.entries(PICKUPS).map(([, p]) => `<b style="color:${p.css}">&#9632;</b> ${p[s.lang]}`).join('<br/>')
      + '<br/><br/><b>ESC</b> PAUSE &nbsp; <b>ENTER</b> CONTINUE';
  }

  drawSettings() {
    const s = this.game.settings;
    const rows = this.visibleRows();
    this.sel = Math.min(this.sel, rows.length - 1);
    $('settings').innerHTML = rows.map((r, i) => `
      <div class="setrow${i === this.sel ? ' sel' : ''}">
        <span class="marker">&#9654;</span><span class="setlabel">${r.label}</span><span
        class="arrow" data-i="${i}" data-d="-1">&#9668;</span><span class="setval">${r.fmt(s[r.key])}</span><span
        class="arrow" data-i="${i}" data-d="1">&#9658;</span>
      </div>`).join('');
    for (const el of $('settings').querySelectorAll('.arrow')) {
      el.addEventListener('click', () => {
        this.sel = Number(el.dataset.i);
        this.adjust(Number(el.dataset.d));
      });
    }
    $('wordcount').textContent = `${wordCount()} WORDS LOADED`;
  }

  adjust(d) {
    const r = this.visibleRows()[this.sel];
    const s = this.game.settings;
    s[r.key] = r.step(s[r.key], d);
    this.game.sfx.tick();
    this.applySettings();
  }

  drawRoster() {
    const lang = this.game.settings.lang;
    $('roster').innerHTML = Object.values(KINDS)
      .map((k) => `<div class="n">${k[lang][0]}</div><div class="d">${k[lang][1]}</div>`).join('');
  }

  drawScores() {
    const list = loadScores();
    $('scores').innerHTML = list.map((e, i) => `
      <tr class="${i === this.freshScore ? 'fresh' : ''}"><td>${String(i + 1).padStart(2, ' ')}${['ST', 'ND', 'RD'][i] ?? 'TH'}</td>
      <td>${String(e.score).padStart(7, ' ')}</td><td>${e.name}</td></tr>`).join('');
    $('hiscore').textContent = list[0].score.toLocaleString('en-US');
  }

  showPage(id) {
    for (const p of PAGES) $('page-' + p.id).classList.toggle('on', p.id === id);
    if (id === 'story') { this.storyChars = 0; }
    if (id === 'scores') this.drawScores();
  }

  // ---- phase machine ----
  enter(phase) {
    this.phase = phase;
    this.t = 0;
    const title = $('title');
    $('boot').style.display = phase === 'boot' ? 'block' : 'none';
    $('publisher').classList.toggle('on', phase === 'publisher');
    title.classList.toggle('dark', phase === 'boot' || phase === 'publisher');
    if (phase === 'boot') {
      $('boot').innerHTML = '';
      this.bootLine = 0;
    }
    if (phase === 'logo') {
      const logo = $('logo');
      logo.classList.remove('shown', 'slam');
      void logo.offsetWidth; // restart the animation
      logo.classList.add('slam');
      [...logo.querySelectorAll('.l')].forEach((l, i) => { l.style.animationDelay = `${i * 0.07}s`; });
      $('tagline').classList.remove('on');
      this.showPage(null);
      this.slammed = false;
      this.game.sfx.whoosh();
    }
    if (phase === 'pages') {
      $('logo').classList.add('shown');
      $('tagline').classList.add('on');
      this.pageT = 0;
      this.showPage(PAGES[this.page].id);
    }
  }

  // jump straight to the menu (any key from anywhere in the loop)
  toMenu() {
    if (this.phase !== 'pages') {
      $('logo').classList.remove('slam');
      this.enter('pages');
    }
    this.page = 0;
    this.pageT = 0;
    this.showPage('menu');
    this.game.sfx.ensure();
    this.game.sfx.setMode('title');
  }

  // back from a demo, a finished run, or the high-score table
  returnFromGame(page = 'menu') {
    this.page = Math.max(0, PAGES.findIndex((p) => p.id === page));
    this.enter('logo');
    this.skipToPage = true;
    this.game.sfx.setMode('title');
  }

  update(dt) {
    this.t += dt;
    switch (this.phase) {
      case 'boot': {
        const line = Math.floor(this.t / 0.28);
        while (this.bootLine < Math.min(line, BOOT_LINES.length)) {
          $('boot').innerHTML += `<div>${BOOT_LINES[this.bootLine] || '&nbsp;'}</div>`;
          this.bootLine++;
          this.game.sfx.tick();
        }
        if (this.t > BOOT_LINES.length * 0.28 + 0.4 && !$('boot').querySelector('.bars')) {
          // a flash of colour bars before the picture comes up
          $('boot').innerHTML += '<div class="bars">' + ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000']
            .map((c) => `<div style="background:${c}"></div>`).join('') + '</div>';
        }
        if (this.t > BOOT_LINES.length * 0.28 + 1.1) this.enter('publisher');
        break;
      }
      case 'publisher':
        if (this.t > 2.6) this.enter('logo');
        break;
      case 'logo':
        // the D of DIE lands at ~0.6s: flash, stab, shake
        if (!this.slammed && this.t > 0.85) {
          this.slammed = true;
          const wf = $('whiteflash');
          wf.classList.remove('on'); void wf.offsetWidth; wf.classList.add('on');
          this.game.sfx.stab();
          this.game.shakeT = Math.max(this.game.shakeT, 0.4);
          this.game.announcer.say(this.game.settings.lang === 'de' ? 'Tipp oder stirb!' : 'Type... or die!', { pitch: 0.1, rate: 0.7 });
        }
        if (this.t > (this.skipToPage ? 1.4 : 2.2)) { this.skipToPage = false; this.enter('pages'); }
        break;
      case 'pages': {
        this.pageT += dt;
        const page = PAGES[this.page];
        if (page.id === 'story') this.typeStory(dt);
        if (this.pageT > page.time) {
          this.page++;
          this.pageT = 0;
          if (this.page >= PAGES.length) {
            this.page = 0;
            this.game.startDemo();
            return;
          }
          this.showPage(PAGES[this.page].id);
        }
        break;
      }
    }
  }

  typeStory(dt) {
    const lines = LANGS[this.game.settings.lang].story;
    const full = lines.join('\n');
    const before = Math.floor(this.storyChars);
    this.storyChars = Math.min(full.length, this.storyChars + dt * 34);
    const n = Math.floor(this.storyChars);
    if (n !== before) {
      if (full[n - 1] && full[n - 1] !== ' ' && full[n - 1] !== '\n') this.game.sfx.tick();
      $('story-text').innerHTML = full.slice(0, n).replace(/\n/g, '<br/>') + '<span class="cur">&nbsp;</span>';
    }
  }

  // returns true if the key was consumed
  key(e) {
    if (this.phase !== 'pages' || PAGES[this.page].id !== 'menu') {
      this.toMenu();
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const n = this.visibleRows().length;
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.game.sfx.tick();
      this.drawSettings();
      this.pageT = 0;
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.adjust(e.key === 'ArrowRight' ? 1 : -1);
      this.pageT = 0;
      return true;
    }
    if (e.key === 'Enter') {
      this.insertCoin();
      return true;
    }
    this.pageT = 0;
    return true;
  }

  insertCoin() {
    if (this.starting) return;
    this.starting = true;
    this.credits++;
    $('credits').textContent = `CREDIT ${this.credits}`;
    this.game.sfx.coin();
    $('start-prompt').textContent = '1 PLAYER START';
    setTimeout(() => {
      this.starting = false;
      this.credits = Math.max(0, this.credits - 1);
      $('credits').textContent = `CREDIT ${this.credits}`;
      $('start-prompt').textContent = 'PRESS ENTER';
      this.game.startGame();
    }, 650);
  }

  // high-score bookkeeping
  qualifies(score) {
    const list = loadScores();
    return list.length < 10 || score > list[list.length - 1].score;
  }

  record(name, score) {
    const list = loadScores();
    list.push({ name, score });
    list.sort((a, b) => b.score - a.score);
    this.freshScore = list.findIndex((e) => e.name === name && e.score === score);
    saveScores(list);
    this.drawScores();
  }
}

function cycle(list, v, d) {
  const i = list.indexOf(v);
  return list[(i + d + list.length) % list.length];
}
