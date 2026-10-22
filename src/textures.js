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

// ---------------------------------------------------------------------------
// Canal-house facades. One texture covers a module 8m wide x 21m tall
// (4 window bays x 7 floors of 3m) at 32 px/m; v = 0 is street level.
export const FACADE_W = 8, FACADE_H = 21;
const PPM = 32;

const FACADE_STYLES = [
  { plaster: [150, 92, 62], shutter: [52, 78, 58], arch: true },    // terracotta
  { plaster: [168, 132, 78], shutter: [70, 52, 36], arch: false },  // ochre
  { plaster: [146, 104, 104], shutter: [48, 66, 70], arch: true },  // faded rose
  { plaster: [112, 118, 104], shutter: [92, 56, 40], arch: false }, // lichen grey-green
  { plaster: [160, 150, 132], shutter: [44, 60, 52], arch: true },  // bone cream
  { plaster: [104, 72, 60], shutter: [60, 64, 72], arch: false },   // oxblood
];
export const FACADE_STYLE_COUNT = FACADE_STYLES.length;

export function facadeMaps(styleIndex) {
  const st = FACADE_STYLES[styleIndex % FACADE_STYLES.length];
  const W = FACADE_W * PPM, H = FACADE_H * PPM;
  const albedo = canvas(W, H), emissive = canvas(W, H);
  const a = albedo.getContext('2d'), e = emissive.getContext('2d');
  const height = new Float32Array(W * H).fill(0.5);
  const hRect = (x, y, w, h, v) => {
    for (let yy = Math.max(0, y | 0); yy < Math.min(H, y + h); yy++)
      for (let xx = Math.max(0, x | 0); xx < Math.min(W, x + w); xx++) height[yy * W + xx] = v;
  };
  const rgb = (c, k = 1) => `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;

  // --- plaster with mottling and rain streaks running down from the top
  const mott = makeFbm(4, 4), streak = makeNoise(64);
  const img = a.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = mott(x / W, y / H);
      const s = streak(x / 3, y / 90) * streak(x / 7 + 9, y / 40);
      const k = (0.62 + m * 0.5) * (1 - s * 0.45) * (0.85 + 0.15 * (y / H));
      const i = (y * W + x) * 4;
      img.data[i] = st.plaster[0] * k;
      img.data[i + 1] = st.plaster[1] * k;
      img.data[i + 2] = st.plaster[2] * k;
      img.data[i + 3] = 255;
      height[y * W + x] = 0.5 + m * 0.12;
    }
  }
  a.putImageData(img, 0, 0);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);

  // --- patches where the plaster fell away, showing brick
  for (let n = 0; n < 5; n++) {
    const cx = rand(0, W), cy = rand(H * 0.2, H), rw = rand(18, 50), rh = rand(12, 34);
    a.save();
    a.beginPath();
    a.ellipse(cx, cy, rw, rh, rand(0, 3), 0, Math.PI * 2);
    a.clip();
    a.fillStyle = '#2a1a14';
    a.fillRect(cx - rw, cy - rh, rw * 2, rh * 2);
    for (let by = Math.floor((cy - rh) / 5) * 5; by < cy + rh; by += 5) {
      const off = (by / 5) % 2 ? 6 : 0;
      for (let bx = Math.floor((cx - rw) / 12) * 12 - off; bx < cx + rw; bx += 12) {
        a.fillStyle = rgb([110, 52, 38], rand(0.6, 1.1));
        a.fillRect(bx + 1, by + 1, 10, 3.5);
        hRect(bx + 1, by + 1, 10, 3.5, 0.42);
      }
    }
    a.restore();
  }

  // --- rusticated ground floor: stone courses, arched doorways, shopfronts
  const gTop = H - 3 * PPM;
  a.fillStyle = 'rgba(30,26,24,0.55)';
  a.fillRect(0, gTop, W, 3 * PPM);
  for (let y = gTop + 12; y < H; y += 12) {
    a.fillStyle = 'rgba(0,0,0,0.5)';
    a.fillRect(0, y, W, 1.5);
    hRect(0, y, W, 2, 0.3);
  }
  for (let bay = 0; bay < 2; bay++) {
    const cx = bay * W / 2 + W / 4, ow = 2.0 * PPM, oh = 2.5 * PPM;
    const x0 = cx - ow / 2, y0 = H - oh;
    const lit = Math.random() < 0.45;
    const path = () => {
      a.beginPath();
      a.moveTo(x0, H);
      a.lineTo(x0, y0 + ow / 2);
      a.arc(cx, y0 + ow / 2, ow / 2, Math.PI, 0);
      a.lineTo(x0 + ow, H);
      a.closePath();
    };
    a.fillStyle = 'rgb(118,110,100)'; // stone surround
    a.save(); a.translate(cx, H); a.scale(1.12, 1.06); a.translate(-cx, -H); path(); a.fill(); a.restore();
    if (lit) {
      const g = a.createLinearGradient(0, y0, 0, H);
      g.addColorStop(0, '#ffcf8a'); g.addColorStop(1, '#a8582a');
      a.fillStyle = g; path(); a.fill();
      e.fillStyle = g;
      e.beginPath();
      e.moveTo(x0, H); e.lineTo(x0, y0 + ow / 2); e.arc(cx, y0 + ow / 2, ow / 2, Math.PI, 0); e.lineTo(x0 + ow, H);
      e.fill();
      // shop mullions
      a.fillStyle = e.fillStyle = '#1a120c';
      for (let k = 1; k < 3; k++) { a.fillRect(x0 + k * ow / 3 - 1, y0, 2.5, oh); e.fillRect(x0 + k * ow / 3 - 1, y0, 2.5, oh); }
    } else {
      // rusted roller shutter
      a.fillStyle = '#2b2622'; path(); a.fill();
      for (let y = y0 + ow / 2; y < H; y += 3) { a.fillStyle = 'rgba(120,70,40,0.35)'; a.fillRect(x0, y, ow, 1); }
    }
    hRect(x0, y0, ow, oh, 0.05);
  }
  // string course above the ground floor
  a.fillStyle = 'rgb(130,122,110)';
  a.fillRect(0, gTop - 6, W, 6);
  hRect(0, gTop - 6, W, 6, 0.95);

  // --- upper floors: four bays of windows per floor
  for (let f = 1; f < 7; f++) {
    const floorBase = H - f * 3 * PPM - 3 * PPM; // top of this floor (canvas y)
    for (let c = 0; c < 4; c++) {
      const cx = (c + 0.5) * W / 4;
      const ww = 0.95 * PPM, wh = 1.65 * PPM;
      const x0 = cx - ww / 2, y0 = floorBase + 3 * PPM - 0.9 * PPM - wh;
      const r = Math.random();
      const state = r < 0.24 ? 'lit' : r < 0.29 ? 'tv' : r < 0.42 ? 'shut' : 'dark';
      const winPath = (ctx, inset = 0) => {
        ctx.beginPath();
        if (st.arch) {
          const rr = ww / 2 - inset;
          ctx.moveTo(x0 + inset, y0 + wh - inset);
          ctx.lineTo(x0 + inset, y0 + rr + inset);
          // pointed Venetian arch
          ctx.quadraticCurveTo(x0 + inset, y0 + inset, cx, y0 - rr * 0.35 + inset);
          ctx.quadraticCurveTo(x0 + ww - inset, y0 + inset, x0 + ww - inset, y0 + rr + inset);
          ctx.lineTo(x0 + ww - inset, y0 + wh - inset);
        } else {
          ctx.rect(x0 + inset, y0 + inset, ww - inset * 2, wh - inset * 2);
        }
        ctx.closePath();
      };
      // stone surround + sill
      a.fillStyle = 'rgb(150,142,128)';
      a.save(); a.translate(cx, y0 + wh / 2); a.scale(1.25, 1.12); a.translate(-cx, -(y0 + wh / 2)); winPath(a); a.fill(); a.restore();
      a.fillStyle = 'rgb(160,152,138)';
      a.fillRect(x0 - 5, y0 + wh, ww + 10, 5);
      hRect(x0 - 5, y0 + wh, ww + 10, 5, 1);
      a.fillStyle = 'rgba(0,0,0,0.35)'; // drip stain under the sill
      a.fillRect(x0, y0 + wh + 5, ww, rand(10, 30));
      hRect(x0 - 3, y0 - 6, ww + 6, wh + 6, 0.8);
      hRect(x0 + 2, y0 + 2, ww - 4, wh - 4, 0.02);

      if (state === 'lit' || state === 'tv') {
        const g = a.createLinearGradient(0, y0, 0, y0 + wh);
        if (state === 'lit') {
          const warm = Math.random() < 0.5;
          g.addColorStop(0, warm ? '#ffd890' : '#ffe8b8');
          g.addColorStop(1, warm ? '#c06428' : '#b07a40');
        } else {
          g.addColorStop(0, '#9ec8ff'); g.addColorStop(1, '#3050a0');
        }
        for (const ctx of [a, e]) {
          ctx.fillStyle = g; winPath(ctx, 2); ctx.fill();
          // curtains drawn half across, mullion cross
          ctx.fillStyle = 'rgba(60,24,14,0.85)';
          const cw = rand(4, ww * 0.35);
          ctx.fillRect(x0 + 2, y0, cw, wh);
          ctx.fillRect(x0 + ww - 2 - cw * rand(0.4, 1), y0, cw, wh);
          ctx.fillStyle = '#20160e';
          ctx.fillRect(cx - 1, y0, 2, wh);
          ctx.fillRect(x0, y0 + wh * 0.42, ww, 2);
          // sometimes a silhouette is standing in the window
          if (Math.random() < 0.15) {
            ctx.fillStyle = '#120a06';
            ctx.beginPath(); ctx.arc(cx + 3, y0 + wh * 0.45, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(cx - 3, y0 + wh * 0.52, 12, wh * 0.5);
          }
        }
      } else if (state === 'dark') {
        const g = a.createLinearGradient(0, y0, 0, y0 + wh);
        g.addColorStop(0, '#2a3446'); g.addColorStop(1, '#07090e');
        a.fillStyle = g; winPath(a, 2); a.fill();
        a.fillStyle = '#05060a';
        a.fillRect(cx - 1, y0, 2, wh);
        a.fillRect(x0, y0 + wh * 0.42, ww, 2);
      }
      // shutters: flanking open, or closed over the window
      if (state === 'shut' || Math.random() < 0.55) {
        const sw = ww / 2;
        const panels = state === 'shut' ? [[x0, sw], [cx, sw]] : [[x0 - sw - 3, sw], [x0 + ww + 3, sw]];
        for (const [sx, w] of panels) {
          a.fillStyle = rgb(st.shutter, rand(0.6, 1));
          a.fillRect(sx, y0, w, wh);
          for (let y = y0 + 3; y < y0 + wh - 2; y += 3) {
            a.fillStyle = 'rgba(0,0,0,0.35)';
            a.fillRect(sx + 2, y, w - 4, 1);
            hRect(sx + 2, y, w - 4, 1, 0.55);
          }
          hRect(sx, y0, w, 2, 0.75);
        }
      }
    }
    // faint floor band
    a.fillStyle = 'rgba(0,0,0,0.12)';
    a.fillRect(0, floorBase + 3 * PPM - 3, W, 3);
  }

  return { albedo, emissive, normal: normalCanvas(height, W, H, 3) };
}
