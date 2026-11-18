import * as THREE from 'three';
import { NO_REFLECT_LAYER } from './reflect.js';

const LABEL_FONT = 'bold 56px "Courier New", ui-monospace, monospace';

// Floating word tag: a dark glass pill with the word, typed letters burning
// amber. Shared by ghouls, power-up canisters and boss projectiles.
// accent: border colour for untargeted tags that need to stand out.
export class WordLabel {
  constructor(word, accent = null) {
    this.accent = accent;
    this.danger = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // dimmed below the bloom threshold so the words stay crisp; only the
    // typed letters (drawn hotter) are allowed to glow
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthTest: false, color: 0xb8b8b8,
    }));
    this.sprite.renderOrder = 10;
    this.sprite.layers.set(NO_REFLECT_LAYER); // no mirrored words in the puddles
    this.setWord(word);
  }

  setWord(word) {
    this.word = word;
    this.ctx.font = LABEL_FONT;
    const w = Math.ceil(this.ctx.measureText(word).width) + 48;
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      this.canvas.height = 96;
      // a resized canvas needs a fresh GPU texture
      this.tex.dispose();
    }
    this.baseW = w / 90;
    this.draw(0, false);
  }

  draw(progress, targeted) {
    const c = this.ctx, cv = this.canvas;
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const x0 = 4, y0 = 10, bw = W - 8, bh = 64, r = 16;
    const pill = () => { c.beginPath(); c.roundRect(x0, y0, bw, bh, r); };
    const g = c.createLinearGradient(0, y0, 0, y0 + bh);
    const hot = this.danger && !targeted;
    g.addColorStop(0, targeted ? 'rgba(28,20,8,0.92)' : hot ? 'rgba(40,6,6,0.9)' : 'rgba(12,14,20,0.78)');
    g.addColorStop(1, targeted ? 'rgba(10,6,2,0.95)' : hot ? 'rgba(18,2,2,0.92)' : 'rgba(4,5,9,0.86)');
    c.fillStyle = g;
    pill();
    c.fill();
    c.lineWidth = targeted || hot || this.accent ? 3 : 2;
    c.strokeStyle = targeted ? 'rgba(255,196,96,0.95)'
      : hot ? 'rgba(255,70,60,0.95)'
      : this.accent ?? 'rgba(160,176,200,0.35)';
    pill();
    c.stroke();
    if (targeted) {
      // pointer down to whatever it belongs to
      c.fillStyle = 'rgba(255,196,96,0.95)';
      c.beginPath();
      c.moveTo(W / 2 - 9, y0 + bh + 1); c.lineTo(W / 2 + 9, y0 + bh + 1); c.lineTo(W / 2, y0 + bh + 13);
      c.fill();
    }

    c.font = LABEL_FONT;
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    const done = this.word.slice(0, progress);
    const todo = this.word.slice(progress);
    const ty = y0 + bh / 2 + 3;
    let x = 24;
    c.shadowColor = 'rgba(255,170,60,1)';
    c.shadowBlur = 14;
    c.fillStyle = '#ffd890';
    c.fillText(done, x, ty);
    x += c.measureText(done).width;
    c.shadowBlur = 0;
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(todo, x, ty);
    c.fillStyle = targeted ? '#ffffff' : '#dfe4ea';
    c.fillText(todo, x, ty);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
