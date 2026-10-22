import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final "film stock" pass, applied after tone mapping in display space:
// barrel lens distortion, chromatic fringing toward the edges, a cold-shadow /
// warm-highlight split tone, animated grain, a soft vignette, and a pulse of
// red desaturation whenever the player takes a hit.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    hurt: { value: 0 },     // 1 → 0 after taking damage
    punch: { value: 0 },    // 1 → 0 after a kill: extra fringe + lens bulge
    lowHP: { value: 0 },    // 0..1 persistent danger tint
    tSplat: { value: null }, // blood on the lens (alpha = coverage)
    splat: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tSplat;
    uniform float time, hurt, punch, lowHP, splat;
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // subtle barrel distortion, bulging on kill punches
      vec2 uv = 0.5 + c * (1.0 - (0.035 + punch * 0.05) * r2 * 4.0);

      // chromatic aberration grows toward the frame edge
      float ca = (0.0012 + hurt * 0.012 + punch * 0.006) * (0.3 + r2 * 3.0);
      vec2 dir = normalize(c + 1e-5) * ca;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // blood on the lens: refracts what's behind it, thick red where it pools
      if (splat > 0.001) {
        float a = texture2D(tSplat, vUv).a * splat;
        if (a > 0.002) {
          vec2 e = vec2(0.004, 0.0);
          vec2 grad = vec2(texture2D(tSplat, vUv + e.xy).a - texture2D(tSplat, vUv - e.xy).a,
                           texture2D(tSplat, vUv + e.yx).a - texture2D(tSplat, vUv - e.yx).a);
          vec3 under = texture2D(tDiffuse, uv - grad * 0.06).rgb;
          vec3 blood = under * vec3(0.5, 0.05, 0.04) + vec3(0.09, 0.0, 0.0) + vec3(0.6, 0.2, 0.15) * max(0.0, grad.x + grad.y) * 2.0;
          col = mix(col, blood, clamp(a * 1.4, 0.0, 0.95));
        }
      }

      // split tone: teal shadows, sodium-amber highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.86, 0.98, 1.12);
      vec3 highTint = vec3(1.08, 1.0, 0.88);
      col *= mix(shadowTint, highTint, smoothstep(0.05, 0.6, l));
      // gentle S-curve for contrast
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);

      // damage: drain colour, flood red from the edges
      float edge = smoothstep(0.08, 0.45, r2 * 2.0);
      float danger = clamp(hurt + lowHP * (0.35 + 0.15 * sin(time * 5.0)), 0.0, 1.0);
      col = mix(col, vec3(l * 1.1, l * 0.25, l * 0.2), hurt * 0.55);
      col = mix(col, vec3(0.45, 0.0, 0.02), edge * danger * 0.75);

      // vignette
      col *= 1.0 - smoothstep(0.18, 0.75, r2 * 1.6) * 0.62;

      // animated film grain, stronger in the shadows
      float g = hash(vUv * resolution + fract(time * 13.7) * 100.0) - 0.5;
      col += g * mix(0.075, 0.03, l);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// Paint a fresh set of blood splats onto a canvas used as a lens overlay.
// 'hurt' smears big blobs and drips in from the edges; 'spatter' is a fine
// mist of droplets from a kill at point-blank range.
function paintSplat(c, S, kind) {
  c.clearRect(0, 0, S, S);
  c.fillStyle = '#fff';
  c.shadowColor = '#fff';
  c.shadowBlur = 6; // soft, wet edges
  // organic blob: a cluster of overlapping circles
  const blob = (x, y, r) => {
    c.beginPath();
    c.arc(x, y, r * 0.7, 0, Math.PI * 2);
    for (let i = 0; i < 6 && r > 4; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.25 + Math.random() * 0.35);
      c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
      c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.3 + Math.random() * 0.35), 0, Math.PI * 2);
    }
    c.fill();
  };
  if (kind === 'hurt') {
    for (let k = 0; k < 6; k++) {
      // hug the frame edges, leave the middle clear enough to keep typing
      const side = Math.floor(Math.random() * 4);
      const t = Math.random() * S;
      const [x, y] = [[t, Math.random() * S * 0.12], [t, S - Math.random() * S * 0.15], [Math.random() * S * 0.12, t], [S - Math.random() * S * 0.12, t]][side];
      const r = S * (0.05 + Math.random() * 0.08);
      c.globalAlpha = 0.85;
      blob(x, y, r);
      for (let d = 0; d < 18; d++) {
        const a = Math.random() * Math.PI * 2, rr = r * (1.2 + Math.random() * 1.8);
        blob(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 1 + Math.random() * r * 0.12);
      }
      // drips run down the glass (canvas y grows downward = screen bottom)
      for (let d = 0; d < 3; d++) {
        const dx = x + (Math.random() - 0.5) * r, w = 1.5 + Math.random() * 2.5, len = r * (0.8 + Math.random() * 2.5);
        c.fillRect(dx - w / 2, y, w, len);
        c.beginPath(); c.arc(dx, y + len, w * 0.9, 0, Math.PI * 2); c.fill();
      }
    }
  } else {
    c.globalAlpha = 0.7;
    for (let d = 0; d < 90; d++) {
      const x = Math.random() * S, y = Math.random() * S;
      const edge = Math.max(Math.abs(x / S - 0.5), Math.abs(y / S - 0.5)) * 2;
      if (Math.random() > edge * 1.3) continue; // fewer drops in the middle
      blob(x, y, 1 + Math.random() * 5);
    }
  }
  c.globalAlpha = 1;
  c.shadowBlur = 0;
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // half-float + MSAA target: the composer otherwise drops the canvas antialiasing
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.55, 0.62
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const u = grade.uniforms;
  u.resolution.value.copy(size);
  const splatCanvas = document.createElement('canvas');
  splatCanvas.width = splatCanvas.height = 512;
  const splatCtx = splatCanvas.getContext('2d');
  const splatTex = new THREE.CanvasTexture(splatCanvas);
  u.tSplat.value = splatTex;

  return {
    composer,
    hurt: 0,
    punch: 0,
    lowHP: 0,
    splatK: 0,
    splat(kind = 'hurt') {
      paintSplat(splatCtx, 512, kind);
      splatTex.needsUpdate = true;
      this.splatK = kind === 'hurt' ? 1 : 0.8;
    },
    resize(w, h) {
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
      renderer.getDrawingBufferSize(u.resolution.value);
    },
    render(dt, time) {
      this.hurt *= Math.exp(-dt * 2.8);
      this.punch *= Math.exp(-dt * 7);
      this.splatK = Math.max(0, this.splatK - dt * 0.35);
      u.splat.value = Math.min(1, this.splatK * 1.5);
      u.time.value = time;
      u.hurt.value = this.hurt;
      u.punch.value = this.punch;
      u.lowHP.value += (this.lowHP - u.lowHP.value) * Math.min(1, dt * 3);
      composer.render(dt);
    },
  };
}
