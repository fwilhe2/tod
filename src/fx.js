import * as THREE from 'three';
import { NO_REFLECT_LAYER } from './reflect.js';
import { makeFbm, rand } from './textures.js';

// Instanced particle effects: every system is one draw call with a fixed
// pool, recycled round-robin.
//   blood   — glossy droplets that stretch along their velocity and leave a
//             splat where they land
//   chunks  — lumps of flesh that bounce and settle
//   decals  — blood splatter on the cobbles, drying darker, then shrinking
//   sparks  — additive streaks (line segments), one buffer
//   puffs   — soft billboards for muzzle smoke and red mist
//   flash   — one pooled point light for impacts

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
const _c = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function splatTexture(seed) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const n = makeFbm(4, 3, seed);
  // central pool with a noisy edge
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x / S - 0.5, dy = y / S - 0.5;
      const r = Math.hypot(dx, dy);
      const edge = 0.2 + n(x / S, y / S) * 0.22;
      const a = Math.max(0, Math.min(1, (edge - r) * 30));
      const i = (y * S + x) * 4;
      const k = 0.6 + n(x / S * 3, y / S * 3) * 0.6;
      img.data[i] = 255 * k; img.data[i + 1] = 255 * k; img.data[i + 2] = 255 * k;
      img.data[i + 3] = a * 255;
    }
  }
  c.putImageData(img, 0, 0);
  // flung droplets and streaks radiating out
  c.fillStyle = '#fff';
  for (let i = 0; i < 40; i++) {
    const a = rand(0, Math.PI * 2), r = rand(0.22, 0.47) * S, sz = rand(1, 5) * (1 - r / S);
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    c.beginPath();
    c.ellipse(x, y, sz * rand(1.2, 3), sz, a, 0, Math.PI * 2);
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const n = makeFbm(4, 3);
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + n(x / S, y / S) * 0.7);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

class Pool {
  constructor(mesh, n) {
    this.mesh = mesh;
    this.items = Array.from({ length: n }, () => ({ alive: false }));
    this.next = 0;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, HIDDEN);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  take() {
    const i = this.next;
    this.next = (this.next + 1) % this.items.length;
    const it = this.items[i];
    it.i = i;
    it.alive = true;
    return it;
  }
}

export class Fx {
  constructor(scene) {
    this.scene = scene;

    // ---- blood droplets: lit, glossy, so lamps glint off them
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.1 });
    this.blood = new Pool(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), dropMat, 700), 700);
    this.blood.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3);
    scene.add(this.blood.mesh);

    // ---- flesh chunks
    const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x5a0e0c, roughness: 0.35 });
    this.chunks = new Pool(new THREE.InstancedMesh(chunkGeo, chunkMat, 160), 160);
    this.chunks.mesh.castShadow = true;
    scene.add(this.chunks.mesh);

    // ---- ground decals, four splatter shapes
    this.decals = [];
    for (let v = 0; v < 4; v++) {
      const mat = new THREE.MeshStandardMaterial({
        map: splatTexture(v * 31 + 7), color: 0x4a0606, roughness: 0.18, metalness: 0,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const pool = new Pool(new THREE.InstancedMesh(geo, mat, 60), 60);
      pool.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(60 * 3).fill(1), 3);
      pool.mesh.renderOrder = 1;
      pool.mesh.layers.set(NO_REFLECT_LAYER);
      scene.add(pool.mesh);
      this.decals.push(pool);
    }

    // ---- sparks: streaks in one line-segment buffer
    this.SPARKS = 300;
    this.sparkPos = new Float32Array(this.SPARKS * 6);
    this.sparkCol = new Float32Array(this.SPARKS * 6);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkLines = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sparkLines.frustumCulled = false;
    scene.add(this.sparkLines);
    this.sparks = Array.from({ length: this.SPARKS }, () => ({ alive: false }));
    this.sparkNext = 0;

    // ---- puffs (smoke, mist): sprites with per-item material for opacity
    const puffTex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, alive: false });
    }
    this.puffNext = 0;

    // ---- impact light
    this.flash = new THREE.PointLight(0xffb070, 0, 7, 2);
    scene.add(this.flash);
    this.flashT = 0;
  }

  // a burst of blood droplets, biased along `dir`
  spray(pos, dir, n = 20, force = 1, color = null) {
    for (let k = 0; k < n; k++) {
      const it = this.blood.take();
      it.pos = pos.clone();
      it.vel = new THREE.Vector3(rand(-2.2, 2.2), rand(0.5, 4.5), rand(-2.2, 2.2)).multiplyScalar(force);
      if (dir) it.vel.addScaledVector(dir, rand(1, 4) * force);
      it.r = rand(0.012, 0.045);
      it.life = 0;
      it.ttl = rand(0.8, 1.6);
      it.water = !!color;
      if (color) _c.set(color).multiplyScalar(rand(0.7, 1.2));
      else _c.setRGB(rand(0.22, 0.4), rand(0.005, 0.02), rand(0.005, 0.02));
      this.blood.mesh.setColorAt(it.i, _c);
    }
    this.blood.mesh.instanceColor.needsUpdate = true;
  }

  gibs(pos, n = 6, force = 1) {
    for (let k = 0; k < n; k++) {
      const it = this.chunks.take();
      it.pos = pos.clone();
      it.vel = new THREE.Vector3(rand(-3, 3), rand(2, 6), rand(-3, 3)).multiplyScalar(force);
      it.rot = new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6));
      it.spin = new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      it.r = rand(0.03, 0.08);
      it.life = 0;
      it.ttl = rand(4, 7);
    }
  }

  splat(pos, size = 1, grow = 0) {
    const pool = this.decals[Math.floor(Math.random() * 4)];
    const it = pool.take();
    it.pos = new THREE.Vector3(pos.x, 0.012 + Math.random() * 0.004, pos.z);
    it.rot = rand(0, Math.PI * 2);
    it.size = size;
    it.grow = grow;  // seconds to spread out to full size (kill pools)
    it.life = 0;
    it.ttl = rand(24, 32);
    pool.mesh.setColorAt(it.i, _c.setRGB(1, 1, 1));
    pool.mesh.instanceColor.needsUpdate = true;
  }

  spark(pos, n = 10, color = 0xffc870, speed = 6) {
    const col = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const it = this.sparks[this.sparkNext];
      this.sparkNext = (this.sparkNext + 1) % this.SPARKS;
      it.alive = true;
      it.pos = pos.clone();
      it.vel = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1) * speed);
      it.col = col.clone().multiplyScalar(rand(1.5, 3));
      it.life = 0;
      it.ttl = rand(0.12, 0.35);
    }
  }

  puff(pos, { color = 0x9aa0a8, size = 0.4, grow = 2, ttl = 1.2, opacity = 0.35, vel = null, additive = false } = {}) {
    const it = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % this.puffs.length;
    it.alive = true;
    it.s.visible = true;
    it.s.position.copy(pos);
    it.s.material.color.set(color);
    it.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    it.s.material.rotation = rand(0, Math.PI * 2);
    it.vel = vel ? vel.clone() : new THREE.Vector3(rand(-0.2, 0.2), rand(0.2, 0.5), rand(-0.2, 0.2));
    it.size = size; it.grow = grow; it.ttl = ttl; it.op = opacity;
    it.life = 0;
  }

  impactLight(pos, k = 1) {
    this.flash.position.copy(pos);
    this.flashT = 0.07 * k;
    this.flashK = k;
  }

  update(dt) {
    // blood droplets: stretch along velocity, splat on landing
    const bm = this.blood.mesh;
    for (const it of this.blood.items) {
      if (!it.alive) continue;
      it.life += dt;
      it.vel.y -= 14 * dt;
      it.pos.addScaledVector(it.vel, dt);
      if (it.pos.y <= 0.02 || it.life > it.ttl) {
        if (it.pos.y <= 0.02 && !it.water && Math.random() < 0.18) this.splat(it.pos, rand(0.12, 0.35));
        it.alive = false;
        bm.setMatrixAt(it.i, HIDDEN);
        continue;
      }
      const sp = it.vel.length();
      _q.setFromUnitVectors(_up, _d.copy(it.vel).divideScalar(sp || 1));
      _s.set(it.r, it.r * (1 + sp * 0.12), it.r);
      bm.setMatrixAt(it.i, _m.compose(it.pos, _q, _s));
    }
    bm.instanceMatrix.needsUpdate = true;

    // chunks: bounce, roll to a stop, sink away at the end
    const cm = this.chunks.mesh;
    for (const it of this.chunks.items) {
      if (!it.alive) continue;
      it.life += dt;
      it.vel.y -= 14 * dt;
      it.pos.addScaledVector(it.vel, dt);
      if (it.pos.y < it.r * 0.6) {
        if (it.vel.y < -2.5) this.splat(it.pos, rand(0.15, 0.3));
        it.pos.y = it.r * 0.6;
        it.vel.set(it.vel.x * 0.45, Math.abs(it.vel.y) > 1.5 ? -it.vel.y * 0.3 : 0, it.vel.z * 0.45);
        it.spin.multiplyScalar(0.6);
      }
      it.rot.x += it.spin.x * dt; it.rot.y += it.spin.y * dt; it.rot.z += it.spin.z * dt;
      const fade = Math.min(1, (it.ttl - it.life) / 0.8);
      if (fade <= 0) { it.alive = false; cm.setMatrixAt(it.i, HIDDEN); continue; }
      _q.setFromEuler(it.rot);
      _s.set(it.r, it.r * 0.7, it.r * 0.85).multiplyScalar(fade);
      cm.setMatrixAt(it.i, _m.compose(it.pos, _q, _s));
    }
    cm.instanceMatrix.needsUpdate = true;

    // decals: spread, dry darker, then shrink away
    for (const pool of this.decals) {
      let dirty = false;
      for (const it of pool.items) {
        if (!it.alive) continue;
        it.life += dt;
        if (it.life > it.ttl) { it.alive = false; pool.mesh.setMatrixAt(it.i, HIDDEN); dirty = true; continue; }
        const spread = it.grow > 0 ? 1 - (1 - Math.min(1, it.life / it.grow)) ** 3 : 1;
        const shrink = Math.min(1, (it.ttl - it.life) / 3);
        const sz = it.size * spread * shrink;
        _q.setFromAxisAngle(_up, it.rot);
        pool.mesh.setMatrixAt(it.i, _m.compose(it.pos, _q, _s.set(sz, 1, sz)));
        const dry = 1 - Math.min(1, it.life / 12) * 0.55;
        pool.mesh.setColorAt(it.i, _c.setRGB(dry, dry, dry));
        dirty = true;
      }
      if (dirty) { pool.mesh.instanceMatrix.needsUpdate = true; pool.mesh.instanceColor.needsUpdate = true; }
    }

    // sparks
    const P = this.sparkPos, C = this.sparkCol;
    for (let i = 0; i < this.SPARKS; i++) {
      const it = this.sparks[i];
      const j = i * 6;
      if (!it.alive) { P.fill(0, j, j + 6); C.fill(0, j, j + 6); continue; }
      it.life += dt;
      if (it.life > it.ttl) { it.alive = false; P.fill(0, j, j + 6); C.fill(0, j, j + 6); continue; }
      it.vel.y -= 9 * dt;
      it.pos.addScaledVector(it.vel, dt);
      const k = 1 - it.life / it.ttl;
      P[j] = it.pos.x; P[j + 1] = it.pos.y; P[j + 2] = it.pos.z;
      P[j + 3] = it.pos.x - it.vel.x * 0.025; P[j + 4] = it.pos.y - it.vel.y * 0.025; P[j + 5] = it.pos.z - it.vel.z * 0.025;
      C[j] = it.col.r * k; C[j + 1] = it.col.g * k; C[j + 2] = it.col.b * k;
      C[j + 3] = it.col.r * k * 0.2; C[j + 4] = it.col.g * k * 0.2; C[j + 5] = it.col.b * k * 0.2;
    }
    this.sparkLines.geometry.attributes.position.needsUpdate = true;
    this.sparkLines.geometry.attributes.color.needsUpdate = true;

    // puffs
    for (const it of this.puffs) {
      if (!it.alive) continue;
      it.life += dt;
      const p = it.life / it.ttl;
      if (p >= 1) { it.alive = false; it.s.visible = false; continue; }
      it.s.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-dt * 2));
      it.s.scale.setScalar(it.size * (1 + p * it.grow));
      it.s.material.opacity = it.op * (1 - p) * Math.min(1, it.life * 20);
    }

    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 60 * this.flashK * (this.flashT / 0.07) : 0;
  }
}
