import * as THREE from 'three';

function rand(a, b) { return a + Math.random() * (b - a); }

// canvas texture: dark facade with scattered lit windows
function facadeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#11141f';
  c.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 14) {
    for (let x = 6; x < 58; x += 12) {
      const r = Math.random();
      if (r < 0.14) c.fillStyle = '#ffc866';
      else if (r < 0.2) c.fillStyle = '#6a4a2a';
      else c.fillStyle = '#05070d';
      c.fillRect(x, y, 7, 9);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function cobbleTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#151821';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const g = 18 + Math.random() * 22;
    c.fillStyle = `rgb(${g},${g + 2},${g + 8})`;
    c.fillRect(Math.random() * 128, Math.random() * 128, rand(4, 12), rand(3, 8));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 60);
  return tex;
}

// soft radial blob, used for mist, lamp glow, moon halo
function glowTexture(inner, mid) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export function buildWorld(scene, sfx) {
  const BG = new THREE.Color(0x0a0e18);
  const BG_FLASH = new THREE.Color(0x3a4a72);
  scene.background = BG.clone();
  scene.fog = new THREE.FogExp2(0x0a0e18, 0.016);
  const fogBase = new THREE.Color(0x0a0e18);
  const fogFlash = new THREE.Color(0x2e3c60);

  // lights
  scene.add(new THREE.HemisphereLight(0x3d4a70, 0x141824, 1.3));
  const moonlight = new THREE.DirectionalLight(0x9fb4ff, 1.0);
  moonlight.position.set(-30, 60, -40);
  scene.add(moonlight);
  const lamp = new THREE.PointLight(0xffb45e, 120, 60, 1.8); // follows camera
  scene.add(lamp);
  // lightning strobe
  const bolt = new THREE.DirectionalLight(0xcdd8ff, 0);
  bolt.position.set(20, 80, -60);
  scene.add(bolt);

  // street
  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 500),
    new THREE.MeshLambertMaterial({ map: cobbleTexture() })
  );
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0, -200);
  scene.add(street);

  // canal (right side)
  const waterGeo = new THREE.PlaneGeometry(14, 500, 12, 160);
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshPhongMaterial({ color: 0x0c1a2e, shininess: 160, specular: 0x8ab0e0 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(19.5, -0.7, -200);
  scene.add(water);
  const basePos = waterGeo.attributes.position.array.slice();

  // quay edge
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.0, 500),
    new THREE.MeshLambertMaterial({ color: 0x232838 })
  );
  quay.position.set(12.6, 0.2, -200);
  scene.add(quay);

  // buildings
  const facades = [facadeTexture(), facadeTexture(), facadeTexture()];
  const addBuilding = (x, z) => {
    const w = rand(7, 12), h = rand(9, 22), d = rand(6, 10);
    const tex = facades[Math.floor(Math.random() * facades.length)];
    const mat = new THREE.MeshLambertMaterial({
      color: 0x8890a8,
      map: tex,
      emissive: 0xffc27a,
      emissiveMap: tex,
      emissiveIntensity: 0.55,
    });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z);
    scene.add(b);
  };
  for (let z = 15; z > -420; z -= rand(9, 14)) addBuilding(rand(-19, -16), z);      // left row
  for (let z = 15; z > -420; z -= rand(9, 14)) addBuilding(rand(29, 33), z);        // across the canal

  // lampposts along the quay, with flickering halos
  const postMat = new THREE.MeshLambertMaterial({ color: 0x1a1e2a });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const lampGlowTex = glowTexture('rgba(255,205,130,0.9)', 'rgba(255,160,60,0.25)');
  const lampGlows = [];
  for (let z = 0; z > -400; z -= 22) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.6, 6), postMat);
    post.position.set(11.5, 1.8, z);
    scene.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulbMat);
    bulb.position.set(11.5, 3.7, z);
    scene.add(bulb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lampGlowTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.5,
    }));
    halo.position.copy(bulb.position);
    halo.scale.setScalar(2.6);
    scene.add(halo);
    lampGlows.push({ halo, phase: rand(0, 20), flicker: Math.random() < 0.25 });
  }

  // moon + halo + stars
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
  );
  moon.position.set(-45, 65, -260);
  moon.lookAt(0, 1.6, 0);
  scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(190,210,255,0.55)', 'rgba(120,150,230,0.15)'),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  moonHalo.position.copy(moon.position);
  moonHalo.scale.setScalar(55);
  scene.add(moonHalo);

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    starPos.push(rand(-250, 250), rand(40, 180), rand(-350, 50));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab6d8, size: 0.7, fog: false })));

  // ---- rain: streaked line segments recycled around the camera ----
  const RAIN_N = 500;
  const rainGeo = new THREE.BufferGeometry();
  const rainArr = new Float32Array(RAIN_N * 6);
  const drops = [];
  for (let i = 0; i < RAIN_N; i++) {
    drops.push({
      x: rand(-30, 30), y: rand(0, 26), z: rand(-45, 10),
      v: rand(16, 26),
    });
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainArr, 3));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({
      color: 0x8093b8, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  rain.frustumCulled = false;
  scene.add(rain);

  // ---- ground mist drifting over the cobbles ----
  const mistTex = glowTexture('rgba(150,170,210,0.16)', 'rgba(120,140,190,0.07)');
  const mists = [];
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mistTex, transparent: true, depthWrite: false, opacity: rand(0.4, 0.8),
      rotation: rand(0, Math.PI),
    }));
    m.scale.set(rand(10, 18), rand(3.5, 6), 1);
    m.position.set(rand(-12, 12), rand(0.6, 1.6), -i * 20 + rand(-6, 6));
    scene.add(m);
    mists.push({ m, drift: rand(0.12, 0.4) * (Math.random() < 0.5 ? -1 : 1), spin: rand(-0.02, 0.02) });
  }

  // ---- drifting embers / motes that catch the bloom ----
  const EMBER_N = 130;
  const emberGeo = new THREE.BufferGeometry();
  const emberArr = new Float32Array(EMBER_N * 3);
  const embers = [];
  for (let i = 0; i < EMBER_N; i++) {
    embers.push({ x: rand(-14, 14), y: rand(0.3, 6), z: rand(-40, 6), p: rand(0, 20), s: rand(0.1, 0.35) });
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberArr, 3));
  const emberPts = new THREE.Points(emberGeo, new THREE.PointsMaterial({
    color: 0xffc070, size: 0.09, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  emberPts.frustumCulled = false;
  scene.add(emberPts);

  // ---- lightning state ----
  let strike = 0;              // 1 → 0 while a flash decays
  let nextStrike = rand(6, 14);

  let t = 0;
  return {
    update(dt, camPos) {
      t += dt;
      lamp.position.set(camPos.x + 2, 4.2, camPos.z - 8);

      // ripple the canal near the camera
      const pos = waterGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = basePos[i * 3], y = basePos[i * 3 + 1];
        pos.array[i * 3 + 2] = Math.sin(y * 0.25 + t * 1.6) * 0.12 + Math.sin(x * 0.9 + t * 2.3) * 0.07;
      }
      pos.needsUpdate = true;

      // rain
      for (let i = 0; i < RAIN_N; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        if (d.y < 0) {
          d.y = rand(18, 26);
          d.x = rand(-30, 30);
          d.z = rand(-45, 10);
        }
        const j = i * 6;
        const wx = camPos.x + d.x, wy = d.y, wz = camPos.z + d.z;
        rainArr[j] = wx; rainArr[j + 1] = wy; rainArr[j + 2] = wz + 0.1;
        rainArr[j + 3] = wx; rainArr[j + 4] = wy + 0.5; rainArr[j + 5] = wz;
      }
      rainGeo.attributes.position.needsUpdate = true;

      // mist drifts sideways and slowly rotates; recycled along the rail
      for (const { m, drift, spin } of mists) {
        m.position.x += drift * dt;
        m.material.rotation += spin * dt;
        if (m.position.x > 14) m.position.x = -14;
        if (m.position.x < -14) m.position.x = 14;
        if (m.position.z > camPos.z + 12) m.position.z -= 440;
      }

      // embers spiral upward
      for (let i = 0; i < EMBER_N; i++) {
        const e = embers[i];
        e.y += e.s * dt;
        if (e.y > 7) e.y = 0.3;
        let z = e.z + camPos.z;
        emberArr[i * 3] = camPos.x + e.x + Math.sin(t * 0.7 + e.p) * 0.8;
        emberArr[i * 3 + 1] = e.y + Math.sin(t * 1.3 + e.p) * 0.2;
        emberArr[i * 3 + 2] = z;
      }
      emberGeo.attributes.position.needsUpdate = true;

      // lamp flicker
      for (const lg of lampGlows) {
        const n = Math.sin(t * 9 + lg.phase) * Math.sin(t * 23 + lg.phase * 2);
        lg.halo.material.opacity = lg.flicker
          ? Math.max(0.06, 0.45 + n * 0.4)
          : 0.5 + n * 0.06;
      }

      // lightning
      nextStrike -= dt;
      if (nextStrike <= 0) {
        strike = 1;
        nextStrike = rand(7, 18);
        bolt.position.set(rand(-60, 60), 80, camPos.z - rand(30, 90));
        if (sfx) setTimeout(() => sfx.thunder(), rand(350, 1400));
      }
      if (strike > 0) {
        strike = Math.max(0, strike - dt * 2.1);
        // double-pulse flicker
        const k = strike * (0.55 + 0.45 * Math.sin(strike * 34));
        bolt.intensity = k * 4.5;
        scene.background.lerpColors(BG, BG_FLASH, k * 0.8);
        scene.fog.color.lerpColors(fogBase, fogFlash, k * 0.8);
      } else if (bolt.intensity !== 0) {
        bolt.intensity = 0;
        scene.background.copy(BG);
        scene.fog.color.copy(fogBase);
      }
    },
  };
}
