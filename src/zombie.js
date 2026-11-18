import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { skinMaps, clothMaps, radialCanvas, tex } from './textures.js';
import { WordLabel } from './label.js';

// pallid, desaturated corpse tones — no healthy saturation
const SKIN = [0x87927a, 0x7d8a68, 0x8e9a84, 0x707d5e, 0x939c7d, 0x9a8f86, 0x7a8478];
// faded, filthy clothes: work shirts, office blue, khaki, a once-white shirt
const CLOTH = [0x6a6258, 0x55606a, 0x7a6a52, 0x5a6450, 0x4a5068, 0x806e5e, 0x8a8478, 0x5e4e44, 0x6a3a34, 0x3e4a3a];

// shared procedural surface maps (painted once); a few cloth variants so the
// blood and mud never line up the same way twice
const SKIN_MAPS = skinMaps();
const SKIN_TEX = { map: tex(SKIN_MAPS.albedo, { srgb: true }), normalMap: tex(SKIN_MAPS.normal) };
const CLOTH_VARIANTS = [0, 1, 2].map(() => {
  const m = clothMaps();
  return { albedo: m.albedo, map: tex(m.albedo, { srgb: true, repeat: [2, 2] }), normalMap: tex(m.normal, { repeat: [2, 2] }) };
});
const CLOTH_TEX = CLOTH_VARIANTS[0];

// a dark base with light stripes, grimed with the cloth albedo
function stripeTex(base, stripe, step, width, vertical, repeat) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = base;
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = stripe;
  for (let p = 0; p < 128; p += step) vertical ? c.fillRect(p, 0, width, 128) : c.fillRect(0, p, 128, width);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(CLOTH_TEX.albedo, 0, 0, 128, 128);
  c.globalCompositeOperation = 'source-over';
  return { map: tex(cv, { srgb: true, repeat }), normalMap: CLOTH_TEX.normalMap };
}
const PINSTRIPE_TEX = stripeTex('#202230', 'rgba(170,170,190,0.6)', 11, 1, true, [3, 2]);
const SAILOR_TEX = stripeTex('#e8e4dc', '#1a2a5a', 16, 8, false, [1, 3]);

const HAIR = [0x1a1612, 0x2a2018, 0x2e2a26, 0x3a332c, 0x14100c, 0x5a5048];
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
         float rim = pow(max(1.0 - ndv, 0.0), 4.0);
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
const CRAWL_LABEL_HEIGHTS = [1.7, 2.4, 3.1];
let labelSlot = 0;

// per-kind look: eye colour, rim colour, label accent
const KIND_STYLE = {
  walker: { eye: 0xc8d86a, rim: 0x9aa8b8 },
  runner: { eye: 0xff5a2a, rim: 0xc89080 },
  crawler: { eye: 0xd8e070, rim: 0x9aa8b8 },
  bloater: { eye: 0x9aff40, rim: 0x80ff40, accent: 'rgba(150,255,90,0.75)' },
  brute: { eye: 0xffd040, rim: 0xb0a080, accent: 'rgba(255,170,60,0.6)' },
};

export class Zombie {
  static env = null; // reflection map for the bosses' gold and steel, set by main

  // opts: { kind, boss, tint, special }
  constructor(word, x, z, speed, opts = {}) {
    this.word = word;
    this.boss = opts.boss ?? null;   // 'gondolier' | 'chef' | 'chancellor'
    this.isBoss = !!this.boss;
    this.kind = this.isBoss ? 'boss' : opts.kind ?? 'walker';
    this.special = opts.special ?? null; // 'coffee': amber-eyed barista ghoul, heals on kill
    this.progress = 0;
    this.speed = speed;
    this.state = 'walk'; // walk | rise | attack | knock | dying | idle | stagger | throw
    this.stateT = 0;
    this.dead = false;   // fully finished, safe to remove
    this.t = rand(0, 10);
    const baseScale = this.isBoss ? 3.0 : this.kind === 'brute' ? 1.42 : 1;
    this.scale = baseScale * (this.isBoss ? 1 : rand(0.92, 1.1));
    this.seed = rand(0, 100);
    this.damage = this.kind === 'brute' ? 2 : 1;
    this.crawl = this.kind === 'crawler';

    // every corpse reanimated a little differently
    this.hunch = this.kind === 'runner' ? rand(0.6, 0.75)
      : this.crawl ? 1.32
      : this.kind === 'brute' ? rand(0.2, 0.32)
      : rand(0.32, 0.55);
    this.pose = {
      armMode: this.kind === 'runner' || this.crawl ? 0 : pick([0, 0, 1, 2]), // 0: both reach; 1/2: one hangs dead
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
    this.build = this.isBoss ? 'normal'
      : this.kind === 'runner' ? 'gaunt'
      : this.kind === 'bloater' ? 'bloated'
      : this.kind === 'brute' ? 'bloated'
      : pick(['normal', 'normal', 'bloated', 'gaunt']);
    this.girth = this.kind === 'bloater' ? 1.4 : this.kind === 'brute' ? 1.28
      : this.build === 'bloated' ? 1.18 : this.build === 'gaunt' ? 0.78 : 0.92;

    const style = KIND_STYLE[this.kind] ?? KIND_STYLE.walker;
    const bossRim = { gondolier: 0x4a90ff, chef: 0xff7020, chancellor: 0xc01818 }[this.boss];
    const skinColor = opts.tint ?? (this.kind === 'bloater' ? 0x8a9a5a : pick(SKIN));
    const rimC = bossRim ?? (this.special === 'coffee' ? 0xffb040 : style.rim);
    const rimK = this.isBoss ? 0.32 : this.kind === 'bloater' ? 0.3 : 0.22;
    this.rimC = rimC;
    // a faint sickly self-glow keeps faces readable in the murk
    this.skinMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      ...SKIN_TEX, color: skinColor, roughness: 0.55, metalness: 0,
      emissive: new THREE.Color(skinColor).multiplyScalar(0.12), emissiveMap: SKIN_TEX.map,
    }), rimK, rimC));
    const clothTex = this.boss === 'chancellor' ? PINSTRIPE_TEX
      : this.boss === 'gondolier' ? SAILOR_TEX
      : pick(CLOTH_VARIANTS);
    const clothColor = this.boss === 'chef' ? 0xd8d4c8 : this.isBoss ? 0xffffff
      : this.kind === 'brute' ? 0x7a5a2a : pick(CLOTH);
    this.clothMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      map: clothTex.map, normalMap: clothTex.normalMap, color: clothColor,
      roughness: this.isBoss ? 0.7 : 0.95, metalness: 0, side: THREE.DoubleSide,
    }), rimK * 0.7, rimC));
    this.woundMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      color: 0x4a0808, emissive: 0x1a0202, roughness: 0.22, metalness: 0,
    }), rimK * 0.5, 0xff6060));
    // hollow eye sockets and the gaping mouth: near-black, wet
    this.voidMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      color: 0x120404, roughness: 0.3, metalness: 0,
    }), 0.05, 0x400000));
    // bone is per-zombie so it can burn away with the rest
    this.boneMat = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: 0x9c9278, roughness: 0.5 }), 0.15, rimC));
    this.hitMats = [this.skinMat, this.clothMat, this.woundMat];
    this.hitFlash = 0;
    const eyeColor = this.boss === 'chancellor' ? 0xff4030 : this.boss === 'gondolier' ? 0x60b0ff
      : this.boss === 'chef' ? 0xff8020 : this.special === 'coffee' ? 0xffc040 : style.eye;
    this.eyeBase = new THREE.Color(eyeColor).multiplyScalar(this.isBoss ? 2 : 2.8);
    this.eyeMat = this.mat(new THREE.MeshBasicMaterial({ color: this.eyeBase.clone() }));
    this.glowMat = this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: eyeColor, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: this.isBoss ? 0.9 : 0.75,
    }));
    this.glowBase = this.glowMat.opacity;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(this.scale);
    this.group = g;

    const body = new THREE.Group();
    body.position.y = this.crawl ? 0.42 : 1.05;
    g.add(body);
    this.body = body;

    this.buildTorso(body);
    this.buildHead(body);
    this.buildArms(body);
    this.buildLegs(body);
    this.buildRags(body);
    if (this.boss === 'chancellor') this.buildChancellor();
    if (this.boss === 'gondolier') this.buildGondolier();
    if (this.boss === 'chef') this.buildChef();
    if (this.kind === 'brute') this.buildHardHat();
    if (this.kind === 'bloater') this.buildPustules();
    if (this.special === 'coffee') this.buildCup();
    this.buildShedQueue();

    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.renderOrder = 1;
    if (this.crawl) shadow.scale.set(1, 1.5, 1);
    g.add(shadow);
    this.shadow = shadow;

    this.compact(g, new Set([shadow, this.aura, this.belly, ...(this.coins ?? [])].filter(Boolean)));
    g.traverse((o) => { if (o.isMesh && o !== shadow && o !== this.aura) o.castShadow = true; });

    this.wl = new WordLabel(word, this.special === 'coffee' ? 'rgba(255,196,96,0.8)' : style.accent ?? null);
    this.label = this.wl.sprite;
    const heights = this.crawl ? CRAWL_LABEL_HEIGHTS : LABEL_HEIGHTS;
    this.label.position.set(0, heights[labelSlot++ % heights.length] / (this.kind === 'brute' ? 1.25 : 1), 0);
    this.baseLabelW = this.wl.baseW;
    g.add(this.label);
  }

  geo(g) { this.geos.push(g); return g; }
  mat(m) { this.mats.push(m); return m; }
  // Merge sibling leaf meshes that share a material into one draw call. The
  // joints and every part that can be shot off are Groups, so they survive;
  // only the static pieces hanging off each joint get baked together.
  compact(root, keep) {
    const nodes = [];
    root.traverse((o) => nodes.push(o));
    for (const node of nodes) {
      const byMat = new Map();
      for (const c of node.children) {
        if (!c.isMesh || c.children.length || keep.has(c)) continue;
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      }
      for (const [mat, list] of byMat) {
        if (list.length < 2) continue;
        const geos = list.map((m) => {
          m.updateMatrix();
          const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
          return g;
        });
        const merged = mergeGeometries(geos);
        if (!merged) continue;
        for (const g of geos) g.dispose();
        for (const m of list) node.remove(m);
        node.add(new THREE.Mesh(this.geo(merged), mat));
      }
    }
  }

  get burnMats() { return this.mats.filter((m) => m.userData.dissolve); }
  mesh(g, m) { return new THREE.Mesh(this.geo(g), m); }

  buildTorso(body) {
    const G = this.girth;
    const pelvis = this.mesh(new THREE.SphereGeometry(0.3, 14, 10), this.clothMat);
    pelvis.scale.set(1.05 * G, 0.72, 0.8 * G);
    pelvis.position.y = 0.05;
    body.add(pelvis);

    // ribcage tapers to a narrow waist: a body, not a bean
    const torso = this.mesh(
      lump(new THREE.CapsuleGeometry(0.31, 0.52, 6, 14), 0.045, this.seed),
      this.clothMat
    );
    torso.position.y = 0.64;
    torso.scale.set(G, 1, 0.68 * (G > 1 ? 1.15 : G));
    torso.rotation.x = 0.1;
    body.add(torso);

    // shoulder yoke and collarbones give a human shoulder line
    const yoke = this.mesh(lump(new THREE.SphereGeometry(0.28, 16, 10), 0.03, this.seed + 9), this.clothMat);
    yoke.position.set(0, 0.97, 0.03);
    yoke.scale.set(1.6 * Math.max(G, 0.92), 0.5, 0.8 * Math.min(G, 1.1));
    body.add(yoke);
    // a vertebral ridge poking through the back of the shirt
    for (let v = 0; v < 5; v++) {
      const knob = this.mesh(new THREE.SphereGeometry(0.035, 6, 5), this.boneMat);
      knob.position.set(0, 0.5 + v * 0.11, -0.2 * Math.min(G, 1.1) - 0.02);
      body.add(knob);
    }
    if (this.build === 'gaunt') {
      for (const sx of [-1, 1]) {
        const clav = this.mesh(new THREE.CapsuleGeometry(0.025, 0.24, 2, 6), this.boneMat);
        clav.position.set(0.15 * sx, 1.07, 0.2);
        clav.rotation.z = Math.PI / 2 + sx * 0.2;
        body.add(clav);
      }
    }

    // sunken belly poking out of the shirt, on some; the bloater's gut is
    // its own group so it can throb
    if (this.kind === 'bloater') {
      const belly = new THREE.Group();
      belly.position.set(0, 0.42, 0.14);
      const gut = this.mesh(lump(new THREE.SphereGeometry(0.42, 22, 16), 0.06, this.seed + 3), this.skinMat);
      gut.scale.set(1.05, 0.95, 0.85);
      belly.add(gut);
      body.add(belly);
      this.belly = belly;
    } else if (this.build === 'bloated' || Math.random() < 0.45) {
      const big = this.build === 'bloated' ? 1.25 : 1;
      const gut = this.mesh(lump(new THREE.SphereGeometry(0.22, 16, 12), 0.05, this.seed + 3), this.skinMat);
      gut.position.set(rand(-0.06, 0.06), 0.32, 0.13 * big);
      gut.scale.set(0.95 * big, 0.75 * big, 0.6 * big);
      body.add(gut);
    }
    // open wound
    if (Math.random() < 0.75) {
      const wound = this.mesh(lump(new THREE.SphereGeometry(0.15, 8, 6), 0.03, this.seed + 5), this.woundMat);
      wound.position.set(rand(-0.24, 0.24), rand(0.35, 0.85), rand(0.17, 0.22));
      wound.scale.set(1, rand(0.7, 1.4), 0.22);
      body.add(wound);
    }
    // torn-open chest with exposed ribs, on some
    if (!this.isBoss && (this.build === 'gaunt' || Math.random() < 0.35)) {
      const rx = rand(-0.06, 0.06);
      const patch = this.mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), this.woundMat);
      patch.position.set(rx, 0.7, 0.2);
      patch.rotation.x = 0.12;
      body.add(patch);
      for (let r = 0; r < 4; r++) {
        // ribs curve around the chest instead of sitting on it like bars
        const rib = this.mesh(new THREE.TorusGeometry(0.15 - r * 0.012, 0.014, 4, 10, Math.PI * 0.75), this.boneMat);
        rib.position.set(rx, 0.56 + r * 0.08, 0.1);
        rib.rotation.set(Math.PI / 2 + 0.15, 0, Math.PI * 0.125);
        body.add(rib);
      }
    }

    // still wearing the office tie, on some
    if (!this.isBoss && this.kind !== 'brute' && Math.random() < 0.3) {
      const tieMat = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: pick(TIES), roughness: 0.6 }), 0.15, 0x9aa8b8));
      const tie = this.mesh(new THREE.BoxGeometry(0.07, 0.42, 0.02), tieMat);
      tie.position.set(rand(-0.03, 0.03), 0.86, 0.26 * (G > 1 ? 1.15 : 1));
      tie.rotation.set(0.25, 0, rand(-0.25, 0.25)); // askew
      body.add(tie);
      const knot = this.mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), tieMat);
      knot.position.set(0, 1.07, 0.21);
      body.add(knot);
    }

    // stringy neck with a tendon showing
    const neck = this.mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.24, 10), this.skinMat);
    neck.position.set(0, 1.16, 0.1);
    neck.rotation.x = 0.35;
    body.add(neck);
    const tendon = this.mesh(new THREE.CapsuleGeometry(0.018, 0.16, 2, 5), this.woundMat);
    tendon.position.set(0.05, 1.15, 0.16);
    tendon.rotation.set(0.35, 0, 0.3);
    body.add(tendon);
  }

  buildHead(body) {
    const head = new THREE.Group();
    head.position.set(0, 1.34, 0.18);
    body.add(head);
    this.head = head;

    // long, hollow-cheeked skull: a cranium over a narrow face
    // the features below all sit proud of these two surfaces (face front ≈ z 0.17)
    const cranium = this.mesh(
      lump(new THREE.SphereGeometry(0.25, 22, 18), 0.022, this.seed + 1),
      this.skinMat
    );
    cranium.scale.set(0.85, 0.95, 0.9);
    cranium.position.set(0, 0.08, -0.04);
    head.add(cranium);
    const face = this.mesh(lump(new THREE.SphereGeometry(0.17, 16, 12), 0.015, this.seed + 7), this.skinMat);
    face.scale.set(0.78, 1.0, 0.75);
    face.position.set(0, -0.07, 0.04);
    head.add(face);
    // jutting cheekbones over sunken cheeks
    for (const s of [-1, 1]) {
      const cheek = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), this.skinMat);
      cheek.position.set(0.095 * s, -0.045, 0.165);
      cheek.scale.set(1.1, 0.6, 0.8);
      head.add(cheek);
      const hollow = this.mesh(new THREE.SphereGeometry(0.045, 8, 6), this.woundMat);
      hollow.position.set(0.1 * s, -0.11, 0.135);
      hollow.scale.set(0.7, 1, 0.5);
      head.add(hollow);
      const ear = this.mesh(new THREE.SphereGeometry(0.05, 6, 6), this.skinMat);
      ear.position.set(0.2 * s, 0.02, -0.03);
      ear.scale.set(0.35, 1, 0.7);
      head.add(ear);
    }

    // heavy brow shadowing the eyes
    const brow = this.mesh(new THREE.BoxGeometry(0.32, 0.06, 0.09, 3, 1, 1), this.skinMat);
    brow.position.set(0, 0.075, 0.19);
    brow.rotation.x = 0.35;
    head.add(brow);

    // rotted-off nose: a dark triangular cavity with a stub of cartilage
    const noseHole = this.mesh(new THREE.ConeGeometry(0.035, 0.08, 3), this.voidMat);
    noseHole.position.set(0, -0.045, 0.185);
    noseHole.rotation.x = -0.25;
    head.add(noseHole);
    if (Math.random() < 0.5) {
      const nose = this.mesh(new THREE.BoxGeometry(0.045, 0.07, 0.05), this.skinMat);
      nose.position.set(0.012, -0.02, 0.2);
      nose.rotation.set(0.3, 0, rand(-0.3, 0.3));
      head.add(nose);
    }

    // upper teeth on the skull, lower on the hanging jaw
    // jagged, broken teeth: one merged mesh per jaw
    const teeth = (n, w, y, z, down) => {
      const parts = [];
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.18) continue; // gaps where teeth fell out
        const h = rand(0.03, 0.055);
        const t = new THREE.BoxGeometry(0.022, h, 0.022);
        t.rotateZ(rand(-0.25, 0.25));
        t.translate(-w / 2 + (i + 0.5) * w / n, y + (down ? -h / 2 : h / 2), z - Math.abs(i - n / 2) * 0.008);
        parts.push(t);
      }
      return parts.length ? new THREE.Mesh(this.geo(mergeGeometries(parts)), this.boneMat) : new THREE.Group();
    };
    head.add(teeth(7, 0.14, -0.13, 0.185, true));
    // the dark of the open mouth behind the teeth
    const maw = this.mesh(new THREE.SphereGeometry(0.075, 10, 8), this.voidMat);
    maw.position.set(0, -0.16, 0.13);
    maw.scale.set(1, 0.8, 0.6);
    head.add(maw);

    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, -0.12, 0.0);
    head.add(jawPivot);
    this.jaw = jawPivot;
    const jaw = this.mesh(lump(new THREE.BoxGeometry(0.2, 0.09, 0.22, 3, 2, 3), 0.015, this.seed + 2), this.skinMat);
    jaw.position.set(0, -0.06, 0.07);
    jawPivot.add(jaw);
    jawPivot.add(teeth(6, 0.13, -0.025, 0.16, false));
    jawPivot.rotation.x = 0.55; // slack, hanging open

    // dried blood down the chin, on most — it fed recently
    if (Math.random() < 0.65) {
      const smear = this.mesh(new THREE.BoxGeometry(0.13, 0.1, 0.03), this.woundMat);
      smear.position.set(rand(-0.03, 0.03), -0.05, 0.17);
      smear.rotation.z = rand(-0.3, 0.3);
      jawPivot.add(smear);
    }

    // a patchy scalp with lank strands hanging off the back and sides, on most
    if (!this.isBoss && this.kind !== 'brute' && Math.random() < 0.7) {
      const hairMat = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: pick(HAIR), roughness: 0.75 }), 0.08, 0x9aa8b8));
      const parts = [];
      const cap = lump(new THREE.SphereGeometry(0.265, 16, 10, 0, Math.PI * 2, 0, rand(0.8, 1.25)), 0.035, this.seed + 4);
      cap.rotateX(-0.45); // sits back on the crown, leaving the brow bare
      cap.scale(0.86, 0.96, 0.92);
      cap.translate(0, 0.08, -0.04);
      parts.push(cap);
      const n = Math.floor(rand(8, 18));
      for (let i = 0; i < n; i++) {
        const a = rand(Math.PI * 0.45, Math.PI * 1.55); // around the back, never the face
        const e = rand(0.05, 0.5);
        const len = rand(0.14, 0.4);
        const st = new THREE.CapsuleGeometry(rand(0.012, 0.022), len, 2, 4);
        st.translate(0, -len / 2, 0);
        st.rotateX(-Math.cos(a) * 0.25);
        st.rotateZ(Math.sin(a) * 0.25);
        st.translate(0.2 * Math.cos(e) * Math.sin(a), 0.08 + 0.23 * Math.sin(e), 0.21 * Math.cos(e) * Math.cos(a) - 0.04);
        parts.push(st);
      }
      head.add(new THREE.Mesh(this.geo(mergeGeometries(parts.map((g) => g.toNonIndexed()))), hairMat));
    }
    // a patch of skull showing where the scalp tore away, on some
    if (!this.isBoss && Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const bone = this.mesh(new THREE.SphereGeometry(0.12, 12, 10), this.boneMat);
      bone.position.set(0.1 * side, 0.17, -0.03);
      bone.scale.set(0.6, 0.8, 0.9);
      head.add(bone);
      const rim = this.mesh(new THREE.TorusGeometry(0.095, 0.02, 6, 14), this.woundMat);
      rim.position.set(0.13 * side, 0.17, -0.03);
      rim.rotation.y = Math.PI / 2;
      rim.scale.set(0.9, 1.1, 1);
      head.add(rim);
    }

    // deep black sockets with a burning pinpoint in each
    const lazy = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0; // one eye gone
    for (const s of [-1, 1]) {
      const socket = this.mesh(new THREE.SphereGeometry(0.062, 10, 8), this.voidMat);
      socket.position.set(0.08 * s, 0.015, 0.17);
      socket.scale.set(1.15, 0.95, 0.6);
      head.add(socket);
      if (s === lazy && !this.isBoss) continue;
      const eye = this.mesh(new THREE.SphereGeometry(0.026, 8, 6), this.eyeMat);
      eye.position.set(0.08 * s, 0.012, 0.2);
      head.add(eye);
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(0.08 * s, 0.012, 0.24);
      glow.scale.setScalar(this.isBoss ? 0.13 : 0.22);
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
      shoulder.position.set(0.42 * s * Math.max(this.girth, 0.92), 0.97 + rand(-0.05, 0.02), 0.08); // uneven droop
      shoulder.rotation.z = s * rand(-0.12, 0.15);
      body.add(shoulder);
      this.shoulders.push(shoulder);

      // torn sleeve upper arm, bare rotten forearm
      const G = this.girth;
      const upper = this.mesh(lump(new THREE.CapsuleGeometry(0.08 * G, 0.3, 6, 12), 0.02, this.seed + 6 + s), this.clothMat);
      upper.position.y = -0.25;
      shoulder.add(upper);
      // ragged sleeve cuff
      const cuff = this.mesh(new THREE.CylinderGeometry(0.1 * G, 0.085 * G, 0.06, 7, 1, true), this.clothMat);
      cuff.position.y = -0.44;
      shoulder.add(cuff);

      const elbow = new THREE.Group();
      elbow.position.y = -0.5;
      shoulder.add(elbow);
      this.elbows.push(elbow);

      const forearm = this.mesh(lump(new THREE.CapsuleGeometry(0.06 * Math.min(G, 1.1), 0.3, 6, 12), 0.02, this.seed + 8 + s), this.skinMat);
      forearm.position.y = -0.21;
      elbow.add(forearm);
      // bone jutting from a torn forearm, on some
      if (Math.random() < 0.2) {
        const ulna = this.mesh(new THREE.CapsuleGeometry(0.02, 0.18, 2, 5), this.boneMat);
        ulna.position.set(0.03, -0.25, 0.03);
        ulna.rotation.z = 0.2;
        elbow.add(ulna);
      }

      if (this.dangling[i]) {
        shoulder.rotation.x = -0.15;
        elbow.rotation.x = -0.12;
      } else {
        shoulder.rotation.x = -Math.PI / 2 + this.pose.reach[i];
        elbow.rotation.x = rand(-0.4, -0.1);
      }

      // long-fingered claw of a hand
      const hand = new THREE.Group();
      hand.position.y = -0.43;
      hand.rotation.x = this.dangling[i] ? rand(-0.3, -0.1) : rand(-1.0, -0.6);
      elbow.add(hand);
      this.hands.push(hand);
      const palm = this.mesh(new THREE.BoxGeometry(0.09, 0.12, 0.045), this.skinMat);
      palm.position.y = -0.05;
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = this.mesh(new THREE.CapsuleGeometry(0.013, 0.11, 2, 5), this.skinMat);
        finger.position.set(-0.033 + f * 0.022, -0.16, 0.01 + (f % 2) * 0.012);
        finger.rotation.x = rand(-1.1, -0.5);
        hand.add(finger);
        // blackened nails
        const nail = this.mesh(new THREE.ConeGeometry(0.012, 0.035, 4), this.voidMat);
        nail.position.set(-0.033 + f * 0.022, -0.22, 0.05 + (f % 2) * 0.012);
        nail.rotation.x = Math.PI - 0.8;
        hand.add(nail);
      }
      const thumb = this.mesh(new THREE.CapsuleGeometry(0.015, 0.07, 2, 5), this.skinMat);
      thumb.position.set(0.055 * s, -0.08, 0.02);
      thumb.rotation.z = s * 0.9;
      hand.add(thumb);
    }
  }

  buildLegs(body) {
    this.hips = [];
    this.knees = [];
    for (const [i, s] of [[0, -1], [1, 1]]) {
      const hip = new THREE.Group();
      hip.position.set(0.18 * s, 0.02, 0);
      body.add(hip);
      this.hips.push(hip);

      const G = this.girth;
      hip.position.x *= Math.max(G, 0.92);
      const thigh = this.mesh(lump(new THREE.CapsuleGeometry(0.1 * G, 0.32, 6, 12), 0.02, this.seed + 10 + s), this.clothMat);
      thigh.position.y = -0.26;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.53;
      knee.rotation.x = 0.15;
      hip.add(knee);
      this.knees.push(knee);

      if (this.crawl) {
        // nothing below the knee but a ragged, dripping stump
        const stump = this.mesh(lump(new THREE.SphereGeometry(0.1 * G, 8, 6), 0.02, this.seed + s), this.woundMat);
        stump.position.y = -0.48;
        stump.scale.set(1, 0.6, 1);
        hip.add(stump);
        const bone = this.mesh(new THREE.CapsuleGeometry(0.025, 0.12, 2, 5), this.boneMat);
        bone.position.y = -0.55;
        hip.add(bone);
        continue; // the knee group stays empty, so the animation code still works
      }

      // one trouser leg torn off at random
      const shinMat = Math.random() < 0.4 ? this.skinMat : this.clothMat;
      const shin = this.mesh(lump(new THREE.CapsuleGeometry(0.075 * Math.min(G, 1.1), 0.3, 6, 12), 0.02, this.seed + 12 + s), shinMat);
      shin.position.y = -0.22;
      knee.add(shin);

      const foot = this.mesh(new THREE.BoxGeometry(0.11, 0.08, 0.27, 2, 1, 2), this.isBoss ? this.voidMat : this.skinMat);
      foot.position.set(0, -0.47, 0.07);
      // the dragging foot scuffs along toe-down
      if (i === this.pose.dragLeg && this.kind !== 'runner') foot.rotation.x = 0.3;
      knee.add(foot);
    }
  }

  buildRags(body) {
    this.rags = [];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const rag = this.mesh(new THREE.PlaneGeometry(0.13, rand(0.35, 0.6), 1, 3), this.clothMat);
      const pivot = new THREE.Group();
      pivot.position.set(rand(-0.3, 0.3), rand(0.1, 0.35), rand(-0.15, 0.22));
      rag.position.y = -0.25;
      pivot.add(rag);
      pivot.userData.phase = rand(0, 6);
      body.add(pivot);
      this.rags.push(pivot);
    }
  }

  // shiny metal for boss props
  goldMaterial(color = 0xd8a848) {
    return this.mat(rimmed(new THREE.MeshStandardMaterial({
      color, metalness: 1, roughness: 0.28, envMap: Zombie.env, emissive: 0x1a1004,
    }), 0.1, this.rimC));
  }

  plainMaterial(color, roughness = 0.6, rim = 0.2) {
    return this.mat(rimmed(new THREE.MeshStandardMaterial({ color, roughness, envMap: Zombie.env }), rim, this.rimC));
  }

  // crimson (or other) pool of light at a boss's feet
  buildAura(color) {
    const aura = new THREE.Mesh(SHADOW_GEO, this.mat(new THREE.MeshBasicMaterial({
      map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6,
    })));
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.03;
    aura.scale.setScalar(1.6);
    this.group.add(aura);
    this.aura = aura;
  }

  buildChancellor() {
    // The Chancellor dresses for the occasion
    const hatMat = this.plainMaterial(0x101016, 0.35);
    const gold = this.goldMaterial();
    this.goldMat = gold;
    const hat = new THREE.Group();
    const crown = this.mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.36, 20), hatMat);
    crown.position.set(0, 0.48, -0.02);
    hat.add(crown);
    const brim = this.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), hatMat);
    brim.position.set(0, 0.31, -0.02);
    hat.add(brim);
    const band = this.mesh(new THREE.CylinderGeometry(0.215, 0.225, 0.07, 20), gold);
    band.position.set(0, 0.36, -0.02);
    hat.add(band);
    this.head.add(hat);
    this.hat = hat;

    // monocle over the left eye, its lens catching the light
    const monocle = this.mesh(new THREE.TorusGeometry(0.065, 0.009, 6, 20), gold);
    monocle.position.set(-0.08, 0.015, 0.215);
    this.head.add(monocle);
    const lens = this.mesh(new THREE.CircleGeometry(0.06, 20), this.mat(rimmed(new THREE.MeshStandardMaterial({
      color: 0x99aacc, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, envMap: Zombie.env,
    }), 0.6, 0xffffff)));
    lens.position.set(-0.08, 0.015, 0.217);
    this.head.add(lens);
    const chain = this.mesh(new THREE.TorusGeometry(0.16, 0.004, 4, 16, Math.PI * 0.6), gold);
    chain.position.set(-0.12, -0.12, 0.18);
    chain.rotation.set(0.2, 0.5, 1.6);
    this.head.add(chain);

    // white shirt-front and crimson cravat
    const shirt = this.mesh(new THREE.BoxGeometry(0.24, 0.42, 0.04), this.plainMaterial(0xb8b4a8));
    shirt.position.set(0, 0.8, 0.25);
    shirt.rotation.x = 0.12;
    this.body.add(shirt);
    const cravat = this.mesh(new THREE.ConeGeometry(0.08, 0.22, 4), this.plainMaterial(0x7a0a10, 0.4));
    cravat.position.set(0, 0.96, 0.28);
    cravat.rotation.x = Math.PI + 0.15;
    this.body.add(cravat);
    // gold watch chain swagged across the waistcoat
    const fob = this.mesh(new THREE.TorusGeometry(0.19, 0.011, 6, 24, Math.PI), gold);
    fob.position.set(0, 0.5, 0.23);
    fob.rotation.z = Math.PI;
    this.body.add(fob);
    this.buildTails(0.75);

    // a halo of gold coins orbiting him: the debts he's owed
    this.coins = [];
    const coinGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.012, 16);
    for (let i = 0; i < 20; i++) {
      const coin = this.mesh(coinGeo, gold);
      coin.userData = { a: (i / 20) * Math.PI * 2, r: rand(0.9, 1.25), y: rand(0.4, 1.9), sp: rand(0.35, 0.6), wob: rand(0, 6) };
      this.group.add(coin);
      this.coins.push(coin);
    }
    this.buildAura(0xb01010);
  }

  // tailcoat or apron tails hanging behind
  buildTails(len) {
    for (const sx of [-1, 1]) {
      const tail = this.mesh(new THREE.PlaneGeometry(0.22, len, 1, 4), this.clothMat);
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.13, 0.15, -0.2);
      tail.position.y = -len / 2;
      pivot.add(tail);
      pivot.userData.phase = sx;
      this.body.add(pivot);
      this.rags.push(pivot);
    }
  }

  buildGondolier() {
    // straw boater with a red ribbon, sailor stripes, neckerchief, and the oar
    const straw = this.plainMaterial(0xc8a860, 0.8);
    const ribbon = this.plainMaterial(0x9a1018, 0.5);
    const hat = new THREE.Group();
    const crown = this.mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.13, 20), straw);
    crown.position.set(0, 0.36, -0.02);
    hat.add(crown);
    const band = this.mesh(new THREE.CylinderGeometry(0.212, 0.213, 0.05, 20), ribbon);
    band.position.set(0, 0.34, -0.02);
    hat.add(band);
    const brim = this.mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 24), straw);
    brim.position.set(0, 0.3, -0.02);
    hat.add(brim);
    hat.rotation.z = 0.12;
    this.head.add(hat);
    this.hat = hat;
    const scarf = this.mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 14), ribbon);
    scarf.position.set(0, 1.1, 0.08);
    scarf.rotation.x = Math.PI / 2 - 0.3;
    this.body.add(scarf);
    const knot = this.mesh(new THREE.ConeGeometry(0.06, 0.16, 4), ribbon);
    knot.position.set(0.05, 1.0, 0.2);
    knot.rotation.set(Math.PI, 0, 0.3);
    this.body.add(knot);

    // the oar, rotten and dripping, in the right hand
    const wood = this.plainMaterial(0x4a3422, 0.85);
    const oar = new THREE.Group();
    const shaft = this.mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.4, 8), wood);
    shaft.position.y = -0.4;
    oar.add(shaft);
    const blade = this.mesh(new THREE.BoxGeometry(0.16, 0.6, 0.03), wood);
    blade.position.y = -1.75;
    oar.add(blade);
    oar.rotation.x = -0.4;
    this.hands[1].add(oar);
    this.prop = oar;
    this.buildAura(0x2050c0);
  }

  buildChef() {
    // a towering toque, a bloodied apron, and a cleaver
    const white = this.plainMaterial(0xe8e4d8, 0.8);
    const hat = new THREE.Group();
    const band = this.mesh(new THREE.CylinderGeometry(0.22, 0.21, 0.14, 20), white);
    band.position.set(0, 0.28, -0.02);
    hat.add(band);
    const puff = this.mesh(lump(new THREE.SphereGeometry(0.3, 16, 12), 0.04, this.seed), white);
    puff.position.set(0, 0.55, -0.03);
    puff.scale.set(1, 1.15, 1);
    hat.add(puff);
    this.head.add(hat);
    this.hat = hat;
    const apronMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      map: pick(CLOTH_VARIANTS).map, color: 0xd8d0c0, roughness: 0.9, side: THREE.DoubleSide,
    }), 0.2, this.rimC));
    const apron = this.mesh(new THREE.PlaneGeometry(0.62, 1.1, 1, 4), apronMat);
    apron.position.set(0, 0.25, 0.28 * this.girth);
    apron.rotation.x = -0.08;
    this.body.add(apron);
    // double row of buttons
    for (let r = 0; r < 3; r++) for (const sx of [-1, 1]) {
      const b = this.mesh(new THREE.SphereGeometry(0.022, 6, 5), this.voidMat);
      b.position.set(sx * 0.07, 0.95 - r * 0.1, 0.24);
      this.body.add(b);
    }
    const steel = this.goldMaterial(0xc8ccd4);
    const cleaver = new THREE.Group();
    const handle = this.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8), this.plainMaterial(0x2a1a10, 0.7));
    handle.position.y = -0.1;
    cleaver.add(handle);
    const blade = this.mesh(new THREE.BoxGeometry(0.02, 0.32, 0.22), steel);
    blade.position.set(0, -0.36, 0.06);
    cleaver.add(blade);
    cleaver.rotation.x = -0.6;
    this.hands[1].add(cleaver);
    this.prop = cleaver;
    this.buildAura(0xc05010);
  }

  buildHardHat() {
    // construction-site brute: hard hat and a hi-vis vest with reflective bands
    const yellow = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: 0xd8a818, roughness: 0.4, emissive: 0x2a1c00 }), 0.2, this.rimC));
    const hat = new THREE.Group();
    const dome = this.mesh(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), yellow);
    dome.position.set(0, 0.16, -0.04);
    dome.scale.set(0.95, 0.85, 1.05);
    hat.add(dome);
    const brim = this.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.025, 20), yellow);
    brim.position.set(0, 0.16, 0.0);
    brim.scale.set(0.9, 1, 1.15);
    hat.add(brim);
    hat.rotation.z = rand(-0.2, 0.2);
    this.head.add(hat);
    this.hat = hat;
    const band = this.mat(rimmed(new THREE.MeshStandardMaterial({ color: 0xd0d4d8, emissive: 0x505458, roughness: 0.3 }), 0.2, this.rimC));
    for (const y of [0.45, 0.7]) {
      const b = this.mesh(new THREE.CylinderGeometry(0.315 * this.girth, 0.315 * this.girth, 0.05, 16, 1, true), band);
      b.position.y = y;
      b.scale.z = 0.68 * 1.15;
      this.body.add(b);
    }
  }

  buildPustules() {
    // glowing green boils across the swollen gut: it's going to pop
    this.pusMat = this.mat(rimmed(new THREE.MeshStandardMaterial({
      color: 0x8adf40, emissive: 0x5aff20, emissiveIntensity: 1.2, roughness: 0.25,
    }), 0.2, 0x80ff40));
    for (let i = 0; i < 14; i++) {
      const a = rand(-1.2, 1.2), e = rand(-0.8, 0.8);
      const p = this.mesh(new THREE.SphereGeometry(rand(0.035, 0.075), 8, 6), this.pusMat);
      p.position.set(Math.sin(a) * 0.42 * Math.cos(e) * 1.05, Math.sin(e) * 0.38, Math.cos(a) * 0.42 * Math.cos(e) * 0.85);
      this.belly.add(p);
    }
    const glow = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0x60ff30, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35,
    })));
    glow.scale.setScalar(1.4);
    glow.position.z = 0.25;
    this.belly.add(glow);
    this.bellyGlow = glow;
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

  drawLabel(targeted) { this.wl.draw(this.progress, targeted); this.targeted = targeted; }

  headWorldPos(out) {
    return this.head.getWorldPosition(out);
  }

  // where a thrown prop leaves the boss's hand
  handWorldPos(out) {
    return (this.attached(this.hands[1]) ? this.hands[1] : this.shoulders[1]).getWorldPosition(out);
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  // a landed letter: flare the flesh and jolt the body
  hit() {
    this.hitFlash = 1;
    this.flinch = this.kind === 'brute' ? 0.45 : 1;
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

  // returns 'strike' the frame its attack lands, 'splash' when it breaks the
  // canal surface, 'step' on a heavy footfall
  update(dt, camPos, slow = 1) {
    // frozen ghouls move through syrup, but their deaths don't
    if (this.state !== 'dying') dt *= slow;
    this.t += dt;
    this.stateT += dt;
    const g = this.group;
    let event = null;
    const toCam = new THREE.Vector3(camPos.x, 0, camPos.z).sub(new THREE.Vector3(g.position.x, 0, g.position.z));
    const dist = toCam.length();
    toCam.normalize();
    g.rotation.y = Math.atan2(toCam.x, toCam.z);

    // the tag burns red when it's close enough to hurt
    const danger = !this.isBoss && dist < 6.5 && this.state !== 'dying';
    if (danger !== this.wl.danger) {
      this.wl.danger = danger;
      this.wl.draw(this.progress, !!this.targeted);
    }

    // rags flutter in every state
    for (const rag of this.rags) {
      const p = rag.userData.phase;
      rag.rotation.x = Math.sin(this.t * 3.1 + p) * 0.3;
      rag.rotation.z = Math.sin(this.t * 2.3 + p * 1.7) * 0.2;
    }
    if (this.belly) {
      const throb = 1 + Math.sin(this.t * 5.5) * 0.05 + Math.max(0, Math.sin(this.t * 1.7)) * 0.05;
      this.belly.scale.setScalar(throb);
      this.bellyGlow.material.opacity = 0.25 + Math.max(0, Math.sin(this.t * 5.5)) * 0.25;
    }

    const ok = (p) => !p.userData.shed; // don't animate parts that were shot off

    if (this.coins) {
      const falling = this.state === 'dying';
      for (const c of this.coins) {
        const u = c.userData;
        if (falling) { // the debts scatter and drop
          u.vy = (u.vy ?? rand(0.5, 2)) - 9 * dt / this.scale;
          c.position.y = Math.max(0.01, c.position.y + u.vy * dt);
          c.position.x *= 1 + dt * 1.5;
          c.position.z *= 1 + dt * 1.5;
          continue;
        }
        u.a += u.sp * dt;
        c.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(this.t * 1.3 + u.wob) * 0.12, Math.sin(u.a) * u.r);
        c.rotation.set(Math.PI / 2, 0, u.a + this.t * 2);
      }
    }
    if (this.aura) {
      this.aura.material.opacity = this.state === 'dying'
        ? Math.max(0, this.aura.material.opacity - dt) : 0.45 + Math.sin(this.t * 2.2) * 0.15;
    }

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
        if (this.kind === 'runner') event = this.animRun(dt, toCam, camPos, ok);
        else if (this.crawl) this.animCrawl(dt, toCam, camPos, ok);
        else event = this.animShamble(dt, toCam, camPos, ok);
        const reach = this.kind === 'brute' ? 3.2 : this.crawl ? 2.3 : this.kind === 'runner' ? 2.9 : 2.7;
        if (dist < reach) this.setState('attack');
        break;
      }
      case 'attack': {
        // wind up then lunge
        const p = this.stateT / (this.kind === 'brute' ? 1.35 : 1);
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
        const k = this.kind === 'brute' ? 0.5 : 1;
        const away = 7.5 * k * (1 - Math.min(this.stateT / 0.6, 1));
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
        if (this.crawl) {
          this.body.rotation.x = this.hunch + Math.min(p * 2, 0.25); // slumps flat
          this.body.position.y = Math.max(0.2, 0.42 - p * 0.4);
        } else {
          this.body.rotation.x = this.hunch - Math.min(p * 3.2, Math.PI / 2); // topple backward
        }
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
        if (this.pusMat) this.pusMat.emissiveIntensity = 1.2 * (1 - burn);
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
        this.shoulders[1].rotation.x = this.prop ? -0.5 + Math.sin(w) * 0.1 : -Math.PI / 2 - Math.sin(w) * 0.1;
        this.shoulders[0].rotation.z = 0;
        this.shoulders[1].rotation.z = 0;
        if (ok(this.head)) this.head.rotation.z = this.pose.headTilt * 0.5 + Math.sin(w * 0.4) * 0.1;
        if (ok(this.jaw)) this.jaw.rotation.x = 0.4 + Math.sin(w * 1.3) * 0.15;
        break;
      }
      case 'throw': { // boss hurls something: wind up overhead, whip forward
        const p = this.stateT;
        const arm = this.shoulders[1];
        if (p < 0.35) {
          arm.rotation.x = -0.5 - (p / 0.35) * 2.6;
          this.body.rotation.x = this.hunch * 0.7 - p * 0.6;
        } else if (p < 0.55) {
          const q = (p - 0.35) / 0.2;
          arm.rotation.x = -3.1 + q * 2.4;
          this.body.rotation.x = this.hunch * 0.7 - 0.21 + q * 0.5;
          if (!this.thrown) { this.thrown = true; event = 'throw'; }
        } else {
          this.thrown = false;
          this.setState('idle');
        }
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

  // the classic: lurch on each step instead of gliding (mean ≈ base speed)
  animShamble(dt, toCam, camPos, ok) {
    const g = this.group;
    const cad = (2.6 + this.speed * 2.4) * this.pose.gait * (this.kind === 'brute' ? 0.7 : 1);
    const prevW = this.walkW ?? 0;
    this.walkW = prevW + dt * cad;
    const w = this.walkW;
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
        // reaching arm bobs limply, fingers grasping
        this.shoulders[i].rotation.x = -Math.PI / 2 + this.pose.reach[i] + Math.sin(w * 0.5 + i * 1.3) * 0.12;
        if (ok(this.elbows[i])) this.elbows[i].rotation.x = -0.3 + Math.sin(w * 0.5 + i) * 0.1;
        if (ok(this.hands[i])) this.hands[i].rotation.x = -0.8 + Math.sin(this.t * 3 + i * 2) * 0.25;
      }
    }

    // head lolls, jaw hangs and works slowly, snaps when close
    if (ok(this.head)) {
      this.head.rotation.z = this.pose.headTilt + Math.sin(this.t * 0.9 + this.seed) * 0.16;
      this.head.rotation.x = 0.24 + Math.sin(this.t * 0.6 + this.seed) * 0.1;
    }
    if (ok(this.jaw)) this.jaw.rotation.x = 0.55 + Math.sin(this.t * 1.7 + this.seed) * 0.2;
    // brutes shake the street (event fires once per footfall)
    if (this.kind === 'brute' && Math.floor(prevW / Math.PI) !== Math.floor(w / Math.PI)) return 'step';
    return null;
  }

  // sprinters: pitched forward, arms flailing back, knees pumping
  animRun(dt, toCam, camPos, ok) {
    const g = this.group;
    const w = this.t * 11 * this.pose.gait;
    const sp = this.speed * (0.85 + 0.3 * Math.abs(Math.sin(w)));
    g.position.x += toCam.x * sp * dt;
    g.position.z += toCam.z * sp * dt;
    g.position.x += (camPos.x - g.position.x) * 0.08 * dt;
    g.position.x += Math.sin(this.t * 1.3 + this.seed) * 0.6 * dt; // zig-zag

    this.body.position.y = 1.0 + Math.abs(Math.sin(w)) * 0.09;
    this.body.rotation.x = this.hunch + Math.sin(w * 2) * 0.05;
    this.body.rotation.z = Math.sin(w) * 0.12;
    this.body.rotation.y = Math.sin(w) * 0.15;
    for (const i of [0, 1]) {
      const s = i === 0 ? 1 : -1;
      this.hips[i].rotation.x = Math.sin(w) * 0.95 * s - 0.25;
      this.knees[i].rotation.x = 0.4 + Math.max(0, Math.sin(w * s + 1.5)) * 1.3;
      // arms thrown forward, clawing at the air
      this.shoulders[i].rotation.x = -Math.PI / 2 - 0.4 + Math.sin(w + i * Math.PI) * 0.7;
      this.shoulders[i].rotation.z = s * -0.25;
      if (ok(this.elbows[i])) this.elbows[i].rotation.x = -0.5 + Math.sin(w + i) * 0.3;
    }
    if (ok(this.head)) {
      this.head.rotation.x = -0.35 + Math.sin(w * 2) * 0.08; // face up, eyes on you
      this.head.rotation.z = Math.sin(w) * 0.2;
    }
    if (ok(this.jaw)) this.jaw.rotation.x = 0.85 + Math.sin(this.t * 9) * 0.25; // shrieking
    return null;
  }

  // legless: drag the torso along the setts hand over hand
  animCrawl(dt, toCam, camPos, ok) {
    const g = this.group;
    const w = this.t * (3.2 + this.speed * 2) * this.pose.gait;
    const pull = Math.max(0, Math.sin(w)) + Math.max(0, Math.sin(w + Math.PI));
    const sp = this.speed * (0.35 + 0.9 * pull);
    g.position.x += toCam.x * sp * dt;
    g.position.z += toCam.z * sp * dt;
    g.position.x += (camPos.x - g.position.x) * 0.05 * dt;

    this.body.position.y = 0.42 + Math.abs(Math.sin(w)) * 0.06;
    this.body.rotation.x = this.hunch + Math.sin(w * 2) * 0.04;
    this.body.rotation.z = Math.sin(w) * 0.14;
    for (const i of [0, 1]) {
      const ph = w + i * Math.PI;
      // reach far ahead, plant, haul back under the chest
      this.shoulders[i].rotation.x = -2.25 - Math.cos(ph) * 0.6;
      this.shoulders[i].rotation.z = (i === 0 ? -1 : 1) * 0.35;
      if (ok(this.elbows[i])) this.elbows[i].rotation.x = -0.3 - Math.max(0, Math.sin(ph)) * 0.7;
      // ruined legs trail limp behind
      this.hips[i].rotation.x = 0.15 + Math.sin(ph * 0.5) * 0.08;
    }
    if (ok(this.head)) {
      this.head.rotation.x = -1.05 + Math.sin(w) * 0.08; // neck craned up at you
      this.head.rotation.z = this.pose.headTilt * 0.5;
    }
    if (ok(this.jaw)) this.jaw.rotation.x = 0.6 + Math.sin(this.t * 2.3) * 0.25;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.wl.dispose();
    for (const geo of this.geos) geo.dispose();
    for (const mat of this.mats) mat.dispose();
  }
}
