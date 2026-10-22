import * as THREE from 'three';
import { createSky } from './sky.js';
import { buildCity } from './city.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cobbleMaps, puddleMap, tex } from './textures.js';
import { createMirror, REFLECT_GLSL, NO_REFLECT_LAYER } from './reflect.js';

function rand(a, b) { return a + Math.random() * (b - a); }

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

// Patch a standard material so it can sample the ground mirror; `frag`
// edits the fragment shader, `extra` adds uniforms.
function wetSurface(mat, mirror, frag, extra = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tReflect = { value: mirror.texture };
    shader.uniforms.reflMatrix = { value: mirror.matrix };
    Object.assign(shader.uniforms, extra);
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader = 'varying vec3 vWPos;\n'
      + Object.keys(extra).map((k) => `uniform float ${k};\n`).join('')
      + REFLECT_GLSL + frag(shader.fragmentShader);
  };
}

// Per-district atmospheres, crossfaded during the advance between waves.
const MOODS = [
  { fog: 0.016, bg: 0x0a0e18, hemi: 1.3, moonC: 0xdfe8ff, rain: 0.32, flickerAll: 0, bolt: [7, 18], cloud: 0.46 },   // 1: the quiet quay
  { fog: 0.030, bg: 0x0c1420, hemi: 1.1, moonC: 0xcfd8ea, rain: 0.26, flickerAll: 0, bolt: [9, 20], cloud: 0.38 },   // 2: the drowned mist
  { fog: 0.020, bg: 0x05070d, hemi: 0.55, moonC: 0x8f98b8, rain: 0.34, flickerAll: 1, bolt: [8, 16], cloud: 0.3 },  // 3: the blackout
  { fog: 0.018, bg: 0x140b10, hemi: 1.0, moonC: 0xff7a5a, rain: 0.4, flickerAll: 0, bolt: [7, 15], cloud: 0.52 },    // 4: the blood moon
  { fog: 0.021, bg: 0x0b1020, hemi: 1.2, moonC: 0xdfe8ff, rain: 0.6, flickerAll: 0, bolt: [2.5, 6], cloud: 0.22 },   // 5: the storm
  { fog: 0.024, bg: 0x081209, hemi: 0.95, moonC: 0xbfe8c8, rain: 0.3, flickerAll: 0.5, bolt: [6, 12], cloud: 0.34 }, // boss: the counting house
];

export function buildWorld(scene, sfx, renderer) {
  const BG_FLASH = new THREE.Color(0x3a4a72);
  scene.fog = new THREE.FogExp2(0x0a0e18, 0.016);

  // current & target mood, lerped in update()
  const cur = {
    fog: 0.016, hemi: 1.3, rain: 0.32, flickerAll: 0, cloud: 0.46,
    bg: new THREE.Color(0x0a0e18), moonC: new THREE.Color(0xdfe8ff),
  };
  let mood = MOODS[0];

  // lights
  const hemi = new THREE.HemisphereLight(0x3d4a70, 0x141824, 1.3);
  scene.add(hemi);
  // moon and lightning both cast shadows from a box that rides with the camera
  const shadowed = (light) => {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    const c = light.shadow.camera;
    c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 1; c.far = 160;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.04;
    scene.add(light.target);
    return light;
  };
  const MOON_DIR = new THREE.Vector3(-30, 60, -40).normalize();
  const moonlight = shadowed(new THREE.DirectionalLight(0x9fb4ff, 1.3));
  scene.add(moonlight);
  const lamp = new THREE.PointLight(0xffb45e, 80, 60, 1.8); // follows camera
  scene.add(lamp);
  // lightning strobe
  const bolt = shadowed(new THREE.DirectionalLight(0xcdd8ff, 0));
  const boltDir = new THREE.Vector3(20, 80, -60).normalize();
  scene.add(bolt);

  // wet cobbled street: PBR setts, glossy puddles that mirror the scene
  const mirror = createMirror(renderer);
  const cobble = cobbleMaps();
  const puddles = tex(puddleMap(), { repeat: [2, 25] });
  const streetMat = new THREE.MeshStandardMaterial({
    map: tex(cobble.albedo, { srgb: true, repeat: [12, 250] }),
    normalMap: tex(cobble.normal, { repeat: [12, 250] }),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: puddles,
    roughness: 1,
    metalness: 0,
  });
  wetSurface(streetMat, mirror, (s) => s.replace(
    '#include <roughnessmap_fragment>',
    `#include <roughnessmap_fragment>
     float wet = 1.0 - smoothstep(0.08, 0.55, roughnessFactor);
     diffuseColor.rgb *= mix(1.0, 0.4, wet); // standing water darkens the stone`
  ).replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>
     normal = normalize(mix(normal, normalize(vNormal), wet * 0.92)); // puddles are flat`
  ).replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
     {
       vec3 V = normalize(cameraPosition - vWPos);
       float F = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
       vec2 bump = mapN.xy;
       vec3 refl = sampleReflection(vWPos, bump * mix(0.03, 0.003, wet), mix(0.01, 0.0012, wet));
       totalEmissiveRadiance += refl * mix(0.1, 0.9, wet) * mix(0.3, 1.0, F);
     }`
  ));
  const street = new THREE.Mesh(new THREE.PlaneGeometry(24, 500), streetMat);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, 0, -200);
  street.receiveShadow = true;
  scene.add(street);

  // canal (right side): black water mirroring the far bank, rippled by waves
  const waterGeo = new THREE.PlaneGeometry(14, 500, 12, 160);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x03070d, roughness: 0.12, metalness: 0 });
  const waterTime = { value: 0 };
  wetSurface(waterMat, mirror, (s) => s.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
     {
       vec3 V = normalize(cameraPosition - vWPos);
       float F = 0.06 + 0.94 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
       vec2 w = vec2(
         sin(vWPos.z * 1.7 + waterTime * 1.9) * 0.6 + sin(vWPos.x * 2.9 - vWPos.z * 0.8 + waterTime * 2.6) * 0.4,
         sin(vWPos.z * 2.3 - waterTime * 1.4) * 0.5 + sin(vWPos.x * 1.9 + waterTime * 1.1) * 0.5);
       vec3 refl = sampleReflection(vWPos, w * 0.008, 0.002);
       totalEmissiveRadiance += refl * mix(0.45, 1.0, F) * vec3(0.8, 0.9, 1.0);
     }`
  ), { waterTime });
  const water = new THREE.Mesh(waterGeo, waterMat);
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

  // canal houses on both banks
  const city = buildCity(scene);

  // cast-iron lampposts along the quay and lanterns bracketed to the
  // houses opposite, all with flickering halos
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.7 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2.2) });
  const lampGlowTex = glowTexture('rgba(255,205,130,0.9)', 'rgba(255,160,60,0.25)');
  const lampGlows = [];
  const ironGeos = [], bulbGeos = [];
  const put = (list, g, x, y, z) => { g.translate(x, y, z); list.push(g); };
  const addLight = (pos, size) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lampGlowTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.5,
    }));
    halo.position.copy(pos);
    halo.scale.setScalar(size);
    scene.add(halo);
    lampGlows.push({ halo, pos, phase: rand(0, 20), rnd: Math.random(), k: 1 });
  };
  for (let z = 0; z > -440; z -= 22) {
    const x = 11.5;
    put(ironGeos, new THREE.CylinderGeometry(0.22, 0.3, 0.5, 8), x, 0.25, z);  // plinth
    put(ironGeos, new THREE.CylinderGeometry(0.06, 0.1, 3.5, 8), x, 2.1, z);   // fluted pole
    put(ironGeos, new THREE.TorusGeometry(0.12, 0.025, 6, 12), x, 3.2, z);    // collar
    put(ironGeos, new THREE.CylinderGeometry(0.05, 0.2, 0.25, 4), x, 3.95, z); // lantern cage
    put(ironGeos, new THREE.ConeGeometry(0.3, 0.32, 4), x, 4.42, z);          // hood
    put(bulbGeos, new THREE.CylinderGeometry(0.17, 0.12, 0.38, 4), x, 4.07, z);
    addLight(new THREE.Vector3(x, 4.05, z), 2.8);
  }
  for (const p of city.lanterns) {
    const s = Math.sign(p.x) || 1; // bracket juts out from the wall
    put(ironGeos, new THREE.BoxGeometry(0.6, 0.05, 0.05), p.x - s * 0.15, p.y + 0.42, p.z);
    put(ironGeos, new THREE.ConeGeometry(0.2, 0.22, 4), p.x + s * 0.12, p.y + 0.3, p.z);
    put(bulbGeos, new THREE.CylinderGeometry(0.12, 0.09, 0.3, 4), p.x + s * 0.12, p.y, p.z);
    addLight(new THREE.Vector3(p.x + s * 0.12, p.y, p.z), 2.2);
  }
  scene.add(new THREE.Mesh(mergeGeometries(ironGeos.map((g) => g.toNonIndexed())), ironMat));
  scene.add(new THREE.Mesh(mergeGeometries(bulbGeos.map((g) => g.toNonIndexed())), bulbMat));

  // a small pool of real point lights hops between the lamps nearest the
  // camera, so lamplight actually pools on the cobbles and facades
  const lightPool = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffa955, 0, 15, 1.7);
    scene.add(l);
    lightPool.push(l);
  }

  // sky dome: gradient, stars, cratered moon, drifting storm clouds
  const sky = createSky(scene);
  const ZENITH = new THREE.Color();

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
  rain.layers.set(NO_REFLECT_LAYER);
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
  emberPts.layers.set(NO_REFLECT_LAYER);
  scene.add(emberPts);

  // ---- lightning state ----
  let strike = 0;              // 1 → 0 while a flash decays
  let nextStrike = rand(6, 14);

  let t = 0;
  return {
    mirror,
    renderReflection(camera) {
      mirror.render(scene, camera, [street, water]);
    },
    setMood(i) {
      mood = MOODS[Math.min(i, MOODS.length - 1)];
    },
    update(dt, camPos) {
      t += dt;
      waterTime.value = t;
      lamp.position.set(camPos.x + 2, 4.2, camPos.z - 8);
      // keep both shadow boxes centred on the fight ahead of the camera
      moonlight.target.position.set(camPos.x, 0, camPos.z - 14);
      moonlight.position.copy(moonlight.target.position).addScaledVector(MOON_DIR, 80);
      bolt.target.position.copy(moonlight.target.position);
      bolt.position.copy(bolt.target.position).addScaledVector(boltDir, 80);

      // crossfade the district atmosphere
      const mk = 1 - Math.exp(-dt * 0.8);
      cur.fog += (mood.fog - cur.fog) * mk;
      cur.hemi += (mood.hemi - cur.hemi) * mk;
      cur.rain += (mood.rain - cur.rain) * mk;
      cur.flickerAll += (mood.flickerAll - cur.flickerAll) * mk;
      cur.cloud += (mood.cloud - cur.cloud) * mk;
      cur.bg.lerp(new THREE.Color(mood.bg), mk);
      cur.moonC.lerp(new THREE.Color(mood.moonC), mk);
      scene.fog.density = cur.fog;
      hemi.intensity = cur.hemi;
      rain.material.opacity = cur.rain;
      moonlight.color.copy(cur.moonC);
      sky.dome.position.copy(camPos);
      sky.uniforms.time.value = t;
      sky.uniforms.cover.value = cur.cloud;
      sky.uniforms.moonColor.value.copy(cur.moonC);

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

      // lamp flicker — in the blackout district, every lamp is dying
      for (const lg of lampGlows) {
        const n = Math.sin(t * 9 + lg.phase) * Math.sin(t * 23 + lg.phase * 2);
        lg.halo.material.opacity = (lg.rnd < Math.max(0.25, cur.flickerAll))
          ? Math.max(0.05, 0.4 + n * 0.42)
          : 0.5 + n * 0.06;
        lg.k = lg.halo.material.opacity / 0.5;
      }
      // hand the pooled lights to the nearest lamps ahead of the camera
      const near = lampGlows
        .filter((lg) => lg.pos.z < camPos.z + 4 && lg.pos.z > camPos.z - 60)
        .sort((a, b) => a.pos.distanceToSquared(camPos) - b.pos.distanceToSquared(camPos));
      for (let i = 0; i < lightPool.length; i++) {
        const l = lightPool[i], lg = near[i];
        if (!lg) { l.intensity = 0; continue; }
        l.position.copy(lg.pos);
        l.intensity = 34 * lg.k;
      }

      // lightning
      nextStrike -= dt;
      if (nextStrike <= 0) {
        strike = 1;
        nextStrike = rand(mood.bolt[0], mood.bolt[1]);
        boltDir.set(rand(-60, 60), 80, -rand(30, 90)).normalize();
        if (sfx) setTimeout(() => sfx.thunder(), rand(350, 1400));
      }
      if (strike > 0) {
        strike = Math.max(0, strike - dt * 2.1);
        // double-pulse flicker
        const k = strike * (0.55 + 0.45 * Math.sin(strike * 34));
        bolt.intensity = k * 4.5;
        scene.fog.color.lerpColors(cur.bg, BG_FLASH, k * 0.55);
        sky.uniforms.flash.value = k;
      } else {
        bolt.intensity = 0;
        scene.fog.color.copy(cur.bg);
        sky.uniforms.flash.value = 0;
      }
      sky.uniforms.horizon.value.copy(scene.fog.color);
      sky.uniforms.zenith.value.copy(ZENITH.copy(cur.bg).multiplyScalar(0.25));
    },
  };
}
