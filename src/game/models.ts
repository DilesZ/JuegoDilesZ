import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  barkMaps, metalMaps, stoneMaps, woodMaps, grassBladeTexture,
  toonRamp3, toonRamp4,
} from './textures';

/* ============================================================
   MODELOS PROCEDURALES — ESTILO ANIME
   - Materiales TOON (cel shading por rampa de bandas).
   - Contornos de tinta (inverted hull) para personajes y props.
   - Humanoides con rasgos anime: ojos grandes, pelo, orejas, colmillos.
   ============================================================ */

export type ToonMat = THREE.MeshToonMaterial;
export type CharMat = THREE.MeshStandardMaterial | THREE.MeshToonMaterial;

/** Material toon con rampa compartida */
export function toonMat(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp3(),
    ...opts,
  });
}

/* ---------- Registro de viento y llamas (animados por World) ---------- */

interface WindEntry { mat: THREE.Material; amp: number }
const windMats: WindEntry[] = [];
const flameMats: THREE.ShaderMaterial[] = [];
const _time = { value: 0 };

export function registerWind(mat: THREE.Material, amp: number, anchor: 'top' | 'bottom' = 'top') {
  if (windMats.some(w => w.mat === mat)) return;
  windMats.push({ mat, amp });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _time;
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float wx = 0.0, wz = 0.0;
          #ifdef USE_INSTANCING
            wx = instanceMatrix[3][0]; wz = instanceMatrix[3][2];
          #endif
          float swayF = pow(${anchor === 'top' ? 'max(uv.y, 0.0)' : 'max(1.0 - uv.y, 0.0)'}, 1.5);
          float sway = sin(uTime * 1.6 + wx * 0.35 + wz * 0.5) + 0.45 * sin(uTime * 2.9 + wx * 1.4 + wz * 0.8);
          transformed.x += sway * uAmp * swayF;
          transformed.z += sway * uAmp * 0.6 * swayF;
        }`);
  };
  mat.customProgramCacheKey = () => `wind_${amp}_${anchor}`;
}

export function updateWindAndFlames(t: number) {
  _time.value = t;
  for (const m of flameMats) m.uniforms.uTime.value = t;
}

/** Material de llama procedural (plano con forma de fuego animado) */
export function makeFlameMaterial(core: number, outer: number, scaleY = 1): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uOuter: { value: new THREE.Color(outer) },
      uScaleY: { value: scaleY },
    },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uCore; uniform vec3 uOuter; uniform float uScaleY;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 uv = vUv; uv.y *= uScaleY;
        float t = uTime;
        // ondulación horizontal creciente con la altura
        float wob = (noise(vec2(uv.y*3.0 - t*2.4, t*0.8)) - 0.5) * 0.34 * uv.y;
        float x = uv.x - 0.5 + wob;
        // silueta de llama: ancho decreciente hacia arriba
        float width = mix(0.42, 0.02, pow(uv.y, 0.72));
        float body = 1.0 - smoothstep(width*0.15, width, abs(x));
        // flicker vertical
        float flick = 0.82 + 0.18 * noise(vec2(t*3.1, uv.y*2.0));
        body *= flick * smoothstep(0.0, 0.10, uv.y) * (1.0 - smoothstep(0.72, 1.0, uv.y + abs(x)*0.8));
        if (body <= 0.004) discard;
        float core = smoothstep(0.12, 0.75, body) * (1.0 - uv.y*0.55);
        vec3 col = mix(uOuter, uCore, clamp(core, 0.0, 1.0));
        col *= 1.35 + 0.65 * body;
        gl_FragColor = vec4(col, body);
      }`,
  });
  flameMats.push(mat);
  return mat;
}

/** Geometría de llama: dos planos cruzados */
export function flameGeometry(w: number, h: number): THREE.BufferGeometry {
  const p1 = new THREE.PlaneGeometry(w, h);
  p1.translate(0, h / 2, 0);
  const p2 = new THREE.PlaneGeometry(w, h);
  p2.translate(0, h / 2, 0);
  p2.rotateY(Math.PI / 2);
  return mergeGeometries([p1, p2])!;
}

/* ---------- Materiales compartidos texturizados ---------- */

let _bark: THREE.MeshToonMaterial | null = null;
export function barkMat(): THREE.MeshToonMaterial {
  if (!_bark) {
    const { map } = barkMaps();
    _bark = toonMat(0xffffff, { map });
  }
  return _bark;
}

let _stone: THREE.MeshToonMaterial | null = null;
export function stoneMat(): THREE.MeshToonMaterial {
  if (!_stone) {
    const { map } = stoneMaps();
    _stone = toonMat(0xffffff, { map });
  }
  return _stone;
}

let _wood: THREE.MeshToonMaterial | null = null;
export function woodMat(): THREE.MeshToonMaterial {
  if (!_wood) {
    const { map } = woodMaps();
    _wood = toonMat(0xffffff, { map });
  }
  return _wood;
}

export function forgedMat(color = 0xdfe8f4): THREE.MeshToonMaterial {
  const { map } = metalMaps();
  return toonMat(color, { map });
}

/* ---------- Materiales básicos (compat API) ---------- */

export function stdMat(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}) {
  return toonMat(color, opts);
}
export function metalMat(color: number) {
  return toonMat(color);
}
export function emisMat(color: number, intensity = 1.6) {
  return new THREE.MeshToonMaterial({
    color, emissive: color, emissiveIntensity: intensity, gradientMap: toonRamp3(),
  });
}

/* ---------- Contornos de tinta (inverted hull) ---------- */

let _outlineMat: THREE.MeshBasicMaterial | null = null;
function outlineMat(): THREE.MeshBasicMaterial {
  if (!_outlineMat) {
    _outlineMat = new THREE.MeshBasicMaterial({ color: 0x191322, side: THREE.BackSide });
  }
  return _outlineMat;
}

/** Clona una geometría desplazando cada vértice a lo largo de su normal */
function expandGeometry(geo: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  const g = geo.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | null;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor ? nor.getX(i) : 0, ny = nor ? nor.getY(i) : 1, nz = nor ? nor.getZ(i) : 0;
    pos.setXYZ(i, pos.getX(i) + nx * t, pos.getY(i) + ny * t, pos.getZ(i) + nz * t);
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * Añade contornos de tinta estilo anime a todos los meshes de un grupo.
 * Omite materiales transparentes, aditivos, basic (ojos/glow) y emisivos.
 */
export function addOutlines(root: THREE.Object3D, thickness = 0.025) {
  const targets: THREE.Mesh[] = [];
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material & { transparent?: boolean; emissiveIntensity?: number };
    if (!m || Array.isArray(m)) return;
    if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) return;
    if (m.transparent) return;
    if (typeof m.emissiveIntensity === 'number' && m.emissiveIntensity > 0.01) return;
    if (o.userData.noOutline) return;
    targets.push(o);
  });
  for (const mesh of targets) {
    const out = new THREE.Mesh(expandGeometry(mesh.geometry, thickness), outlineMat());
    out.castShadow = false;
    out.receiveShadow = false;
    out.renderOrder = mesh.renderOrder;
    mesh.add(out); // hereda transformación (sigue animaciones)
  }
}

/** Añade rim light (fresnel) a un material toon/estándar */
export function addRim(mat: THREE.MeshStandardMaterial | THREE.MeshToonMaterial, color: number, strength = 0.35, power = 3.2) {
  const c = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: c };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), uRimPower);
          totalEmissiveRadiance += uRimColor * rimF * uRimStrength;
        }`);
  };
  mat.customProgramCacheKey = () => `rim_${color}_${strength}_${power}`;
  return mat;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}

/* ---------- Armas ---------- */

/** Hoja de sección romboidal (más creíble que una caja) */
function bladeGeo(len: number, wBase: number, tipFrac = 0.22): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(wBase * 0.22, wBase, len * (1 - tipFrac), 4, 1);
  g.translate(0, len * (1 - tipFrac) / 2, 0);
  const tip = new THREE.ConeGeometry(wBase * 0.22, len * tipFrac, 4);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, len * (1 - tipFrac) + (len * tipFrac) / 2, 0);
  const merged = mergeGeometries([g.toNonIndexed(), tip.toNonIndexed()])!;
  merged.rotateY(Math.PI / 4);
  merged.scale(1, 1, 0.42);
  merged.computeVertexNormals();
  return merged;
}

export function buildSword(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const steel = forgedMat(0xcdd6e2);
  const gold = forgedMat(0xc7a24a);
  const blade = mesh(bladeGeo(0.85 * scale, 0.05 * scale), steel, 0, 0.1 * scale, 0);
  // ranura luminosa (runa encendida)
  const rune = mesh(new THREE.BoxGeometry(0.012 * scale, 0.5 * scale, 0.024 * scale),
    emisMat(0x54e0ff, 1.5), 0, 0.5 * scale, 0, false);
  const guard = mesh(new THREE.TorusGeometry(0.085 * scale, 0.02 * scale, 6, 12, Math.PI), gold, 0, 0.1 * scale, 0);
  guard.rotation.z = Math.PI;
  const grip = mesh(new THREE.CylinderGeometry(0.026 * scale, 0.03 * scale, 0.2 * scale, 8), woodMat(), 0, -0.02 * scale, 0);
  const pommel = mesh(new THREE.OctahedronGeometry(0.045 * scale, 0), gold, 0, -0.14 * scale, 0);
  g.add(blade, rune, guard, grip, pommel);
  return g;
}

export function buildGreatsword(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const dark = forgedMat(0x4a4a58);
  const blade = mesh(bladeGeo(1.62 * scale, 0.15 * scale, 0.16), dark, 0, 0.12 * scale, 0);
  // grietas incandescentes
  const crackMat = emisMat(0xff3a1a, 1.8);
  for (let i = 0; i < 3; i++) {
    const crack = mesh(new THREE.BoxGeometry(0.016 * scale, 0.3 * scale - i * 0.04 * scale, 0.05 * scale),
      crackMat, 0, (0.45 + i * 0.35) * scale, 0, false);
    crack.rotation.z = (i - 1) * 0.18;
    g.add(crack);
  }
  // púas del lomo
  for (let i = 0; i < 3; i++) {
    const spike = mesh(new THREE.ConeGeometry(0.03 * scale, 0.12 * scale, 4), dark,
      0.07 * scale, (0.35 + i * 0.4) * scale, 0);
    spike.rotation.z = -1.9;
    g.add(spike);
  }
  const guard = mesh(new THREE.BoxGeometry(0.44 * scale, 0.07 * scale, 0.1 * scale), forgedMat(0x2a2a34), 0, 0.1 * scale, 0);
  const grip = mesh(new THREE.CylinderGeometry(0.04 * scale, 0.05 * scale, 0.34 * scale, 8), woodMat(), 0, -0.1 * scale, 0);
  const skull = mesh(new THREE.IcosahedronGeometry(0.075 * scale, 0), emisMat(0xff2a1a, 1.6), 0, -0.3 * scale, 0);
  g.add(blade, guard, grip, skull);
  return g;
}

export function buildClub(): THREE.Group {
  const g = new THREE.Group();
  const stick = mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.75, 8), barkMat(), 0, 0.3, 0);
  const head = mesh(new THREE.DodecahedronGeometry(0.17, 0), woodMat(), 0, 0.72, 0);
  const spike = mesh(new THREE.ConeGeometry(0.05, 0.15, 4), forgedMat(0x8a8a94), 0, 0.88, 0);
  g.add(stick, head, spike);
  return g;
}

export function buildAxe(): THREE.Group {
  const g = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.15, 8), woodMat(), 0, 0.45, 0);
  // hoja: media luna con forma de cuña
  const headGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 3);
  const head = mesh(headGeo, forgedMat(0x9aa2ae), 0.13, 0.95, 0);
  head.rotation.x = Math.PI / 2;
  head.rotation.z = Math.PI;
  const edge = mesh(new THREE.TorusGeometry(0.3, 0.022, 5, 10, Math.PI * 0.8), forgedMat(0xd8dee8), 0.13, 0.95, 0);
  edge.rotation.x = Math.PI / 2;
  edge.rotation.z = Math.PI * 0.62;
  g.add(handle, head, edge);
  return g;
}

export function buildBow(): THREE.Group {
  const g = new THREE.Group();
  const arc = mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 14, Math.PI * 1.15), woodMat(), 0, 0.35, 0);
  arc.rotation.z = Math.PI * 0.42;
  const strMat = new THREE.LineBasicMaterial({ color: 0xd8d3c0 });
  const pts = [new THREE.Vector3(-0.38, 0.05, 0), new THREE.Vector3(0.06, 0.35, 0), new THREE.Vector3(-0.38, 0.65, 0)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strMat);
  g.add(arc, line);
  return g;
}

export function buildShield(): THREE.Group {
  const g = new THREE.Group();
  const face = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.045, 14), forgedMat(0xaeb9c9), 0, 0, 0);
  face.rotation.x = Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(0.3, 0.028, 6, 16), forgedMat(0xd8b34a), 0, 0, 0);
  const boss0 = mesh(new THREE.SphereGeometry(0.075, 8, 6), forgedMat(0xd8b34a), 0, 0, 0.035);
  const sigil = mesh(new THREE.TorusGeometry(0.14, 0.014, 5, 12), emisMat(0x54e0ff, 0.9), 0, 0, 0.03, false);
  g.add(face, rim, boss0, sigil);
  return g;
}

export function buildArrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5), woodMat(), 0, 0, 0, false);
  shaft.rotation.x = Math.PI / 2;
  const tip = mesh(new THREE.ConeGeometry(0.045, 0.14, 4), forgedMat(0xcdd6e2), 0, 0, 0.4, false);
  tip.rotation.x = Math.PI / 2;
  g.add(shaft, tip);
  return g;
}

/* ---------- Humanoide paramétrico ---------- */

export interface HumanoidOpts {
  scale?: number;
  skin: number;
  torso: number;
  legs: number;
  arms?: number;
  /** color del iris; con eyeStyle 'anime' pinta ojo blanco + iris + brillo */
  eyes?: number | null;
  eyeStyle?: 'glow' | 'anime';
  eyeIntensity?: number;
  weapon?: 'sword' | 'greatsword' | 'club' | 'axe' | 'bow' | 'none';
  shield?: boolean;
  helmet?: 'none' | 'knight' | 'horns' | 'hood';
  helmetColor?: number;
  shoulder?: number | null;
  chest?: number | null;
  cape?: number | null;
  capeTattered?: boolean;
  rim?: { color: number; strength: number };
  bigHead?: boolean;
  hunched?: boolean;
  /** color del pelo puntiagudo (anime); null = sin pelo */
  hair?: number | null;
  /** orejas largas laterales (goblin/orco) */
  ears?: boolean;
  /** colmillos pequeños hacia arriba */
  tusks?: boolean;
  /** grosor del contorno de tinta; 0/udefinido = sin contorno */
  outline?: number;
}

export interface HumanoidRig {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handR: THREE.Group;
  handL: THREE.Group;
  weapon: THREE.Group | null;
  weaponMat: CharMat | null;
  height: number;
}

export function buildHumanoid(o: HumanoidOpts): HumanoidRig {
  const s = o.scale ?? 1;
  const root = new THREE.Group();

  const mkBody = (color: number) => {
    const m = toonMat(color, { gradientMap: toonRamp4() });
    if (o.rim) addRim(m, o.rim.color, o.rim.strength);
    return m;
  };
  const skin = mkBody(o.skin);
  const torsoMat = mkBody(o.torso);
  const legMat = mkBody(o.legs);
  const armMat = mkBody(o.arms ?? o.skin);

  const legLen = 0.52, torsoH = 0.55, headR = o.bigHead ? 0.21 : 0.155;

  const body = new THREE.Group();
  body.position.y = legLen;
  root.add(body);

  const pelvis = mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), legMat, 0, 0.04, 0);
  body.add(pelvis);

  const torso = new THREE.Group();
  body.add(torso);
  const chest = mesh(new THREE.BoxGeometry(0.34, torsoH, 0.22), torsoMat, 0, torsoH / 2, 0);
  torso.add(chest);
  if (o.chest !== null && o.chest !== undefined) {
    torso.add(mesh(new THREE.BoxGeometry(0.37, torsoH * 0.55, 0.25), forgedMat(o.chest), 0, torsoH * 0.62, 0));
  }
  if (o.hunched) torso.rotation.x = 0.35;

  // Capa
  if (o.cape !== null && o.cape !== undefined) {
    const capeGroup = new THREE.Group();
    capeGroup.position.set(0, torsoH * 0.9, -0.15);
    capeGroup.rotation.x = 0.14;
    capeGroup.rotation.y = Math.PI;
    const geo = new THREE.PlaneGeometry(0.5, 0.68, 4, 6);
    geo.translate(0, -0.34, 0);
    if (o.capeTattered) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < -0.3) {
          pos.setY(i, pos.getY(i) - Math.random() * 0.1);
          pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.06);
        }
      }
      geo.computeVertexNormals();
    }
    const capeMat = stdMat(o.cape, { side: THREE.DoubleSide });
    registerWind(capeMat, 0.05);
    const cape = new THREE.Mesh(geo, capeMat);
    cape.castShadow = true;
    cape.userData.noOutline = true; // plano sin volumen: el hull invertido fallaría
    capeGroup.add(cape);
    torso.add(capeGroup);
  }

  // Cabeza
  const head = new THREE.Group();
  head.position.y = torsoH + 0.06;
  torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(headR, 14, 12), skin, 0, headR * 0.8, 0));

  // --- RASGOS ANIME (ojos grandes, boca, orejas, colmillos, pelo) ---
  const faceMat = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  if (o.eyes !== null && o.eyes !== undefined && (o.eyeStyle ?? 'glow') === 'anime') {
    // esclerótica blanca aplastada + iris de color + brillo blanco
    const scleraR = headR * 0.24;
    const irisR = headR * 0.13;
    for (const side of [-1, 1]) {
      const s = mesh(new THREE.SphereGeometry(scleraR, 10, 8), faceMat(0xffffff),
        side * headR * 0.44, headR * 0.86, headR * 0.72, false);
      s.scale.set(0.85, 1.25, 0.5);
      head.add(s);
      const iris = mesh(new THREE.SphereGeometry(irisR, 10, 8), faceMat(o.eyes),
        side * headR * 0.46, headR * 0.86, headR * 0.86, false);
      iris.scale.set(0.9, 1.25, 0.5);
      head.add(iris);
      const pupil = mesh(new THREE.SphereGeometry(irisR * 0.5, 8, 6), faceMat(0x241a2e),
        side * headR * 0.47, headR * 0.84, headR * 0.95, false);
      pupil.scale.set(1, 1.3, 0.5);
      head.add(pupil);
      const glint = mesh(new THREE.SphereGeometry(irisR * 0.34, 6, 5), faceMat(0xffffff),
        side * headR * 0.5, headR * 0.97, headR * 0.98, false);
      head.add(glint);
    }
    // boca pequeña
    const mouth = mesh(new THREE.SphereGeometry(headR * 0.1, 8, 6), faceMat(0x8a4a44),
      0, headR * 0.42, headR * 0.92, false);
    mouth.scale.set(1.25, 0.55, 0.4);
    head.add(mouth);
  } else if (o.eyes !== null && o.eyes !== undefined) {
    const eyeMat = emisMat(o.eyes, o.eyeIntensity ?? 2.2);
    const eL = mesh(new THREE.SphereGeometry(0.028, 6, 5), eyeMat, -0.06, headR * 0.85, headR * 0.78, false);
    const eR = mesh(new THREE.SphereGeometry(0.028, 6, 5), eyeMat, 0.06, headR * 0.85, headR * 0.78, false);
    head.add(eL, eR);
  }
  // orejas largas laterales (elfo/goblin)
  if (o.ears) {
    const earGeo = new THREE.ConeGeometry(headR * 0.17, headR * 0.72, 5);
    for (const side of [-1, 1]) {
      const e = mesh(earGeo, skin, side * headR * 0.92, headR * 0.95, -0.01);
      e.rotation.z = side * -Math.PI * 0.46;
      e.rotation.x = -0.15;
      head.add(e);
    }
  }
  // colmillos
  if (o.tusks) {
    const tuskGeo = new THREE.ConeGeometry(headR * 0.09, headR * 0.34, 5);
    const tuskMat = faceMat(0xfff6e2);
    for (const side of [-1, 1]) {
      const t = mesh(tuskGeo, tuskMat, side * headR * 0.3, headR * 0.42, headR * 0.82, false);
      t.rotation.z = side * 0.22;
      head.add(t);
    }
  }
  // pelo puntiagudo anime (las puntas sobresalen claramente del cráneo)
  if (o.hair) {
    const hairMat = toonMat(o.hair, { gradientMap: toonRamp4() });
    const spikes: [number, number, number, number, number][] = [
      // [x, y, z, tiltZ, tiltX]
      [0, headR * 1.62, -0.02, 0, 0.05],
      [-headR * 0.62, headR * 1.48, 0.02, 0.5, 0.08],
      [headR * 0.62, headR * 1.48, 0.02, -0.5, 0.08],
      [-headR * 1.02, headR * 1.18, -0.06, 1.0, 0.05],
      [headR * 1.02, headR * 1.18, -0.06, -1.0, 0.05],
      [-headR * 0.34, headR * 1.5, -headR * 0.5, 0.2, -0.7],
      [headR * 0.34, headR * 1.5, -headR * 0.5, -0.2, -0.7],
      [0, headR * 1.42, headR * 0.62, 0, -0.95],
    ];
    for (const [x, y, z, tz, tx] of spikes) {
      const spike = mesh(new THREE.ConeGeometry(headR * 0.32, headR * 1.15, 5), hairMat, x, y, z);
      spike.rotation.z = tz;
      spike.rotation.x = tx;
      head.add(spike);
    }
  }
  if (o.helmet === 'knight') {
    const hm = forgedMat(o.helmetColor ?? 0xaeb9c9);
    // diadema abierta (cara visible estilo anime) + penacho
    const band = mesh(new THREE.TorusGeometry(headR * 0.98, headR * 0.1, 6, 14), hm, 0, headR * 0.82, 0);
    band.rotation.x = Math.PI / 2;
    head.add(band);
    const plumeMat = toonMat(0xd8564a);
    const plume = mesh(new THREE.ConeGeometry(headR * 0.22, headR * 1.2, 6), plumeMat, 0, headR * 1.75, -0.02, false);
    plume.rotation.x = -0.55;
    head.add(plume);
  } else if (o.helmet === 'horns') {
    const hm = forgedMat(o.helmetColor ?? 0x2e2e3c);
    head.add(mesh(new THREE.SphereGeometry(headR + 0.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hm, 0, headR * 0.84, 0));
    const hornGeo = new THREE.ConeGeometry(0.05, 0.3, 6);
    const h1 = mesh(hornGeo, stdMat(0xcbb69a), -0.16, headR * 1.25, -0.02);
    h1.rotation.z = 0.7;
    const h2 = mesh(hornGeo, stdMat(0xcbb69a), 0.16, headR * 1.25, -0.02);
    h2.rotation.z = -0.7;
    head.add(h1, h2);
  } else if (o.helmet === 'hood') {
    const hm = stdMat(o.helmetColor ?? 0x2d2a33);
    const hood = mesh(new THREE.ConeGeometry(headR + 0.06, 0.3, 7), hm, 0, headR * 1.0, -0.02);
    hood.rotation.x = 0.22;
    head.add(hood);
  }

  // Brazos
  const makeArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.225, torsoH * 0.88, 0);
    torso.add(arm);
    arm.add(mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.5, 8), armMat, 0, -0.25, 0));
    if (o.shoulder !== null && o.shoulder !== undefined) {
      arm.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), forgedMat(o.shoulder), 0, 0.02, 0));
    }
    const hand = new THREE.Group();
    hand.position.y = -0.5;
    arm.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(0.055, 6, 5), skin, 0, 0, 0));
    return { arm, hand };
  };
  const aL = makeArm(-1), aR = makeArm(1);
  aL.arm.rotation.x = -0.12; aR.arm.rotation.x = -0.12;
  aL.arm.rotation.z = 0.1; aR.arm.rotation.z = -0.1;

  // Piernas
  const makeLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.11, 0.02, 0);
    body.add(leg);
    leg.add(mesh(new THREE.CylinderGeometry(0.065, 0.05, legLen, 8), legMat, 0, -legLen / 2 + 0.02, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), stdMat(0x2a2018), 0, -legLen + 0.02, 0.04));
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  // Arma en mano derecha
  let weapon: THREE.Group | null = null;
  let weaponMat: CharMat | null = null;
  if (o.weapon && o.weapon !== 'none') {
    weapon = new THREE.Group();
    weapon.position.y = -0.06;
    let w: THREE.Group;
    switch (o.weapon) {
      case 'sword': w = buildSword(1); break;
      case 'greatsword': w = buildGreatsword(1); break;
      case 'club': w = buildClub(); break;
      case 'axe': w = buildAxe(); break;
      case 'bow': w = buildBow(); break;
      default: w = buildSword(1);
    }
    weapon.add(w);
    weapon.traverse(m => {
      if (m instanceof THREE.Mesh) {
        const mm = m.material as THREE.MeshStandardMaterial;
        if (mm && mm.emissive && mm.emissiveIntensity > 0) weaponMat = mm;
      }
    });
    aR.hand.add(weapon);
  }

  // Escudo en mano izquierda
  if (o.shield) {
    const sh = buildShield();
    sh.position.y = -0.34;
    sh.rotation.x = Math.PI / 2;
    sh.rotation.y = -0.25;
    aL.hand.add(sh);
  }

  root.scale.setScalar(s);
  if (o.outline) addOutlines(root, o.outline);
  return {
    root, body, torso, head,
    armL: aL.arm, armR: aR.arm, legL, legR,
    handR: aR.hand, handL: aL.hand, weapon, weaponMat: weaponMat ?? null,
    height: (legLen + torsoH + headR * 2.4) * s,
  };
}

/* ---------- Creadores de personajes (ESTILO ANIME) ---------- */

export function buildPlayerRig(): HumanoidRig {
  return buildHumanoid({
    skin: 0xffdcb8, torso: 0x3d6ec4, legs: 0x2c3f66, arms: 0x3d6ec4,
    eyes: 0x38b6d8, eyeStyle: 'anime',
    weapon: 'sword', shield: true,
    helmet: 'knight', helmetColor: 0xcdd8e8,
    hair: 0x2c3e6e,
    chest: 0xd8e2f2, shoulder: 0xd8b34a,
    cape: 0xc23050,
    bigHead: true,
    rim: { color: 0x9fd8ff, strength: 0.3 },
    outline: 0.022,
  });
}
export function buildGoblinRig(): HumanoidRig {
  return buildHumanoid({
    scale: 0.72, skin: 0x6fc23c, torso: 0x9a6a30, legs: 0x6a4a24,
    eyes: 0xffd23e, eyeStyle: 'anime', weapon: 'club',
    bigHead: true, hunched: true,
    ears: true, tusks: true,
    hair: 0x2e5a1c,
    outline: 0.032,
  });
}
export function buildArcherRig(): HumanoidRig {
  return buildHumanoid({
    scale: 0.95, skin: 0xe8d4b8, torso: 0x4a4438, legs: 0x37322a,
    eyes: 0x9df2ff, weapon: 'bow', helmet: 'hood', helmetColor: 0x4a4438,
    outline: 0.024,
  });
}
export function buildOrcRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.42, skin: 0x62a03c, torso: 0x6a4426, legs: 0x4a3220,
    eyes: 0xff9a2a, eyeStyle: 'anime', weapon: 'axe',
    shoulder: 0x8a8a96, hunched: true,
    ears: true, tusks: true,
    hair: 0x243018,
    outline: 0.034,
  });
}
export function buildBossRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.95, skin: 0x4a4a64, torso: 0x302e48, legs: 0x26243a,
    eyes: 0xff2a1e, eyeIntensity: 3, weapon: 'greatsword',
    helmet: 'horns', helmetColor: 0x26263a, chest: 0x26263a, shoulder: 0x26263a,
    cape: 0x1c0e18, capeTattered: true,
    rim: { color: 0xff4a30, strength: 0.5 },
    outline: 0.05,
  });
}

/* ---------- Props del mundo ---------- */

export function buildObelisk(cleansed: boolean): {
  group: THREE.Group; crystal: THREE.Mesh; runes: THREE.Mesh[]; shards: THREE.Mesh[];
} {
  const g = new THREE.Group();
  const st = stoneMat();
  const base = mesh(new THREE.CylinderGeometry(1.15, 1.45, 0.5, 8), st, 0, 0.25, 0);
  const shaft = mesh(new THREE.CylinderGeometry(0.35, 0.64, 3.4, 7), st, 0, 2.0, 0);
  const ring = mesh(new THREE.TorusGeometry(0.52, 0.06, 6, 14), st, 0, 3.55, 0);
  ring.rotation.x = Math.PI / 2;
  const crystalMat = cleansed ? emisMat(0x37d8c8, 2.4) : emisMat(0xd8323c, 1.8);
  const crystal = mesh(new THREE.OctahedronGeometry(0.46, 0), crystalMat, 0, 4.15, 0);
  g.add(base, shaft, ring, crystal);
  const runes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const r = mesh(new THREE.BoxGeometry(0.1, 0.3, 0.03),
      cleansed ? emisMat(0x37d8c8, 1.6) : emisMat(0xd8323c, 1.2),
      Math.sin((i / 4) * Math.PI * 2) * 0.56, 1.2 + (i % 2) * 0.8, Math.cos((i / 4) * Math.PI * 2) * 0.56, false);
    r.lookAt(0, r.position.y, 0);
    g.add(r);
    runes.push(r);
  }
  // fragmentos orbitando el cristal
  const shards: THREE.Mesh[] = [];
  const shardMat = cleansed ? emisMat(0x37d8c8, 1.4) : emisMat(0xd8323c, 1.1);
  for (let i = 0; i < 3; i++) {
    const sh = mesh(new THREE.TetrahedronGeometry(0.11), shardMat, 0, 0, 0, false);
    g.add(sh);
    shards.push(sh);
  }
  addOutlines(g, 0.045);
  return { group: g, crystal, runes, shards };
}

export function buildBonfire(): { group: THREE.Group; light: THREE.PointLight; logs: THREE.Mesh[] } {
  const g = new THREE.Group();
  const logs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), barkMat(),
      Math.sin((i / 5) * Math.PI * 2) * 0.35, 0.22, Math.cos((i / 5) * Math.PI * 2) * 0.35);
    log.rotation.z = Math.PI / 2.4;
    log.rotation.y = (i / 5) * Math.PI * 2;
    g.add(log); logs.push(log);
  }
  // anillo de piedras
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = mesh(new THREE.DodecahedronGeometry(0.16 + (i % 2) * 0.05, 0), stoneMat(),
      Math.cos(a) * 0.78, 0.08, Math.sin(a) * 0.78);
    st.rotation.set(Math.random(), Math.random() * 3, Math.random());
    g.add(st);
  }
  // llamas shader (cruzadas) + núcleo brillante
  const flame = new THREE.Mesh(flameGeometry(1.05, 1.5), makeFlameMaterial(0xffe9a8, 0xff6a1a));
  flame.position.y = 0.28;
  flame.name = 'flame';
  g.add(flame);
  const inner = new THREE.Mesh(flameGeometry(0.5, 0.7), makeFlameMaterial(0xffffff, 0xffc23e));
  inner.position.y = 0.22;
  inner.name = 'flameInner';
  g.add(inner);
  const light = new THREE.PointLight(0xff9040, 16, 22, 1.55);
  light.position.set(0, 1.5, 0);
  g.add(light);
  const glow = mesh(new THREE.CylinderGeometry(1.55, 1.85, 0.06, 14), stdMat(0x1c1c22), 0, 0.03, 0, false);
  g.add(glow);
  return { group: g, light, logs };
}

export function buildTorch(soul = false): { group: THREE.Group; light: THREE.PointLight; flame: THREE.Mesh } {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.085, 2.4, 7), woodMat(), 0, 1.2, 0);
  const bowl = mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.22, 8), forgedMat(0x4a4a52), 0, 2.45, 0);
  const flame = new THREE.Mesh(
    flameGeometry(0.42, 0.62),
    soul ? makeFlameMaterial(0xffc9b0, 0xd8202e) : makeFlameMaterial(0xffe2a0, 0xff7a1e),
  );
  flame.position.y = 2.62;
  const light = new THREE.PointLight(soul ? 0xe03040 : 0xff8030, 6.5, 14, 1.8);
  light.position.set(0, 2.95, 0);
  g.add(pole, bowl, flame, light);
  return { group: g, light, flame };
}

export function buildRuinedPillar(h = 2.4): THREE.Group {
  const g = new THREE.Group();
  const st = stoneMat();
  g.add(mesh(new THREE.BoxGeometry(0.72, 0.26, 0.72), st, 0, 0.13, 0));
  const col = mesh(new THREE.CylinderGeometry(0.26, 0.3, h, 10), st, 0, h / 2 + 0.22, 0);
  col.rotation.z = 0.03;
  g.add(col);
  // capitel caído
  const cap = mesh(new THREE.BoxGeometry(0.78, 0.22, 0.78), st, 0.08, h + 0.3, 0.05);
  cap.rotation.set(0.1, 0.4, -0.12);
  g.add(cap);
  addOutlines(g, 0.035);
  return g;
}

export function buildBrokenArch(): THREE.Group {
  const g = new THREE.Group();
  const st = stoneMat();
  const l = mesh(new THREE.BoxGeometry(0.55, 3.4, 0.55), st, -1.5, 1.7, 0);
  const r = mesh(new THREE.BoxGeometry(0.55, 2.6, 0.55), st, 1.5, 1.3, 0.1);
  r.rotation.z = 0.08;
  const top = mesh(new THREE.BoxGeometry(3.8, 0.5, 0.6), st, -0.2, 3.55, 0);
  top.rotation.z = -0.1;
  g.add(l, r, top);
  addOutlines(g, 0.04);
  return g;
}

export function buildPickupOrb(color: number): { group: THREE.Group; core: THREE.Mesh } {
  const g = new THREE.Group();
  const core = mesh(new THREE.IcosahedronGeometry(0.16, 0), emisMat(color, 2.4), 0, 0, 0, false);
  const halo = mesh(new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, 0, false);
  g.add(core, halo);
  return { group: g, core };
}

export function buildSigil(): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const mat = stoneMat();
  g.add(mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.3, 24), mat, 0, 0.15, 0));
  const ring = mesh(new THREE.TorusGeometry(1.5, 0.09, 8, 32), emisMat(0xd8323c, 1.6), 0, 0.4, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return { group: g, ring };
}

/* ---------- Hierba: mata de 3 hojas curvadas (textura alpha) ---------- */

export function grassGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const H = 0.6;
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(0.2, H, 1, 3);
    p.translate(0, H / 2, 0);
    // curvatura de la hoja
    const pos = p.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const k = Math.pow(y / H, 2);
      pos.setZ(v, k * 0.16);
      pos.setX(v, pos.getX(v) * (1 - k * 0.35));
    }
    p.rotateY((i / 3) * Math.PI + 0.3);
    p.rotateX(((i * 37) % 10 - 5) * 0.02);
    blades.push(p);
  }
  const merged = mergeGeometries(blades)!;
  merged.computeVertexNormals();
  return merged;
}

export function grassMaterial(): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    color: 0xffffff,
    gradientMap: toonRamp3(),
  });
  registerWind(mat, 0.09);
  return mat;
}

/** Material de copa de pino (dos tonos) con viento — anime saturado */
export function canopyMat(color: number): THREE.MeshToonMaterial {
  const m = toonMat(color);
  registerWind(m, 0.06);
  return m;
}

/** Seta luminosa (para instanciar en grupos) */
export function mushroomGeos(): { stem: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.16, 6);
  stem.translate(0, 0.08, 0);
  const cap = new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  cap.scale(1, 0.75, 1);
  cap.translate(0, 0.15, 0);
  return { stem, cap };
}
