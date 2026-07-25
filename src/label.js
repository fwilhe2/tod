import * as THREE from 'three';

// Shared by both ghoul implementations (procedural and glTF-skinned): the
// floating word sprite, and the soft radial glow used for eyes and steam.

export const GLOW_TEX = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

// Successive zombies cycle through these label heights so words on
// overlapping zombies don't cover each other.
const LABEL_HEIGHTS = [2.9, 3.6, 4.3];
let labelSlot = 0;

const FONT = 'bold 58px "Courier New", monospace';

export class WordLabel {
  constructor(word) {
    this.word = word;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.font = FONT;
    const w = Math.ceil(this.ctx.measureText(word).width) + 36;
    this.canvas.width = w;
    this.canvas.height = 84;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false })
    );
    this.sprite.position.set(0, LABEL_HEIGHTS[labelSlot++ % LABEL_HEIGHTS.length], 0);
    this.sprite.renderOrder = 10;
    this.baseW = w / 90;
  }

  draw(progress, targeted, special = null) {
    const c = this.ctx, cv = this.canvas;
    c.clearRect(0, 0, cv.width, cv.height);
    c.font = FONT;
    c.textBaseline = 'middle';
    // backdrop
    c.fillStyle = targeted ? 'rgba(10,14,8,0.96)' : 'rgba(4,6,12,0.88)';
    c.fillRect(0, 8, cv.width, 68);
    if (targeted) {
      c.strokeStyle = 'rgba(255,212,121,0.9)';
      c.lineWidth = 3;
      c.strokeRect(1, 9, cv.width - 3, 66);
    }
    if (!targeted && special === 'coffee') {
      c.strokeStyle = 'rgba(255,190,60,0.75)'; // the barista's label glints amber
      c.lineWidth = 3;
      c.strokeRect(1, 9, cv.width - 3, 66);
    }
    const done = this.word.slice(0, progress);
    const todo = this.word.slice(progress);
    let x = 18;
    c.shadowColor = 'rgba(255,190,80,0.9)';
    c.shadowBlur = targeted ? 12 : 0;
    c.fillStyle = '#ffd479';
    c.fillText(done, x, 44);
    x += c.measureText(done).width;
    c.shadowBlur = 0;
    c.fillStyle = targeted ? '#ffffff' : '#c9d4c9';
    c.fillText(todo, x, 44);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
