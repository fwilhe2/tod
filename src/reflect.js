import * as THREE from 'three';

// Planar mirror for the ground plane y = 0, rendered once per frame at reduced
// resolution. The wet street and the canal both sample it through `matrix`,
// which maps a world position straight to projective reflection UVs.
// (Adapted from three's Reflector, but world-space and driven explicitly.)
export const NO_REFLECT_LAYER = 1; // things on this layer never show up in puddles

export function createMirror(renderer, scale = 0.5) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(scale);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera();
  cam.layers.disable(NO_REFLECT_LAYER);
  const matrix = new THREE.Matrix4();
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const bias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );

  return {
    texture: target.texture,
    matrix,
    resize() {
      renderer.getDrawingBufferSize(size).multiplyScalar(scale);
      target.setSize(size.x, size.y);
    },
    render(scene, camera, hide) {
      camPos.setFromMatrixPosition(camera.matrixWorld);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      // mirror eye and gaze across y = 0
      cam.position.set(camPos.x, -camPos.y, camPos.z);
      cam.up.set(0, 1, 0).applyMatrix4(rot);
      cam.up.y = -cam.up.y;
      cam.lookAt(look.x, -look.y, look.z);
      cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);
      matrix.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

      // oblique near plane: clip away everything below the water line
      plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = cam.projectionMatrix.elements;
      q.set(
        (Math.sign(clip.x) + e[8]) / e[0],
        (Math.sign(clip.y) + e[9]) / e[5],
        -1,
        (1 + e[10]) / e[14]
      );
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;

      for (const o of hide) o.visible = false;
      const prevTarget = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadow;
      for (const o of hide) o.visible = true;
    },
  };
}

// GLSL chunk shared by the street and the canal: a few jittered taps of the
// mirror, spread wider on rough ground so cobbles blur the image.
export const REFLECT_GLSL = /* glsl */`
  uniform sampler2D tReflect;
  uniform mat4 reflMatrix;
  vec3 sampleReflection(vec3 worldPos, vec2 offset, float spread) {
    vec4 p = reflMatrix * vec4(worldPos.x, 0.0, worldPos.z, 1.0);
    vec2 uv = p.xy / p.w + offset;
    vec3 acc = texture2D(tReflect, uv).rgb * 0.4;
    acc += texture2D(tReflect, uv + vec2(spread, spread * 0.4)).rgb * 0.15;
    acc += texture2D(tReflect, uv + vec2(-spread, -spread * 0.4)).rgb * 0.15;
    acc += texture2D(tReflect, uv + vec2(spread * 0.3, -spread * 1.8)).rgb * 0.15;
    acc += texture2D(tReflect, uv + vec2(-spread * 0.3, spread * 1.8)).rgb * 0.15;
    return acc;
  }
`;
