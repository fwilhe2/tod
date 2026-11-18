import * as THREE from 'three';
import { WordLabel } from './label.js';
import { radialCanvas } from './textures.js';
import { PICKUPS } from './levels.js';

// Typeable things that aren't ghouls: power-up canisters drifting over the
// street, and whatever a boss hurls at you. They share the ghouls' targeting
// interface (word, progress, state, label, headWorldPos...) so the lock-on
// code treats them all alike.

const GLOW = new THREE.CanvasTexture(radialCanvas([
  [0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)'],
], 64));

function rand(a, b) { return a + Math.random() * (b - a); }

// one icon per power-up, drawn into a canvas once
const ICONS = {};
function icon(type) {
  if (ICONS[type]) return ICONS[type];
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.translate(S / 2, S / 2);
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.lineWidth = 12;
  c.lineCap = 'round';
  if (type === 'medkit') {
    c.fillRect(-14, -42, 28, 84);
    c.fillRect(-42, -14, 84, 28);
  } else if (type === 'bomb') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = i % 2 ? 26 : 50;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  } else if (type === 'freeze') {
    for (let i = 0; i < 3; i++) {
      c.rotate(Math.PI / 3);
      c.beginPath(); c.moveTo(0, -46); c.lineTo(0, 46); c.stroke();
      for (const s of [-1, 1]) {
        c.beginPath(); c.moveTo(0, s * 28); c.lineTo(14, s * 40); c.moveTo(0, s * 28); c.lineTo(-14, s * 40); c.stroke();
      }
    }
  } else {
    c.font = 'bold 64px "Courier New", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('x2', 0, 4);
  }
  const t = new THREE.CanvasTexture(cv);
  ICONS[type] = t;
  return t;
}

const CANISTER = new THREE.CylinderGeometry(0.22, 0.22, 0.55, 18);
const CAP = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 18);
const BAND = new THREE.CylinderGeometry(0.228, 0.228, 0.16, 18);
const CLEAVER_BLADE = new THREE.BoxGeometry(0.05, 0.75, 0.55);
const CLEAVER_HANDLE = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8);
const COIN = new THREE.CylinderGeometry(0.45, 0.45, 0.07, 28);
const FISH = new THREE.SphereGeometry(0.3, 14, 10);
const FISH_TAIL = new THREE.ConeGeometry(0.22, 0.35, 4);

export class Floater {
  // kind: 'pickup' (opts.type: medkit|bomb|freeze|double) or 'projectile'
  // (opts.prop: cleaver|coin|fish, opts.from, opts.to, opts.time)
  constructor(word, kind, opts = {}, env = null) {
    this.word = word;
    this.isFloater = true;
    this.kind = kind;
    this.isPickup = kind === 'pickup';
    this.isProjectile = kind === 'projectile';
    this.type = opts.type ?? null;
    this.progress = 0;
    this.state = 'float';
    this.stateT = 0;
    this.dead = false;
    this.t = rand(0, 10);
    this.mats = [];
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.hitFlash = 0;

    const mat = (m) => { this.mats.push(m); return m; };
    let accent, glowColor;
    if (this.isPickup) {
      const p = PICKUPS[this.type];
      glowColor = p.color;
      accent = p.css;
      const shell = mat(new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.9, roughness: 0.35, envMap: env }));
      const glowM = mat(new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 2.2 }));
      this.body.add(new THREE.Mesh(CANISTER, shell));
      for (const y of [-0.3, 0.3]) {
        const cap = new THREE.Mesh(CAP, shell);
        cap.position.y = y;
        this.body.add(cap);
      }
      const band = new THREE.Mesh(BAND, glowM);
      this.body.add(band);
      this.flashMat = glowM;
      // the symbol hovers in front, always facing you
      const ic = new THREE.Sprite(mat(new THREE.SpriteMaterial({
        map: icon(this.type), color: new THREE.Color(p.color).multiplyScalar(1.6),
        transparent: true, depthWrite: false,
      })));
      ic.scale.setScalar(0.42);
      ic.position.set(0, 0.62, 0);
      this.group.add(ic);
      this.icon = ic;
      const x = rand(-4.5, 4.5);
      this.group.position.set(x, rand(1.6, 2.6), opts.z ?? -18);
      this.drift = rand(-0.35, 0.35);
      this.ttl = 10;
      this.body.rotation.z = 0.35;
    } else {
      glowColor = 0xff5030;
      accent = 'rgba(255,90,60,0.9)';
      this.prop = opts.prop;
      if (opts.prop === 'cleaver') {
        const steel = mat(new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.25, envMap: env, emissive: 0x200808 }));
        const wood = mat(new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.7 }));
        const blade = new THREE.Mesh(CLEAVER_BLADE, steel);
        blade.position.y = 0.2;
        const handle = new THREE.Mesh(CLEAVER_HANDLE, wood);
        handle.position.y = -0.4;
        this.body.add(blade, handle);
        this.flashMat = steel;
      } else if (opts.prop === 'coin') {
        const gold = mat(new THREE.MeshStandardMaterial({ color: 0xd8a848, metalness: 1, roughness: 0.25, envMap: env, emissive: 0x2a1804 }));
        const c = new THREE.Mesh(COIN, gold);
        c.rotation.x = Math.PI / 2;
        this.body.add(c);
        this.flashMat = gold;
        glowColor = 0xffc040;
      } else {
        const scale = mat(new THREE.MeshStandardMaterial({ color: 0x9aa8b0, metalness: 0.6, roughness: 0.3, envMap: env, emissive: 0x101418 }));
        const f = new THREE.Mesh(FISH, scale);
        f.scale.set(0.5, 0.7, 1.4);
        const tail = new THREE.Mesh(FISH_TAIL, scale);
        tail.position.z = -0.5;
        tail.rotation.x = -Math.PI / 2;
        tail.scale.set(1, 1, 0.3);
        this.body.add(f, tail);
        this.flashMat = scale;
        glowColor = 0x80c0ff;
      }
      this.from = opts.from.clone();
      this.to = opts.to.clone();
      this.flight = opts.time;
      this.delay = opts.delay ?? 0; // volleys leave the hand one at a time
      this.arc = rand(2.5, 4);
      this.side = rand(-2, 2);
      this.group.position.copy(this.from);
    }
    const glow = new THREE.Sprite(mat(new THREE.SpriteMaterial({
      map: GLOW, color: glowColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
    })));
    glow.scale.setScalar(this.isPickup ? 1.6 : 1.3);
    this.group.add(glow);
    this.glow = glow;
    this.light = null;

    this.wl = new WordLabel(word, accent);
    this.label = this.wl.sprite;
    this.label.position.set(0, this.isPickup ? 1.15 : 0.85 + (opts.slot ?? 0) * 0.55, 0);
    if (this.isPickup) this.body.scale.setScalar(1.5);
    if (this.isProjectile && this.delay > 0) this.group.visible = false;
    this.baseLabelW = this.wl.baseW;
    this.group.add(this.label);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  drawLabel(targeted) { this.wl.draw(this.progress, targeted); }
  headWorldPos(out) { return this.body.getWorldPosition(out); }
  hit() { this.hitFlash = 1; }
  shed() { return null; }
  decapitate() { return null; }
  knockback() {}

  die() {
    if (this.state === 'dying') return;
    this.state = 'dying';
    this.stateT = 0;
    this.label.visible = false;
  }

  update(dt, camPos, slow = 1) {
    if (this.state !== 'dying') dt *= slow;
    this.t += dt;
    this.stateT += dt;
    let ev = null;
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    }
    if (this.flashMat) this.flashMat.emissiveIntensity = (this.isPickup ? 2.2 : 1) + this.hitFlash * 4;

    if (this.state === 'dying') {
      const k = Math.max(0, 1 - this.stateT / 0.25);
      this.group.scale.setScalar(Math.max(0.001, k));
      if (this.stateT > 0.25) this.dead = true;
      return null;
    }

    if (this.isPickup) {
      this.group.position.x += this.drift * dt;
      this.body.position.y = Math.sin(this.t * 2) * 0.12;
      this.body.rotation.y += dt * 1.6;
      this.glow.material.opacity = 0.4 + Math.sin(this.t * 6) * 0.15;
      // blink out of existence when time's nearly up
      if (this.stateT > this.ttl - 2.5) this.body.visible = this.icon.visible = Math.sin(this.t * 30) > -0.3;
      if (this.stateT > this.ttl) { this.die(); ev = 'expire'; }
    } else {
      if (this.stateT < this.delay) return null;
      if (!this.group.visible) { this.group.visible = true; ev = 'launch'; }
      const p = Math.min(1, (this.stateT - this.delay) / this.flight);
      // a lazy, then accelerating, arc straight for your face
      const e = p * p * (1.6 - 0.6 * p);
      this.group.position.lerpVectors(this.from, this.to, e);
      this.group.position.y += Math.sin(Math.PI * e) * this.arc;
      this.group.position.x += Math.sin(Math.PI * e) * this.side;
      this.body.rotation.x += dt * (this.prop === 'coin' ? 4 : 9);
      this.body.rotation.z += dt * (this.prop === 'coin' ? 7 : 2);
      if (p >= 1) { this.die(); ev = 'strike'; }
    }
    return ev;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.wl.dispose();
    for (const m of this.mats) m.dispose();
  }
}
