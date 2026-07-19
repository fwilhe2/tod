import * as THREE from 'three';

// First-person "field keyboard sidearm": chunky service pistol in a gloved
// hand, bottom-right of frame. Muzzle flash + point light + recoil on fire.

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

export class Gun {
  constructor(camera) {
    const g = new THREE.Group();
    this.group = g;
    this.basePos = new THREE.Vector3(0.36, -0.31, -0.62);
    g.position.copy(this.basePos);
    g.rotation.y = -0.07;
    camera.add(g);

    const metal = new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.85, roughness: 0.3 });
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.8, roughness: 0.45 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2c20, metalness: 0.1, roughness: 0.85 });
    const glove = new THREE.MeshLambertMaterial({ color: 0x2e2a24 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x3c4254 });
    const cell = new THREE.MeshBasicMaterial({ color: 0xffb040 });

    // ---- frame ----
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.3), metal);
    frame.position.set(0, 0, -0.05);
    g.add(frame);

    this.slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.32), metalDark);
    this.slide.position.set(0, 0.062, -0.06);
    g.add(this.slide);
    // slide serrations
    for (let i = 0; i < 4; i++) {
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.04, 0.008), metal);
      cut.position.set(0, 0, 0.1 - i * 0.022);
      this.slide.add(cut);
    }

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.24, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.055, -0.3);
    g.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.06, 10), metalDark);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.055, -0.4);
    g.add(brake);

    // sights
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.015), metalDark);
    rear.position.set(0, 0.1, 0.08);
    g.add(rear);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.012), metalDark);
    front.position.set(0, 0.1, -0.21);
    g.add(front);

    // amber power cell + cable back to the car battery (per the lore)
    const cellMesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.07), cell);
    cellMesh.position.set(-0.05, 0.01, 0.02);
    g.add(cellMesh);
    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, -0.02, 0.05),
      new THREE.Vector3(-0.1, -0.15, 0.15),
      new THREE.Vector3(-0.05, -0.35, 0.3),
      new THREE.Vector3(0.15, -0.5, 0.5),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 16, 0.011, 6), metalDark);
    g.add(cable);

    // grip + trigger guard
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.17, 0.09), grip);
    gripMesh.position.set(0, -0.11, 0.07);
    gripMesh.rotation.x = 0.28;
    g.add(gripMesh);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 12, Math.PI), metal);
    guard.position.set(0, -0.06, -0.03);
    guard.rotation.z = Math.PI;
    g.add(guard);

    // ---- gloved hand ----
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.15, 0.11), glove);
    palm.position.set(0.045, -0.12, 0.08);
    palm.rotation.x = 0.28;
    palm.rotation.z = -0.12;
    g.add(palm);
    // fingers wrapping the grip
    for (let f = 0; f < 3; f++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.075, 2, 6), glove);
      finger.position.set(-0.028, -0.085 - f * 0.038, 0.035 + f * 0.012);
      finger.rotation.z = Math.PI / 2;
      finger.rotation.y = -0.4;
      g.add(finger);
    }
    // trigger finger
    const trigger = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.07, 2, 6), glove);
    trigger.position.set(0.02, -0.055, -0.04);
    trigger.rotation.x = Math.PI / 2.4;
    g.add(trigger);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 2, 6), glove);
    thumb.position.set(0.05, -0.045, 0.05);
    thumb.rotation.z = 0.5;
    thumb.rotation.x = -0.4;
    g.add(thumb);
    // wrist + sleeve running off-frame
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), glove);
    wrist.position.set(0.06, -0.22, 0.13);
    wrist.rotation.x = 0.5;
    wrist.rotation.z = -0.2;
    g.add(wrist);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.35, 8), sleeve);
    arm.position.set(0.12, -0.38, 0.28);
    arm.rotation.x = 0.7;
    arm.rotation.z = -0.25;
    g.add(arm);

    // ---- muzzle flash ----
    this.muzzle = new THREE.Group();
    this.muzzle.position.set(0, 0.055, -0.44);
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
    const fill = new THREE.PointLight(0xa8b4dc, 18, 3.5, 1.5);
    fill.position.set(0.25, 0.35, 0.2);
    g.add(fill);

    // ejection port reference point (shells spawn here, in world space)
    this.eject = new THREE.Object3D();
    this.eject.position.set(0.05, 0.08, -0.02);
    g.add(this.eject);

    this.recoil = 0;
    this.flashLife = 0;
    this.setFlash(0);
  }

  fire() {
    this.recoil = 1;
    this.flashLife = 1;
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.flashScale = 0.8 + Math.random() * 0.7;
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

    const r = this.recoil;
    // idle sway + breathing bob, then recoil kick back and up
    this.group.position.set(
      this.basePos.x + Math.sin(time * 1.7) * 0.006,
      this.basePos.y + Math.sin(time * 2.3) * 0.007 + r * 0.02,
      this.basePos.z + r * 0.09
    );
    this.group.rotation.x = -r * 0.22;
    this.group.rotation.z = Math.sin(time * 1.3) * 0.008 + r * 0.03;
    this.slide.position.z = -0.06 + r * 0.055;
  }
}
