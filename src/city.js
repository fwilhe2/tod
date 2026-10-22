import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeMaps, tex, rand, FACADE_W, FACADE_H, FACADE_STYLE_COUNT } from './textures.js';

// Two continuous terraces of canal houses: the left row lines the street,
// the right row faces it across the canal. Facades of the same style are
// merged into one mesh; cornices, string courses, roofs and the funnel
// chimneys go into shared trim/roof meshes. Vertex colours vary each house.

const _m = new THREE.Matrix4();

// a wall quad whose UVs are scaled so window bays keep their real-world size
function wall(width, height, uOff, matrix, shade) {
  const g = new THREE.PlaneGeometry(width, height);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * width / FACADE_W + uOff, uv.getY(i) * height / FACADE_H);
  }
  g.translate(0, height / 2, 0);
  g.applyMatrix4(matrix);
  return paint(g, shade);
}

function paint(g, shade) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = shade.r; col[i * 3 + 1] = shade.g; col[i * 3 + 2] = shade.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.index) g = g.toNonIndexed();
  return g;
}

function box(w, h, d, x, y, z, shade, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(_m.makeRotationY(ry));
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return paint(g, shade);
}

// low terracotta pitch running along the street
function pitchedRoof(w, d, rise, x, y, z, shade) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - 0.3, 0);
  s.lineTo(w / 2 + 0.3, 0);
  s.lineTo(0, rise);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d + 0.4, bevelEnabled: false });
  g.translate(x, y, z - d / 2 - 0.2);
  g.deleteAttribute('uv');
  return paint(g, shade);
}

// the classic inverted-cone Venetian chimney pot
function chimney(x, y, z, shade, out) {
  out.push(box(0.45, 1.1, 0.45, x, y + 0.55, z, shade));
  const pot = new THREE.CylinderGeometry(0.5, 0.18, 0.75, 8, 1, true);
  pot.translate(x, y + 1.45, z);
  pot.deleteAttribute('uv');
  out.push(paint(pot, shade));
}

export function buildCity(scene) {
  const facadeGeos = Array.from({ length: FACADE_STYLE_COUNT }, () => []);
  const trimGeos = [], roofGeos = [];
  const lanterns = []; // wall lantern positions for the caller to light

  const row = (frontX, facing) => {
    // facing = +1: front wall faces +x (left row); -1: faces -x (far bank)
    let z = 24;
    while (z > -450) {
      const d = rand(7, 12);
      const w = rand(9, 13);
      const floors = 3 + Math.floor(Math.random() * 4);
      const h = floors * 3 + rand(0.4, 0.9);
      const cz = z - d / 2;
      const fx = frontX + rand(-0.25, 0.25) * facing;
      const cx = fx - facing * w / 2;
      const style = Math.floor(Math.random() * FACADE_STYLE_COUNT);
      const k = rand(0.7, 1.05);
      const shade = new THREE.Color(k, k * rand(0.95, 1.02), k * rand(0.93, 1.03));
      const uOff = Math.floor(Math.random() * 4) * 0.25;
      const geos = facadeGeos[style];

      // front wall, then the two side walls (seen above shorter neighbours)
      _m.makeRotationY(facing * Math.PI / 2).setPosition(fx, 0, cz);
      geos.push(wall(d, h, uOff, _m, shade));
      _m.makeRotationY(0).setPosition(cx, 0, z);
      geos.push(wall(w, h, uOff + 0.5, _m, shade));
      _m.makeRotationY(Math.PI).setPosition(cx, 0, z - d);
      geos.push(wall(w, h, uOff + 0.25, _m, shade));

      const stone = new THREE.Color(0.55 * k, 0.52 * k, 0.48 * k);
      // cornice and the moulded band over the ground floor
      trimGeos.push(box(w + 0.2, 0.42, d + 0.25, cx + facing * 0.15, h - 0.1, cz, stone));
      trimGeos.push(box(w + 0.05, 0.12, d + 0.08, cx + facing * 0.06, h - 0.38, cz, stone));
      trimGeos.push(box(0.22, 0.16, d - 0.02, fx + facing * 0.08, 2.86, cz, stone));
      // balconies with a solid stone parapet on some upper floors
      if (floors > 3 && Math.random() < 0.6) {
        const by = 3 * (1 + Math.floor(Math.random() * (floors - 2)));
        const bl = Math.min(d - 1, rand(2, 4));
        const bz = cz + rand(-1, 1) * (d - bl) / 2;
        trimGeos.push(box(0.9, 0.14, bl, fx + facing * 0.45, by + 0.07, bz, stone));
        trimGeos.push(box(0.08, 0.85, bl, fx + facing * 0.86, by + 0.55, bz, stone));
      }

      const roofShade = new THREE.Color(0.32 * k, 0.15 * k, 0.1 * k);
      roofGeos.push(box(w, 0.1, d, cx, h, cz, roofShade));
      if (Math.random() < 0.65) roofGeos.push(pitchedRoof(w, d, rand(1.2, 2.2), cx, h + 0.1, cz, roofShade));
      const nc = Math.floor(rand(1, 3.5));
      for (let i = 0; i < nc; i++) {
        chimney(cx + rand(-w / 3, w / 3), h, cz + rand(-d / 3, d / 3), new THREE.Color(0.38 * k, 0.24 * k, 0.2 * k), roofGeos);
      }

      if (Math.random() < 0.5) lanterns.push(new THREE.Vector3(fx + facing * 0.45, 3.9, cz));
      z -= d;
    }
  };
  row(-12.4, 1);   // street side
  row(27.2, -1);   // across the canal

  for (let s = 0; s < FACADE_STYLE_COUNT; s++) {
    if (!facadeGeos[s].length) continue;
    const maps = facadeMaps(s);
    const mat = new THREE.MeshStandardMaterial({
      map: tex(maps.albedo, { srgb: true }),
      normalMap: tex(maps.normal),
      normalScale: new THREE.Vector2(1.4, 1.4),
      emissiveMap: tex(maps.emissive, { srgb: true }),
      emissive: 0xffffff,
      emissiveIntensity: 1.9,
      roughness: 0.88,
      vertexColors: true,
    });
    scene.add(new THREE.Mesh(mergeGeometries(facadeGeos[s]), mat));
  }
  scene.add(new THREE.Mesh(mergeGeometries(trimGeos),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
  scene.add(new THREE.Mesh(mergeGeometries(roofGeos),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide })));
  return { lanterns };
}
