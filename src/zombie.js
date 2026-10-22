import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skinMaps, clothMaps, radialCanvas, tex } from './textures.js';

// pallid, desaturated corpse tones — no healthy saturation
const SKIN = [0x87927a, 0x7d8a68, 0x8e9a84, 0x707d5e, 0x939c7d];
// faded, filthy clothes: work shirts, office blue, khaki, a once-white shirt
const CLOTH = [0x6a6258, 0x55606a, 0x7a6a52, 0x5a6450, 0x4a5068, 0x806e5e, 0x8a8478, 0x5e4e44];

// shared procedural surface maps (painted once)
const SKIN_MAPS = skinMaps();
const CLOTH_MAPS = clothMaps();
const SKIN_TEX = { map: tex(SKIN_MAPS.albedo, { srgb: true }), normalMap: tex(SKIN_MAPS.normal) };
const CLOTH_TEX = { map: tex(CLOTH_MAPS.albedo, { srgb: true, repeat: [2, 2] }), normalMap: tex(CLOTH_MAPS.normal, { repeat: [2, 2] }) };
const HAIR = [0x1a1612, 0x2a2018, 0x2e2a26, 0x3a332c, 0x14100c];
const TIES = [0x5a1018, 0x1c2a4a, 0x2c3a24, 0x4a3a10];

// soft contact shadow under the feet
const SHADOW_MAT = new THREE.MeshBasicMaterial({
  map: new THREE.CanvasTexture(radialCanvas([[0, 'rgba(0,0,0,0.75)'], [0.5, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']])),
  transparent: true, depthWrite: false,
});
const SHADOW_GEO = new THREE.PlaneGeometry(1.9, 1.9);

// Moonlit rim + hit flash + burn-away dissolve, injected into each zombie
// surface: the rim separates silhouettes from the dark street, every landed
// letter flares the body, and on death the flesh burns away from a noise
// front with a glowing ember edge.
function rimmed(mat, rim, rimColor) {
  mat.userData.hit = { value: 0 };
  mat.userData.dissolve = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(rimColor).multiplyScalar(rim) };
    shader.uniforms.hitFlash = mat.userData.hit;
    shader.uniforms.dissolve = mat.userData.dissolve;
    shader.vertexShader = 'varying vec3 vBurnPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vBurnPos = position;'
    );
    shader.fragmentShader = `uniform vec3 rimColor;
      uniform float hitFlash, dissolve;
      varying vec3 vBurnPos;
      float bHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.3, 71.7))) * 43758.5453); }
      float bNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(bHash(i), bHash(i + vec3(1, 0, 0)), f.x), mix(bHash(i + vec3(0, 1, 0)), bHash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(bHash(i + vec3(0, 0, 1)), bHash(i + vec3(1, 0, 1)), f.x), mix(bHash(i + vec3(0, 1, 1)), bHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      ` + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
       float burnN = bNoise(vBurnPos * 14.0) * 0.6 + bNoise(vBurnPos * 41.0) * 0.4;
       if (burnN < dissolve) discard;
       float burnEdge = dissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.07, burnN - dissolve) : 0.0;`
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       {
         float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
         float rim = pow(1.0 - ndv, 4.0);
         totalEmissiveRadiance += rimColor * rim + vec3(1.0, 0.82, 0.7) * hitFlash * (0.25 + rim);
         // char just behind the front, white-hot embers right on it
         diffuseColor.rgb *= 1.0 - burnEdge * 0.85;
         totalEmissiveRadiance += mix(vec3(2.5, 0.5, 0.08), vec3(5.0, 3.2, 1.2), burnEdge * burnEdge) * burnEdge;
       }`
    );
  };
  mat.customProgramCacheKey = () => 'zombie-rim';
  return mat;
}

// soft radial glow texture, shared by all eye glows
const GLOW_TEX = new THREE.CanvasTexture(radialCanvas([
  [0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)'],
], 64));

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
  constructor(word, x, z, speed, scale = 1, tint = null, special = null) {
    this.word = word;
    this.special = special; // 'coffee': amber-eyed barista ghoul, heals on kill
    this.progress = 0;
    this.speed = speed;
    this.state = 'walk'; // walk | attack | knock | dying | idle | stagger
    this.stateT = 0;
    this.dead = false;   // fully finished, safe to remove
    this.t = rand(0, 10);
    this.scale = scale * (scale === 1 ? rand(0.92, 1.1) : 1);
    this.isBoss = scale > 2;
    this.seed = rand(0, 100);

    // every corpse reanimated a little differently
    this.hunch = rand(0.32, 0.55);
    this.pose = {
      armMode: pick([0, 0, 1, 2]),   // 0: both arms reach; 1/2: left/right hangs dead
      dragLeg: Math.random() < 0.5 ? 0 : 1,
      headTilt: rand(0.2, 0.5) * (Math.random() < 0.5 ? -1 : 1),
      twist: rand(-0.14, 0.14),      // permanent spine twist
      gait: rand(0.85, 1.15),
      reach: [rand(-0.35, 0.1), rand(-0.35, 0.1)], // uneven arm heights
    };
    this.twitchT = rand(1.5, 4);
    this.twitchDur = 0;
    this.twitchSign = 1;

    this.geos = [];
    this.mats = [];

    // body type: most are ordinary corpses, some bloated, some starved
    this.build = this.isBoss ? 'normal' : pick(['normal', 'normal', 'bloated', 'gaunt']);
    this.girth = this.build === 'bloated' ? 1.22 : this.build === 'gaunt' ? 0.8 : 1;

    const skinColor = tint ?? pick(SKIN);
    const rimC = this.isBoss ? 0xff5040 : special === 'coffee' ? 0xffb040 : 0x9aa8b8;
    const rimK = this.isBoss ? 0.6 : 0.22;
    // a faint sickly self-glow keeps faces readable in the murk
    this.skinMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      ...SKIN_TEX, color: skinColor, roughness: 0.55, metalness: 0,
      emissive: new THREE.Color(skinColor).multiplyScalar(0.16), emissiveMap: SKIN_TEX.map,
    }), rimK, rimC));
    this.clothMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      ...CLOTH_TEX, color: pick(CLOTH), roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    }), rimK * 0.7, rimC));
    this.woundMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      color: 0x4a0808, emissive: 0x1a0202, roughness: 0.22, metalness: 0,
    }), rimK * 0.5, 0xff6060));
    // bone is per-zombie so it can burn away with the rest
    const BONE_MAT = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: 0x8c8370, roughness: 0.5 }), 0.15, rimC));
    this.boneMat = BONE_MAT;
    this.hitMats = [this.skinMat, this.clothMat, this.woundMat];
    this.hitFlash = 0;
    const eyeColor = this.isBoss ? 0xff4030 : special === 'coffee' ? 0xffc040 : 0xc8d86a;
    this.eyeBase = new THREE.Color(eyeColor).multiplyScalar(2.5);
    this.eyeMat = this.mat(new THREE.MeshBasicMaterial({ color: this.eyeBase.clone() }));
    this.glowMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: eyeColor, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: this.isBoss ? 0.85 : 0.6,
    }));
    this.glowBase = this.glowMat.opacity;

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
    if (special === 'coffee') this.buildCup();
    this.buildShedQueue();

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.renderOrder = 1;
    g.add(shadow);
    this.shadow = shadow;

    g.traverse((o) => { if (o.isMesh && o !== shadow) o.castShadow = true; });
    this.makeLabel();
  }

  geo(g) { this.geos.push(g); return g; }
  mat(m) { this.mats.push(m); return m; }
  get burnMats() { return this.mats.filter((m) => m.userData.dissolve); }
  mesh(g, m) { return new THREE.Mesh(this.geo(g), m); }

  buildTorso(body) {
    const G = this.girth;
    const pelvis = this.mesh(new THREE.SphereGeometry(0.34, 14, 10), this.clothMat);
    pelvis.scale.set(1.05 * G, 0.7, 0.8 * G);
    pelvis.position.y = 0.05;
    body.add(pelvis);

    const torso = this.mesh(
      lump(new THREE.CapsuleGeometry(0.38, 0.5, 6, 14), 0.05, this.seed),
      this.clothMat
    );
    torso.position.y = 0.62;
    torso.scale.set(G, 1, 0.72 * (G > 1 ? 1.15 : G));
    torso.rotation.x = 0.1;
    body.add(torso);

    // shoulder yoke and collarbones give a human shoulder line, not a bean
    const yoke = this.mesh(lump(new THREE.SphereGeometry(0.3, 16, 10), 0.03, this.seed + 9), this.clothMat);
    yoke.position.set(0, 0.95, 0.04);
    yoke.scale.set(1.55 * G, 0.55, 0.85 * Math.min(G, 1.1));
    body.add(yoke);
    if (this.build === 'gaunt') {
      for (const sx of [-1, 1]) {
        const clav = this.mesh(new THREE.CapsuleGeometry(0.025, 0.24, 2, 6), this.boneMat);
        clav.position.set(0.15 * sx, 1.06, 0.22);
        clav.rotation.z = Math.PI / 2 + sx * 0.2;
        body.add(clav);
      }
    }

    // sunken belly poking out of the shirt, on some
    if (this.build === 'bloated' || Math.random() < 0.45) {
      const big = this.build === 'bloated' ? 1.25 : 1;
      const gut = this.mesh(lump(new THREE.SphereGeometry(0.24, 16, 12), 0.05, this.seed + 3), this.skinMat);
      gut.position.set(rand(-0.06, 0.06), 0.32, 0.15 * big);
      gut.scale.set(0.95 * big, 0.75 * big, 0.6 * big);
      body.add(gut);
    }
    // open wound
    if (Math.random() < 0.7) {
      const wound = this.mesh(lump(new THREE.SphereGeometry(0.15, 8, 6), 0.03, this.seed + 5), this.woundMat);
      wound.position.set(rand(-0.28, 0.28), rand(0.35, 0.85), rand(0.18, 0.26));
      wound.scale.set(1, rand(0.7, 1.4), 0.22);
      body.add(wound);
    }
    // torn-open chest with exposed ribs, on some
    if (this.build === 'gaunt' || Math.random() < 0.35) {
      const rx = rand(-0.08, 0.08);
      const patch = this.mesh(new THREE.BoxGeometry(0.34, 0.3, 0.05), this.woundMat);
      patch.position.set(rx, 0.68, 0.24);
      patch.rotation.x = 0.12;
      body.add(patch);
      for (let r = 0; r < 3; r++) {
        // ribs curve around the chest instead of sitting on it like bars
        const rib = this.mesh(new THREE.TorusGeometry(0.16 - r * 0.01, 0.014, 4, 10, Math.PI * 0.75), this.boneMat);
        rib.position.set(rx, 0.56 + r * 0.09, 0.14);
        rib.rotation.set(Math.PI / 2 + 0.15, 0, Math.PI * 0.125);
        body.add(rib);
      }
    }

    // still wearing the office tie, on some
    if (!this.isBoss && Math.random() < 0.3) {
      const tieMat = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: pick(TIES), roughness: 0.6 }), 0.15, 0x9aa8b8));
      const tie = this.mesh(new THREE.BoxGeometry(0.07, 0.42, 0.02), tieMat);
      tie.position.set(rand(-0.03, 0.03), 0.86, 0.3 * (G > 1 ? 1.1 : 1));
      tie.rotation.set(0.25, 0, rand(-0.25, 0.25)); // askew
      body.add(tie);
      const knot = this.mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), tieMat);
      knot.position.set(0, 1.07, 0.24);
      body.add(knot);
    }

    const neck = this.mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.2, 10), this.skinMat);
    neck.position.set(0, 1.15, 0.1);
    neck.rotation.x = 0.35;
    body.add(neck);
  }

  buildHead(body) {
    const head = new THREE.Group();
    head.position.set(0, 1.32, 0.18);
    body.add(head);
    this.head = head;

    // gaunt, narrow skull
    const skull = this.mesh(
      lump(new THREE.SphereGeometry(0.3, 22, 18), 0.03, this.seed + 1),
      this.skinMat
    );
    skull.scale.set(0.76, 1.02, 0.9);
    head.add(skull);

    // heavy brow shadowing the eyes
    const brow = this.mesh(new THREE.BoxGeometry(0.4, 0.09, 0.13, 3, 1, 1), this.skinMat);
    brow.position.set(0, 0.08, 0.21);
    brow.rotation.x = 0.35;
    head.add(brow);

    const nose = this.mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), this.skinMat);
    nose.position.set(0, -0.05, 0.26);
    nose.rotation.x = 0.3;
    head.add(nose);

    // upper teeth on the skull, lower on the hanging jaw
    // jagged, broken teeth: one merged mesh per jaw
    const teeth = (n, w, y, z, down) => {
      const parts = [];
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.18) continue; // gaps where teeth fell out
        const h = rand(0.025, 0.05);
        const t = new THREE.BoxGeometry(0.022, h, 0.022);
        t.rotateZ(rand(-0.25, 0.25));
        t.translate(-w / 2 + (i + 0.5) * w / n, y + (down ? -h / 2 : h / 2), z - Math.abs(i - n / 2) * 0.008);
        parts.push(t);
      }
      return parts.length ? new THREE.Mesh(this.geo(mergeGeometries(parts)), this.boneMat) : new THREE.Group();
    };
    head.add(teeth(7, 0.17, -0.135, 0.225, true));

    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, -0.12, 0.0);
    head.add(jawPivot);
    this.jaw = jawPivot;
    const jaw = this.mesh(lump(new THREE.BoxGeometry(0.24, 0.11, 0.24, 3, 2, 3), 0.015, this.seed + 2), this.skinMat);
    jaw.position.set(0, -0.06, 0.07);
    jawPivot.add(jaw);
    jawPivot.add(teeth(6, 0.15, -0.02, 0.17, false));
    jawPivot.rotation.x = 0.55; // slack, hanging open

    // dried blood around the mouth, on some — it fed recently
    if (Math.random() < 0.5) {
      const smear = this.mesh(new THREE.BoxGeometry(0.15, 0.07, 0.03), this.woundMat);
      smear.position.set(rand(-0.04, 0.04), -0.02, 0.14);
      smear.rotation.z = rand(-0.3, 0.3);
      jawPivot.add(smear);
    }

    // a patchy scalp with lank strands hanging off the back and sides, on most
    if (Math.random() < 0.7) {
      const hairMat = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: pick(HAIR), roughness: 0.75 }), 0.08, 0x9aa8b8));
      const parts = [];
      const cap = lump(new THREE.SphereGeometry(0.31, 16, 10, 0, Math.PI * 2, 0, rand(0.8, 1.25)), 0.045, this.seed + 4);
      cap.rotateX(-0.45); // sits back on the crown, leaving the brow bare
      cap.scale(0.78, 1.02, 0.92);
      parts.push(cap);
      const n = Math.floor(rand(8, 18));
      for (let i = 0; i < n; i++) {
        const a = rand(Math.PI * 0.45, Math.PI * 1.55); // around the back, never the face
        const e = rand(0.05, 0.5);
        const len = rand(0.12, 0.34);
        const st = new THREE.CapsuleGeometry(rand(0.012, 0.022), len, 2, 4);
        st.translate(0, -len / 2, 0);
        st.rotateX(-Math.cos(a) * 0.25);
        st.rotateZ(Math.sin(a) * 0.25);
        st.translate(0.235 * Math.cos(e) * Math.sin(a), 0.3 * Math.sin(e), 0.28 * Math.cos(e) * Math.cos(a));
        parts.push(st);
      }
      head.add(new THREE.Mesh(this.geo(mergeGeometries(parts.map((g) => g.toNonIndexed()))), hairMat));
    }
    // a patch of skull showing where the scalp tore away, on some
    if (Math.random() < 0.3) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const bone = this.mesh(new THREE.SphereGeometry(0.13, 12, 10), this.boneMat);
      bone.position.set(0.12 * side, 0.15, 0.02);
      bone.scale.set(0.6, 0.8, 0.9);
      head.add(bone);
      const rim = this.mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 14), this.woundMat);
      rim.position.set(0.15 * side, 0.15, 0.02);
      rim.rotation.y = Math.PI / 2;
      rim.scale.set(0.9, 1.1, 1);
      head.add(rim);
    }

    for (const s of [-1, 1]) {
      const socket = this.mesh(new THREE.SphereGeometry(0.075, 10, 8), this.woundMat);
      socket.position.set(0.105 * s, 0.01, 0.19);
      socket.scale.z = 0.5;
      head.add(socket);
      const eye = this.mesh(new THREE.SphereGeometry(0.036, 8, 6), this.eyeMat);
      eye.position.set(0.105 * s, 0.01, 0.23);
      head.add(eye);
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(0.105 * s, 0.01, 0.27);
      glow.scale.setScalar(this.isBoss ? 0.5 : 0.2);
      head.add(glow);
    }
  }

  buildArms(body) {
    this.shoulders = [];
    this.elbows = [];
    this.hands = [];
    // which arms hang limp vs. reach out
    this.dangling = [this.pose.armMode === 1, this.pose.armMode === 2];
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.46 * s * this.girth, 0.96 + rand(-0.05, 0.02), 0.1); // uneven droop
      shoulder.rotation.z = s * rand(-0.12, 0.15);
      body.add(shoulder);
      this.shoulders.push(shoulder);

      // torn sleeve upper arm, bare rotten forearm
      const G = this.girth;
      const upper = this.mesh(lump(new THREE.CapsuleGeometry(0.09 * G, 0.28, 6, 12), 0.02, this.seed + 6 + s), this.clothMat);
      upper.position.y = -0.24;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.48;
      shoulder.add(elbow);
      this.elbows.push(elbow);

      const forearm = this.mesh(lump(new THREE.CapsuleGeometry(0.07 * Math.min(G, 1.1), 0.26, 6, 12), 0.02, this.seed + 8 + s), this.skinMat);
      forearm.position.y = -0.2;
      elbow.add(forearm);

      if (this.dangling[i]) {
        shoulder.rotation.x = -0.15;
        elbow.rotation.x = -0.12;
      } else {
        shoulder.rotation.x = -Math.PI / 2 + this.pose.reach[i];
        elbow.rotation.x = rand(-0.4, -0.1);
      }

      // limp drooping claw of a hand
      const hand = new THREE.Group();
      hand.position.y = -0.4;
      hand.rotation.x = this.dangling[i] ? rand(-0.3, -0.1) : rand(-1.0, -0.6);
      elbow.add(hand);
      this.hands.push(hand);
      const palm = this.mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), this.skinMat);
      palm.position.y = -0.05;
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = this.mesh(new THREE.CapsuleGeometry(0.015, 0.08, 2, 5), this.skinMat);
        finger.position.set(-0.036 + f * 0.024, -0.15, 0.01 + (f % 2) * 0.012);
        finger.rotation.x = rand(-1.0, -0.4);
        hand.add(finger);
      }
      const thumb = this.mesh(new THREE.CapsuleGeometry(0.016, 0.06, 2, 5), this.skinMat);
      thumb.position.set(0.06 * s, -0.08, 0.02);
      thumb.rotation.z = s * 0.9;
      hand.add(thumb);
    }
  }

  buildLegs(body) {
    this.hips = [];
    this.knees = [];
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const hip = new THREE.Group();
      hip.position.set(0.2 * s, 0.02, 0);
      body.add(hip);
      this.hips.push(hip);

      const G = this.girth;
      hip.position.x *= G;
      const thigh = this.mesh(lump(new THREE.CapsuleGeometry(0.11 * G, 0.3, 6, 12), 0.02, this.seed + 10 + s), this.clothMat);
      thigh.position.y = -0.26;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.52;
      knee.rotation.x = 0.15;
      hip.add(knee);
      this.knees.push(knee);

      // one trouser leg torn off at random
      const shinMat = Math.random() < 0.4 ? this.skinMat : this.clothMat;
      const shin = this.mesh(lump(new THREE.CapsuleGeometry(0.085 * Math.min(G, 1.1), 0.28, 6, 12), 0.02, this.seed + 12 + s), shinMat);
      shin.position.y = -0.22;
      knee.add(shin);

      const foot = this.mesh(new THREE.BoxGeometry(0.12, 0.09, 0.28, 2, 1, 2), this.skinMat);
      foot.position.set(0, -0.47, 0.07);
      // the dragging foot scuffs along toe-down
      if (i === this.pose.dragLeg) foot.rotation.x = 0.3;
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
    const hat = new THREE.Group();
    const crown = this.mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.36, 12), hatMat);
    crown.position.set(0, 0.42, -0.02);
    hat.add(crown);
    const brim = this.mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 14), hatMat);
    brim.position.set(0, 0.25, -0.02);
    hat.add(brim);
    const band = this.mesh(new THREE.CylinderGeometry(0.225, 0.235, 0.07, 12), bandMat);
    band.position.set(0, 0.3, -0.02);
    hat.add(band);
    this.head.add(hat);
    this.hat = hat;
  }

  buildCup() {
    // the barista ghoul still carries a fresh cup
    const cupMat = this.mat(new THREE.MeshLambertMaterial({ color: 0xe8e2d4, emissive: 0x2a2822 }));
    const hand = this.hands[this.dangling[0] ? 1 : 0];
    const cup = this.mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.1, 10), cupMat);
    cup.position.set(0, -0.12, 0.06);
    hand.add(cup);
    const steamMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0xfff4e0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35,
    }));
    const steam = new THREE.Sprite(steamMat);
    steam.position.set(0, -0.02, 0.06);
    steam.scale.setScalar(0.2);
    hand.add(steam);
  }

  // ---------- typed dismemberment ----------
  // Every landed letter can strip a part; the last letter takes the head.
  buildShedQueue() {
    const parts = [this.hands[0], this.hands[1], this.elbows[0], this.elbows[1]];
    for (let i = parts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    parts.push(this.jaw);
    if (this.hat) parts.unshift(this.hat); // the hat goes first, obviously
    this.shedQueue = parts;
  }

  attached(part) {
    let n = part;
    while (n.parent) n = n.parent;
    return n === this.group;
  }

  shed() {
    while (this.shedQueue.length) {
      const p = this.shedQueue.shift();
      if (!this.attached(p)) continue; // flew off with a parent part
      p.userData.shed = true;
      return p;
    }
    return null;
  }

  decapitate() {
    if (!this.attached(this.head)) return null;
    this.head.userData.shed = true;
    return this.head;
  }

  // ---------- canal spawn ----------
  beginRise() {
    this.setState('rise');
    this.group.position.y = -1.75;
    this.splashed = false;
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
    if (!targeted && this.special === 'coffee') {
      c.strokeStyle = 'rgba(255,190,60,0.75)'; // the barista's label glints amber
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

  // a landed letter: flare the flesh and jolt the body
  hit() {
    this.hitFlash = 1;
    this.flinch = 1;
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

    const ok = (p) => !p.userData.shed; // don't animate parts that were shot off

    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      for (const m of this.hitMats) m.userData.hit.value = this.hitFlash * this.hitFlash;
    }

    switch (this.state) {
      case 'rise': {
        // clamber dripping out of the canal, over the quay, onto the street
        const p = this.stateT;
        if (!this.splashed && p > 0.12) { this.splashed = true; event = 'splash'; }
        if (p < 1.3) {
          const q = p / 1.3;
          this.group.position.y = -1.75 + q * 2.0; // up onto the kerb
          this.body.rotation.x = this.hunch + 0.9 * (1 - q); // unfolding upright
          for (const i of [0, 1]) {
            this.shoulders[i].rotation.x = -2.6 + q * (Math.PI / 2 + 1.1); // arms haul upward
          }
          if (ok(this.head)) this.head.rotation.x = -0.3 + q * 0.5; // face tips up first
        } else if (p < 2.1) {
          const q = (p - 1.3) / 0.8;
          this.group.position.y = 0.25 * (1 - q); // step down off the kerb
          this.group.position.x += (11.7 - this.group.position.x) * 3 * dt;
          this.body.rotation.x = this.hunch;
          const w = this.t * 5;
          this.hips[0].rotation.x = Math.sin(w) * 0.4;
          this.hips[1].rotation.x = -Math.sin(w) * 0.4;
        } else {
          this.group.position.y = 0;
          this.setState('walk');
        }
        break;
      }
      case 'walk': {
        // lurch: surge on each step instead of gliding (mean ≈ base speed)
        const cad = (2.6 + this.speed * 2.4) * this.pose.gait;
        const w = this.t * cad;
        const surge = 0.5 + 0.85 * Math.abs(Math.sin(w));
        const sp = this.speed * surge;
        g.position.x += toCam.x * sp * dt;
        g.position.z += toCam.z * sp * dt;
        // drift toward center of street, plus a drunken sideways stagger
        g.position.x += (camPos.x - g.position.x) * 0.06 * dt;
        g.position.x += Math.sin(this.t * 0.6 + this.seed) * 0.25 * dt;

        // no lively bounce — a sagging dip on each step
        this.body.position.y = 1.03 - Math.abs(Math.cos(w)) * 0.05;
        this.body.rotation.x = this.hunch + Math.sin(w) * 0.06;
        this.body.rotation.z = this.pose.twist + Math.sin(w * 0.5) * 0.1 + Math.sin(this.t * 0.7 + this.seed) * 0.06;
        this.body.rotation.y = this.pose.twist * 0.8 + Math.sin(this.t * 0.5 + this.seed) * 0.05;

        // one leg steps, the other stiffly drags behind
        const a = 1 - this.pose.dragLeg, b = this.pose.dragLeg;
        this.hips[a].rotation.x = Math.sin(w) * 0.5;
        this.knees[a].rotation.x = 0.12 + Math.max(0, Math.sin(w + 1.7)) * 0.85;
        this.hips[b].rotation.x = -Math.sin(w) * 0.18 - 0.12;
        this.knees[b].rotation.x = 0.3;

        for (const i of [0, 1]) {
          if (this.dangling[i]) {
            // dead arm swings passively
            this.shoulders[i].rotation.x = -0.15 + Math.sin(w + i) * 0.09;
            if (ok(this.elbows[i])) this.elbows[i].rotation.x = -0.12;
          } else {
            // reaching arm bobs limply
            this.shoulders[i].rotation.x = -Math.PI / 2 + this.pose.reach[i] + Math.sin(w * 0.5 + i * 1.3) * 0.12;
            if (ok(this.elbows[i])) this.elbows[i].rotation.x = -0.3 + Math.sin(w * 0.5 + i) * 0.1;
          }
        }

        // head lolls, jaw hangs and works slowly
        if (ok(this.head)) {
          this.head.rotation.z = this.pose.headTilt + Math.sin(this.t * 0.9 + this.seed) * 0.16;
          this.head.rotation.x = 0.24 + Math.sin(this.t * 0.6 + this.seed) * 0.1;
        }
        if (ok(this.jaw)) this.jaw.rotation.x = 0.55 + Math.sin(this.t * 1.7 + this.seed) * 0.2;

        if (dist < 2.7) this.setState('attack');
        break;
      }
      case 'attack': {
        // wind up then lunge
        const p = this.stateT;
        if (p < 0.35) {
          this.body.rotation.x = this.hunch - p * 1.0;                // rear back
          if (ok(this.jaw)) this.jaw.rotation.x = 0.55 + p * 1.6;     // gape
          for (const i of [0, 1]) {
            this.shoulders[i].rotation.x = -Math.PI / 2 - p * 1.8;    // arms up
            this.shoulders[i].rotation.z = (i === 0 ? -1 : 1) * p * 1.1; // spread wide
          }
        } else if (p < 0.55) {
          const q = p - 0.35;
          this.body.rotation.x = this.hunch - 0.35 + q * 5.5;         // lunge forward
          if (ok(this.jaw)) this.jaw.rotation.x = Math.max(0.15, 1.11 - q * 4.5); // jaw snaps shut
          for (const i of [0, 1]) {
            this.shoulders[i].rotation.x = -Math.PI / 2 - 0.63 + q * 5;
            this.shoulders[i].rotation.z = (i === 0 ? -1 : 1) * Math.max(0.1, 0.385 - q * 1.5); // clamp inward
          }
        } else {
          this.body.rotation.x = this.hunch;
          if (ok(this.jaw)) this.jaw.rotation.x = 0.55;
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
        // limbs splay, knees buckle, head lolls aside, jaw drops
        const s = Math.min(p * 2, 1);
        this.shoulders[0].rotation.z = -s * 1.2;
        this.shoulders[1].rotation.z = s * 1.2;
        this.knees[0].rotation.x = 0.15 + s * 1.1;
        this.knees[1].rotation.x = 0.15 + s * 0.8;
        if (ok(this.head)) this.head.rotation.z = this.pose.headTilt + s * 0.6;
        if (ok(this.jaw)) this.jaw.rotation.x = 0.55 + s * 0.6;
        // burn away from a noise front: flesh chars, embers glow, then it's gone
        const burn = Math.min(1, Math.max(0, (p - 0.4) / 1.1));
        for (const m of this.burnMats) m.userData.dissolve.value = burn * 1.02;
        this.eyeMat.color.setScalar(0).lerp(this.eyeBase, 1 - Math.min(1, burn * 2));
        this.glowMat.opacity = this.glowBase * (1 - Math.min(1, burn * 2));
        this.shadow.scale.setScalar(1 - burn);
        if (p > 1.6) this.dead = true;
        break;
      }
      case 'idle': { // boss loiter
        const w = this.t * 1.6;
        this.body.position.y = 1.05 + Math.sin(w) * 0.06;
        this.body.rotation.x = this.hunch * 0.7;
        this.body.rotation.z = this.pose.twist + Math.sin(w * 0.7) * 0.05;
        this.shoulders[0].rotation.x = -Math.PI / 2 + Math.sin(w) * 0.1;
        this.shoulders[1].rotation.x = -Math.PI / 2 - Math.sin(w) * 0.1;
        if (ok(this.head)) this.head.rotation.z = this.pose.headTilt * 0.5 + Math.sin(w * 0.4) * 0.1;
        if (ok(this.jaw)) this.jaw.rotation.x = 0.4 + Math.sin(w * 1.3) * 0.15;
        break;
      }
      case 'stagger': {
        this.body.rotation.x = this.hunch * 0.7 - 0.6 * Math.sin(Math.min(this.stateT / 0.5, 1) * Math.PI);
        this.body.rotation.z = Math.sin(this.stateT * 22) * 0.08 * (1 - this.stateT / 0.5);
        if (ok(this.jaw)) this.jaw.rotation.x = 1.0;
        if (this.stateT >= 0.5) { this.body.rotation.z = 0; this.setState('idle'); }
        break;
      }
    }

    // bullet flinch: snap backwards, recover over a fraction of a second
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 5);
      const f = this.flinch * this.flinch;
      this.body.rotation.x -= f * 0.35;
      this.body.rotation.z += f * 0.15 * Math.sin(this.seed);
      if (ok(this.head)) this.head.rotation.x -= f * 0.5;
    }

    // reanimated nerves: sudden head-snap / shoulder-jerk twitches
    if (this.state === 'walk' || this.state === 'idle') {
      this.twitchT -= dt;
      if (this.twitchT <= 0) {
        this.twitchT = rand(1.6, 4.5);
        this.twitchDur = 0.2;
        this.twitchSign = Math.random() < 0.5 ? -1 : 1;
      }
      if (this.twitchDur > 0) {
        this.twitchDur -= dt;
        const k = Math.sin(Math.max(this.twitchDur, 0) / 0.2 * Math.PI);
        if (ok(this.head)) this.head.rotation.z += k * 0.45 * this.twitchSign;
        this.shoulders[this.twitchSign < 0 ? 0 : 1].rotation.x += k * 0.4;
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
