import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { Floater } from './floater.js';
import { Fx } from './fx.js';
import { pickWord, bossText, question, endings, TYPEABLE } from './words.js';
import { STAGES, FIGHTS, KINDS, PICKUPS } from './levels.js';
import { Attract, loadSettings, loadScores } from './attract.js';
import { Announcer } from './announcer.js';

const ADVANCE_DIST = 26;
const MAX_HP = 5;
const EXTRA_LIFE_EVERY = 30000;
const COMBO_SHOUTS = [
  [10, 'NICE!', 'nice', ''], [25, 'GREAT!', 'great', 'good'], [50, 'EXCELLENT!', 'excellent', 'good'],
  [75, 'INCREDIBLE!', 'incredible', 'cool'], [100, 'UNSTOPPABLE!', 'unstoppable', 'bad'],
];
const NUMBERS = {
  en: ['one', 'two', 'three', 'four', 'five'],
  de: ['eins', 'zwei', 'drei', 'vier', 'fünf'],
};
const BOSS_VOLLEY = { gondolier: { prop: 'fish', n: 1 }, chef: { prop: 'cleaver', n: 2 }, chancellor: { prop: 'coin', n: 3 } };

function rand(a, b) { return a + Math.random() * (b - a); }
function weighted(mix) {
  const entries = Object.entries(mix);
  let r = Math.random() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

const $ = (id) => document.getElementById(id);

const BULLET_GEO = new THREE.CapsuleGeometry(0.03, 0.55, 3, 6);
const SHELL_GEO = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 10).rotateX(Math.PI / 2);
const RING_GEO = new THREE.RingGeometry(0.3, 0.38, 28);
const BULLET_SPEED = 75;

// lock-on reticle: four corner brackets that spin slowly around the target's
// head and snap tight on every hit
function makeReticle() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.strokeStyle = '#fff';
  c.lineWidth = 7;
  c.lineCap = 'round';
  const m = 14, l = 30;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [S - m, m, -1, 1], [m, S - m, 1, -1], [S - m, S - m, -1, -1]]) {
    c.beginPath();
    c.moveTo(x, y + dy * l); c.lineTo(x, y); c.lineTo(x + dx * l, y);
    c.stroke();
  }
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(S / 2, S / 2, 4, 0, Math.PI * 2); c.fill();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), color: new THREE.Color(0xffb84a).multiplyScalar(1.4),
    transparent: true, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.85,
  }));
  sprite.renderOrder = 9;
  sprite.visible = false;
  return sprite;
}

export class Game {
  constructor(scene, camera, sfx, gun) {
    this.scene = scene;
    this.camera = camera;
    this.sfx = sfx;
    this.gun = gun;
    this.world = null;   // set by main.js, drives district moods
    this.post = null;    // set by main.js, screen-space hurt/kill pulses
    this.fovKick = 0;
    this.groanT = 3;
    this.beatT = 0;
    this.slowmo = 0;     // real seconds of bullet-time remaining
    this.dangerAcc = 0;  // music-intensity poll timer
    this.demo = false;   // attract mode: the game plays itself
    this.autoT = 0;

    // title|intro|playing|advance|bossintro|boss|volley|question|ending|
    // gameover|tally|results|initials|pause
    this.state = 'title';
    this.stateT = 0;
    this.time = 0;
    this.pausedFrom = null;

    this.zombies = [];   // ghouls, power-up canisters and boss projectiles
    this.target = null;
    this.effects = [];   // tracers, limbs, shells, rings, popups {obj, life, ttl, vel?}
    this.fx = new Fx(scene); // instanced blood, gibs, decals, sparks, smoke
    this.reticle = makeReticle();
    this.reticlePulse = 0;
    scene.add(this.reticle);
    this.baseZ = 0;      // camera rail position
    this.advanceFrom = 0;
    this.shakeT = 0;

    this.fightIdx = 0;
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0;
    this.pickupsLeft = 0;
    this.pickupTimer = 0;
    this.freezeT = 0;
    this.doubleT = 0;

    this.hp = MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.kills = 0;
    this.typeTime = 0;   // active combat seconds, for WPM
    this.coffees = 0;    // continues used
    this.nextLife = EXTRA_LIFE_EVERY;
    this.stage = { hits: 0, misses: 0, damage: 0, maxCombo: 0, time: 0 };

    this.boss = null;
    this.bossKind = null;
    this.bossHP = 6;
    this.bossMaxHP = 6;
    this.bossPhrases = [];
    this.phrase = '';
    this.phraseProgress = 0;
    this.phraseTimer = 0;
    this.phraseTimeMax = 1;
    this.usedPhrases = [];
    this.phrasesDone = 0;

    this.question = null;
    this.answerLock = -1; // question phase
    this.answerProgress = 0;
    this.initials = '';

    this.hud = {
      root: $('hud'), hearts: $('hearts'), score: $('score'), combo: $('combo'), mult: $('mult'),
      combobar: $('combobar').firstElementChild, powers: $('powers'),
      wavelabel: $('wavelabel'), banner: $('banner'), typebar: $('typebar'),
      bossui: $('bossui'), bossname: $('bossname'), bosshp: $('bosshp').firstElementChild,
      bosstimer: $('bosstimer').firstElementChild, phrasebox: $('phrasebox'),
      questionbox: $('questionbox'), answers: $('answers'), redflash: $('redflash'),
    };
    this.screens = {
      title: $('title'), pause: $('pause'), gameover: $('gameover'), ending: $('ending'),
      results: $('results'), tally: $('tally'), initials: $('initials'),
    };
    this.heartEls = [];
    for (let i = 0; i < MAX_HP; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      this.hud.hearts.appendChild(h);
      this.heartEls.push(h);
    }

    this.settings = loadSettings();
    this.announcer = new Announcer($('shouts'));
    this.attract = new Attract(this);

    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get fight() { return FIGHTS[this.fightIdx]; }
  get lang() { return this.settings.lang; }
  waveCount() { return Math.max(3, Math.round(this.fight.count * this.settings.horde)); }
  waveSimult() { return Math.max(1, Math.round(this.fight.simult * this.settings.horde)); }
  ghouls() { return this.zombies.filter((z) => !z.isFloater); }

  // ---------------- state helpers ----------------
  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  showScreen(name) {
    if (name) this.hideBanner();
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
    $('cabinet').style.display = name === 'title' ? 'flex' : 'none';
  }

  banner(text, sub = '', stage = '', warn = false) {
    const b = this.hud.banner;
    b.classList.remove('on');
    void b.offsetWidth; // restart the slam
    b.innerHTML = (stage ? `<span class="stage">${stage}</span>` : '') + text + (sub ? `<span class="sub">${sub}</span>` : '');
    b.style.color = warn ? '#ff3b3b' : '';
    b.classList.add('on');
  }
  hideBanner() { this.hud.banner.classList.remove('on'); }

  say(en, de, opts) { this.announcer.say(this.lang === 'de' ? de : en, opts); }

  // ---------------- game flow ----------------
  clearField() {
    for (const z of this.zombies) z.dispose(this.scene);
    if (this.boss) { this.boss.dispose(this.scene); this.boss = null; }
    this.zombies = [];
    this.target = null;
  }

  startGame() {
    this.clearField();
    this.baseZ = 0;
    this.fightIdx = 0;
    this.hp = MAX_HP;
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.kills = 0;
    this.hits = 0; this.misses = 0; this.typeTime = 0; this.coffees = 0;
    this.nextLife = EXTRA_LIFE_EVERY;
    this.freezeT = 0; this.doubleT = 0;
    this.usedPhrases = [];
    this.slowmo = 0;
    this.resetStageStats();
    this.hiScore = loadScores()[0]?.score ?? 0;
    this.showScreen(null);
    this.announcer.clear();
    this.sfx.setMode('game');
    this.hud.root.style.display = 'block';
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.hud.questionbox.style.display = 'none';
    this.startWave();
    this.updateHUD();
  }

  resetStageStats() {
    this.stage = { hits: 0, misses: 0, damage: 0, maxCombo: 0, time: 0 };
  }

  startWave() {
    const f = this.fight;
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0.8;
    this.pickupsLeft = f.pickups;
    this.pickupTimer = rand(5, 10);
    this.world?.setMood(f.mood);
    const st = STAGES[f.stage];
    this.hud.wavelabel.textContent = `${st.name[this.lang]} ${f.stage + 1}-${f.area + 1}`;
    if (f.area === 0) {
      this.banner(st.name[this.lang], f.sub[this.lang], `STAGE ${f.stage + 1}`);
      this.say(`Stage ${NUMBERS.en[f.stage]}`, `Level ${NUMBERS.de[f.stage]}`);
    } else {
      this.banner(`AREA ${f.stage + 1}-${f.area + 1}`, f.sub[this.lang]);
    }
    this.sfx.waveChime();
    this.setState('intro');
  }

  waveCleared() {
    this.hideBanner();
    for (const z of this.zombies) if (z.isPickup) z.die(); // unclaimed power-ups fizzle
    this.advanceFrom = this.baseZ;
    const next = FIGHTS[this.fightIdx + 1];
    if (next?.type === 'boss') {
      const b = bossText(next.boss);
      this.banner('WARNING!', `${b.name} &mdash; ${b.title}`, '', true);
      this.say('Warning! A huge monster is approaching.', 'Achtung! Ein riesiges Monster nähert sich.');
      this.sfx.bossRoar();
      this.setState('bossintro');
    } else {
      this.banner('CLEAR!', this.lang === 'de' ? 'WEITER...' : 'ADVANCING...');
      this.setState('advance');
      this.sfx.waveChime();
    }
  }

  startBoss() {
    this.hideBanner();
    const f = this.fight;
    this.bossKind = f.boss;
    const text = bossText(f.boss);
    this.bossPhrases = text.phrases;
    this.boss = new Zombie('', this.camera.position.x, this.baseZ - 17, 0, {
      boss: f.boss, tint: { gondolier: 0x7a8a8a, chef: 0x9a9480, chancellor: 0x86986a }[f.boss],
    });
    this.boss.setState('idle');
    this.boss.label.visible = false;
    this.scene.add(this.boss.group);
    this.bossMaxHP = f.hp;
    this.bossHP = f.hp;
    this.phrasesDone = 0;
    this.hud.bossui.style.display = 'block';
    this.hud.bossname.innerHTML = `${text.name} &mdash; "${text.title}"`;
    this.hud.bosshp.style.width = '100%';
    this.hud.phrasebox.style.display = 'block';
    this.hud.wavelabel.textContent = `${STAGES[f.stage].name[this.lang]} ${f.stage + 1}-BOSS`;
    this.world?.setMood(f.mood);
    this.sfx.bossRoar();
    this.shakeT = 0.6;
    this.nextPhrase();
    this.setState('boss');
  }

  nextPhrase() {
    const pool = this.bossPhrases.filter((p) => !this.usedPhrases.includes(p));
    const list = pool.length ? pool : this.bossPhrases;
    this.phrase = list[Math.floor(Math.random() * list.length)];
    this.usedPhrases.push(this.phrase);
    this.phraseProgress = 0;
    this.phraseTimeMax = (5 + this.phrase.length * 0.33) / this.settings.speed;
    this.phraseTimer = this.phraseTimeMax;
    this.hud.phrasebox.style.display = 'block';
    this.drawPhrase();
  }

  drawPhrase() {
    const done = this.phrase.slice(0, this.phraseProgress);
    const todo = this.phrase.slice(this.phraseProgress);
    this.hud.phrasebox.innerHTML =
      `<span class="done">${done}</span><span class="todo">${todo}</span>`;
  }

  // the boss winds up and throws: every projectile is a short word to shoot down
  startVolley() {
    this.hud.phrasebox.style.display = 'none';
    this.boss.setState('throw');
    this.setState('volley');
    this.volleyThrown = false;
    this.shout(this.lang === 'de' ? 'ACHTUNG!' : 'INCOMING!', 'bad');
  }

  spawnVolley() {
    this.volleyThrown = true;
    const v = BOSS_VOLLEY[this.bossKind];
    const n = v.n + (this.bossHP <= 2 ? 1 : 0);
    const from = this.boss.handWorldPos(new THREE.Vector3());
    this.sfx.whoosh();
    for (let i = 0; i < n; i++) {
      const inUse = this.zombies.filter((z) => z.state !== 'dying').map((z) => z.word);
      const word = pickWord(i === 0 ? 1 : 0, inUse);
      const to = this.camera.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.1), -0.6));
      const time = (3.2 + i * 0.5 + word.length * 0.18) / this.settings.speed;
      const p = new Floater(word, 'projectile', { prop: v.prop, from, to, time, delay: i * 0.45, slot: i % 2 }, Zombie.env);
      this.scene.add(p.group);
      this.zombies.push(p);
    }
  }

  startQuestion() {
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.question = question();
    this.answerLock = -1;
    this.answerProgress = 0;
    this.hud.questionbox.style.display = 'block';
    this.hud.questionbox.querySelector('h2').textContent = this.question.prompt;
    this.drawAnswers();
    this.setState('question');
  }

  drawAnswers() {
    this.hud.answers.innerHTML = this.question.answers.map((a, i) => {
      const locked = this.answerLock === i;
      const done = locked ? a.text.slice(0, this.answerProgress) : '';
      const todo = locked ? a.text.slice(this.answerProgress) : a.text;
      const dim = this.answerLock !== -1 && !locked ? 'opacity:0.25' : '';
      return `<div class="answer" style="${dim}"><span class="done">${done}</span><span>${todo}</span></div>`;
    }).join('');
  }

  // a boss goes down: decapitation, coins, slow motion
  killBoss() {
    const b = this.boss;
    this.spawnGore(b.headWorldPos(new THREE.Vector3()), 70, 2.2);
    this.spawnBloodPool(b.group.position);
    const skull = b.decapitate();
    if (skull) { this.flingPart(skull, 2); this.spawnFountain(b, 1.6); }
    b.die();
    this.sfx.kill();
    this.slowmo = 1.4;
    this.shakeT = 0.6;
  }

  finishBoss(endingKey) {
    this.hud.questionbox.style.display = 'none';
    if (this.boss) this.killBoss();
    this.endingKey = endingKey;
    this.setState('ending');
    const e = endings()[endingKey];
    setTimeout(() => {
      if (this.state !== 'ending') return;
      $('endingtitle').textContent = e.title;
      $('endingtext').textContent = e.text;
      this.showScreen('ending');
    }, 1400);
  }

  // the stage boss is down: count up the bonuses, arcade style
  startTally() {
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    const s = this.stage;
    const acc = s.hits + s.misses > 0 ? s.hits / (s.hits + s.misses) : 1;
    const de = this.lang === 'de';
    const rows = [
      [de ? 'TREFFERQUOTE' : 'ACCURACY', `${(acc * 100).toFixed(1)}%`, Math.round(acc * acc * 20000)],
      [de ? 'MAX. COMBO' : 'MAX COMBO', `${s.maxCombo}`, s.maxCombo * 60],
      [de ? 'OHNE TREFFER' : 'NO DAMAGE', s.damage === 0 ? (de ? 'JA!' : 'YES!') : '—', s.damage === 0 ? 15000 : 0],
    ];
    const total = rows.reduce((n, r) => n + r[2], 0);
    this.tally = { rows, total, shown: 0, counted: 0, t: 0, done: false };
    $('tally-name').textContent = `STAGE ${this.fight.stage + 1} — ${STAGES[this.fight.stage].name[this.lang]}`;
    $('tally-table').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2].toLocaleString('en-US')}</td></tr>`).join('')
      + `<tr class="total"><td>BONUS</td><td></td><td id="tally-total">0</td></tr>`;
    this.showScreen('tally');
    this.sfx.fanfare();
    this.say('Stage clear!', 'Level geschafft!');
    this.setState('tally');
  }

  updateTally(dt) {
    const T = this.tally;
    T.t += dt;
    const rowsEls = $('tally-table').querySelectorAll('tr');
    const want = Math.min(rowsEls.length, Math.floor(T.t / 0.55));
    while (T.shown < want) {
      rowsEls[T.shown].classList.add('on');
      T.shown++;
      this.sfx.tick();
    }
    if (T.shown >= rowsEls.length && T.counted < T.total) {
      const add = Math.min(Math.max(150, Math.ceil(T.total / 60)), T.total - T.counted);
      T.counted += add;
      this.score += add;
      $('tally-total').textContent = T.counted.toLocaleString('en-US');
      if (Math.floor(T.t * 30) % 2 === 0) this.sfx.tick();
      this.updateHUD();
      if (T.counted >= T.total) { T.done = true; T.doneT = T.t; }
    } else if (T.shown >= rowsEls.length && !T.done) {
      T.done = true; T.doneT = T.t;
    }
    if (T.done && T.t - T.doneT > (this.demo ? 1.5 : 3.5)) this.leaveTally();
  }

  leaveTally() {
    if (this.state !== 'tally') return;
    // make sure the whole bonus landed even if the count was skipped
    if (this.tally.counted < this.tally.total) { this.score += this.tally.total - this.tally.counted; this.tally.counted = this.tally.total; }
    this.checkExtraLife();
    this.showScreen(null);
    this.resetStageStats();
    this.advanceFrom = this.baseZ;
    this.setState('advance');
  }

  showResults() {
    const acc = this.hits + this.misses > 0 ? (100 * this.hits) / (this.hits + this.misses) : 100;
    const minutes = Math.max(this.typeTime / 60, 0.01);
    const wpm = Math.round(this.hits / 5 / minutes);
    $('r-score').textContent = this.score.toLocaleString('en-US');
    $('r-acc').textContent = acc.toFixed(1) + '%';
    $('r-combo').textContent = this.maxCombo;
    $('r-wpm').textContent = wpm;
    $('r-kills').textContent = this.kills;
    $('r-coffee').textContent = `${this.coffees} cup${this.coffees === 1 ? '' : 's'}`;
    let rank = 'D';
    if (acc >= 97 && this.coffees === 0 && wpm >= 45) rank = 'S';
    else if (acc >= 93 && this.coffees <= 1) rank = 'A';
    else if (acc >= 85) rank = 'B';
    else if (acc >= 70) rank = 'C';
    $('rank').textContent = rank;
    this.hud.root.style.display = 'none';
    this.showScreen('results');
    this.setState('results');
  }

  leaveResults() {
    if (!this.demo && this.attract.qualifies(this.score)) {
      this.initials = '';
      this.drawInitials();
      $('initials-score').textContent = this.score.toLocaleString('en-US');
      this.showScreen('initials');
      this.setState('initials');
      this.say('New high score! Enter your initials.', 'Neuer Highscore! Gib deine Initialen ein.');
      this.sfx.fanfare();
    } else {
      this.backToTitle('scores');
    }
  }

  drawInitials() {
    const slots = $('initials').querySelectorAll('.slot');
    slots.forEach((s, i) => {
      s.textContent = this.initials[i] ?? '';
      s.classList.toggle('cur', i === this.initials.length);
    });
  }

  backToTitle(page = 'menu') {
    this.clearField();
    this.hud.root.style.display = 'none';
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.hud.questionbox.style.display = 'none';
    this.hideBanner();
    this.slowmo = 0;
    this.sfx.setIntensity(0);
    this.announcer.clear();
    this.showScreen('title');
    this.setState('title');
    this.attract.returnFromGame(page);
  }

  gameOver() {
    this.hud.typebar.innerHTML = '';
    $('countdown').textContent = '9';
    this.showScreen('gameover');
    this.setState('gameover');
    this.say('Game over. Continue?', 'Game over. Weiterspielen?', { pitch: 0.1, rate: 0.7 });
  }

  // ---------------- attract mode ----------------
  startDemo() {
    this.demo = true;
    this.demoStart = this.time;
    this.autoT = 1;
    $('demobadge').style.display = 'block';
    this.startGame();
  }

  exitDemo() {
    this.demo = false;
    $('demobadge').style.display = 'none';
    this.backToTitle('menu');
  }

  // the ghost of Agent Verdana types on: mostly accurate, occasionally sloppy
  autoType() {
    if (['playing', 'intro', 'volley'].includes(this.state)) {
      let z = this.target;
      if (z && (z.state === 'dying' || z.dead)) z = null;
      if (!z) {
        let bd = Infinity;
        for (const c of this.zombies) {
          if (c.state === 'dying' || !c.group.visible) continue;
          const d = c.group.position.distanceTo(this.camera.position);
          if (d < bd) { bd = d; z = c; }
        }
      }
      if (!z) return;
      const correct = z.word[this.target === z ? z.progress : 0];
      const ch = Math.random() < 0.04 ? 'qxjz'[Math.floor(Math.random() * 4)] : correct;
      this.typeCombat(ch);
    } else if (this.state === 'boss') {
      const ch = this.phrase[this.phraseProgress];
      if (ch) this.typeBoss(Math.random() < 0.02 ? 'q' : ch);
    } else if (this.state === 'question') {
      if (this.answerLock === -1) {
        const i = Math.floor(Math.random() * this.question.answers.length);
        this.typeAnswer(this.question.answers[i].text[0]);
      } else {
        const a = this.question.answers[this.answerLock];
        this.typeAnswer(a.text[this.answerProgress]);
      }
    }
  }

  continueGame() {
    // arcade continue: full HP, restart current fight
    this.coffees++;
    this.hp = MAX_HP;
    for (const z of this.zombies) z.dispose(this.scene);
    this.zombies = [];
    this.target = null;
    this.showScreen(null);
    this.sfx.coin();
    this.say('Here we go!', 'Weiter gehts!');
    if (this.boss) {
      this.boss.setState('idle');
      this.nextPhrase();
      this.setState('boss');
    } else {
      this.startWave();
    }
    this.updateHUD();
  }

  // ---------------- input ----------------
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.demo) { this.exitDemo(); return; } // any key reclaims the controls
    this.sfx.ensure();

    if (this.state === 'title') { this.attract.key(e); return; }

    if (e.key === 'Escape') {
      if (this.state === 'pause') {
        this.showScreen(null);
        this.setState(this.pausedFrom);
      } else if (['playing', 'advance', 'intro', 'boss', 'volley', 'question', 'bossintro'].includes(this.state)) {
        this.pausedFrom = this.state;
        this.showScreen('pause');
        this.setState('pause');
      }
      return;
    }

    if (this.state === 'initials') { this.typeInitials(e); return; }

    if (e.key === 'Enter') {
      if (this.state === 'gameover') this.continueGame();
      else if (this.state === 'ending') this.showResults();
      else if (this.state === 'results') this.leaveResults();
      else if (this.state === 'tally') this.leaveTally();
      return;
    }

    if (e.key.length !== 1 || e.repeat) return;
    const ch = e.key.toLowerCase();
    if (!TYPEABLE.test(ch)) return;
    e.preventDefault();

    if (['playing', 'intro', 'volley'].includes(this.state)) this.typeCombat(ch);
    else if (this.state === 'boss') this.typeBoss(ch);
    else if (this.state === 'question') this.typeAnswer(ch);
  }

  typeInitials(e) {
    if (e.key === 'Backspace') {
      this.initials = this.initials.slice(0, -1);
    } else if (e.key === 'Enter') {
      const name = (this.initials + '...').slice(0, 3);
      this.attract.record(name, this.score);
      this.sfx.coin();
      this.backToTitle('scores');
      return;
    } else if (e.key.length === 1 && /[a-z0-9äöü!?.]/i.test(e.key) && this.initials.length < 3) {
      this.initials += e.key.toUpperCase();
      this.sfx.shot();
    }
    this.drawInitials();
  }

  typeCombat(ch) {
    let z = this.target;
    if (z && (z.state === 'dying' || z.dead)) { z = null; this.target = null; }
    if (!z) {
      // lock nearest target whose word starts with the typed letter
      let best = null, bestD = Infinity;
      for (const c of this.zombies) {
        if (c.state === 'dying' || (c.state === 'rise' && c.stateT < 0.6) || c.group.visible === false) continue;
        if (c.word[0] !== ch) continue;
        const d = c.group.position.distanceTo(this.camera.position);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) { this.registerMiss(); return; }
      this.target = best;
      z = best;
      z.progress = 0;
      z.missed = false;
    }
    if (z.word[z.progress] === ch) {
      z.progress++;
      this.registerHit(z);
      z.drawLabel(true);
      if (z.progress >= z.word.length) this.killZombie(z);
    } else {
      z.missed = true;
      this.registerMiss();
      z.drawLabel(true);
    }
    this.updateHUD();
  }

  typeBoss(ch) {
    if (this.phrase[this.phraseProgress] === ch) {
      this.phraseProgress++;
      this.registerHit(this.boss);
      this.drawPhrase();
      if (this.phraseProgress >= this.phrase.length) this.damageBoss();
    } else {
      this.registerMiss();
    }
    this.updateHUD();
  }

  typeAnswer(ch) {
    const Q = this.question;
    if (this.answerLock === -1) {
      const i = Q.answers.findIndex((a) => a.text[0] === ch);
      if (i === -1) { this.sfx.miss(); return; }
      this.answerLock = i;
      this.answerProgress = 1;
      this.sfx.shot();
    } else {
      const a = Q.answers[this.answerLock];
      if (a.text[this.answerProgress] === ch) {
        this.answerProgress++;
        this.sfx.shot();
      } else {
        this.sfx.miss();
      }
    }
    const a = Q.answers[this.answerLock];
    if (a && this.answerProgress >= a.text.length) {
      this.finishBoss(a.ending);
    }
    this.drawAnswers();
  }

  addScore(pts) {
    const k = this.doubleT > 0 ? 2 : 1;
    this.score += pts * k;
    this.checkExtraLife();
    return pts * k;
  }

  checkExtraLife() {
    while (this.score >= this.nextLife) {
      this.nextLife += EXTRA_LIFE_EVERY;
      if (this.hp < MAX_HP) {
        this.hp++;
        this.heartEls[this.hp - 1]?.classList.add('pop');
        this.shout('EXTRA LIFE!', 'good');
        this.say('Extra life!', 'Extraleben!');
      } else {
        this.score += 5000;
        this.shout('+5000', 'good', this.lang === 'de' ? 'VOLLE GESUNDHEIT' : 'FULL HEALTH BONUS');
      }
      this.sfx.extraLife();
    }
  }

  multiplier() { return Math.min(8, 1 + Math.floor(this.combo / 10)); }

  registerHit(z) {
    this.hits++;
    this.stage.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.stage.maxCombo = Math.max(this.stage.maxCombo, this.combo);
    this.addScore(10 * this.multiplier());
    for (const [n, text, voice, kind] of COMBO_SHOUTS) {
      if (this.combo === n) { this.shout(text, kind, `${n} COMBO`); this.announcer.say(voice, { lang: 'en' }); }
    }
    if (this.combo > 100 && this.combo % 50 === 0) {
      this.shout('GODLIKE!', 'cool', `${this.combo} COMBO`);
      this.announcer.say('godlike', { lang: 'en' });
    }
    this.sfx.shot(this.combo);
    this.gun.fire();
    this.spawnShell();
    const muzzle = this.gun.muzzleWorldPos(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.fx.puff(muzzle, {
      color: 0x8c9098, size: 0.1, grow: 4, ttl: 1.1, opacity: 0.22,
      vel: fwd.multiplyScalar(1.2).add(new THREE.Vector3(0, 0.35, 0)),
    });
    if (z) {
      this.spawnBullet(z);
      z.hit?.();
      this.reticlePulse = 1;
      // every landed letter strips a part off a regular ghoul
      if (!z.isBoss && !z.isFloater) {
        const part = z.shed();
        if (part) this.flingPart(part, 0.8);
      }
    }
  }

  registerMiss() {
    this.misses++;
    this.stage.misses++;
    if (this.combo >= 10) this.shout(this.lang === 'de' ? 'COMBO WEG' : 'COMBO BREAKER', 'bad');
    this.combo = 0;
    this.sfx.miss();
  }

  shout(text, kind = '', sub = '') { this.announcer.shout(text, kind, sub); }

  // opts.blast: caught in a bloater's explosion (no shooting, just chunks)
  killZombie(z, opts = {}) {
    if (z.state === 'dying') return;
    if (this.target === z) this.target = null;
    if (z.isPickup) { this.collectPickup(z); return; }
    if (z.isProjectile) { this.shootDown(z); return; }
    const head = z.headWorldPos(new THREE.Vector3());
    let pts = 50 + z.word.length * 15;
    if (z.kind === 'brute') pts *= 2;
    if (opts.blast) pts = 250 * opts.chain;
    pts = this.addScore(pts);
    this.kills++;
    this.sfx.kill();
    this.spawnGore(head, 30, 1.15);
    this.spawnBloodPool(z.group.position);
    this.spawnRing(head);
    this.spawnPopup(`+${pts}`, head);
    if (!opts.blast && !z.missed && z.word.length >= 6) {
      const bonus = this.addScore(100);
      this.spawnPopup(`PERFECT +${bonus}`, head.clone().add(new THREE.Vector3(0, 0.6, 0)), '#9dff8a', 'rgba(90,255,80,0.9)');
    }
    this.fovKick = Math.min(this.fovKick + 2.5, 8);
    if (this.post && !opts.blast) {
      this.post.punch = 1;
      // point-blank kills spatter the lens
      if (z.group.position.distanceTo(this.camera.position) < 4.5) this.post.splat('spatter');
    }
    // the last letter takes the head clean off
    const skull = z.decapitate();
    if (skull) { this.flingPart(skull, opts.blast ? 2.2 : 1.5); this.spawnFountain(z); }
    if (z.special === 'coffee' && this.hp < MAX_HP) {
      this.hp++;
      this.sfx.heart();
      this.spawnPopup('+♥', head, '#ff5a5a', 'rgba(255,60,60,0.9)');
    }
    z.die();
    this.countKill();
    if (z.kind === 'bloater') this.explode(z, opts.chain ?? 0);
  }

  countKill() {
    this.killed++;
    if (this.killed >= this.waveCount() && (this.state === 'playing' || this.state === 'intro')) {
      this.slowmo = 0.9; // wave-clear finisher in bullet-time
      this.waveCleared();
    }
    this.updateHUD();
  }

  // a bloater pops: a green blast that takes its neighbours with it
  explode(z, chain) {
    const pos = z.group.position.clone();
    const c = pos.clone().setY(1.2);
    this.sfx.explosion(1);
    this.fx.spray(c, null, 50, 2, 0x7adf30);
    this.fx.puff(c, { color: 0x6aff30, size: 1.2, grow: 4, ttl: 0.9, opacity: 0.55, additive: true });
    this.fx.puff(c, { color: 0x2a4a10, size: 1.5, grow: 3, ttl: 1.8, opacity: 0.4 });
    this.fx.spark(c, 30, 0xa0ff60, 9);
    this.fx.impactLight(c, 3);
    this.spawnRing(c, 0x8aff40);
    this.spawnRing(new THREE.Vector3(pos.x, 0.1, pos.z), 0x8aff40, true);
    this.shakeT = Math.max(this.shakeT, 0.35);
    const caught = this.ghouls().filter((o) => o !== z && o.state !== 'dying' && o.group.position.distanceTo(pos) < 4.2);
    if (caught.length) {
      const n = chain + caught.length + 1;
      this.shout(`CHAIN x${n}`, 'good');
      if (n >= 3) this.announcer.say('multi kill', { lang: 'en' });
      // ripple outward, a beat apart, so a chain reads as a chain
      caught.forEach((o, i) => setTimeout(() => {
        if (o.state !== 'dying' && !o.dead && this.zombies.includes(o)) this.killZombie(o, { blast: true, chain: n });
      }, 90 + i * 90));
    }
  }

  collectPickup(p) {
    const at = p.headWorldPos(new THREE.Vector3());
    p.die();
    this.sfx.powerup();
    this.spawnRing(at, PICKUPS[p.type].color);
    this.fx.spark(at, 24, PICKUPS[p.type].color, 6);
    this.fx.impactLight(at, 1.5);
    const de = this.lang === 'de';
    switch (p.type) {
      case 'medkit':
        this.hp = Math.min(MAX_HP, this.hp + 1);
        this.sfx.heart();
        this.shout('+1 ♥', 'good', 'MEDKIT');
        break;
      case 'bomb': {
        this.shout('NAPALM!', '', de ? 'ALLES BRENNT' : 'EVERYTHING BURNS');
        this.announcer.say('napalm', { lang: 'en' });
        this.sfx.explosion(1.6);
        this.shakeT = 0.6;
        if (this.post) this.post.punch = 2;
        const wf = $('whiteflash'); wf.classList.remove('on'); void wf.offsetWidth; wf.classList.add('on');
        const all = this.ghouls().filter((o) => o.state !== 'dying');
        all.forEach((o, i) => setTimeout(() => {
          if (o.state === 'dying' || o.dead || !this.zombies.includes(o)) return;
          this.fx.spark(o.headWorldPos(new THREE.Vector3()), 20, 0xff8a20, 7);
          this.killZombie(o, { blast: true, chain: 1 });
        }, 60 + i * 110));
        break;
      }
      case 'freeze':
        this.freezeT = 7;
        this.sfx.freeze();
        this.shout(de ? 'FROST!' : 'FREEZE!', 'cool');
        this.announcer.say('freeze', { lang: 'en' });
        break;
      case 'double':
        this.doubleT = 15;
        this.shout(de ? 'DOPPELTE PUNKTE' : 'DOUBLE SCORE', 'cool');
        this.announcer.say('double score', { lang: 'en' });
        break;
    }
    this.updateHUD();
  }

  shootDown(p) {
    const at = p.headWorldPos(new THREE.Vector3());
    p.die();
    const pts = this.addScore(150);
    this.spawnPopup(`+${pts}`, at);
    this.fx.spark(at, 26, 0xffc870, 8);
    this.fx.impactLight(at, 1.2);
    this.spawnRing(at);
    this.sfx.bossHit();
  }

  damageBoss() {
    this.bossHP--;
    this.phrasesDone++;
    this.sfx.bossHit();
    this.boss.setState('stagger');
    // each finished phrase costs a boss a piece: hat first, then arms, then jaw
    const part = this.boss.shed();
    if (part) this.flingPart(part, 1.4);
    this.hud.bosshp.style.width = `${(100 * this.bossHP) / this.bossMaxHP}%`;
    const head = this.boss.headWorldPos(new THREE.Vector3());
    this.spawnGore(head, 45, 1.6);
    this.spawnBloodPool(this.boss.group.position);
    this.spawnRing(head);
    this.spawnPopup(`+${this.addScore(400)}`, head);
    this.fovKick = Math.min(this.fovKick + 4.5, 9);
    this.shakeT = Math.max(this.shakeT, 0.3);
    if (this.post) this.post.punch = 1.5;
    if (this.bossHP <= 0) {
      this.slowmo = 1.2;
      this.sfx.bossRoar();
      if (this.bossKind === 'chancellor') {
        this.startQuestion();
      } else {
        this.addScore(5000);
        this.killBoss();
        this.shout('K.O.!', 'bad', '+5000');
        this.say('Boss defeated!', 'Boss besiegt!');
        this.hud.phrasebox.style.display = 'none';
        this.hud.bossui.style.display = 'none';
        this.setState('bossdown');
      }
    } else if (this.phrasesDone % 2 === 1 || this.bossHP <= 2) {
      this.startVolley();
    } else {
      this.nextPhrase();
    }
  }

  damagePlayer(n = 1) {
    if (this.demo && this.hp - n <= 0) n = 0; // the demo never dies, it just looks scared
    this.hp = Math.max(0, this.hp - n);
    this.stage.damage += n;
    this.shakeT = 0.45 + n * 0.1;
    this.sfx.hurt();
    if (this.post) { this.post.hurt = 1; this.post.splat('hurt'); }
    this.hud.redflash.classList.add('on');
    setTimeout(() => this.hud.redflash.classList.remove('on'), 180);
    if (this.combo >= 10) this.shout(this.lang === 'de' ? 'COMBO WEG' : 'COMBO BREAKER', 'bad');
    this.combo = 0;
    this.updateHUD();
    if (this.hp <= 0) this.gameOver();
  }

  // ---------------- spawning / effects ----------------
  spawnZombie() {
    const f = this.fight;
    const inUse = this.zombies.filter((z) => z.state !== 'dying').map((z) => z.word);
    const kind = weighted(f.mix);
    const word = pickWord(f.tier + KINDS[kind].tier, inUse);
    const late = f.stage > 0 || f.area > 0;
    const coffee = kind === 'walker' && late && this.hp < MAX_HP && Math.random() < 0.1;
    const riser = kind === 'walker' && !coffee && late && Math.random() < 0.3;
    const speed = rand(f.speed[0], f.speed[1]) * KINDS[kind].speed * this.settings.speed;
    let z;
    if (riser) {
      // it comes up out of the canal, soaked dark
      z = new Zombie(word, rand(13.5, 15.5), this.baseZ - rand(12, 24), speed, { tint: 0x5c6a54 });
      z.beginRise();
    } else {
      const dist = kind === 'runner' ? rand(32, 40) : kind === 'crawler' ? rand(17, 24) : rand(26, 36);
      z = new Zombie(word, this.camera.position.x + rand(-7, 7), this.baseZ - dist, speed, {
        kind, special: coffee ? 'coffee' : null,
      });
    }
    this.scene.add(z.group);
    this.zombies.push(z);
    this.spawned++;
    if (kind === 'runner') this.sfx.groan(rand(-0.5, 0.5));
  }

  spawnPickup() {
    const types = Object.keys(PICKUPS).filter((t) => t !== 'medkit' || this.hp < MAX_HP);
    const type = types[Math.floor(Math.random() * types.length)];
    const inUse = this.zombies.filter((z) => z.state !== 'dying').map((z) => z.word);
    const word = pickWord(Math.min(1, this.fight.tier), inUse);
    const p = new Floater(word, 'pickup', { type, z: this.baseZ - rand(13, 19) }, Zombie.env);
    this.scene.add(p.group);
    this.zombies.push(p);
    this.sfx.waveChime();
  }

  // rip a detached body part into the world as tumbling debris
  flingPart(part, power = 1) {
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    part.getWorldPosition(pos);
    part.getWorldQuaternion(quat);
    part.getWorldScale(scl);
    part.parent.remove(part);
    part.position.copy(pos);
    part.quaternion.copy(quat);
    part.scale.copy(scl);
    this.scene.add(part);
    this.effects.push({
      kind: 'limb', obj: part, life: 0, ttl: rand(0.9, 1.4), keepMats: true,
      baseScale: scl.clone(), spin: rand(6, 15),
      vel: new THREE.Vector3(rand(-2.5, 2.5) * power, rand(2, 4.5) * power, rand(-2.5, 2.5) * power),
    });
    this.spawnGore(pos, 10, 0.6);
  }

  spawnSplash(pos) {
    this.sfx.splash();
    const p = new THREE.Vector3(pos.x, -0.5, pos.z);
    this.fx.spray(p, null, 26, 1.2, 0x9fc0e8);
    this.fx.puff(p, { color: 0xb8cce0, size: 0.8, grow: 2.5, ttl: 0.8, opacity: 0.3 });
    this.spawnRing(new THREE.Vector3(pos.x, -0.55, pos.z), 0x9fc0e8, true);
  }

  // head of whatever we're shooting at, in camera space (null when nothing locked)
  aimLocal(cam) {
    let z = this.state === 'boss' ? this.boss : this.target;
    if (!z || z.dead || z.state === 'dying') return null;
    return cam.worldToLocal(z.headWorldPos(new THREE.Vector3()));
  }

  // glowing tracer round that flies from the muzzle to the target's head
  spawnBullet(z) {
    const start = this.gun.muzzleWorldPos(new THREE.Vector3());
    const end = z.headWorldPos(new THREE.Vector3());
    end.x += rand(-0.12, 0.12);
    end.y += rand(-0.1, 0.1);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    const m = new THREE.Mesh(BULLET_GEO, new THREE.MeshBasicMaterial({
      color: this.doubleT > 0 ? 0xe0a0ff : 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(start);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(m);
    this.effects.push({
      kind: 'bullet', obj: m, life: 0, ttl: dist / BULLET_SPEED,
      vel: dir.multiplyScalar(BULLET_SPEED), end, metal: !!z.isFloater,
    });
  }

  // where the bullet lands: sparks, a spurt out the back, red mist, a flash
  impact(pos, dir, metal) {
    this.fx.spark(pos, 9, 0xffc870, 6);
    if (!metal) {
      this.fx.spray(pos, dir, 9, 0.7);
      this.fx.puff(pos, { color: 0x6a0808, size: 0.25, grow: 2.5, ttl: 0.5, opacity: 0.5 });
    }
    this.fx.impactLight(pos, 0.6);
  }

  spawnShell() {
    const m = new THREE.Mesh(SHELL_GEO, new THREE.MeshStandardMaterial({
      color: 0xd8a848, metalness: 1, roughness: 0.25, envMap: this.gun.envMap ?? null, transparent: true,
    }));
    this.gun.ejectWorldPos(m.position);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const vel = right.multiplyScalar(rand(1.2, 2.2)).addScaledVector(up, rand(1.6, 2.6));
    this.scene.add(m);
    this.effects.push({ kind: 'shell', obj: m, life: 0, ttl: 0.9, vel, spin: rand(10, 22) });
  }

  spawnRing(pos, color = 0xffd479, flat = false) {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    m.position.copy(pos);
    if (flat) m.rotation.x = -Math.PI / 2;
    else m.lookAt(this.camera.position);
    this.scene.add(m);
    this.effects.push({ kind: 'ring', obj: m, life: 0, ttl: 0.35 });
  }

  spawnPopup(text, pos, color = '#ffd479', glow = 'rgba(255,180,60,0.9)') {
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d');
    const font = 'bold 48px "Courier New", monospace';
    c.font = font;
    cv.width = Math.ceil(c.measureText(text).width) + 24;
    cv.height = 64;
    c.font = font;
    c.textBaseline = 'middle';
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.strokeText(text, 12, 32);
    c.shadowColor = glow;
    c.shadowBlur = 10;
    c.fillStyle = color;
    c.fillText(text, 12, 32);
    const tex = new THREE.CanvasTexture(cv);
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false,
    }));
    m.position.copy(pos);
    m.position.y += 0.5;
    m.scale.set(cv.width / 80, 0.8, 1);
    m.renderOrder = 11;
    m.layers.set(1); // never in the puddles
    this.scene.add(m);
    this.effects.push({ kind: 'popup', obj: m, life: 0, ttl: 0.9, ownMap: true });
  }

  spawnGore(pos, n = 26, force = 1) {
    this.fx.spray(pos, null, n, force);
    this.fx.gibs(pos, Math.ceil(n / 7), force);
    this.fx.puff(pos, { color: 0x5a0606, size: 0.35 * force, grow: 3, ttl: 0.9, opacity: 0.45 });
  }

  spawnBloodPool(pos) {
    this.fx.splat(pos, rand(1.6, 2.4), 1.4);
  }

  // blood pumping from the neck stump for a moment after decapitation
  spawnFountain(z, ttl = 0.6) {
    this.effects.push({ kind: 'fountain', zombie: z, life: 0, ttl });
  }

  // ---------------- per-frame update ----------------
  // main calls advance() with the real frame dt; bullet-time scales it here
  advance(rawDt) {
    this.slowmo = Math.max(0, this.slowmo - rawDt);
    const dt = rawDt * (this.slowmo > 0 ? 0.25 : 1);
    this.update(dt, rawDt);
    return dt;
  }

  update(dt, rawDt = dt) {
    this.stateT += dt;
    this.time += dt;

    if (this.state === 'title') this.attract.update(rawDt);
    if (this.demo) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = rand(0.1, 0.22);
        this.autoType();
      }
      // the demo only shows the opening districts, then hands back to the title
      if ((this.fightIdx >= 2 && this.state === 'advance')
        || (this.state === 'gameover' && this.stateT > 3)
        || this.time - this.demoStart > 75) this.exitDemo();
    }

    // adaptive score: intensity follows how close the horde is
    this.dangerAcc -= dt;
    if (this.dangerAcc <= 0) {
      this.dangerAcc = 0.4;
      let danger = 0;
      if (this.state === 'boss' || this.state === 'volley') danger = 3;
      else if (['playing', 'intro', 'advance'].includes(this.state)) {
        danger = 1;
        let nearest = Infinity;
        for (const z of this.zombies) {
          if (z.state === 'dying' || z.isFloater) continue;
          nearest = Math.min(nearest, z.group.position.distanceTo(this.camera.position));
        }
        if (nearest < 7) danger = 3;
        else if (nearest < 13) danger = 2;
      }
      this.sfx.setIntensity(danger);
    }

    // power-up timers run in combat only
    if (['playing', 'intro', 'boss', 'volley'].includes(this.state)) {
      if (this.freezeT > 0) this.freezeT = Math.max(0, this.freezeT - rawDt);
      if (this.doubleT > 0) this.doubleT = Math.max(0, this.doubleT - rawDt);
    }

    // effects always tick
    this.fx.update(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life += dt;
      const p = fx.life / fx.ttl;
      switch (fx.kind) {
        case 'bullet':
          fx.obj.position.addScaledVector(fx.vel, dt);
          if (p >= 1) this.impact(fx.end, fx.vel.clone().normalize(), fx.metal);
          break;
        case 'fountain': {
          const z = fx.zombie;
          if (!z.dead) {
            const neck = z.body.localToWorld(new THREE.Vector3(0, 1.2, 0.12));
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(z.body.getWorldQuaternion(new THREE.Quaternion()));
            this.fx.spray(neck, up.multiplyScalar(1.4 * (1 - p)), 3, 0.5);
          }
          break;
        }
        case 'shell':
          fx.vel.y -= 14 * dt;
          fx.obj.position.addScaledVector(fx.vel, dt);
          fx.obj.rotation.x += fx.spin * dt;
          fx.obj.rotation.z += fx.spin * 0.7 * dt;
          fx.obj.material.opacity = 1 - p * p;
          break;
        case 'ring':
          fx.obj.scale.setScalar(1 + p * 5);
          fx.obj.material.opacity = 0.55 * (1 - p) * (1 - p);
          break;
        case 'popup':
          fx.obj.position.y += 1.5 * dt;
          fx.obj.material.opacity = 1 - p * p;
          break;
        case 'limb': // a shot-off body part tumbling through the night
          fx.vel.y -= 11 * dt;
          fx.obj.position.addScaledVector(fx.vel, dt);
          fx.obj.rotation.x += fx.spin * dt;
          fx.obj.rotation.y += fx.spin * 0.6 * dt;
          if (Math.random() < 0.3) this.fx.spray(fx.obj.position, null, 1, 0.2); // drips as it flies
          if (fx.obj.position.y < 0.08) {
            if (fx.vel.y < -2) this.fx.splat(fx.obj.position, rand(0.3, 0.5));
            fx.obj.position.y = 0.08;
            fx.vel.set(fx.vel.x * 0.4, Math.abs(fx.vel.y) > 1.5 ? -fx.vel.y * 0.25 : 0, fx.vel.z * 0.4);
          }
          if (p > 0.75) fx.obj.scale.copy(fx.baseScale).multiplyScalar(Math.max(0.001, 1 - (p - 0.75) / 0.25));
          break;
      }
      if (fx.life >= fx.ttl) {
        if (!fx.obj) { this.effects.splice(i, 1); continue; }
        this.scene.remove(fx.obj);
        if (!fx.keepMats) { // limbs borrow their zombie's materials
          if (fx.ownGeo) fx.obj.geometry.dispose();
          if (fx.ownMap) fx.obj.material.map.dispose();
          fx.obj.material?.dispose();
        }
        this.effects.splice(i, 1);
      }
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT > 1.8) { this.hideBanner(); this.setState('playing'); }
        this.updateZombies(dt);
        break;
      case 'playing': {
        this.typeTime += dt;
        this.stage.time += dt;
        const alive = this.zombies.filter((z) => z.state !== 'dying' && !z.isFloater).length;
        this.spawnTimer -= dt;
        if (this.spawned < this.waveCount() && alive < this.waveSimult() && this.spawnTimer <= 0) {
          this.spawnZombie();
          this.spawnTimer = rand(1.0, 1.9) / this.settings.speed;
        }
        this.pickupTimer -= dt;
        if (this.pickupsLeft > 0 && this.pickupTimer <= 0) {
          this.pickupsLeft--;
          this.pickupTimer = rand(9, 16);
          this.spawnPickup();
        }
        this.updateZombies(dt);
        break;
      }
      case 'advance': {
        this.baseZ = this.advanceFrom - Math.min(this.stateT / 3.2, 1) * ADVANCE_DIST;
        this.updateZombies(dt);
        if (this.stateT >= 3.4) {
          this.fightIdx++;
          this.startWave();
        }
        break;
      }
      case 'bossintro': {
        this.baseZ = this.advanceFrom - Math.min(this.stateT / 3.2, 1) * ADVANCE_DIST;
        this.updateZombies(dt);
        if (Math.floor(this.stateT * 2.5) !== Math.floor((this.stateT - dt) * 2.5)) this.sfx.miss(); // klaxon
        if (this.stateT >= 3.6) {
          this.fightIdx++;
          this.startBoss();
        }
        break;
      }
      case 'boss': {
        this.typeTime += dt;
        this.stage.time += dt;
        this.phraseTimer -= dt * (this.freezeT > 0 ? 0.5 : 1);
        this.hud.bosstimer.style.width = `${Math.max(0, (100 * this.phraseTimer) / this.phraseTimeMax)}%`;
        this.updateBoss(dt);
        if (this.boss) {
          if (this.phraseTimer <= 0 && this.boss.state === 'idle') {
            this.boss.setState('attack');
            this.sfx.bossRoar();
          }
          if (this.boss.state === 'attack' && this.boss.stateT > 0.55) {
            this.boss.setState('idle');
            this.damagePlayer();
            if (this.hp > 0) this.nextPhrase();
          }
        }
        break;
      }
      case 'volley': {
        this.typeTime += dt;
        this.stage.time += dt;
        this.updateBoss(dt);
        this.updateZombies(dt);
        // safety net: if the throw event got skipped, throw anyway
        if (!this.volleyThrown && this.stateT > 1) this.spawnVolley();
        if (this.volleyThrown && this.zombies.length === 0 && this.state === 'volley') {
          this.nextPhrase();
          this.setState('boss');
        }
        break;
      }
      case 'bossdown':
        this.updateBoss(dt);
        if (this.stateT > 2.2) this.startTally();
        break;
      case 'tally':
        this.updateBoss(dt);
        this.updateTally(rawDt);
        break;
      case 'question':
      case 'ending':
        this.updateBoss(dt);
        if (this.demo && this.state === 'ending' && this.stateT > 5) this.showResults();
        break;
      case 'results':
        if (this.demo && this.stateT > 6) this.exitDemo();
        break;
      case 'gameover': {
        this.updateZombies(dt, true); // keep shambling, no strikes
        const n = Math.max(0, 9 - Math.floor(this.stateT));
        const el = $('countdown');
        if (el.textContent !== String(n)) { el.textContent = String(n); if (!this.demo) this.sfx.tick(); }
        if (this.stateT > 10 && !this.demo) this.showResults();
        break;
      }
    }

    // ambient dread: distant groans while ghouls are out, heartbeat when low
    if (this.ghouls().length && ['playing', 'intro', 'advance'].includes(this.state)) {
      this.groanT -= dt;
      if (this.groanT <= 0) {
        this.sfx.groan(rand(-0.8, 0.8));
        this.groanT = rand(2.2, 5.5);
      }
    }
    if (this.hp <= 2 && ['playing', 'intro', 'advance', 'boss', 'volley'].includes(this.state)) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.sfx.heartbeat();
        this.beatT = this.hp === 1 ? 0.6 : 0.85;
      }
    }

    // camera rail + idle sway + shake + kill-punch zoom
    this.shakeT = Math.max(0, this.shakeT - dt);
    const cam = this.camera;
    cam.position.z = this.baseZ;
    cam.position.x = Math.sin(this.time * 0.5) * 0.15;
    cam.position.y = 1.6 + Math.sin(this.time * 1.1) * 0.04;
    // walking bob while the rail advances
    if (this.state === 'advance' || this.state === 'bossintro') {
      const walk = this.stateT < 3.2 ? 1 : 0;
      cam.position.y += Math.abs(Math.sin(this.stateT * 7)) * 0.06 * walk;
      cam.position.x += Math.sin(this.stateT * 3.5) * 0.05 * walk;
    }
    if (this.shakeT > 0) {
      const s = this.shakeT * 0.35;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
    }
    // glance up at a giant while one is on the field
    const lift = this.boss && ['boss', 'volley', 'question', 'bossdown'].includes(this.state) ? 1.6 : 0;
    this.lookLift = (this.lookLift ?? 0) + (lift - (this.lookLift ?? 0)) * (1 - Math.exp(-dt * 2));
    cam.lookAt(0, 1.7 + this.lookLift, this.baseZ - 12);
    if (this.state === 'title') {
      // attract-screen flythrough: drift up the street, drifting toward the canal
      const t = this.time;
      const z = -10 - ((t * 1.6) % 300);
      cam.position.set(2.5 + Math.sin(t * 0.09) * 3.5, 2.6 + Math.sin(t * 0.13) * 0.8, z);
      if (this.shakeT > 0) cam.position.y += rand(-1, 1) * this.shakeT * 0.3;
      cam.lookAt(6 + Math.sin(t * 0.07) * 6, 1.6, z - 20);
    }
    this.gun.group.visible = !['title', 'results', 'initials'].includes(this.state);
    this.fovKick *= Math.exp(-dt * 7);
    cam.fov = 60 + this.fovKick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.gun.aimAt(this.aimLocal(cam));
    this.gun.update(dt, this.time);

    // reticle rides the locked target's head
    const tz = this.state === 'boss' ? this.boss : this.target;
    if (tz && !tz.dead && tz.state !== 'dying' && (tz.isFloater || tz.head.parent)) {
      const head = tz.headWorldPos(new THREE.Vector3());
      const d = head.distanceTo(cam.position);
      this.reticlePulse *= Math.exp(-dt * 10);
      this.reticle.visible = true;
      this.reticle.position.copy(head);
      this.reticle.scale.setScalar((tz.isBoss ? 1.5 : 0.85) * (1 - this.reticlePulse * 0.3) * Math.max(1, d / 14));
      this.reticle.material.rotation = this.time * 0.9;
    } else {
      this.reticle.visible = false;
    }

    // keep word labels legible at distance
    for (const z of this.zombies) {
      const d = z.group.position.distanceTo(cam.position);
      const k = Math.max(1, d / 11) / (z.scale ?? 1);
      z.label.scale.set(z.baseLabelW * k, (96 / 90) * k, 1);
    }

    this.updateTypebar();
    this.updatePowers();
  }

  updateBoss(dt) {
    if (!this.boss) return;
    const ev = this.boss.update(dt, this.camera.position);
    if (ev === 'throw' && this.state === 'volley' && !this.volleyThrown) this.spawnVolley();
    if (this.boss.dead) { this.boss.dispose(this.scene); this.boss = null; }
  }

  updateZombies(dt, harmless = false) {
    const slow = this.freezeT > 0 ? 0.3 : 1;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const ev = z.update(dt, this.camera.position, slow);
      // a burning corpse sheds embers and smoke
      if (!z.isFloater && z.state === 'dying' && z.stateT > 0.4 && z.stateT < 1.5) {
        const at = z.body.localToWorld(new THREE.Vector3(rand(-0.4, 0.4), rand(0, 1.3), rand(-0.3, 0.3)));
        if (Math.random() < 0.7) this.fx.spark(at, 2, z.kind === 'bloater' ? 0x9aff40 : 0xff7a28, 1.4, -2.5, 1.1);
        if (Math.random() < 0.12) this.fx.puff(at, { color: 0x2a2624, size: 0.4, grow: 3, ttl: 1.6, opacity: 0.35 });
      }
      if (ev === 'splash') this.spawnSplash(z.group.position);
      if (ev === 'launch') this.sfx.whoosh();
      if (ev === 'step' && z.group.position.distanceTo(this.camera.position) < 14) {
        this.sfx.stomp();
        this.shakeT = Math.max(this.shakeT, 0.12);
      }
      if (ev === 'strike') {
        const live = !harmless && ['playing', 'intro', 'advance', 'volley'].includes(this.state);
        if (this.target === z) this.target = null;
        if (z.isProjectile) {
          if (live) {
            this.damagePlayer(1);
            this.fx.spark(this.camera.position.clone().add(new THREE.Vector3(0, 0, -0.8)), 20, 0xffc870, 4);
          }
        } else if (z.kind === 'bloater') {
          // it bursts all over you
          if (live) this.damagePlayer(1);
          this.killZombie(z, { blast: true, chain: 0 });
          this.post?.splat('hurt');
        } else {
          if (live) this.damagePlayer(z.damage);
          z.knockback();
        }
      }
      if (z.dead) {
        z.dispose(this.scene);
        const j = this.zombies.indexOf(z);
        if (j !== -1) this.zombies.splice(j, 1);
      }
    }
  }

  // ---------------- HUD ----------------
  updateHUD() {
    if (this.post) this.post.lowHP = this.hp <= 1 ? 1 : this.hp === 2 ? 0.45 : 0;
    this.heartEls.forEach((h, i) => h.classList.toggle('empty', i >= this.hp));
    this.hud.score.textContent = this.score.toLocaleString('en-US');
    const hi = Math.max(this.score, this.hiScore ?? 0);
    $('hiscore').textContent = hi.toLocaleString('en-US');
    const m = this.multiplier();
    this.hud.combo.textContent = this.combo >= 5 ? `${this.combo} COMBO` : '';
    this.hud.combo.classList.toggle('hot', this.combo >= 50);
    this.hud.mult.textContent = m > 1 || this.doubleT > 0 ? `x${m * (this.doubleT > 0 ? 2 : 1)}` : '';
    this.hud.combobar.style.width = `${m >= 8 ? 100 : (this.combo % 10) * 10}%`;
  }

  updatePowers() {
    const parts = [];
    if (this.freezeT > 0) parts.push(`<div class="pw" style="color:#80e0ff">FREEZE ${this.freezeT.toFixed(1)}</div>`);
    if (this.doubleT > 0) parts.push(`<div class="pw" style="color:#d090ff">x2 SCORE ${this.doubleT.toFixed(1)}</div>`);
    const html = parts.join('');
    if (html !== this.powersHTML) {
      this.powersHTML = html;
      this.hud.powers.innerHTML = html;
      this.updateHUD();
    }
  }

  updateTypebar() {
    const z = this.target;
    if (['playing', 'intro', 'volley'].includes(this.state) && z && z.state !== 'dying') {
      const done = z.word.slice(0, z.progress);
      const todo = z.word.slice(z.progress);
      const html = `<span class="done">${done}</span><span class="todo">${todo}</span>`;
      if (html !== this.typebarHTML) { this.typebarHTML = html; this.hud.typebar.innerHTML = html; }
    } else if (this.typebarHTML) {
      this.typebarHTML = '';
      this.hud.typebar.innerHTML = '';
    }
  }
}
