import * as THREE from 'three';

// Procedural texture kit: everything is painted into canvases at startup,
// so the game still ships without a single image asset.

export function rand(a, b) { return a + Math.random() * (b - a); }

function canvas(w, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

// Tileable value noise: lattice wraps at `period`, so textures repeat seamlessly.
export function makeNoise(period, seed = Math.random() * 1000) {
  const lat = new Float32Array(period * period);
  let s = Math.floor(seed * 9301) % 233280;
  for (let i = 0; i < lat.length; i++) { s = (s * 9301 + 49297) % 233280; lat[i] = s / 233280; }
  const at = (x, y) => lat[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// fbm over a tileable noise; (x, y) in 0..1 texture space
export function makeFbm(basePeriod, octaves = 4, seed) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(basePeriod << o, seed !== undefined ? seed + o * 17 : undefined));
  return (x, y) => {
    let v = 0, a = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = basePeriod << o;
      v += a * layers[o](x * p, y * p);
      norm += a;
      a *= 0.5;
    }
    return v / norm;
  };
}

// separable wrap-around box blur on a single-channel float buffer
function blur(buf, w, h, r) {
  const tmp = new Float32Array(buf.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += buf[y * w + ((k + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += buf[y * w + ((x + r + 1) % w)] - buf[y * w + ((x - r + w) % w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      buf[y * w + x] = acc / n;
      acc += tmp[((y + r + 1) % h) * w + x] - tmp[((y - r + h) % h) * w + x];
    }
  }
}

// height buffer → tangent-space normal map canvas (wraps at the edges)
export function normalCanvas(height, w, h, strength = 2) {
  const cv = canvas(w, h);
  const c = cv.getContext('2d');
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)], r = height[y * w + ((x + 1) % w)];
      const u = height[((y - 1 + h) % h) * w + x], d = height[((y + 1) % h) * w + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export function tex(cv, { srgb = false, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// ---------------------------------------------------------------------------
// Cobbled setts: staggered rows of rounded stones, grimy mortar, moss.
// One tile covers 2m x 2m. Returns albedo + normal canvases.
export function cobbleMaps(S = 512) {
  const height = new Float32Array(S * S);
  const tone = new Float32Array(S * S);  // per-stone tint
  const stoneId = new Float32Array(S * S);
  const ROWS = 10, rowH = S / ROWS;
  let id = 1;
  for (let r = 0; r < ROWS; r++) {
    let x = rand(0, 60);
    const start = x;
    while (x < start + S - 30) {
      let w = rand(38, 70);
      if (x + w > start + S - 20) w = start + S - x; // close the row so it wraps
      const t = rand(0.5, 1.05);
      // uneven gaps on every side so the stones don't read as bricks
      const y0 = r * rowH + rand(2.5, 6), y1 = (r + 1) * rowH - rand(2.5, 6);
      const x0 = x + rand(2.5, 6), x1 = x + w - rand(2.5, 6);
      const sid = id++;
      const cr = rand(8, 16); // corner radius
      for (let py = Math.floor(y0); py < y1; py++) {
        for (let px = Math.floor(x0); px < x1; px++) {
          // rounded-rect test
          const dx = Math.max(x0 + cr - px, 0, px - (x1 - cr));
          const dy = Math.max(y0 + cr - py, 0, py - (y1 - cr));
          if (dx * dx + dy * dy > cr * cr) continue;
          const wx = ((px % S) + S) % S;
          const i = py * S + wx;
          height[i] = 1;
          tone[i] = t;
          stoneId[i] = sid;
        }
      }
      x += w;
    }
  }
  const domed = height.slice();
  blur(domed, S, S, 5);
  blur(domed, S, S, 3);

  const grain = makeFbm(16, 4);
  const blotch = makeFbm(4, 3);
  const albedo = canvas(S);
  const c = albedo.getContext('2d');
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const g = grain(x / S, y / S), b = blotch(x / S, y / S);
      let R, G, B;
      if (height[i] > 0) {
        // granite: warm grey with speckle, worn darker toward the edges
        const k = tone[i] * (0.7 + g * 0.5) * (0.5 + domed[i] * 0.5);
        const hue = (stoneId[i] * 0.618) % 1; // some stones bluish basalt, some brown
        R = (72 + hue * 14) * k; G = 70 * k; B = (78 - hue * 16) * k;
        if (Math.random() < 0.04) { R *= 1.35; G *= 1.35; B *= 1.35; } // mica glints
      } else {
        // mortar gaps: black mud, green moss in patches
        const moss = Math.max(0, b - 0.55) * 3;
        R = 26 + moss * 18; G = 24 + moss * 40; B = 20 + moss * 8;
      }
      const grime = 0.75 + b * 0.35;
      img.data[i * 4] = Math.min(255, R * grime);
      img.data[i * 4 + 1] = Math.min(255, G * grime);
      img.data[i * 4 + 2] = Math.min(255, B * grime);
      img.data[i * 4 + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);

  // fine surface pitting on top of the domes for the normal map
  for (let i = 0; i < domed.length; i++) {
    const x = i % S, y = (i / S) | 0;
    domed[i] = domed[i] * 6 + grain(x / S * 2, y / S * 2) * 0.8;
  }
  return { albedo, normal: normalCanvas(domed, S, S, 1.2) };
}

// Large-scale wetness: puddles in the dips (glossy), damp everywhere else.
// Stored as roughness in G (three reads roughness from the green channel).
export function puddleMap(S = 512) {
  const f = makeFbm(3, 5);
  const fine = makeFbm(24, 2);
  const cv = canvas(S);
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = f(x / S, y / S);
      const puddle = Math.min(1, Math.max(0, (n - 0.545) / 0.06));
      const rough = 0.62 + fine(x / S, y / S) * 0.3;
      const v = (rough * (1 - puddle) + 0.04 * puddle) * 255;
      const i = (y * S + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}
