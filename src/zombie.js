import * as THREE from 'three';

const SKIN = [0x9cc487, 0xa8c284, 0x8cc09c, 0xb4ca88, 0xa2d4a6];
const CLOTH = [0x565478, 0x785858, 0x4a6a62, 0x6a5c48, 0x53688a, 0x74547a];

const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
const TEETH_MAT = new THREE.MeshLambertMaterial({ color: 0xd8d2b0 });
const SHADOW_GEO = new THREE.CircleGeometry(0.75, 20);

// soft radial glow texture, shared by all eye glows
const GLOW_TEX = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Lump a geometry with position-hashed noise (seam-safe: identical
// vertices get identical offsets) — turns clean primitives into rotten flesh.
function lump(geo, amt, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.sin(y * 9.1 + seed) * Math.cos(z * 7.3 + seed * 1.7);
    const ny = Math.sin(z * 8.2 + seed * 2.1) * Math.cos(x * 6.7 + seed);
    const nz = Math.sin(x * 7.9 + seed * 1.3) * Math.cos(y * 9.7 + seed * 0.7);
    p.setXYZ(i, x + nx * amt, y + ny * amt, z + nz * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

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
    this.scale = scale * (scale === 1 ? rand(0.92, 1.1) : 1);
    this.isBoss = scale > 2;
    this.hunch = rand(0.16, 0.34);
    this.seed = rand(0, 100);

    this.geos = [];
    this.mats = [];

    const skinColor = tint ?? pick(SKIN);
    this.skinMat = this.mat(new THREE.MeshLambertMaterial({ color: skinColor, emissive: 0x2c3c24 }));
    this.clothMat = this.mat(new THREE.MeshLambertMaterial({ color: pick(CLOTH), emissive: 0x181826, side: THREE.DoubleSide }));
    this.woundMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x6a1010, emissive: 0x300606 }));
    const eyeColor = this.isBoss ? 0xff4030 : 0xffd24a;
    this.eyeMat = this.mat(new THREE.MeshBasicMaterial({ color: eyeColor }));
    this.glowMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: eyeColor, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
    }));

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(this.scale);
    this.group = g;

    const body = new THREE.Group();
    body.position.y = 1.05;
    g.add(body);
    this.body = body;

    this.buildTorso(body);
    this.buildHead(body);
    this.buildArms(body);
    this.buildLegs(body);
    this.buildRags(body);
    if (this.isBoss) this.buildHat();

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);
    this.shadow = shadow;

    this.makeLabel();
  }

  geo(g) { this.geos.push(g); return g; }
  mat(m) { this.mats.push(m); return m; }
  mesh(g, m) { return new THREE.Mesh(this.geo(g), m); }

  buildTorso(body) {
    const pelvis = this.mesh(new THREE.SphereGeometry(0.36, 10, 8), this.clothMat);
    pelvis.scale.set(1.1, 0.7, 0.85);
    pelvis.position.y = 0.05;
    body.add(pelvis);

    const torso = this.mesh(
      lump(new THREE.CapsuleGeometry(0.4, 0.5, 6, 14), 0.05, this.seed),
      this.clothMat
    );
    torso.position.y = 0.62;
    torso.scale.set(1.05, 1, 0.78);
    torso.rotation.x = 0.1;
    body.add(torso);

    // bloated gut poking out of the shirt
    if (Math.random() < 0.6) {
      const gut = this.mesh(lump(new THREE.SphereGeometry(0.3, 12, 10), 0.04, this.seed + 3), this.skinMat);
      gut.position.set(rand(-0.06, 0.06), 0.32, 0.2);
      gut.scale.set(1, 0.85, 0.7);
      body.add(gut);
    }
    // open wound
    if (Math.random() < 0.7) {
      const wound = this.mesh(lump(new THREE.SphereGeometry(0.15, 8, 6), 0.03, this.seed + 5), this.woundMat);
      wound.position.set(rand(-0.3, 0.3), rand(0.4, 0.85), rand(0.2, 0.28));
      wound.scale.set(1, rand(0.7, 1.4), 0.4);
      body.add(wound);
    }

    const neck = this.mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.2, 8), this.skinMat);
    neck.position.set(0, 1.15, 0.1);
    neck.rotation.x = 0.3;
    body.add(neck);
  }

  buildHead(body) {
    const head = new THREE.Group();
    head.position.set(0, 1.32, 0.16);
    head.rotation.x = 0.22;
    head.rotation.z = rand(-0.28, 0.28);
    body.add(head);
    this.head = head;

    const skull = this.mesh(
      lump(new THREE.SphereGeometry(0.3, 14, 12), 0.03, this.seed + 1),
      this.skinMat
    );
    skull.scale.set(0.85, 1.0, 0.95);
    head.add(skull);

    const brow = this.mesh(new THREE.BoxGeometry(0.4, 0.08, 0.12, 3, 1, 1), this.skinMat);
    brow.position.set(0, 0.1, 0.22);
    brow.rotation.x = 0.25;
    head.add(brow);

    const nose = this.mesh(new THREE.BoxGeometry(0.07, 0.11, 0.09), this.skinMat);
    nose.position.set(0, -0.04, 0.28);
    nose.rotation.x = 0.3;
    head.add(nose);

    // upper teeth on the skull, lower on the swinging jaw
    const upperTeeth = this.mesh(new THREE.BoxGeometry(0.18, 0.035, 0.03), TEETH_MAT);
    upperTeeth.position.set(0, -0.15, 0.24);
    head.add(upperTeeth);

    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, -0.12, 0.0);
    head.add(jawPivot);
    this.jaw = jawPivot;
    const jaw = this.mesh(lump(new THREE.BoxGeometry(0.26, 0.12, 0.26, 3, 2, 3), 0.015, this.seed + 2), this.skinMat);
    jaw.position.set(0, -0.06, 0.08);
    jawPivot.add(jaw);
    const lowerTeeth = this.mesh(new THREE.BoxGeometry(0.16, 0.03, 0.025), TEETH_MAT);
    lowerTeeth.position.set(0, -0.005, 0.19);
    jawPivot.add(lowerTeeth);
    jawPivot.rotation.x = 0.4;

    for (const s of [-1, 1]) {
      const socket = this.mesh(new THREE.SphereGeometry(0.07, 8, 6), this.woundMat);
      socket.position.set(0.115 * s, 0.02, 0.22);
      socket.scale.z = 0.5;
      head.add(socket);
      const eye = this.mesh(new THREE.SphereGeometry(0.042, 8, 6), this.eyeMat);
      eye.position.set(0.115 * s, 0.02, 0.26);
      head.add(eye);
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(0.115 * s, 0.02, 0.3);
      glow.scale.setScalar(this.isBoss ? 0.55 : 0.32);
      head.add(glow);
    }
  }

  buildArms(body) {
    this.shoulders = [];
    this.elbows = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.48 * s, 0.98, 0.1);
      shoulder.rotation.x = -Math.PI / 2 + rand(-0.25, 0.2);
      shoulder.rotation.z = s * rand(-0.15, 0.1);
      body.add(shoulder);
      this.shoulders.push(shoulder);

      // torn sleeve upper arm, bare rotten forearm
      const upper = this.mesh(lump(new THREE.CapsuleGeometry(0.095, 0.28, 4, 10), 0.02, this.seed + 6 + s), this.clothMat);
      upper.position.y = -0.24;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.48;
      elbow.rotation.x = rand(-0.55, -0.2);
      shoulder.add(elbow);
      this.elbows.push(elbow);

      const forearm = this.mesh(lump(new THREE.CapsuleGeometry(0.075, 0.26, 4, 10), 0.02, this.seed + 8 + s), this.skinMat);
      forearm.position.y = -0.2;
      elbow.add(forearm);

      // hand with curled clawing fingers
      const hand = new THREE.Group();
      hand.position.y = -0.4;
      hand.rotation.x = rand(-0.5, -0.2);
      elbow.add(hand);
      const palm = this.mesh(new THREE.BoxGeometry(0.11, 0.13, 0.055), this.skinMat);
      palm.position.y = -0.05;
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = this.mesh(new THREE.CapsuleGeometry(0.017, 0.08, 2, 5), this.skinMat);
        finger.position.set(-0.04 + f * 0.026, -0.15, 0.01 + (f % 2) * 0.012);
        finger.rotation.x = rand(-1.1, -0.5);
        hand.add(finger);
      }
      const thumb = this.mesh(new THREE.CapsuleGeometry(0.018, 0.06, 2, 5), this.skinMat);
      thumb.position.set(0.065 * s, -0.08, 0.02);
      thumb.rotation.z = s * 0.9;
      hand.add(thumb);
    }
  }

  buildLegs(body) {
    this.hips = [];
    this.knees = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.2 * s, 0.02, 0);
      body.add(hip);
      this.hips.push(hip);

      const thigh = this.mesh(lump(new THREE.CapsuleGeometry(0.115, 0.3, 4, 10), 0.02, this.seed + 10 + s), this.clothMat);
      thigh.position.y = -0.26;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.52;
      knee.rotation.x = 0.15;
      hip.add(knee);
      this.knees.push(knee);

      // one trouser leg torn off at random
      const shinMat = Math.random() < 0.4 ? this.skinMat : this.clothMat;
      const shin = this.mesh(lump(new THREE.CapsuleGeometry(0.09, 0.28, 4, 10), 0.02, this.seed + 12 + s), shinMat);
      shin.position.y = -0.22;
      knee.add(shin);

      const foot = this.mesh(new THREE.BoxGeometry(0.13, 0.1, 0.3, 2, 1, 2), this.skinMat);
      foot.position.set(0, -0.47, 0.07);
      knee.add(foot);
    }
  }

  buildRags(body) {
    this.rags = [];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const rag = this.mesh(new THREE.PlaneGeometry(0.13, rand(0.35, 0.6), 1, 3), this.clothMat);
      const pivot = new THREE.Group();
      pivot.position.set(rand(-0.35, 0.35), rand(0.1, 0.35), rand(-0.15, 0.25));
      rag.position.y = -0.25;
      pivot.add(rag);
      pivot.userData.phase = rand(0, 6);
      body.add(pivot);
      this.rags.push(pivot);
    }
  }

  buildHat() {
    // The Chancellor dresses for the occasion
    const hatMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x14121a }));
    const bandMat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffc040 }));
    const crown = this.mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.36, 12), hatMat);
    crown.position.set(0, 0.42, -0.02);
    this.head.add(crown);
    const brim = this.mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 14), hatMat);
    brim.position.set(0, 0.25, -0.02);
    this.head.add(brim);
    const band = this.mesh(new THREE.CylinderGeometry(0.225, 0.235, 0.07, 12), bandMat);
    band.position.set(0, 0.3, -0.02);
    this.head.add(band);
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
    c.shadowColor = 'rgba(255,190,80,0.9)';
    c.shadowBlur = targeted ? 12 : 0;
    c.fillStyle = '#ffd479';
    c.fillText(done, x, 44);
    x += c.measureText(done).width;
    c.shadowBlur = 0;
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

    // rags flutter in every state
    for (const rag of this.rags) {
      const p = rag.userData.phase;
      rag.rotation.x = Math.sin(this.t * 3.1 + p) * 0.3;
      rag.rotation.z = Math.sin(this.t * 2.3 + p * 1.7) * 0.2;
    }

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
        this.body.rotation.x = this.hunch + Math.sin(w) * 0.03;
        this.hips[0].rotation.x = Math.sin(w) * 0.6;
        this.hips[1].rotation.x = -Math.sin(w) * 0.6;
        this.knees[0].rotation.x = 0.15 + Math.max(0, Math.sin(w + 1.6)) * 0.8;
        this.knees[1].rotation.x = 0.15 + Math.max(0, -Math.sin(w + 1.6)) * 0.8;
        this.shoulders[0].rotation.x = -Math.PI / 2 + Math.sin(w * 0.9) * 0.18;
        this.shoulders[1].rotation.x = -Math.PI / 2 - Math.sin(w * 0.9) * 0.18;
        this.elbows[0].rotation.x = -0.35 + Math.sin(w * 0.9 + 1) * 0.12;
        this.elbows[1].rotation.x = -0.35 - Math.sin(w * 0.9 + 1) * 0.12;
        this.head.rotation.z = Math.sin(w * 0.5 + this.seed) * 0.14;
        this.jaw.rotation.x = 0.35 + Math.sin(this.t * 2.3 + this.seed) * 0.18;
        if (dist < 2.7) this.setState('attack');
        break;
      }
      case 'attack': {
        // wind up then lunge
        const p = this.stateT;
        this.jaw.rotation.x = Math.min(1.0, 0.4 + p * 2.5); // mouth gapes
        if (p < 0.35) {
          this.body.rotation.x = this.hunch - p * 0.9; // rear back
          this.shoulders[0].rotation.x = -Math.PI / 2 - p * 1.6; // arms rise
          this.shoulders[1].rotation.x = -Math.PI / 2 - p * 1.6;
          this.shoulders[0].rotation.z = -p * 0.8;
          this.shoulders[1].rotation.z = p * 0.8;
        } else if (p < 0.55) {
          this.body.rotation.x = this.hunch - 0.31 + (p - 0.35) * 5.5; // lunge forward
          this.shoulders[0].rotation.x = -Math.PI / 2 - 0.55 + (p - 0.35) * 6;
          this.shoulders[1].rotation.x = -Math.PI / 2 - 0.55 + (p - 0.35) * 6;
        } else {
          this.body.rotation.x = this.hunch;
          this.shoulders[0].rotation.z = 0;
          this.shoulders[1].rotation.z = 0;
          event = 'strike';
        }
        break;
      }
      case 'knock': {
        const away = 7.5 * (1 - Math.min(this.stateT / 0.6, 1));
        g.position.x -= toCam.x * away * dt;
        g.position.z -= toCam.z * away * dt;
        this.body.rotation.x = this.hunch - 0.5 * (1 - this.stateT / 0.6);
        this.shoulders[0].rotation.z = Math.sin(this.stateT * 20) * 0.3;
        this.shoulders[1].rotation.z = -Math.sin(this.stateT * 20) * 0.3;
        if (this.stateT >= 0.6) {
          this.body.rotation.x = this.hunch;
          this.shoulders[0].rotation.z = 0;
          this.shoulders[1].rotation.z = 0;
          this.setState('walk');
        }
        break;
      }
      case 'dying': {
        const p = this.stateT;
        this.body.rotation.x = this.hunch - Math.min(p * 3.2, Math.PI / 2); // topple backward
        g.position.x -= toCam.x * 2.5 * dt;
        g.position.z -= toCam.z * 2.5 * dt;
        // limbs splay, knees buckle, jaw drops
        const s = Math.min(p * 2, 1);
        this.shoulders[0].rotation.z = -s * 1.2;
        this.shoulders[1].rotation.z = s * 1.2;
        this.knees[0].rotation.x = 0.15 + s * 1.1;
        this.knees[1].rotation.x = 0.15 + s * 0.8;
        this.jaw.rotation.x = 0.4 + s * 0.7;
        if (p > 0.6) g.position.y -= dt * 2.2; // sink
        if (p > 1.3) this.dead = true;
        break;
      }
      case 'idle': { // boss loiter
        const w = this.t * 1.6;
        this.body.position.y = 1.05 + Math.sin(w) * 0.06;
        this.body.rotation.x = this.hunch * 0.6;
        this.body.rotation.z = Math.sin(w * 0.7) * 0.05;
        this.shoulders[0].rotation.x = -Math.PI / 2 + Math.sin(w) * 0.1;
        this.shoulders[1].rotation.x = -Math.PI / 2 - Math.sin(w) * 0.1;
        this.head.rotation.z = Math.sin(w * 0.4) * 0.08;
        this.jaw.rotation.x = 0.3 + Math.sin(w * 1.3) * 0.12;
        break;
      }
      case 'stagger': {
        this.body.rotation.x = this.hunch * 0.6 - 0.6 * Math.sin(Math.min(this.stateT / 0.5, 1) * Math.PI);
        this.body.rotation.z = Math.sin(this.stateT * 22) * 0.08 * (1 - this.stateT / 0.5);
        this.jaw.rotation.x = 1.0;
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
    for (const geo of this.geos) geo.dispose();
    for (const mat of this.mats) mat.dispose();
  }
}
