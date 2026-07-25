// Offline converter: Quaternius' Zombie.fbx -> public/models/zombie.glb
//
//   node tools/fbx2glb.mjs path/to/Zombie.fbx public/models/zombie.glb
//
// Quaternius ships the Animated Zombie Pack as FBX/OBJ/Blend only, and glTF is
// what we actually want to load at runtime (smaller, and GLTFLoader is a
// fraction of FBXLoader's weight). three.js can do the conversion by itself, so
// there is no Blender/FBX2glTF dependency.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter reaches for the browser's FileReader to serialise the .glb blob.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((ab) => {
      this.result = ab;
      this.onloadend?.();
    });
  }
};

const [, , fbxPath, outPath = 'public/models/zombie.glb'] = process.argv;
if (!fbxPath) {
  console.error('usage: node tools/fbx2glb.mjs <Zombie.fbx> [out.glb]');
  process.exit(1);
}

const buf = readFileSync(fbxPath);
const group = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ''
);

// glTF is PBR-only and the FBX arrives with a textureless Phong material. The
// game re-materialises the mesh at runtime anyway (per-corpse skin tint), so
// swapping in a plain standard material costs nothing.
group.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
});

const glb = await new GLTFExporter().parseAsync(group, {
  binary: true,
  animations: group.animations,
});
writeFileSync(outPath, Buffer.from(glb));
console.log(
  `wrote ${outPath} (${(glb.byteLength / 1024).toFixed(0)} KB)\n` +
  `clips: ${group.animations.map((a) => a.name).join(', ')}`
);
