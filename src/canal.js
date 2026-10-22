import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cobbleMaps, tex, rand } from './textures.js';

// Canal dressing: masonry embankments on both sides, humped stone bridges,
// striped mooring poles, and black gondolas rocking at their moorings.
// Water surface sits at y = -0.7, between x = 13.3 (quay) and x = 26.5.

const WATER_Y = -0.7;

function stripeTexture(a, b) {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = a;
  c.fillRect(0, 0, 64, 256);
  c.fillStyle = b;
  // a helix: diagonal bands that wrap around the pole
  for (let y = -64; y < 256 + 64; y += 48) {
    c.beginPath();
    c.moveTo(0, y); c.lineTo(64, y + 32); c.lineTo(64, y + 56); c.lineTo(0, y + 24);
    c.fill();
  }
  // weathering
  for (let i = 0; i < 400; i++) {
    c.fillStyle = `rgba(20,16,10,${Math.random() * 0.25})`;
    c.fillRect(Math.random() * 64, Math.random() * 256, 2, Math.random() * 10);
  }
  // green slime band at the water line
  const g = c.createLinearGradient(0, 200, 0, 256);
  g.addColorStop(0, 'rgba(40,60,30,0)');
  g.addColorStop(1, 'rgba(30,48,24,0.95)');
  c.fillStyle = g;
  c.fillRect(0, 190, 64, 66);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a gondola-ish hull: a box bent into a long, narrow, upswept boat
function hullGeometry(len) {
  const g = new THREE.BoxGeometry(1.25, 0.55, len, 4, 2, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const z = p.getZ(i);
    const t = z / (len / 2); // -1 stern .. 1 bow
    const taper = Math.pow(Math.max(0, 1 - t * t), 0.55);
    x *= taper;
    if (y < 0) x *= 0.55; // narrow, rounded keel
    y += Math.pow(Math.abs(t), 3.5) * (t > 0 ? 1.1 : 0.7); // ends sweep upward
    p.setXYZ(i, x + 0.08 * (1 - t * t), y, z); // gondolas list to one side
  }
  g.computeVertexNormals();
  return g;
}

export function buildCanal(scene) {
  const stone = cobbleMaps();
  const stoneMat = (ru, rv) => new THREE.MeshStandardMaterial({
    map: tex(stone.albedo, { srgb: true, repeat: [ru, rv] }),
    normalMap: tex(stone.normal, { repeat: [ru, rv] }),
    color: 0x9a948c, roughness: 0.85,
  });

  // embankment walls: dressed stone from below the water up to the paving
  const wallMat = stoneMat(250, 1.2);
  const nearWall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 500), wallMat);
  nearWall.position.set(12.6, -0.75, -200); // top is a low kerb at y = 0.25
  scene.add(nearWall);
  const farWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 500), wallMat);
  farWall.position.set(27.1, -0.6, -200);
  scene.add(farWall);
  // a band of green slime and tide marks where the water laps the stone
  const slime = new THREE.MeshStandardMaterial({ color: 0x1c2a16, roughness: 0.3, transparent: true, opacity: 0.85 });
  for (const x of [13.31, 26.49]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(500, 0.5), slime);
    band.rotation.y = x < 20 ? Math.PI / 2 : -Math.PI / 2;
    band.position.set(x, WATER_Y + 0.15, -200);
    scene.add(band);
  }

  // humped stone bridges spanning the canal
  const bridgeMat = stoneMat(0.5, 0.5);
  const bridges = [];
  for (let z = -48; z > -440; z -= rand(80, 110)) {
    const s = new THREE.Shape();
    s.moveTo(-1, -1.6);
    s.lineTo(-1, 0.3);
    s.quadraticCurveTo(6.6, 3.4, 14.2, 0.5);
    s.lineTo(14.2, -1.6);
    s.lineTo(12.3, -1.6);
    s.absellipse(6.55, -1.6, 5.75, 3.05, 0, Math.PI, false);
    s.lineTo(-1, -1.6);
    const deck = new THREE.ExtrudeGeometry(s, { depth: 3.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 24 });
    // parapets follow the hump
    const parts = [deck];
    for (const pz of [0, 2.95]) {
      const ps = new THREE.Shape();
      const top = (x) => { // the deck curve, sampled
        const t = (x + 1) / 15.2;
        return (1 - t) * (1 - t) * 0.3 + 2 * (1 - t) * t * 3.4 + t * t * 0.5;
      };
      ps.moveTo(-1, top(-1));
      for (let x = -1; x <= 14.2; x += 0.4) ps.lineTo(x, top(x) + 0.95);
      for (let x = 14.2; x >= -1; x -= 0.4) ps.lineTo(x, top(x) - 0.05);
      const wall = new THREE.ExtrudeGeometry(ps, { depth: 0.25, bevelEnabled: false });
      wall.translate(0, 0, pz);
      parts.push(wall);
    }
    const g = mergeGeometries(parts);
    const bridge = new THREE.Mesh(g, bridgeMat);
    bridge.position.set(13.3, 0, z);
    bridge.castShadow = true;
    scene.add(bridge);
    bridges.push(bridge);
  }

  // striped mooring poles in leaning clusters
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 4.4, 10);
  const poleMats = [
    new THREE.MeshStandardMaterial({ map: stripeTexture('#d8d0c0', '#1d3a7a'), roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: stripeTexture('#d8d0c0', '#8a1c1c'), roughness: 0.6 }),
  ];
  const poleSets = [[], []];
  for (let z = -10; z > -440; z -= rand(14, 30)) {
    const x = Math.random() < 0.7 ? rand(23.5, 25.8) : rand(16.5, 18);
    const set = poleSets[Math.random() < 0.5 ? 0 : 1];
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + rand(-0.4, 0.4), WATER_Y + 1.0, z + rand(-0.5, 0.5)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.08, 0.08), rand(0, 6), rand(-0.08, 0.08))),
        new THREE.Vector3(1, rand(0.85, 1.15), 1)
      );
      set.push(m);
    }
  }
  poleSets.forEach((set, k) => {
    const inst = new THREE.InstancedMesh(poleGeo, poleMats[k], set.length);
    set.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    scene.add(inst);
  });

  // gondolas moored along the far bank, under black lacquer and tarps
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.25, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.35, metalness: 0.8 });
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.9 });
  const boats = [];
  for (let z = -20; z > -440; z -= rand(30, 55)) {
    const len = rand(7, 9.5);
    const boat = new THREE.Group();
    boat.add(new THREE.Mesh(hullGeometry(len), hullMat));
    // the ferro: a comb-like iron prow ornament
    const ferro = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.35), trimMat);
    ferro.position.set(0.08, 1.15, len / 2 - 0.05);
    boat.add(ferro);
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), trimMat);
      tooth.position.set(0.08, 0.95 + i * 0.09, len / 2 + 0.15);
      boat.add(tooth);
    }
    if (Math.random() < 0.6) {
      const tarp = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, len * 0.55), tarpMat);
      tarp.position.y = 0.3;
      tarp.rotation.z = rand(-0.05, 0.05);
      boat.add(tarp);
    }
    boat.position.set(rand(24, 25.3), WATER_Y - 0.08, z);
    boat.rotation.y = rand(-0.06, 0.06) + (Math.random() < 0.5 ? Math.PI : 0);
    boat.userData = { phase: rand(0, 10), baseY: boat.position.y, baseRy: boat.rotation.y };
    boat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(boat);
    boats.push(boat);
  }

  return {
    update(t) {
      for (const b of boats) {
        const p = b.userData.phase;
        b.position.y = b.userData.baseY + Math.sin(t * 1.3 + p) * 0.05;
        b.rotation.z = Math.sin(t * 0.9 + p) * 0.04;
        b.rotation.x = Math.sin(t * 0.7 + p * 2) * 0.015;
        b.rotation.y = b.userData.baseRy + Math.sin(t * 0.2 + p) * 0.03;
      }
    },
  };
}
