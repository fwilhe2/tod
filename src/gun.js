import * as THREE from 'three';

// First-person "field keyboard sidearm": chunky service pistol in a gloved
// hand, bottom-right of frame. Muzzle flash + point light + recoil on fire.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function flashTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,220,140,0.9)');
  g.addColorStop(0.6, 'rgba(255,150,50,0.35)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  // star spikes
  c.strokeStyle = 'rgba(255,240,190,0.85)';
  c.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    c.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

// Workshop-style environment for the metal to reflect: a dark room with a
// warm lamp strip, a cold window and a dim floor bounce. Rendered to a PMREM.
export function makeGunEnv(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05070c);
  const panel = (color, k, w, h, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(0xffa860, 6, 6, 1.2, new THREE.Vector3(6, 4, -6));   // sodium lamps up the street
  panel(0xffb070, 3, 3, 3, new THREE.Vector3(-7, 2, -2));     // lit window
  panel(0x9fb4ff, 2.2, 14, 4, new THREE.Vector3(0, 9, 2));    // overcast moonlit sky
  panel(0x30241c, 1, 20, 20, new THREE.Vector3(0, -8, 0));    // wet street bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

// extrude a side profile (u forward, v up) into a part `width` wide, barrel along -z
function profile(points, width, bevel = 0.003) {
  const s = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  g.rotateY(Math.PI / 2);
  g.translate(-width / 2 + bevel, 0, 0);
  return g;
}

function stippleTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgb(128,128,255)';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const g = c.createRadialGradient(x - 1, y - 1, 0, x, y, 2.5);
    g.addColorStop(0, 'rgb(90,90,255)');
    g.addColorStop(1, 'rgba(160,160,255,0)');
    c.fillStyle = g;
    c.fillRect(x - 3, y - 3, 6, 6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  return t;
}

export class Gun {
  constructor(camera) {
    const g = new THREE.Group();
    this.group = g;
    this.basePos = new THREE.Vector3(0.36, -0.31, -0.62);
    g.position.copy(this.basePos);
    g.rotation.y = -0.07;
    camera.add(g);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.32 });
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.85, roughness: 0.42 });
    const worn = new THREE.MeshStandardMaterial({ color: 0x6a6c70, metalness: 1, roughness: 0.22 }); // edges worn bright
    const polymer = new THREE.MeshStandardMaterial({
      color: 0x1e1c1a, metalness: 0, roughness: 0.75, normalMap: stippleTexture(), normalScale: new THREE.Vector2(0.8, 0.8),
    });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.62, metalness: 0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x343a4a, roughness: 0.9 });
    const tritium = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dff6a).multiplyScalar(3) });
    this.cellMat = new THREE.MeshStandardMaterial({
      color: 0x3a2008, emissive: 0xffa030, emissiveIntensity: 2, roughness: 0.1, transparent: true, opacity: 0.9,
    });
    this.mats = [metal, metalDark, worn, polymer, glove, sleeve];
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    // ---- slide: chamfered nose, bevelled edges, cocking serrations, ejection port
    this.slide = new THREE.Group();
    this.slide.position.set(0, 0.034, 0.075);
    g.add(this.slide);
    const slideMesh = new THREE.Mesh(profile([
      [0, 0], [0.37, 0], [0.37, 0.036], [0.35, 0.056], [0.03, 0.056], [0, 0.046],
    ], 0.07, 0.004), metalDark);
    this.slide.add(slideMesh);
    for (let i = 0; i < 7; i++) {
      for (const sx of [-1, 1]) {
        const cut = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.04, 0.005), metal);
        cut.position.set(sx * 0.0345, 0.026, -0.012 - i * 0.011);
        this.slide.add(cut);
      }
    }
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    port.position.set(0.012, 0.055, -0.13);
    this.slide.add(port);
    const barrelHood = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.012, 0.06), worn);
    barrelHood.position.set(0.012, 0.052, -0.13);
    this.slide.add(barrelHood);
    // night sights: two rear dots straddling one front dot
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.016, 0.014), metalDark);
    rear.position.set(0, 0.064, -0.012);
    this.slide.add(rear);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.016, 0.012), metalDark);
    front.position.set(0, 0.064, -0.345);
    this.slide.add(front);
    const dot = new THREE.SphereGeometry(0.0038, 8, 6);
    for (const [x, z] of [[-0.016, -0.004], [0.016, -0.004], [0, -0.338]]) {
      const d = new THREE.Mesh(dot, tritium);
      d.position.set(x, 0.068, z);
      this.slide.add(d);
    }

    // ---- frame with accessory rail, barrel crown, trigger guard
    add(profile([
      [0, 0], [0.31, 0], [0.31, 0.034], [0.04, 0.034], [0.0, 0.03],
    ], 0.066, 0.004), metal, 0, 0, 0.08);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.05, 0.006, 0.008), metalDark, 0, -0.002, -0.12 - i * 0.022);
    const barrel = add(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 14), worn, 0, 0.065, -0.3);
    barrel.rotation.x = Math.PI / 2;
    const bore = add(new THREE.CircleGeometry(0.009, 12), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, 0.065, -0.311);
    bore.rotation.y = Math.PI;
    const guard = add(new THREE.TorusGeometry(0.042, 0.007, 8, 16, Math.PI), polymer, 0, -0.002, -0.02);
    guard.rotation.z = Math.PI;
    add(new THREE.BoxGeometry(0.008, 0.03, 0.008), metal, 0, -0.018, -0.01).rotation.x = 0.3; // trigger
    add(new THREE.BoxGeometry(0.016, 0.022, 0.016), metalDark, 0, 0.07, 0.085); // hammer

    // ---- stippled polymer grip and magazine baseplate
    const grip = add(new THREE.BoxGeometry(0.064, 0.17, 0.085, 1, 4, 1), polymer, 0, -0.1, 0.07);
    grip.rotation.x = 0.28;
    const base = add(new THREE.BoxGeometry(0.07, 0.016, 0.095), metal, 0, -0.185, 0.095);
    base.rotation.x = 0.28;

    // ---- the battery cell: an amber glass tube glowing on the frame, cabled
    // back to the car battery (per the lore)
    const cellTube = add(new THREE.CylinderGeometry(0.011, 0.011, 0.085, 12), this.cellMat, -0.042, 0.016, -0.03);
    cellTube.rotation.x = Math.PI / 2;
    for (const z of [0.015, -0.075]) {
      const cap = add(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), worn, -0.042, 0.016, z);
      cap.rotation.x = Math.PI / 2;
    }
    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.042, 0.016, 0.02),
      new THREE.Vector3(-0.06, -0.06, 0.12),
      new THREE.Vector3(-0.05, -0.3, 0.3),
      new THREE.Vector3(0.15, -0.5, 0.5),
    ]);
    add(new THREE.TubeGeometry(cableCurve, 24, 0.008, 8), metalDark);

    // ---- gloved hand
    const palm = add(new THREE.BoxGeometry(0.085, 0.15, 0.11), glove, 0.045, -0.12, 0.08);
    palm.rotation.x = 0.28;
    palm.rotation.z = -0.12;
    for (let f = 0; f < 3; f++) {
      const finger = add(new THREE.CapsuleGeometry(0.017, 0.075, 4, 8), glove, -0.028, -0.085 - f * 0.036, 0.035 + f * 0.012);
      finger.rotation.z = Math.PI / 2;
      finger.rotation.y = -0.4;
      const knuckle = add(new THREE.SphereGeometry(0.019, 8, 6), glove, 0.028, -0.08 - f * 0.036, 0.05 + f * 0.012);
      knuckle.scale.set(1, 0.9, 1.1);
    }
    const trigger = add(new THREE.CapsuleGeometry(0.016, 0.07, 4, 8), glove, 0.022, -0.035, -0.035);
    trigger.rotation.x = Math.PI / 2.4;
    const thumb = add(new THREE.CapsuleGeometry(0.018, 0.06, 4, 8), glove, 0.05, -0.03, 0.04);
    thumb.rotation.z = 0.5;
    thumb.rotation.x = -0.4;
    const wrist = add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), glove, 0.06, -0.22, 0.13);
    wrist.rotation.x = 0.5;
    wrist.rotation.z = -0.2;
    const cuff = add(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 12), metalDark, 0.075, -0.265, 0.16);
    cuff.rotation.x = 0.55;
    cuff.rotation.z = -0.2;
    const arm = add(new THREE.CylinderGeometry(0.058, 0.08, 0.38, 12), sleeve, 0.12, -0.38, 0.28);
    arm.rotation.x = 0.7;
    arm.rotation.z = -0.25;

    // ---- muzzle flash ----
    this.muzzle = new THREE.Group();
    this.muzzle.position.set(0, 0.065, -0.33);
    g.add(this.muzzle);
    const tex = flashTexture();
    this.flashPlanes = [];
    for (let i = 0; i < 2; i++) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.42),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      plane.rotation.y = i * Math.PI / 2;
      this.muzzle.add(plane);
      this.flashPlanes.push(plane);
    }
    this.flashLight = new THREE.PointLight(0xffc866, 0, 9, 1.6);
    this.muzzle.add(this.flashLight);

    // small fill light so the metal and glove read against the dark street
    const fill = new THREE.PointLight(0xa8b4dc, 10, 3.5, 1.5);
    fill.position.set(0.25, 0.35, 0.2);
    g.add(fill);

    // ejection port reference point (shells spawn here, in world space)
    this.eject = new THREE.Object3D();
    this.eject.position.set(0.04, 0.095, -0.06);
    g.add(this.eject);

    this.recoil = 0;
    this.flashLife = 0;
    // aim swing toward whatever we're currently shooting at (camera-space)
    this.baseYaw = -0.07;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.wantYaw = 0;
    this.wantPitch = 0;
    this.setFlash(0);
  }

  // point the barrel at a target given in camera-local space; null = rest pose
  aimAt(local) {
    if (!local) { this.wantYaw = 0; this.wantPitch = 0; return; }
    const dx = local.x - this.basePos.x;
    const dy = local.y - this.basePos.y;
    const dz = local.z - this.basePos.z;
    const flat = Math.hypot(dx, dz) || 1e-6;
    // barrel rests along -Z, so undo the stylistic base yaw to get a true lead
    this.wantYaw = clamp(Math.atan2(-dx, -dz) - this.baseYaw, -0.55, 0.55);
    this.wantPitch = clamp(Math.atan2(dy, flat), -0.4, 0.4);
  }

  fire() {
    this.recoil = 1;
    this.flashLife = 1;
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.flashScale = 0.8 + Math.random() * 0.7;
  }

  // reflections for the metal, from makeGunEnv()
  setEnv(env) {
    this.envMap = env;
    for (const m of this.mats) { m.envMap = env; m.envMapIntensity = 1.2; m.needsUpdate = true; }
  }

  muzzleWorldPos(out) { return this.muzzle.getWorldPosition(out); }
  ejectWorldPos(out) { return this.eject.getWorldPosition(out); }

  setFlash(k) {
    for (const p of this.flashPlanes) {
      p.visible = k > 0;
      p.material.opacity = k;
      p.scale.setScalar((this.flashScale ?? 1) * (0.7 + k * 0.5));
    }
    this.flashLight.intensity = 40 * k;
  }

  update(dt, time) {
    this.recoil *= Math.exp(-dt * 13);
    this.flashLife = Math.max(0, this.flashLife - dt / 0.065);
    this.setFlash(this.flashLife);

    // swing onto the current target instead of snapping
    const k = 1 - Math.exp(-dt * 9);
    this.aimYaw += (this.wantYaw - this.aimYaw) * k;
    this.aimPitch += (this.wantPitch - this.aimPitch) * k;

    const r = this.recoil;
    // idle sway + breathing bob, then recoil kick back and up
    this.group.position.set(
      this.basePos.x + Math.sin(time * 1.7) * 0.006,
      this.basePos.y + Math.sin(time * 2.3) * 0.007 + r * 0.02,
      this.basePos.z + r * 0.09
    );
    this.group.rotation.x = -r * 0.22 + this.aimPitch;
    this.group.rotation.y = this.baseYaw + this.aimYaw;
    this.group.rotation.z = Math.sin(time * 1.3) * 0.008 + r * 0.03 - this.aimYaw * 0.25;
    this.slide.position.z = 0.075 + r * 0.05;
    // the cell breathes, and surges on each shot
    this.cellMat.emissiveIntensity = 1.6 + Math.sin(time * 3.1) * 0.4 + Math.sin(time * 17) * 0.1 + this.flashLife * 4;
  }
}
