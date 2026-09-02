/* Inspección offline de GLB/gltf: huesos, clips y tamaño */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const base = '/home/z/my-project/public/assets';
const files = [
  `${base}/models/rpm-anims/M_Standing_Idle_001.glb`,
  `${base}/models/rpm-anims/M_Walk_001.glb`,
  `${base}/models/monsters/Orc.gltf`,
  `${base}/models/monsters/Tribal.gltf`,
  `${base}/models/monsters/Demon.gltf`,
  `${base}/models/monsters/Ghost_Skull.gltf`,
];

// GLTFLoader con FileManager-like API: usamos parse con ArrayBuffer
const loader = new GLTFLoader();
for (const f of files) {
  const buf = readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
    const scene = gltf.scene;
    let skin = null;
    scene.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
    const bbox = new THREE.Box3().setFromObject(scene);
    const h = (bbox.max.y - bbox.min.y).toFixed(2);
    const bones = skin ? skin.skeleton.bones.map(b => b.name) : [];
    const anims = gltf.animations.map(a => `${a.name}(${a.duration.toFixed(2)}s/${a.tracks.length}t)`);
    const trackSample = gltf.animations[0]?.tracks.slice(0, 3).map(t => t.name) ?? [];
    console.log(`\n=== ${f.split('/').pop()} === altura:${h} meshes:${(gltf.scene.getObjectByProperty('isMesh', true) ? 'si' : 'no')}`);
    console.log(' huesos:', bones.length ? bones.slice(0, 12).join(',') + (bones.length > 12 ? ` +${bones.length - 12}` : '') : 'SIN SKIN');
    console.log(' clips:', anims.join(' | '));
    console.log(' tracks[0..2]:', trackSample.join(' | '));
  } catch (e) {
    console.log(`\n=== ${f} === ERROR: ${e.message ?? e}`);
  }
}
