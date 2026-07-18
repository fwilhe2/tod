import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Sfx } from './audio.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 1.6, 0);

const world = buildWorld(scene);
const sfx = new Sfx();
const game = new Game(scene, camera, sfx);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state !== 'pause') {
    game.update(dt);
    world.update(dt, camera.position);
  }
  renderer.render(scene, camera);
});
