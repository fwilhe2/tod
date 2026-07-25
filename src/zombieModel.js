import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { GLOW_TEX, WordLabel } from './label.js';

// A ghoul backed by a CC0 skinned glTF (Quaternius' Animated Zombie Pack)
// instead of the procedural primitive skeleton in zombie.js. Same public
// surface, so game.js can construct either one — see ASSETS.md for provenance.

const SKIN = [0x87927a, 0x7d8a68, 0x8e9a84, 0x707d5e, 0x939c7d];

// Match the procedural ghouls' silhouette: they stand ~2.5 units tall, which
// keeps the word labels (2.9 / 3.6 / 4.3) clear of the head.
const TARGET_HEIGHT = 2.5;

// The bite clip is a leisurely 5s; the game's combat contract wants the strike
// to land at 0.55s, so it gets compressed into a single quick lunge.
const ATTACK_DUR = 1.0;
const STRIKE_AT = 0.55;

const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
const SHADOW_GEO = new THREE.CircleGeometry(0.75, 20);

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------------------------------------------------------------------------
// asset loading
// ---------------------------------------------------------------------------

let asset = null; // { mesh, clips, scale, faceOffset }

export async function loadZombieModel(url = 'models/zombie.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);

  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!mesh) throw new Error('zombie.glb contains no SkinnedMesh');

  // Derive the scale from the model rather than hard-coding it, so dropping in
  // a different CC0 zombie doesn't silently produce a 700-unit-tall giant.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = TARGET_HEIGHT / size.y;

  const clips = {};
  for (const clip of gltf.animations) {
    // clips arrive named "Zombie|ZombieWalk"
    clips[clip.name.split('|').pop()] = clip;
  }

  asset = { scene: gltf.scene, mesh, clips, scale };
  precomputeLimbGroups(mesh);
  return asset;
}

export function zombieModelReady() { return asset !== null; }

// ---------------------------------------------------------------------------
// gib extraction
//
// The problem with dropping a skinned mesh into this game is that its whole
// gore mechanic reparents body parts into the world — and you cannot detach
// part of a skinned mesh, it is one buffer deformed by a bone palette. The
// usual fix is to author a stump mesh per limb, which no CC0 pack ships.
//
// Instead we carve the gib out of the source mesh at runtime: find the
// triangles whose vertices are dominantly weighted to the severed bone (or any
// of its descendants), bake them at the pose they are currently in, and hand
// back a free-standing Mesh. Then collapse the bone so the limb disappears from
// the still-skinned body. No authoring, and the gib matches exactly.
// ---------------------------------------------------------------------------

const limbTriangles = new Map(); // bone name -> Uint32Array of vertex indices

function precomputeLimbGroups(mesh) {
  limbTriangles.clear();
  const geo = mesh.geometry;
  const skinIndex = geo.attributes.skinIndex;
  const skinWeight = geo.attributes.skinWeight;
  const index = geo.index;
  const triCount = index ? index.count / 3 : geo.attributes.position.count / 3;

  // dominant bone per vertex
  const vertCount = skinIndex.count;
  const dominant = new Uint16Array(vertCount);
  for (let v = 0; v < vertCount; v++) {
    let best = 0, bestW = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k);
      if (w > bestW) { bestW = w; best = skinIndex.getComponent(v, k); }
    }
    dominant[v] = best;
  }

  const boneIndex = new Map(mesh.skeleton.bones.map((b, i) => [b, i]));

  for (const bone of mesh.skeleton.bones) {
    // every bone in this bone's subtree
    const subtree = new Set();
    bone.traverse((b) => { if (boneIndex.has(b)) subtree.add(boneIndex.get(b)); });

    const verts = [];
    for (let t = 0; t < triCount; t++) {
      const a = index ? index.getX(t * 3) : t * 3;
      const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      // a triangle belongs to the limb if the majority of it does
      const n = subtree.has(dominant[a]) + subtree.has(dominant[b]) + subtree.has(dominant[c]);
      if (n >= 2) verts.push(a, b, c);
    }
    if (verts.length) limbTriangles.set(bone.name, new Uint32Array(verts));
  }
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

// Bake the triangles of `boneName`'s subtree, in their current animated pose,
// into a standalone Mesh parented to `group`.
function buildGib(mesh, group, boneName, material) {
  const verts = limbTriangles.get(boneName);
  if (!verts || !verts.length) return null;

  const srcPos = mesh.geometry.attributes.position;
  const n = verts.length;
  const pos = new Float32Array(n * 3);

  // Skinning reads bone world matrices, and the placement below needs the
  // group's. Refresh from the root: a ghoul shot on its very first frame has
  // never been through the renderer, so these are otherwise still identity.
  group.updateMatrixWorld(true);

  // pass 1: skin every vertex into mesh-local posed space, accumulate centroid
  const centroid = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const vi = verts[i];
    _v.fromBufferAttribute(srcPos, vi);
    mesh.applyBoneTransform(vi, _v);
    pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
    centroid.add(_v);
  }
  centroid.divideScalar(n);

  // pass 2: re-centre on the limb so it tumbles about itself, not the hips
  for (let i = 0; i < n; i++) {
    pos[i * 3] -= centroid.x;
    pos[i * 3 + 1] -= centroid.y;
    pos[i * 3 + 2] -= centroid.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // the source normals are rotated by the same bone palette; recomputing them
  // is cheaper than skinning them, and plenty for a chunk that lives ~1 second
  geo.computeVertexNormals();

  const gib = new THREE.Mesh(geo, material);

  // place it so it lines up exactly with the limb it replaces
  _m.copy(group.matrixWorld).invert().multiply(mesh.matrixWorld);
  gib.position.copy(centroid).applyMatrix4(_m);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  _m.decompose(p, q, s);
  gib.quaternion.copy(q);
  gib.scale.copy(s);
  group.add(gib);
  return gib;
}

// ---------------------------------------------------------------------------

export class ModelZombie {
  constructor(word, x, z, speed, scale = 1, tint = null, special = null) {
    if (!asset) throw new Error('loadZombieModel() must resolve before spawning');

    this.word = word;
    this.special = special;
    this.progress = 0;
    this.speed = speed;
    this.state = 'walk';
    this.stateT = 0;
    this.dead = false;
    this.t = rand(0, 10);
    this.scale = scale * (scale === 1 ? rand(0.92, 1.1) : 1);
    this.isBoss = scale > 2;
    this.seed = rand(0, 100);
    this.gait = rand(0.85, 1.15);

    this.geos = [];
    this.mats = [];

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(this.scale);
    this.group = g;

    // wrapper carries the hunch/topple that the procedural ghoul applies to its
    // torso; the mixer animates bones underneath it
    const body = new THREE.Group();
    body.scale.setScalar(asset.scale);
    g.add(body);
    this.body = body;

    const model = cloneSkinned(asset.scene);
    body.add(model);
    this.model = model;

    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      this.mesh = o;
      o.frustumCulled = false; // animated bounds drift outside the rest-pose box
      const m = new THREE.MeshLambertMaterial({
        color: tint ?? pick(SKIN),
        emissive: 0x1a2216,
      });
      o.material = this.mat(m);
    });

    this.bones = new Map();
    this.mesh.skeleton.bones.forEach((b) => this.bones.set(b.name, b));
    this.head = this.bones.get('Head');

    // Anything parented to a bone inherits the model scale *and* whatever
    // scales the rig's own joints carry, which for an FBX-derived skeleton is
    // not 1. Measure the ratio rather than assuming it, so accessories come out
    // in the same units as the rest of the scene.
    g.updateMatrixWorld(true);
    const gs = g.getWorldScale(new THREE.Vector3()).x;
    const hs = this.head.getWorldScale(new THREE.Vector3()).x;
    this.attachK = gs / hs;

    // ---- animation ----
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [name, clip] of Object.entries(asset.clips)) {
      const a = this.mixer.clipAction(clip);
      this.actions[name] = a;
    }
    this.actions.ZombieBite.setLoop(THREE.LoopOnce, 1);
    this.actions.ZombieBite.clampWhenFinished = true;
    this.current = null;
    this.play('ZombieWalk');
    // desync identical clips across the horde
    this.actions.ZombieWalk.time = rand(0, asset.clips.ZombieWalk.duration);

    this.addEyes(tint);
    if (this.isBoss) this.addHat();
    if (special === 'coffee') this.addCup();

    this.shedQueue = ['LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm'];
    for (let i = this.shedQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shedQueue[i], this.shedQueue[j]] = [this.shedQueue[j], this.shedQueue[i]];
    }
    this.gone = new Set();

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    this.wordLabel = new WordLabel(word);
    this.label = this.wordLabel.sprite;
    this.baseLabelW = this.wordLabel.baseW;
    g.add(this.label);
    this.drawLabel(false);
  }

  mat(m) { this.mats.push(m); return m; }

  addEyes(tint) {
    const color = this.isBoss ? 0xff4030 : this.special === 'coffee' ? 0xffc040 : 0xc8d86a;
    const glowMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      opacity: this.isBoss ? 0.85 : 0.6,
    }));
    const k = this.attachK;
    for (const s of [-1, 1]) {
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(0.07 * s * k, 0.06 * k, 0.16 * k);
      glow.scale.setScalar((this.isBoss ? 0.45 : 0.22) * k);
      this.head.add(glow);
    }
  }

  addHat() {
    // The Chancellor dresses for the occasion — still procedural, because no
    // CC0 pack ships a top-hatted banking-tycoon ghoul.
    const k = this.attachK;
    const hatMat = this.mat(new THREE.MeshLambertMaterial({ color: 0x14121a }));
    const bandMat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffc040 }));
    const hat = new THREE.Group();
    const crown = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.21, 0.23, 0.36, 12)), hatMat);
    crown.position.y = 0.42;
    hat.add(crown);
    const brim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 14)), hatMat);
    brim.position.y = 0.25;
    hat.add(brim);
    const band = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.225, 0.235, 0.07, 12)), bandMat);
    band.position.y = 0.3;
    hat.add(band);
    hat.scale.setScalar(k);
    // the rig's Head bone sits mid-skull, not at the crown, so the brim only
    // needs to clear the top of the head by a little
    hat.position.set(0, -0.06 * k, 0.02 * k);
    this.head.add(hat);
    this.hat = hat;
  }

  addCup() {
    const k = this.attachK;
    const hand = this.bones.get('RightHand');
    if (!hand) return;
    const cupMat = this.mat(new THREE.MeshLambertMaterial({ color: 0xe8e2d4, emissive: 0x2a2822 }));
    const cup = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.055, 0.045, 0.1, 10)), cupMat);
    cup.position.set(0, -0.06 * k, 0.04 * k);
    cup.scale.setScalar(k);
    hand.add(cup);
    const steamMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0xfff4e0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35,
    }));
    const steam = new THREE.Sprite(steamMat);
    steam.position.set(0, 0.04 * k, 0.04 * k);
    steam.scale.setScalar(0.2 * k);
    hand.add(steam);
  }

  geo(g) { this.geos.push(g); return g; }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  // ---------- dismemberment ----------
  shed() {
    while (this.shedQueue.length) {
      const bone = this.shedQueue.shift();
      if (this.gone.has(bone)) continue;
      const gib = this.severe(bone);
      if (gib) return gib;
    }
    return null;
  }

  decapitate() {
    if (this.gone.has('Head')) return null;
    return this.severe('Head');
  }

  severe(boneName) {
    const bone = this.bones.get(boneName);
    if (!bone) return null;
    const gib = buildGib(this.mesh, this.group, boneName, this.mats[0]);
    // collapsing the bone takes its whole subtree with it, which is exactly the
    // behaviour the procedural version got from reparenting
    bone.scale.setScalar(1e-4);
    bone.traverse((b) => this.gone.add(b.name));
    if (gib) this.geos.push(gib.geometry);
    return gib;
  }

  // ---------- canal spawn ----------
  beginRise() {
    this.setState('rise');
    this.group.position.y = -1.75;
    this.splashed = false;
  }

  drawLabel(targeted) {
    this.wordLabel.draw(this.progress, targeted, this.special);
  }

  headWorldPos(out) {
    // once the head is gone its bone is collapsed at the neck, which is where
    // we want the gore to come from anyway
    return (this.head ?? this.mesh).getWorldPosition(out);
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    if (s === 'walk' || s === 'knock') this.play(this.speed > 1.15 ? 'ZombieRun' : 'ZombieWalk');
    else if (s === 'attack') {
      const bite = this.actions.ZombieBite;
      bite.timeScale = bite.getClip().duration / ATTACK_DUR;
      bite.reset();
      this.play('ZombieBite', 0.08);
    } else if (s === 'idle' || s === 'stagger') this.play('ZombieIdle');
    else if (s === 'rise') this.play('ZombieCrawl');
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

  update(dt, camPos) {
    this.t += dt;
    this.stateT += dt;
    const g = this.group;
    let event = null;

    const toCam = new THREE.Vector3(camPos.x, 0, camPos.z)
      .sub(new THREE.Vector3(g.position.x, 0, g.position.z));
    const dist = toCam.length();
    toCam.normalize();
    g.rotation.y = Math.atan2(toCam.x, toCam.z); // the pack's rig already faces +Z

    switch (this.state) {
      case 'rise': {
        const p = this.stateT;
        if (!this.splashed && p > 0.12) { this.splashed = true; event = 'splash'; }
        if (p < 1.3) {
          g.position.y = -1.75 + (p / 1.3) * 2.45;
        } else if (p < 2.1) {
          const q = (p - 1.3) / 0.8;
          g.position.y = 0.7 * (1 - q);
          g.position.x += (11.7 - g.position.x) * 3 * dt;
        } else {
          g.position.y = 0;
          this.setState('walk');
        }
        break;
      }
      case 'walk': {
        // lurch: surge on each step instead of gliding (mean ~= base speed)
        const cad = (2.6 + this.speed * 2.4) * this.gait;
        const w = this.t * cad;
        const sp = this.speed * (0.5 + 0.85 * Math.abs(Math.sin(w)));
        g.position.x += toCam.x * sp * dt;
        g.position.z += toCam.z * sp * dt;
        g.position.x += (camPos.x - g.position.x) * 0.06 * dt;
        g.position.x += Math.sin(this.t * 0.6 + this.seed) * 0.25 * dt;
        // drive the walk cycle from the lurch so feet roughly track the surge
        if (this.current === this.actions.ZombieWalk) this.current.timeScale = 0.8 + this.speed * 0.5;
        this.body.rotation.z = Math.sin(this.t * 0.7 + this.seed) * 0.04;
        if (dist < 2.7) this.setState('attack');
        break;
      }
      case 'attack': {
        if (this.stateT >= STRIKE_AT && !this.struck) { this.struck = true; }
        if (this.stateT >= ATTACK_DUR) { this.struck = false; event = 'strike'; }
        break;
      }
      case 'knock': {
        const away = 7.5 * (1 - Math.min(this.stateT / 0.6, 1));
        g.position.x -= toCam.x * away * dt;
        g.position.z -= toCam.z * away * dt;
        this.body.rotation.x = -0.5 * (1 - this.stateT / 0.6);
        if (this.stateT >= 0.6) { this.body.rotation.x = 0; this.setState('walk'); }
        break;
      }
      case 'dying': {
        // no death clip in the pack — topple procedurally and let the last
        // animated pose freeze underneath
        const p = this.stateT;
        this.mixer.timeScale = Math.max(0, 1 - p * 3);
        this.body.rotation.x = -Math.min(p * 3.2, Math.PI / 2);
        g.position.x -= toCam.x * 2.5 * dt;
        g.position.z -= toCam.z * 2.5 * dt;
        if (p > 0.6) g.position.y -= dt * 2.2;
        if (p > 1.3) this.dead = true;
        break;
      }
      case 'idle':
        this.body.rotation.z = Math.sin(this.t * 1.1) * 0.03;
        break;
      case 'stagger': {
        this.body.rotation.x = -0.6 * Math.sin(Math.min(this.stateT / 0.5, 1) * Math.PI);
        this.body.rotation.z = Math.sin(this.stateT * 22) * 0.08 * (1 - this.stateT / 0.5);
        if (this.stateT >= 0.5) { this.body.rotation.z = 0; this.setState('idle'); }
        break;
      }
    }

    this.mixer.update(dt);
    return event;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.wordLabel.dispose();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const geo of this.geos) geo.dispose();
    for (const mat of this.mats) mat.dispose();
  }
}
