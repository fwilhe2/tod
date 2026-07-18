import * as THREE from 'three';

const SKIN = [0x9cc487, 0xa8c284, 0x8cc09c, 0xb4ca88, 0xa2d4a6];
const CLOTH = [0x565478, 0x785858, 0x4a6a62, 0x6a5c48, 0x53688a, 0x74547a];

// shared geometry
const G = {
  torso: new THREE.BoxGeometry(0.9, 1.15, 0.5),
  head: new THREE.BoxGeometry(0.55, 0.6, 0.55),
  arm: new THREE.BoxGeometry(0.22, 0.85, 0.22),
  leg: new THREE.BoxGeometry(0.28, 0.9, 0.28),
  eye: new THREE.PlaneGeometry(0.12, 0.09),
  shadow: new THREE.CircleGeometry(0.75, 20),
};
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xffd24a });
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Successive zombies cycle through these label heights so words on
// overlapping zombies don't cover each other.
const LABEL_HEIGHTS = [2.9, 3.6, 4.3];
let labelSlot = 0;

export class Zombie {
  constructor(word, x, z, speed, scale = 1, tint = null) {
    this.word = word;
    this.progress = 0;
    this.speed = speed;
    this.state = 'walk'; // walk | attack | knock | dying | idle | stagger
    this.stateT = 0;
    this.dead = false;   // fully finished, safe to remove
    this.t = rand(0, 10);
    this.scale = scale;

    this.skinMat = new THREE.MeshLambertMaterial({ color: tint ?? pick(SKIN), emissive: 0x1e2c1a });
    this.clothMat = new THREE.MeshLambertMaterial({ color: pick(CLOTH), emissive: 0x101018 });

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    this.group = g;

    const body = new THREE.Group();
    body.position.y = 1.05;
    g.add(body);
    this.body = body;

    this.torso = new THREE.Mesh(G.torso, this.clothMat);
    this.torso.position.y = 0.55;
    this.torso.rotation.x = 0.22;
    body.add(this.torso);

    this.head = new THREE.Mesh(G.head, this.skinMat);
    this.head.position.set(0, 1.35, 0.18);
    this.head.rotation.x = 0.3;
    this.head.rotation.z = rand(-0.25, 0.25);
    body.add(this.head);

    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(G.eye, EYE_MAT);
      eye.position.set(0.14 * s, 0.06, 0.29);
      this.head.add(eye);
    }

    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(G.arm, this.skinMat);
      arm.geometry = G.arm;
      const pivot = new THREE.Group();
      pivot.position.set(0.56 * s, 1.0, 0.1);
      pivot.rotation.x = -Math.PI / 2 + rand(-0.2, 0.2); // arms out front
      arm.position.y = -0.42;
      pivot.add(arm);
      body.add(pivot);
      this.arms.push(pivot);
    }

    this.legs = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.24 * s, 0.05, 0);
      const leg = new THREE.Mesh(G.leg, this.clothMat);
      leg.position.y = -0.5;
      pivot.add(leg);
      body.add(pivot);
      this.legs.push(pivot);
    }

    const shadow = new THREE.Mesh(G.shadow, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);
    this.shadow = shadow;

    this.makeLabel();
  }

  // ---------- floating word label ----------
  makeLabel() {
    this.canvas = document.createElement('canvas');
    this.lctx = this.canvas.getContext('2d');
    const font = 'bold 58px "Courier New", monospace';
    this.lctx.font = font;
    const w = Math.ceil(this.lctx.measureText(this.word).width) + 36;
    this.canvas.width = w;
    this.canvas.height = 84;
    this.tex = new THREE.CanvasTexture(this.canvas);
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false });
    this.label = new THREE.Sprite(mat);
    this.label.position.set(0, LABEL_HEIGHTS[labelSlot++ % LABEL_HEIGHTS.length], 0);
    this.label.renderOrder = 10;
    this.baseLabelW = w / 90;
    this.group.add(this.label);
    this.drawLabel(false);
  }

  drawLabel(targeted) {
    const c = this.lctx, cv = this.canvas;
    c.clearRect(0, 0, cv.width, cv.height);
    c.font = 'bold 58px "Courier New", monospace';
    c.textBaseline = 'middle';
    // backdrop
    c.fillStyle = targeted ? 'rgba(10,14,8,0.96)' : 'rgba(4,6,12,0.88)';
    c.fillRect(0, 8, cv.width, 68);
    if (targeted) {
      c.strokeStyle = 'rgba(255,212,121,0.9)';
      c.lineWidth = 3;
      c.strokeRect(1, 9, cv.width - 3, 66);
    }
    const done = this.word.slice(0, this.progress);
    const todo = this.word.slice(this.progress);
    let x = 18;
    c.fillStyle = '#ffd479';
    c.fillText(done, x, 44);
    x += c.measureText(done).width;
    c.fillStyle = targeted ? '#ffffff' : '#c9d4c9';
    c.fillText(todo, x, 44);
    this.tex.needsUpdate = true;
  }

  headWorldPos(out) {
    return this.head.getWorldPosition(out);
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  die() {
    if (this.state === 'dying') return;
    this.setState('dying');
    this.label.visible = false;
  }

  knockback() {
    this.setState('knock');
    this.progress = 0;
    this.drawLabel(false);
  }

  // returns 'strike' the frame its attack lands
  update(dt, camPos) {
    this.t += dt;
    this.stateT += dt;
    const g = this.group;
    let event = null;

    const toCam = new THREE.Vector3(camPos.x, 0, camPos.z).sub(new THREE.Vector3(g.position.x, 0, g.position.z));
    const dist = toCam.length();
    toCam.normalize();
    g.rotation.y = Math.atan2(toCam.x, toCam.z);

    switch (this.state) {
      case 'walk': {
        const sp = this.speed;
        g.position.x += toCam.x * sp * dt;
        g.position.z += toCam.z * sp * dt;
        // drift toward center of street
        g.position.x += (camPos.x - g.position.x) * 0.06 * dt;
        // shamble
        const w = this.t * 6.2;
        this.body.position.y = 1.05 + Math.abs(Math.sin(w)) * 0.09;
        this.body.rotation.z = Math.sin(w * 0.5) * 0.09;
        this.legs[0].rotation.x = Math.sin(w) * 0.55;
        this.legs[1].rotation.x = -Math.sin(w) * 0.55;
        this.arms[0].rotation.x = -Math.PI / 2 + Math.sin(w * 0.9) * 0.15;
        this.arms[1].rotation.x = -Math.PI / 2 - Math.sin(w * 0.9) * 0.15;
        if (dist < 2.7) this.setState('attack');
        break;
      }
      case 'attack': {
        // wind up then lunge
        const p = this.stateT;
        if (p < 0.35) {
          this.body.rotation.x = -p * 0.9; // rear back
        } else if (p < 0.55) {
          this.body.rotation.x = -0.31 + (p - 0.35) * 5.5; // lunge forward
        } else {
          this.body.rotation.x = 0;
          event = 'strike';
        }
        break;
      }
      case 'knock': {
        const away = 7.5 * (1 - Math.min(this.stateT / 0.6, 1));
        g.position.x -= toCam.x * away * dt;
        g.position.z -= toCam.z * away * dt;
        this.body.rotation.x = -0.5 * (1 - this.stateT / 0.6);
        if (this.stateT >= 0.6) {
          this.body.rotation.x = 0;
          this.setState('walk');
        }
        break;
      }
      case 'dying': {
        const p = this.stateT;
        this.body.rotation.x = -Math.min(p * 3.2, Math.PI / 2); // topple backward
        g.position.x -= toCam.x * 2.5 * dt;
        g.position.z -= toCam.z * 2.5 * dt;
        if (p > 0.6) g.position.y -= dt * 2.2; // sink
        this.shadow.material = SHADOW_MAT; // shared; fade via sink only
        if (p > 1.3) this.dead = true;
        break;
      }
      case 'idle': { // boss loiter
        const w = this.t * 1.6;
        this.body.position.y = 1.05 + Math.sin(w) * 0.06;
        this.body.rotation.z = Math.sin(w * 0.7) * 0.05;
        this.arms[0].rotation.x = -Math.PI / 2 + Math.sin(w) * 0.1;
        this.arms[1].rotation.x = -Math.PI / 2 - Math.sin(w) * 0.1;
        break;
      }
      case 'stagger': {
        this.body.rotation.x = -0.6 * Math.sin(Math.min(this.stateT / 0.5, 1) * Math.PI);
        this.body.rotation.z = Math.sin(this.stateT * 22) * 0.08 * (1 - this.stateT / 0.5);
        if (this.stateT >= 0.5) { this.body.rotation.z = 0; this.setState('idle'); }
        break;
      }
    }
    return event;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.tex.dispose();
    this.label.material.dispose();
    this.skinMat.dispose();
    this.clothMat.dispose();
  }
}
