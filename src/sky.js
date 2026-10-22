import * as THREE from 'three';

// Procedural night sky on a camera-centred dome: gradient that melts into the
// fog colour at the horizon, hashed twinkling stars, a cratered moon with a
// halo, and fbm storm clouds that drift across it, catch silver moonlight on
// their edges and light up from inside when lightning strikes.
const vert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const frag = /* glsl */`
  uniform vec3 horizon, zenith, moonColor, moonDir;
  uniform float time, flash, cover;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, h));

    // stars: one candidate per cell on a lat/long grid, twinkling
    vec2 sp = vec2(atan(dir.z, dir.x) * 140.0, asin(clamp(h, -1.0, 1.0)) * 140.0);
    vec2 cell = floor(sp);
    float sh = hash(cell);
    if (sh > 0.975) {
      vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.3)) * 0.6 + 0.2;
      float d = length(fract(sp) - off);
      float tw = 0.6 + 0.4 * sin(time * (2.0 + sh * 9.0) + sh * 60.0);
      col += vec3(0.75, 0.82, 1.0) * smoothstep(0.16, 0.0, d) * tw * (sh - 0.975) * 60.0 * smoothstep(0.0, 0.25, h);
    }

    // moon disc with maria and craters, plus a two-stage halo
    float md = dot(dir, moonDir);
    float R = 0.042;
    vec3 mt = normalize(cross(moonDir, vec3(0, 1, 0)));
    vec3 mb = cross(mt, moonDir);
    vec2 mp = vec2(dot(dir, mt), dot(dir, mb)) / R; // -1..1 across the disc
    float disc = smoothstep(1.0, 0.96, length(mp)) * step(0.0, md);
    float maria = fbm(mp * 1.6 + 3.0);
    float craters = fbm(mp * 6.0 + 11.0);
    float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
    vec3 moon = moonColor * (2.6 - smoothstep(0.45, 0.7, maria) * 1.1 - craters * 0.6) * (0.55 + 0.45 * limb);
    float halo = pow(max(md, 0.0), 900.0) * 0.9 + pow(max(md, 0.0), 60.0) * 0.18;
    col += moonColor * halo;

    // clouds: fbm on a plane above, perspective-squashed toward the horizon
    vec2 cuv = dir.xz / (h + 0.18) * 0.9 + vec2(time * 0.012, time * 0.02);
    float n = fbm(cuv);
    float n2 = fbm(cuv * 2.3 - time * 0.015);
    float dens = smoothstep(cover, cover + 0.3, n * 0.75 + n2 * 0.35) * smoothstep(-0.02, 0.12, h);
    // silver lining: thin edges near the moon glow
    float lit = pow(max(md, 0.0), 14.0);
    vec3 cloudCol = horizon * 0.9 + zenith * 0.3
                  + moonColor * (0.08 + lit * 0.9 * (1.0 - dens))
                  + vec3(0.55, 0.62, 0.95) * flash * (0.5 + n2);
    col = mix(col + moon * disc, cloudCol, dens * 0.92);
    // whole sky flickers with the strike
    col += vec3(0.18, 0.22, 0.38) * flash * smoothstep(-0.1, 0.4, h);

    // melt into fog at and below the horizon
    col = mix(col, horizon, smoothstep(0.08, -0.04, h));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSky(scene) {
  const uniforms = {
    horizon: { value: new THREE.Color(0x0a0e18) },
    zenith: { value: new THREE.Color(0x020308) },
    moonColor: { value: new THREE.Color(0xdfe8ff) },
    moonDir: { value: new THREE.Vector3(-45, 63, -260).normalize() },
    time: { value: 0 },
    flash: { value: 0 },
    cover: { value: 0.42 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);
  return { dome, uniforms };
}
