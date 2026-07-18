import * as THREE from 'three';
import { Zombie } from './zombie.js';
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

const GORE_GEO = new THREE.BoxGeometry(0.13, 0.13, 0.13);
const POOL_GEO = new THREE.CircleGeometry(0.9, 14);

export class Game {
  constructor(scene, camera, sfx) {
    this.scene = scene;
    this.camera = camera;
    this.sfx = sfx;

    this.state = 'title'; // title|intro|playing|advance|bossintro|boss|question|ending|gameover|results|pause
    this.stateT = 0;
    this.time = 0;
    this.pausedFrom = null;

    this.zombies = [];
    this.target = null;
    this.effects = [];   // particles + tracers {obj, life, ttl, vel?}
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
    this.sfx.shot();
    if (z) {
      this.spawnTracer(z);
      this.spawnGore(z.headWorldPos(new THREE.Vector3()), 5, 0.55);
    }
  }

  registerMiss() {
    this.misses++;
    this.combo = 0;
    this.sfx.miss();
  }

  killZombie(z) {
    this.score += 50 + z.word.length * 15;
    this.sfx.kill();
    const head = z.headWorldPos(new THREE.Vector3());
    this.spawnGore(head, 30, 1.15);
    this.spawnBloodPool(z.group.position);
    z.die();
    this.killed++;
    if (this.target === z) this.target = null;
    if (this.killed >= this.waveCount()) this.waveCleared();
  }

  damageBoss() {
    this.bossHP--;
    this.sfx.bossHit();
    this.boss.setState('stagger');
    this.hud.bosshp.style.width = `${(100 * this.bossHP) / this.bossMaxHP}%`;
    const head = this.boss.headWorldPos(new THREE.Vector3());
    this.spawnGore(head, 45, 1.6);
    this.spawnBloodPool(this.boss.group.position);
    this.score += 400;
    if (this.bossHP <= 0) {
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
    const z = new Zombie(
      word,
      this.camera.position.x + rand(-7, 7),
      this.baseZ - rand(26, 36),
      rand(w.speed[0], w.speed[1]) * this.settings.speed
    );
    this.scene.add(z.group);
    this.zombies.push(z);
    this.spawned++;
  }

  spawnTracer(z) {
    const head = z.headWorldPos(new THREE.Vector3());
    const muzzle = new THREE.Vector3(0.35, -0.42, -0.4).applyMatrix4(this.camera.matrixWorld);
    const geo = new THREE.BufferGeometry().setFromPoints([muzzle, head]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ obj: line, life: 0, ttl: 0.1, ownGeo: true });
  }

  spawnGore(pos, n = 26, force = 1) {
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const mat = new THREE.MeshBasicMaterial({
        color: r < 0.45 ? 0x9c1818 : r < 0.75 ? 0x701010 : r < 0.9 ? 0xb42424 : 0x4a0b0b,
        transparent: true,
      });
      const m = new THREE.Mesh(GORE_GEO, mat);
      m.position.copy(pos);
      m.scale.setScalar(rand(0.5, 1.9));
      m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      this.scene.add(m);
      this.effects.push({
        obj: m, life: 0, ttl: rand(0.7, 1.2),
        vel: new THREE.Vector3(rand(-4.5, 4.5) * force, rand(1.5, 7) * force, rand(-4.5, 4.5) * force),
      });
    }
  }

  spawnBloodPool(pos) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x581010, transparent: true, opacity: 0.6, depthWrite: false,
    });
    const m = new THREE.Mesh(POOL_GEO, mat);
    m.position.set(pos.x, 0.03 + Math.random() * 0.01, pos.z);
    m.rotation.set(-Math.PI / 2, 0, rand(0, Math.PI * 2));
    m.scale.set(rand(0.8, 1.7), rand(0.8, 1.7), 1);
    m.renderOrder = 1;
    this.scene.add(m);
    this.effects.push({ obj: m, life: 0, ttl: 20, baseOp: 0.6 });
  }

  // ---------------- per-frame update ----------------
  update(dt) {
    this.stateT += dt;
    this.time += dt;

    // effects always tick
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life += dt;
      if (fx.vel) {
        fx.vel.y -= 12 * dt;
        fx.obj.position.addScaledVector(fx.vel, dt);
        if (fx.obj.position.y < 0.05) { fx.obj.position.y = 0.05; fx.vel.set(0, 0, 0); }
        fx.obj.material.opacity = 1 - fx.life / fx.ttl;
      } else {
        fx.obj.material.opacity = (fx.baseOp ?? 0.9) * (1 - fx.life / fx.ttl);
      }
      if (fx.life >= fx.ttl) {
        this.scene.remove(fx.obj);
        if (fx.ownGeo) fx.obj.geometry.dispose();
        fx.obj.material.dispose();
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

    // camera rail + idle sway + shake
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
