import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { Fx } from './fx.js';
import { pickWord, BOSS_PHRASES, QUESTION, ENDINGS } from './words.js';

const WAVES = [
  { tier: 0, count: 10, simult: 2, speed: [0.65, 0.9] },
  { tier: 1, count: 12, simult: 2, speed: [0.75, 1.0] },
  { tier: 2, count: 14, simult: 3, speed: [0.8, 1.1] },
  { tier: 3, count: 14, simult: 3, speed: [0.9, 1.2] },
  { tier: 4, count: 15, simult: 3, speed: [1.0, 1.35] },
];
const ADVANCE_DIST = 26;
const MAX_HP = 5;

function rand(a, b) { return a + Math.random() * (b - a); }

const $ = (id) => document.getElementById(id);

const BULLET_GEO = new THREE.CapsuleGeometry(0.03, 0.55, 3, 6);
const SHELL_GEO = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 10).rotateX(Math.PI / 2);
const RING_GEO = new THREE.RingGeometry(0.3, 0.38, 28);
const BULLET_SPEED = 75;

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
    this.titleIdle = 0;
    this.autoT = 0;

    this.state = 'title'; // title|intro|playing|advance|bossintro|boss|question|ending|gameover|results|pause
    this.stateT = 0;
    this.time = 0;
    this.pausedFrom = null;

    this.zombies = [];
    this.target = null;
    this.effects = [];   // tracers, limbs, shells, rings, popups {obj, life, ttl, vel?}
    this.fx = new Fx(scene); // instanced blood, gibs, decals, sparks, smoke
    this.baseZ = 0;      // camera rail position
    this.advanceFrom = 0;
    this.shakeT = 0;

    this.wave = 0;
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0;

    this.hp = MAX_HP;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.typeTime = 0;   // active combat seconds, for WPM
    this.coffees = 0;    // continues used

    this.boss = null;
    this.bossHP = 6;
    this.bossMaxHP = 6;
    this.phrase = '';
    this.phraseProgress = 0;
    this.phraseTimer = 0;
    this.phraseTimeMax = 1;
    this.usedPhrases = [];

    this.answerLock = -1; // question phase
    this.answerProgress = 0;

    this.hud = {
      root: $('hud'), hearts: $('hearts'), score: $('score'), combo: $('combo'),
      wavelabel: $('wavelabel'), banner: $('banner'), typebar: $('typebar'),
      bossui: $('bossui'), bosshp: $('bosshp').firstElementChild,
      bosstimer: $('bosstimer').firstElementChild, phrasebox: $('phrasebox'),
      questionbox: $('questionbox'), answers: $('answers'), redflash: $('redflash'),
    };
    this.screens = { title: $('title'), pause: $('pause'), gameover: $('gameover'), ending: $('ending'), results: $('results') };

    // gameplay settings (persisted)
    this.settings = { speed: 1, horde: 1 };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem('tod-settings') || '{}'));
    } catch { /* fresh defaults */ }
    this.selSetting = 0; // 0 = speed, 1 = horde
    for (const el of document.querySelectorAll('.arrow')) {
      el.addEventListener('click', () => {
        this.selSetting = el.dataset.set === 'speed' ? 0 : 1;
        this.adjustSetting(Number(el.dataset.dir));
      });
    }
    this.drawSettings();

    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  adjustSetting(dir) {
    const key = this.selSetting === 0 ? 'speed' : 'horde';
    this.settings[key] = Math.min(2, Math.max(0.5, Math.round((this.settings[key] + dir * 0.25) * 4) / 4));
    localStorage.setItem('tod-settings', JSON.stringify(this.settings));
    this.drawSettings();
  }

  drawSettings() {
    $('set-speed').textContent = Math.round(this.settings.speed * 100) + '%';
    $('set-horde').textContent = Math.round(this.settings.horde * 100) + '%';
    $('row-speed').classList.toggle('sel', this.selSetting === 0);
    $('row-horde').classList.toggle('sel', this.selSetting === 1);
  }

  waveCount() { return Math.max(3, Math.round(WAVES[this.wave].count * this.settings.horde)); }
  waveSimult() { return Math.max(1, Math.round(WAVES[this.wave].simult * this.settings.horde)); }

  // ---------------- state helpers ----------------
  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  showScreen(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('on', k === name);
  }

  banner(text, sub = '') {
    this.hud.banner.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '');
    this.hud.banner.classList.add('on');
  }
  hideBanner() { this.hud.banner.classList.remove('on'); }

  // ---------------- game flow ----------------
  startGame() {
    for (const z of this.zombies) z.dispose(this.scene);
    if (this.boss) { this.boss.dispose(this.scene); this.boss = null; }
    this.zombies = [];
    this.target = null;
    this.baseZ = 0;
    this.wave = 0;
    this.hp = MAX_HP;
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.hits = 0; this.misses = 0; this.typeTime = 0; this.coffees = 0;
    this.usedPhrases = [];
    this.slowmo = 0;
    this.showScreen(null);
    this.hud.root.style.display = 'block';
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.hud.questionbox.style.display = 'none';
    this.startWave(0);
    this.updateHUD();
  }

  startWave(i) {
    this.wave = i;
    this.spawned = 0;
    this.killed = 0;
    this.spawnTimer = 0.8;
    this.world?.setMood(i);
    this.hud.wavelabel.textContent = `CANAL DISTRICT ${i + 1} / ${WAVES.length}`;
    this.banner(`AREA ${i + 1}`, i === 0 ? 'THEY CAN SMELL TYPOS' : '');
    this.sfx.waveChime();
    this.setState('intro');
  }

  waveCleared() {
    this.hideBanner();
    if (this.wave + 1 < WAVES.length) {
      this.banner('CLEAR', 'ADVANCING...');
      this.advanceFrom = this.baseZ;
      this.setState('advance');
    } else {
      this.banner('CLEAR', 'SOMETHING BIG IS WADING THIS WAY');
      this.advanceFrom = this.baseZ;
      this.setState('bossintro');
    }
    this.sfx.waveChime();
  }

  startBoss() {
    this.hideBanner();
    this.boss = new Zombie('', this.camera.position.x, this.baseZ - 17, 0, 3.1, 0x86986a);
    this.boss.setState('idle');
    this.boss.label.visible = false;
    this.scene.add(this.boss.group);
    this.bossMaxHP = 6;
    this.bossHP = 6;
    this.hud.bossui.style.display = 'block';
    this.hud.bosshp.style.width = '100%';
    this.hud.phrasebox.style.display = 'block';
    this.hud.wavelabel.textContent = 'THE COUNTING HOUSE';
    this.world?.setMood(5);
    this.sfx.bossRoar();
    this.nextPhrase();
    this.setState('boss');
  }

  nextPhrase() {
    const pool = BOSS_PHRASES.filter((p) => !this.usedPhrases.includes(p));
    this.phrase = pool.length ? pool[Math.floor(Math.random() * pool.length)]
                              : BOSS_PHRASES[Math.floor(Math.random() * BOSS_PHRASES.length)];
    this.usedPhrases.push(this.phrase);
    this.phraseProgress = 0;
    this.phraseTimeMax = (5 + this.phrase.length * 0.33) / this.settings.speed;
    this.phraseTimer = this.phraseTimeMax;
    this.drawPhrase();
  }

  drawPhrase() {
    const done = this.phrase.slice(0, this.phraseProgress);
    const todo = this.phrase.slice(this.phraseProgress);
    this.hud.phrasebox.innerHTML =
      `<span class="done">${done}</span><span class="todo">${todo}</span>`;
  }

  startQuestion() {
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.answerLock = -1;
    this.answerProgress = 0;
    this.hud.questionbox.style.display = 'block';
    this.hud.questionbox.querySelector('h2').textContent = QUESTION.prompt;
    this.drawAnswers();
    this.setState('question');
  }

  drawAnswers() {
    this.hud.answers.innerHTML = QUESTION.answers.map((a, i) => {
      const locked = this.answerLock === i;
      const done = locked ? a.text.slice(0, this.answerProgress) : '';
      const todo = locked ? a.text.slice(this.answerProgress) : a.text;
      const dim = this.answerLock !== -1 && !locked ? 'opacity:0.25' : '';
      return `<div class="answer" style="${dim}"><span class="done">${done}</span><span>${todo}</span></div>`;
    }).join('');
  }

  finishBoss(endingKey) {
    this.hud.questionbox.style.display = 'none';
    if (this.boss) {
      this.spawnGore(this.boss.headWorldPos(new THREE.Vector3()), 70, 2.2);
      this.spawnBloodPool(this.boss.group.position);
      const skull = this.boss.decapitate();
      if (skull) { this.flingPart(skull, 2); this.spawnFountain(this.boss, 1.6); }
      this.boss.die();
    }
    this.sfx.kill();
    this.endingKey = endingKey;
    this.setState('ending');
    const e = ENDINGS[endingKey];
    setTimeout(() => {
      if (this.state !== 'ending') return;
      $('endingtitle').textContent = e.title;
      $('endingtext').textContent = e.text;
      this.showScreen('ending');
    }, 1400);
  }

  showResults() {
    const acc = this.hits + this.misses > 0 ? (100 * this.hits) / (this.hits + this.misses) : 100;
    const minutes = Math.max(this.typeTime / 60, 0.01);
    const wpm = Math.round(this.hits / 5 / minutes);
    $('r-score').textContent = this.score.toLocaleString();
    $('r-acc').textContent = acc.toFixed(1) + '%';
    $('r-combo').textContent = this.maxCombo;
    $('r-wpm').textContent = wpm;
    $('r-coffee').textContent = `${this.coffees} cup${this.coffees === 1 ? '' : 's'}`;
    let rank = 'D';
    if (acc >= 97 && this.coffees === 0 && wpm >= 45) rank = 'S';
    else if (acc >= 93 && this.coffees <= 1) rank = 'A';
    else if (acc >= 85) rank = 'B';
    else if (acc >= 70) rank = 'C';
    $('rank').textContent = rank;
    this.showScreen('results');
    this.setState('results');
  }

  gameOver() {
    this.showScreen('gameover');
    this.setState('gameover');
  }

  // ---------------- attract mode ----------------
  startDemo() {
    this.demo = true;
    this.autoT = 1;
    $('demobadge').style.display = 'block';
    this.startGame();
  }

  exitDemo() {
    this.demo = false;
    $('demobadge').style.display = 'none';
    for (const z of this.zombies) z.dispose(this.scene);
    this.zombies = [];
    if (this.boss) { this.boss.dispose(this.scene); this.boss = null; }
    this.target = null;
    this.hud.root.style.display = 'none';
    this.hud.bossui.style.display = 'none';
    this.hud.phrasebox.style.display = 'none';
    this.hud.questionbox.style.display = 'none';
    this.hideBanner();
    this.slowmo = 0;
    this.titleIdle = 0;
    this.sfx.setIntensity(0);
    this.showScreen('title');
    this.setState('title');
  }

  // the ghost of Agent Verdana types on: mostly accurate, occasionally sloppy
  autoType() {
    if (this.state === 'playing' || this.state === 'intro') {
      let z = this.target;
      if (z && (z.state === 'dying' || z.dead)) z = null;
      if (!z) {
        let bd = Infinity;
        for (const c of this.zombies) {
          if (c.state === 'dying') continue;
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
        const i = Math.floor(Math.random() * QUESTION.answers.length);
        this.typeAnswer(QUESTION.answers[i].text[0]);
      } else {
        const a = QUESTION.answers[this.answerLock];
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
    if (this.boss) {
      this.nextPhrase();
      this.setState('boss');
    } else {
      this.startWave(this.wave);
    }
    this.updateHUD();
  }

  // ---------------- input ----------------
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.demo) { this.exitDemo(); return; } // any key reclaims the controls
    this.titleIdle = 0;

    if (e.key === 'Escape') {
      if (this.state === 'pause') {
        this.showScreen(null);
        this.setState(this.pausedFrom);
      } else if (['playing', 'advance', 'intro', 'boss', 'question', 'bossintro'].includes(this.state)) {
        this.pausedFrom = this.state;
        this.showScreen('pause');
        this.setState('pause');
      }
      return;
    }

    if (this.state === 'title' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        this.selSetting = 1 - this.selSetting;
        this.drawSettings();
      } else {
        this.adjustSetting(e.key === 'ArrowRight' ? 1 : -1);
      }
      return;
    }

    if (e.key === 'Enter') {
      if (this.state === 'title') { this.sfx.ensure(); this.startGame(); }
      else if (this.state === 'gameover') { this.sfx.ensure(); this.continueGame(); }
      else if (this.state === 'ending') this.showResults();
      else if (this.state === 'results') { this.showScreen('title'); this.setState('title'); }
      return;
    }

    if (e.key.length !== 1 || e.repeat) return;
    const ch = e.key.toLowerCase();
    if (!/[a-z '\-]/.test(ch)) return;
    e.preventDefault();
    this.sfx.ensure();

    if (this.state === 'playing' || this.state === 'intro') this.typeCombat(ch);
    else if (this.state === 'boss') this.typeBoss(ch);
    else if (this.state === 'question') this.typeAnswer(ch);
  }

  typeCombat(ch) {
    let z = this.target;
    if (z && (z.state === 'dying' || z.dead)) { z = null; this.target = null; }
    if (!z) {
      // lock nearest zombie whose word starts with the typed letter
      let best = null, bestD = Infinity;
      for (const c of this.zombies) {
        if (c.state === 'dying') continue;
        if (c.word[0] !== ch) continue;
        const d = c.group.position.distanceTo(this.camera.position);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) { this.registerMiss(); return; }
      this.target = best;
      z = best;
      z.progress = 0;
    }
    if (z.word[z.progress] === ch) {
      z.progress++;
      this.registerHit(z);
      z.drawLabel(true);
      if (z.progress >= z.word.length) this.killZombie(z);
    } else {
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
    if (this.answerLock === -1) {
      const i = QUESTION.answers.findIndex((a) => a.text[0] === ch);
      if (i === -1) { this.sfx.miss(); return; }
      this.answerLock = i;
      this.answerProgress = 1;
      this.sfx.shot();
    } else {
      const a = QUESTION.answers[this.answerLock];
      if (a.text[this.answerProgress] === ch) {
        this.answerProgress++;
        this.sfx.shot();
      } else {
        this.sfx.miss();
      }
    }
    const a = QUESTION.answers[this.answerLock];
    if (a && this.answerProgress >= a.text.length) {
      this.finishBoss(a.ending);
    }
    this.drawAnswers();
  }

  registerHit(z) {
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += 10 * (1 + Math.floor(this.combo / 10));
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
      // every landed letter strips a part off a regular ghoul
      if (!z.isBoss) {
        const part = z.shed();
        if (part) this.flingPart(part, 0.8);
      }
    }
  }

  registerMiss() {
    this.misses++;
    this.combo = 0;
    this.sfx.miss();
  }

  killZombie(z) {
    const pts = 50 + z.word.length * 15;
    this.score += pts;
    this.sfx.kill();
    const head = z.headWorldPos(new THREE.Vector3());
    this.spawnGore(head, 30, 1.15);
    this.spawnBloodPool(z.group.position);
    this.spawnRing(head);
    this.spawnPopup(`+${pts}`, head);
    this.fovKick = Math.min(this.fovKick + 2.5, 8);
    if (this.post) this.post.punch = 1;
    // the last letter takes the head clean off
    const skull = z.decapitate();
    if (skull) { this.flingPart(skull, 1.5); this.spawnFountain(z); }
    if (z.special === 'coffee' && this.hp < MAX_HP) {
      this.hp++;
      this.sfx.heart();
      this.spawnPopup('+♥', head, '#ff5a5a', 'rgba(255,60,60,0.9)');
      this.updateHUD();
    }
    z.die();
    this.killed++;
    if (this.target === z) this.target = null;
    if (this.killed >= this.waveCount()) {
      this.slowmo = 0.9; // wave-clear finisher in bullet-time
      this.waveCleared();
    }
  }

  damageBoss() {
    this.bossHP--;
    this.sfx.bossHit();
    this.boss.setState('stagger');
    // each finished phrase costs the Chancellor a piece: hat first, then arms, then jaw
    const part = this.boss.shed();
    if (part) this.flingPart(part, 1.4);
    this.hud.bosshp.style.width = `${(100 * this.bossHP) / this.bossMaxHP}%`;
    const head = this.boss.headWorldPos(new THREE.Vector3());
    this.spawnGore(head, 45, 1.6);
    this.spawnBloodPool(this.boss.group.position);
    this.spawnRing(head);
    this.spawnPopup('+400', head);
    this.fovKick = Math.min(this.fovKick + 4.5, 9);
    this.shakeT = Math.max(this.shakeT, 0.3);
    if (this.post) this.post.punch = 1.5;
    this.score += 400;
    if (this.bossHP <= 0) {
      this.slowmo = 1.2;
      this.sfx.bossRoar();
      this.startQuestion();
    } else {
      this.nextPhrase();
    }
  }

  damagePlayer() {
    this.hp--;
    this.shakeT = 0.45;
    this.sfx.hurt();
    if (this.post) this.post.hurt = 1;
    this.hud.redflash.classList.add('on');
    setTimeout(() => this.hud.redflash.classList.remove('on'), 180);
    this.updateHUD();
    if (this.hp <= 0) this.gameOver();
  }

  // ---------------- spawning / effects ----------------
  spawnZombie() {
    const w = WAVES[this.wave];
    const inUse = this.zombies.filter((z) => z.state !== 'dying').map((z) => z.word);
    const word = pickWord(w.tier, inUse);
    const coffee = this.wave >= 1 && this.hp < MAX_HP && Math.random() < 0.08;
    const riser = !coffee && this.wave >= 1 && Math.random() < 0.35;
    const speed = rand(w.speed[0], w.speed[1]) * this.settings.speed;
    let z;
    if (riser) {
      // it comes up out of the canal, soaked dark
      z = new Zombie(word, rand(13.5, 15.5), this.baseZ - rand(12, 24), speed, 1, 0x5c6a54);
      z.beginRise();
    } else {
      z = new Zombie(
        word,
        this.camera.position.x + rand(-7, 7),
        this.baseZ - rand(26, 36),
        speed, 1, null, coffee ? 'coffee' : null
      );
    }
    this.scene.add(z.group);
    this.zombies.push(z);
    this.spawned++;
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
      color: 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(start);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(m);
    this.effects.push({
      kind: 'bullet', obj: m, life: 0, ttl: dist / BULLET_SPEED,
      vel: dir.multiplyScalar(BULLET_SPEED), end,
    });
  }

  // where the bullet lands: sparks, a spurt out the back, red mist, a flash
  impact(pos, dir) {
    this.fx.spark(pos, 9, 0xffc870, 6);
    this.fx.spray(pos, dir, 9, 0.7);
    this.fx.puff(pos, { color: 0x6a0808, size: 0.25, grow: 2.5, ttl: 0.5, opacity: 0.5 });
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
    c.font = 'bold 48px "Courier New", monospace';
    cv.width = Math.ceil(c.measureText(text).width) + 24;
    cv.height = 64;
    c.font = 'bold 48px "Courier New", monospace';
    c.textBaseline = 'middle';
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
    this.update(dt);
    return dt;
  }

  update(dt) {
    this.stateT += dt;
    this.time += dt;

    // attract mode: start after idling on the title, play until interrupted
    if (this.state === 'title' && !this.demo) {
      this.titleIdle += dt;
      if (this.titleIdle > 14) { this.titleIdle = 0; this.startDemo(); }
    }
    if (this.demo) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = rand(0.1, 0.22);
        this.autoType();
      }
      if (this.state === 'ending' && this.stateT > 5) this.showResults();
      else if (this.state === 'results' && this.stateT > 7) this.exitDemo();
      else if (this.state === 'gameover' && this.stateT > 4) this.exitDemo();
    }

    // adaptive score: intensity follows how close the horde is
    this.dangerAcc -= dt;
    if (this.dangerAcc <= 0) {
      this.dangerAcc = 0.4;
      let danger = 0;
      if (this.state === 'boss') danger = 3;
      else if (['playing', 'intro', 'advance'].includes(this.state)) {
        danger = 1;
        let nearest = Infinity;
        for (const z of this.zombies) {
          if (z.state === 'dying') continue;
          nearest = Math.min(nearest, z.group.position.distanceTo(this.camera.position));
        }
        if (nearest < 7) danger = 3;
        else if (nearest < 13) danger = 2;
      }
      this.sfx.setIntensity(danger);
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
          if (p >= 1) this.impact(fx.end, fx.vel.clone().normalize());
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
        if (this.stateT > 1.6) { this.hideBanner(); this.setState('playing'); }
        this.updateZombies(dt);
        break;
      case 'playing': {
        this.typeTime += dt;
        const alive = this.zombies.filter((z) => z.state !== 'dying').length;
        this.spawnTimer -= dt;
        if (this.spawned < this.waveCount() && alive < this.waveSimult() && this.spawnTimer <= 0) {
          this.spawnZombie();
          this.spawnTimer = rand(1.0, 1.9) / this.settings.speed;
        }
        this.updateZombies(dt);
        break;
      }
      case 'advance': {
        this.baseZ = this.advanceFrom - Math.min(this.stateT / 3.2, 1) * ADVANCE_DIST;
        this.updateZombies(dt);
        if (this.stateT >= 3.4) this.startWave(this.wave + 1);
        break;
      }
      case 'bossintro': {
        this.baseZ = this.advanceFrom - Math.min(this.stateT / 3.2, 1) * ADVANCE_DIST;
        if (this.stateT >= 3.6) this.startBoss();
        break;
      }
      case 'boss': {
        this.typeTime += dt;
        this.phraseTimer -= dt;
        this.hud.bosstimer.style.width = `${Math.max(0, (100 * this.phraseTimer) / this.phraseTimeMax)}%`;
        if (this.boss) {
          this.boss.update(dt, this.camera.position);
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
      case 'question':
      case 'ending':
        if (this.boss) {
          this.boss.update(dt, this.camera.position);
          if (this.boss.dead) { this.boss.dispose(this.scene); this.boss = null; }
        }
        break;
      case 'gameover':
        this.updateZombies(dt, true); // keep shambling, no strikes
        break;
    }

    // ambient dread: distant groans while ghouls are out, heartbeat when low
    if (this.zombies.length && ['playing', 'intro', 'advance'].includes(this.state)) {
      this.groanT -= dt;
      if (this.groanT <= 0) {
        this.sfx.groan(rand(-0.8, 0.8));
        this.groanT = rand(2.2, 5.5);
      }
    }
    if (this.hp <= 2 && ['playing', 'intro', 'advance', 'boss'].includes(this.state)) {
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
    if (this.shakeT > 0) {
      const s = this.shakeT * 0.35;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
    }
    cam.lookAt(0, 1.7, this.baseZ - 12);
    this.fovKick *= Math.exp(-dt * 7);
    cam.fov = 60 + this.fovKick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.gun.aimAt(this.aimLocal(cam));
    this.gun.update(dt, this.time);

    // keep word labels legible at distance
    for (const z of this.zombies) {
      const d = z.group.position.distanceTo(cam.position);
      const k = Math.max(1, d / 11);
      z.label.scale.set(z.baseLabelW * k, (84 / 90) * k, 1);
    }

    this.updateTypebar();
  }

  updateZombies(dt, harmless = false) {
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const ev = z.update(dt, this.camera.position);
      if (ev === 'splash') this.spawnSplash(z.group.position);
      if (ev === 'strike') {
        if (!harmless && (this.state === 'playing' || this.state === 'intro' || this.state === 'advance')) {
          this.damagePlayer();
        }
        if (this.target === z) this.target = null;
        z.knockback();
      }
      if (z.dead) {
        z.dispose(this.scene);
        this.zombies.splice(i, 1);
      }
    }
  }

  // ---------------- HUD ----------------
  updateHUD() {
    if (this.post) this.post.lowHP = this.hp <= 1 ? 1 : this.hp === 2 ? 0.45 : 0;
    this.hud.hearts.textContent = '♥'.repeat(this.hp) + '♡'.repeat(Math.max(0, MAX_HP - this.hp));
    this.hud.score.textContent = this.score.toLocaleString();
    this.hud.combo.textContent = this.combo >= 5 ? `${this.combo} COMBO x${1 + Math.floor(this.combo / 10)}` : '';
  }

  updateTypebar() {
    const z = this.target;
    if ((this.state === 'playing' || this.state === 'intro') && z && z.state !== 'dying') {
      const done = z.word.slice(0, z.progress);
      const todo = z.word.slice(z.progress);
      this.hud.typebar.innerHTML = `<span class="done">${done}</span><span class="todo">${todo}</span>`;
    } else {
      this.hud.typebar.innerHTML = '';
    }
  }
}
