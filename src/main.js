import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Gun } from './gun.js';
import { Sfx } from './audio.js';
import { createPost } from './post.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 1.6, 0);
scene.add(camera); // the gun rides on the camera

const sfx = new Sfx();
const world = buildWorld(scene, sfx);
const gun = new Gun(camera);
const game = new Game(scene, camera, sfx, gun);
game.world = world;
if (new URLSearchParams(location.search).has('debug')) window.game = game;

// glow pipeline: muzzle flashes, tracers, eyes, lamps, lightning all bloom,
// then a film-stock grade pass on top
const post = createPost(renderer, scene, camera);
game.post = post;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.resize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const rawDt = Math.min(timer.getDelta(), 0.05);
  if (game.state !== 'pause') {
    const dt = game.advance(rawDt); // bullet-time may dilate the frame
    world.update(dt, camera.position);
  }
  post.render(rawDt, timer.getElapsed());
});
