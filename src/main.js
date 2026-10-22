import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Gun } from './gun.js';
import { Sfx } from './audio.js';
import { createPost } from './post.js';
import { NO_REFLECT_LAYER } from './reflect.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 1.6, 0);
scene.add(camera); // the gun rides on the camera

// the agent's shoulder lamp: lights the faces of whatever is coming and
// sweeps a cold glint across the puddles
const shoulderLamp = new THREE.SpotLight(0xe0e2f0, 32, 42, 0.5, 0.9, 1.4);
shoulderLamp.position.set(0.45, 0.3, 0.1);
shoulderLamp.target.position.set(-0.3, -1.3, -12);
camera.add(shoulderLamp, shoulderLamp.target);

const sfx = new Sfx();
const world = buildWorld(scene, sfx, renderer);
const gun = new Gun(camera);
// the first-person gun lives on its own layer so puddles don't reflect it
camera.layers.enable(NO_REFLECT_LAYER);
gun.group.traverse((o) => { if (o.isMesh) o.layers.set(NO_REFLECT_LAYER); });
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
  world.mirror.resize();
});

const timer = new THREE.Timer();
let frames = 0;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const rawDt = Math.min(timer.getDelta(), 0.05);
  if (game.state !== 'pause') {
    const dt = game.advance(rawDt); // bullet-time may dilate the frame
    world.update(dt, camera.position);
  }
  // (skip the mirror until the shadow maps exist, or it samples empty ones)
  if (frames++ > 0) world.renderReflection(camera);
  post.render(rawDt, timer.getElapsed());
});
