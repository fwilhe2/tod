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

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x0a0e18);
  scene.fog = new THREE.FogExp2(0x0a0e18, 0.016);

  // lights
  scene.add(new THREE.HemisphereLight(0x3d4a70, 0x141824, 1.2));
  const moonlight = new THREE.DirectionalLight(0x9fb4ff, 1.0);
  moonlight.position.set(-30, 60, -40);
  scene.add(moonlight);
  const lamp = new THREE.PointLight(0xffb45e, 95, 45, 1.8); // follows camera
  scene.add(lamp);

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
    new THREE.MeshPhongMaterial({ color: 0x0c1a2e, shininess: 90, specular: 0x4a6a9a })
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
  // lampposts along the quay
  const postMat = new THREE.MeshLambertMaterial({ color: 0x1a1e2a });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (let z = 0; z > -400; z -= 22) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.6, 6), postMat);
    post.position.set(11.5, 1.8, z);
    scene.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulbMat);
    bulb.position.set(11.5, 3.7, z);
    scene.add(bulb);
  }

  // moon + stars
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
  );
  moon.position.set(-45, 65, -260);
  moon.lookAt(0, 1.6, 0);
  scene.add(moon);

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 350; i++) {
    starPos.push(rand(-250, 250), rand(40, 180), rand(-350, 50));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab6d8, size: 0.7, fog: false })));

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
    },
  };
}
