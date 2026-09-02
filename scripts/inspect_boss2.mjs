/* Inspección de GLTF: clips y duraciones (para elegir el 2º jefe) */
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const base = 'public/assets/models/monsters';
const files = ['Dragon.gltf', 'Yeti.gltf', 'Wizard.gltf', 'MushroomKing.gltf', 'BlueDemon.gltf', 'Ghost.gltf', 'Ninja.gltf'];

const loader = new GLTFLoader();
for (const f of files) {
  const buf = readFileSync(`${base}/${f}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const gltf = await new Promise((res, rej) => loader.parse(ab, pathToFileURL(`${base}/${f}`).href, res, rej));
    let skin = null;
    gltf.scene.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const h = (bbox.max.y - bbox.min.y).toFixed(2);
    const bones = skin ? skin.skeleton.bones.length : 0;
    const anims = gltf.animations.map(a => `${a.name}(${a.duration.toFixed(2)}s)`);
    console.log(`\n=== ${f} === altura:${h} huesos:${bones}`);
    console.log('  clips:', anims.join(' | '));
  } catch (e) {
    console.log(`\n=== ${f} === ERROR: ${e.message ?? e}`);
  }
}
