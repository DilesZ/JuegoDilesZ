globalThis.self = globalThis; // polyfill Node para GLTFLoader
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';

async function load(f) {
  const buf = readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}
// héroe
const hero = await load('/home/z/my-project/public/assets/models/readyplayer.me.glb');
let skin = null;
hero.scene.traverse(o => { if (o.isSkinnedMesh && !skin) skin = o; });
const heroBones = skin ? skin.skeleton.bones.map(b => b.name) : [];
console.log('HERO huesos(', heroBones.length, '):', heroBones.slice(0, 16).join(', '));
// clips RPM
const walk = await load('/home/z/my-project/public/assets/models/rpm-anims/M_Walk_001.glb');
const trackNames = [...new Set(walk.animations[0].tracks.map(t => t.name.replace(/\.(quaternion|position|scale)$/, '')))];
console.log('\nRPM Walk huesos animados(', trackNames.length, '):', trackNames.slice(0, 16).join(', '));
const missing = trackNames.filter(n => !heroBones.includes(n));
console.log('faltantes en héroe:', missing.length ? missing.join(',') : 'NINGUNO — match total');
// monstruos con polyfill
for (const f of ['Orc', 'Tribal', 'Demon', 'Ghost_Skull']) {
  try {
    const g = await load(`/home/z/my-project/public/assets/models/monsters/${f}.gltf`);
    let sk = null; g.scene.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
    const bb = new THREE.Box3().setFromObject(g.scene);
    const names = g.animations.map(a => a.name);
    console.log(`\n${f}: h=${(bb.max.y - bb.min.y).toFixed(2)} clips=${names.join('|')}`);
    if (sk) console.log('  huesos:', sk.skeleton.bones.slice(0, 10).map(b => b.name).join(','));
  } catch (e) { console.log(`${f} ERROR ${e.message}`); }
}
