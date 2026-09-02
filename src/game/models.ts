import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  barkMaps, metalMaps, stoneMaps, woodMaps, grassBladeTexture,
  foliageTexture, pineFoliageTexture,
} from './textures';

/* ============================================================
   MODELOS PROCEDURALES — PIPELINE PBR REALISTA (DMC-style)
   - Materiales MeshStandardMaterial fotográficos (metal/rough).
   - Vegetación con tarjetas alpha de follaje (SpeedTree-style).
   - Los rigs humanoides de respaldo siguen aquí (fallback sin GLB).
   ============================================================ */

export type ToonMat = THREE.MeshStandardMaterial; // (nombre histórico)
export type CharMat = THREE.MeshStandardMaterial | THREE.MeshToonMaterial;

/** Material estándar PBR (antes toon): rugoso mate por defecto */
export function toonMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const { gradientMap: _drop, ...rest } = opts as Record<string, unknown>;
  void _drop;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0.02,
    ...rest,
  } as THREE.MeshStandardMaterialParameters);
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

/* ---------- Materiales compartidos texturizados (PBR) ---------- */

let _bark: THREE.MeshStandardMaterial | null = null;
export function barkMat(): THREE.MeshStandardMaterial {
  if (!_bark) {
    const { map, normalMap } = barkMaps();
    _bark = toonMat(0xffffff, { map, normalMap, roughness: 0.92, metalness: 0 });
  }
  return _bark;
}

let _stone: THREE.MeshStandardMaterial | null = null;
export function stoneMat(): THREE.MeshStandardMaterial {
  if (!_stone) {
    const { map, normalMap } = stoneMaps();
    _stone = toonMat(0x9b948c, { map, normalMap, roughness: 0.95, metalness: 0 });
  }
  return _stone;
}

let _wood: THREE.MeshStandardMaterial | null = null;
export function woodMat(): THREE.MeshStandardMaterial {
  if (!_wood) {
    const { map, normalMap } = woodMaps();
    _wood = toonMat(0xffffff, { map, normalMap, roughness: 0.9, metalness: 0 });
  }
  return _wood;
}

export function forgedMat(color = 0xdfe8f4): THREE.MeshStandardMaterial {
  const { map, normalMap, roughnessMap } = metalMaps();
  return toonMat(color, { map, normalMap, roughnessMap, roughness: 0.42, metalness: 0.85 });
}

/* ---------- Materiales básicos (compat API) ---------- */

export function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return toonMat(color, opts);
}
export function metalMat(color: number) {
  return toonMat(color, { roughness: 0.38, metalness: 0.85 });
}
export function emisMat(color: number, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity,
    roughness: 0.5, metalness: 0,
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
  const wood = woodMat();
  const gold = forgedMat(0xc7a24a);
  // recurva: dos arcos curvos con extremos reforzados
  const arc = mesh(new THREE.TorusGeometry(0.44, 0.028, 6, 16, Math.PI * 1.2), wood, 0, 0.35, 0);
  arc.rotation.z = Math.PI * 0.4;
  // cantoneras doradas de las puntas
  const tipT = mesh(new THREE.ConeGeometry(0.035, 0.11, 5), gold, -0.2, 0.72, 0);
  tipT.rotation.z = 1.2;
  const tipB = mesh(new THREE.ConeGeometry(0.035, 0.11, 5), gold, -0.2, -0.02, 0);
  tipB.rotation.z = -1.9;
  // empuñadura envuelta en cuero
  const grip = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 8), stdMat(0x5a3a24), -0.06, 0.35, 0);
  grip.rotation.z = -0.35;
  const strMat = new THREE.LineBasicMaterial({ color: 0xf2ecd8 });
  const pts = [new THREE.Vector3(-0.21, 0.73, 0), new THREE.Vector3(-0.055, 0.35, 0), new THREE.Vector3(-0.21, -0.03, 0)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strMat);
  g.add(arc, tipT, tipB, grip, line);
  return g;
}

/** Alabarda: asta larga, punta de lanza, hoja de hacha y contrapeso */
export function buildHalberd(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const s = scale;
  const steel = forgedMat(0xb9c2d0);
  const gold = forgedMat(0xc7a24a);
  // asta larga (2.05 m) con refuerzos metálicos
  const shaft = mesh(new THREE.CylinderGeometry(0.032 * s, 0.04 * s, 2.05 * s, 7), woodMat(), 0, 0.92 * s, 0);
  const collar1 = mesh(new THREE.CylinderGeometry(0.044 * s, 0.044 * s, 0.07 * s, 8), gold, 0, 1.62 * s, 0);
  const collar2 = mesh(new THREE.CylinderGeometry(0.044 * s, 0.044 * s, 0.07 * s, 8), gold, 0, 0.42 * s, 0);
  // punta de lanza (rombo alargado)
  const tip = mesh(new THREE.ConeGeometry(0.055 * s, 0.34 * s, 5), steel, 0, 2.12 * s, 0);
  // hoja de hacha lateral (media luna afilada)
  const headGeo = new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.05 * s, 3);
  const head = mesh(headGeo, steel, 0.17 * s, 1.86 * s, 0);
  head.rotation.x = Math.PI / 2;
  head.rotation.z = Math.PI;
  head.scale.set(1, 1, 0.9);
  const edge = mesh(new THREE.TorusGeometry(0.27 * s, 0.02 * s, 5, 10, Math.PI * 0.85), forgedMat(0xe2e8f0), 0.17 * s, 1.86 * s, 0);
  edge.rotation.x = Math.PI / 2;
  edge.rotation.z = Math.PI * 0.6;
  // gancho trasero + contrapeso con runa encendida
  const hook = mesh(new THREE.ConeGeometry(0.04 * s, 0.2 * s, 4), steel, -0.11 * s, 1.82 * s, 0);
  hook.rotation.z = 1.9;
  const rune = mesh(new THREE.OctahedronGeometry(0.045 * s, 0), emisMat(0xff9a3a, 1.5), 0, 0.36 * s, 0, false);
  g.add(shaft, collar1, collar2, tip, head, edge, hook, rune);
  return g;
}

/** Bastón mágico: asta con garras doradas que abrazan un cristal de brasa */
export function buildStaff(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const s = scale;
  const dark = woodMat();
  const gold = forgedMat(0xb08a3e);
  const shaft = mesh(new THREE.CylinderGeometry(0.03 * s, 0.042 * s, 1.85 * s, 7), dark, 0, 0.82 * s, 0);
  // espiral metálica decorativa
  for (let i = 0; i < 5; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.05 * s, 0.008 * s, 4, 10), gold, 0, (0.5 + i * 0.24) * s, 0);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = i * 0.5;
    g.add(ring);
  }
  // copa de garras
  for (let i = 0; i < 3; i++) {
    const claw = mesh(new THREE.ConeGeometry(0.024 * s, 0.22 * s, 5), gold,
      Math.cos(i * 2.094) * 0.07 * s, 1.78 * s, Math.sin(i * 2.094) * 0.07 * s);
    claw.rotation.set(Math.sin(i * 2.094) * 0.5, 0, -Math.cos(i * 2.094) * 0.5);
    g.add(claw);
  }
  // cristal de brasa (runa del arma — tiñible por rareza)
  const crystal = mesh(new THREE.OctahedronGeometry(0.085 * s, 0), emisMat(0xff6a2a, 2.4), 0, 1.92 * s, 0, false);
  crystal.name = 'weaponRune';
  const halo = mesh(new THREE.SphereGeometry(0.13 * s, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.22, depthWrite: false }),
    0, 1.92 * s, 0, false);
  g.add(shaft, crystal, halo);
  return g;
}

/** Martillo de herrero: mango de madera y cabeza de acero */
export function buildHammer(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const s = scale;
  const handle = mesh(new THREE.CylinderGeometry(0.024 * s, 0.03 * s, 0.5 * s, 7), woodMat(), 0, 0.18 * s, 0);
  const head = mesh(new THREE.BoxGeometry(0.11 * s, 0.13 * s, 0.24 * s), forgedMat(0x4a4a58), 0, 0.46 * s, 0);
  const band1 = mesh(new THREE.CylinderGeometry(0.032 * s, 0.032 * s, 0.04 * s, 8), forgedMat(0x2a2a34), 0, 0.36 * s, 0);
  const band2 = mesh(new THREE.CylinderGeometry(0.032 * s, 0.032 * s, 0.04 * s, 8), forgedMat(0x2a2a34), 0, 0.03 * s, 0);
  g.add(handle, head, band1, band2);
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

/** Contrato visual mínimo que usan las entidades (rig procedural o GLB) */
export interface VisualRig {
  root: THREE.Group;
  weapon: THREE.Group | null;
  weaponMat: CharMat | null;
  handR: THREE.Object3D | null;
  handL: THREE.Object3D | null;
  height: number;
}

export interface HumanoidRig extends VisualRig {
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handR: THREE.Group;
  handL: THREE.Group;
  height: number;
}

export function buildHumanoid(o: HumanoidOpts): HumanoidRig {
  const s = o.scale ?? 1;
  const root = new THREE.Group();

  const mkBody = (color: number) => {
    const m = toonMat(color);
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
    const hairMat = toonMat(o.hair);
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
/** Ferran, el mercader del campamento — mercader anime con peto y banda */
export function buildMerchantRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.04, skin: 0xf2cfa4, torso: 0x7a3b52, legs: 0x3a3048, arms: 0x7a3b52,
    eyes: 0xffb347, eyeStyle: 'anime',
    hair: 0x4a2f1e,
    chest: 0xc7a24a,
    helmet: 'hood', helmetColor: 0x5e3248,
    cape: 0x4e2a3e,
    bigHead: true,
    rim: { color: 0xffd9a0, strength: 0.25 },
    outline: 0.024,
  });
}
/** Bran, el herrero — corpulento, delantal de cuero y barba canosa */
export function buildBlacksmithRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.16, skin: 0xe8b48c, torso: 0x5a2e22, legs: 0x3a2e26, arms: 0x5a2e22,
    eyes: 0xffd23e, eyeStyle: 'anime',
    hair: 0x8a7a70,          // barba/cabello canoso (las puntas actúan de barba)
    chest: 0x4a3a30,          // peto de cuero
    bigHead: true,
    rim: { color: 0xffb37d, strength: 0.3 },
    outline: 0.026,
  });
}

/* ---------- FORJA del herrero: yunque, hornalla, rack de armas y cubo ---------- */

export interface ForgeSet {
  group: THREE.Group;
  /** luz cálida de la hornalla (parpadea de noche) */
  light: THREE.PointLight;
  /** brasas (escala/brillo pulsante) */
  coals: THREE.Mesh;
  /** llama de la hornalla (shader) */
  fire: THREE.Mesh;
  /** punto exacto sobre el yunque (chispas al martillear) */
  anvilTop: THREE.Vector3;
}

export function buildForgeSet(): ForgeSet {
  const g = new THREE.Group();
  const st = stoneMat();
  const dark = forgedMat(0x3a3a46);
  const wood = woodMat();

  // --- HORNALLA: bloque de piedra con arcada y brasas encendidas ---
  const base = mesh(new THREE.BoxGeometry(1.5, 0.55, 1.2), st, 0, 0.27, 0);
  const body = mesh(new THREE.BoxGeometry(1.35, 0.85, 1.05), st, 0, 0.95, 0);
  // campana de humo corta en piedra (antes: cono negro gigante)
  const hood = mesh(new THREE.CylinderGeometry(0.42, 0.72, 0.8, 6), st, 0, 1.78, -0.08);
  const chimney = mesh(new THREE.BoxGeometry(0.42, 0.7, 0.42), stoneMat(), 0, 2.4, -0.08);
  // arcada frontal con el fuego dentro + brillo fundido alrededor
  const arch = mesh(new THREE.TorusGeometry(0.34, 0.09, 6, 12, Math.PI), dark, 0, 0.85, 0.53);
  const glowRim = mesh(new THREE.TorusGeometry(0.3, 0.045, 6, 12, Math.PI * 1.2),
    emisMat(0xff6a2a, 2.2), 0, 0.82, 0.56, false);
  const cavity = mesh(new THREE.BoxGeometry(0.85, 0.55, 0.25), stdMat(0x120a08), 0, 0.68, 0.42);
  // brasas (runa del fuego) + llama shader
  const coals = mesh(new THREE.SphereGeometry(0.3, 10, 8),
    emisMat(0xff5a1e, 2.6), 0, 0.62, 0.42, false);
  coals.scale.set(1.25, 0.5, 1);
  const fire = new THREE.Mesh(flameGeometry(0.62, 0.85), makeFlameMaterial(0xffc26a, 0xff4a10));
  fire.position.set(0, 0.92, 0.42);
  g.add(base, body, hood, chimney, arch, glowRim, cavity, coals, fire);
  const light = new THREE.PointLight(0xff7a2a, 5.5, 11, 1.7);
  light.position.set(0, 1.15, 0.5);
  g.add(light);

  // --- YUNQUE sobre el tronco (prominente, mirando al frente) ---
  const stump = mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.44, 9), wood, 0.95, 0.22, 0.62);
  const anvilBase = mesh(new THREE.BoxGeometry(0.46, 0.1, 0.22), dark, 0.95, 0.49, 0.62);
  const anvilBody = mesh(new THREE.BoxGeometry(0.66, 0.18, 0.26), forgedMat(0x6a6a78), 0.95, 0.62, 0.62);
  const horn = mesh(new THREE.ConeGeometry(0.11, 0.32, 6), forgedMat(0x6a6a78), 1.42, 0.62, 0.62);
  horn.rotation.z = Math.PI / 2;
  g.add(stump, anvilBase, anvilBody, horn);

  // --- RACK de armas: dos postes + travesaño con una muestra de cada arma ---
  const rack = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.7, 6);
  const p1 = mesh(postGeo, wood, 0, 0.85, 0);
  const p2 = mesh(postGeo, wood, 1.45, 0.85, 0);
  const bar = mesh(new THREE.BoxGeometry(1.6, 0.07, 0.07), wood, 0.72, 1.55, 0);
  rack.add(p1, p2, bar);
  // armas de muestra apoyadas (alabarda, bastón, espada)
  const hSample = buildHalberd(0.85);
  hSample.position.set(0.28, 1.5, 0.02);
  hSample.rotation.z = -0.06;
  rack.add(hSample);
  const sSample = buildStaff(0.85);
  sSample.position.set(0.72, 1.5, 0.02);
  sSample.rotation.z = 0.05;
  rack.add(sSample);
  const swSample = buildSword(0.95);
  swSample.position.set(1.12, 1.46, 0.02);
  swSample.rotation.z = 0.14;
  rack.add(swSample);
  rack.position.set(-0.35, 0, 0.95);
  rack.rotation.y = Math.PI * 0.06;
  g.add(rack);

  // --- CUBO de agua para templar (con agua oscura) ---
  const barrel = new THREE.Group();
  const bBody = mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.5, 10), wood, 0, 0.25, 0);
  const bRim1 = mesh(new THREE.TorusGeometry(0.235, 0.02, 5, 12), dark, 0, 0.4, 0);
  bRim1.rotation.x = Math.PI / 2;
  const bRim2 = mesh(new THREE.TorusGeometry(0.21, 0.02, 5, 12), dark, 0, 0.1, 0);
  bRim2.rotation.x = Math.PI / 2;
  const water = mesh(new THREE.CircleGeometry(0.2, 10), stdMat(0x22343e, { roughness: 0.25, metalness: 0.1 }), 0, 0.44, 0, false);
  water.rotation.x = -Math.PI / 2;
  barrel.add(bBody, bRim1, bRim2, water);
  barrel.position.set(1.85, 0, -0.25);
  g.add(barrel);

  // yunque: posición local exacta para chispas
  const anvilTop = new THREE.Vector3(0.95, 0.73, 0.62);
  return { group: g, light, coals, fire, anvilTop };
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

/**
 * Puesto del mercader: dos postes, toldo a rayas rojo/crema,
 * mostrador de madera con género (frascos, saco de monedas, caja)
 * y un farol cálido que arde de noche.
 */
export function buildMerchantStall(): { group: THREE.Group; lantern: THREE.PointLight; lanternCore: THREE.Mesh } {
  const g = new THREE.Group();
  const wood = woodMat();
  const darkWood = woodMat();
  darkWood.color.setHex(0x4a3423);

  // postes
  const poleGeo = new THREE.CylinderGeometry(0.055, 0.07, 2.35, 7);
  const pL = mesh(poleGeo, wood, -1.05, 1.175, -0.55);
  const pR = mesh(poleGeo, wood, 1.05, 1.175, -0.55);
  const pBack = mesh(poleGeo, darkWood, 0, 1.125, 0.62);
  pBack.scale.y = 1.0;
  g.add(pL, pR, pBack);

  // toldo a rayas (listones alternos, ligeramente inclinado hacia delante)
  const awning = new THREE.Group();
  awning.position.set(0, 2.28, 0.02);
  awning.rotation.x = -0.16;
  const stripeA = toonMat(0xb8443c);
  const stripeB = toonMat(0xe8dcc2);
  const stripeGeo = new THREE.BoxGeometry(0.35, 0.045, 1.75);
  for (let i = 0; i < 6; i++) {
    const s = mesh(stripeGeo, i % 2 === 0 ? stripeA : stripeB, -0.875 + i * 0.35, 0, -0.1, false);
    s.userData.noOutline = true;
    awning.add(s);
  }
  // canto del toldo
  const trim = mesh(new THREE.BoxGeometry(2.16, 0.07, 0.06), toonMat(0xc7a24a), 0, -0.05, 0.82, false);
  trim.userData.noOutline = true;
  awning.add(trim);
  g.add(awning);

  // mostrador
  const counter = mesh(new THREE.BoxGeometry(2.25, 0.78, 0.72), wood, 0, 0.46, 0.1);
  g.add(counter);
  // tablón superior del mostrador
  const top = mesh(new THREE.BoxGeometry(2.4, 0.07, 0.86), darkWood, 0, 0.88, 0.1);
  g.add(top);
  // manto frontal con rombos dorados
  const skirt = mesh(new THREE.BoxGeometry(2.28, 0.5, 0.04), toonMat(0x7a3b52), 0, 0.42, 0.47, false);
  skirt.userData.noOutline = true;
  g.add(skirt);
  for (let i = 0; i < 3; i++) {
    const d = mesh(new THREE.OctahedronGeometry(0.06), emisMat(0xffb347, 0.9), -0.6 + i * 0.6, 0.42, 0.5, false);
    d.userData.noOutline = true;
    g.add(d);
  }

  // género sobre el mostrador: frascos de elixir
  const potionColors = [0xff5a4e, 0x51e07c, 0x54a8ff];
  potionColors.forEach((c, i) => {
    const bottle = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.16, 8), toonMat(c), 0, 0.08, 0, false);
    const neck = mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.09, 6), toonMat(c), 0, 0.2, 0, false);
    const cork = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.04, 6), toonMat(0x8a6a42), 0, 0.26, 0, false);
    bottle.add(body, neck, cork);
    bottle.position.set(-0.62 + i * 0.24, 0.92, 0.12);
    g.add(bottle);
  });
  // saco de monedas
  const sack = mesh(new THREE.SphereGeometry(0.14, 8, 7), toonMat(0xb09a6a), 0.42, 0.99, 0.1);
  sack.scale.set(1, 0.9, 1);
  g.add(sack);
  const tie = mesh(new THREE.TorusGeometry(0.05, 0.014, 5, 8), toonMat(0x8a6a42), 0.42, 1.12, 0.1);
  tie.rotation.x = Math.PI / 2;
  g.add(tie);
  const coin = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 10), emisMat(0xffc84a, 1.1), 0.42, 1.16, 0.08, false);
  coin.rotation.x = 0.4;
  g.add(coin);
  // caja de madera con espada
  const crate = mesh(new THREE.BoxGeometry(0.42, 0.3, 0.34), darkWood, -0.78, 1.06, 0.12);
  g.add(crate);
  const blade = mesh(bladeGeo(0.72, 0.045), forgedMat(0xcdd6e2), -0.7, 1.28, 0.16);
  blade.rotation.z = -0.5;
  g.add(blade);

  // farol colgante del toldo
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(0.95, 1.95, 0.35);
  const hook = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5), forgedMat(0x6a6a72), 0, 0.15, 0, false);
  hook.userData.noOutline = true;
  const cage = mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 6), forgedMat(0x55504e), 0, -0.06, 0);
  const core = mesh(new THREE.OctahedronGeometry(0.065), emisMat(0xffb36a, 2.6), 0, -0.06, 0, false);
  core.userData.noOutline = true;
  lanternGroup.add(hook, cage, core);
  g.add(lanternGroup);
  const lantern = new THREE.PointLight(0xffb36a, 0, 12, 2);
  lantern.position.set(0.95, 1.8, 0.35);
  g.add(lantern);

  // rótulo colgante con emblema de moneda
  const signBoard = mesh(new THREE.BoxGeometry(0.5, 0.3, 0.04), darkWood, -0.95, 1.78, 0.3);
  g.add(signBoard);
  const emblem = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), emisMat(0xffc84a, 1.5), -0.95, 1.78, 0.33, false);
  emblem.rotation.x = Math.PI / 2;
  emblem.userData.noOutline = true;
  g.add(emblem);

  return { group: g, lantern, lanternCore: core };
}


/* ---------- Hierba: mata de 5 hojas curvadas (textura alpha, PBR) ---------- */

export function grassGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const H = 0.68;
  for (let i = 0; i < 5; i++) {
    const p = new THREE.PlaneGeometry(0.16, H, 1, 3);
    p.translate(0, H / 2, 0);
    // curvatura de la hoja
    const pos = p.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const k = Math.pow(y / H, 2);
      pos.setZ(v, k * 0.16);
      pos.setX(v, pos.getX(v) * (1 - k * 0.35));
    }
    p.rotateY((i / 5) * Math.PI + 0.25);
    p.rotateX(((i * 37) % 10 - 5) * 0.02);
    p.translate((i % 2 ? 0.05 : -0.05) * (i % 3), 0, ((i * 7) % 5 - 2) * 0.035);
    blades.push(p);
  }
  const merged = mergeGeometries(blades)!;
  merged.computeVertexNormals();
  return merged;
}

export function grassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  registerWind(mat, 0.1);
  return mat;
}

/**
 * Material de follaje por tarjetas alpha (caducifolio): recibe el tinte
 * por instancia vía instanceColor; viento en shader. PBR con alphaTest.
 */
export function canopyMat(color: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: foliageTexture(1),
    color,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  registerWind(m, 0.055);
  m.customProgramCacheKey = () => 'canopyCard';
  return m;
}

/** Material de follaje de pino (acículas) */
export function pineCanopyMat(color: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: pineFoliageTexture(3),
    color,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });
  registerWind(m, 0.035);
  m.customProgramCacheKey = () => 'pineCard';
  return m;
}

/**
 * GEOMETRÍA DE ROBLE REALISTA: tronco cónico curvado + 3 ramas.
 * Unidad: árbol de ~7.5 m de alto con el origen en la base.
 */
export function buildOakGeos(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  // --- tronco con curvatura y estrechamiento ---
  const trunk = new THREE.CylinderGeometry(0.16, 0.42, 4.6, 9, 6);
  trunk.translate(0, 2.3, 0);
  {
    const p = trunk.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = Math.pow(Math.max(0, y / 4.6), 1.6);
      p.setZ(i, p.getZ(i) + k * 0.55);          // curva hacia +Z
      p.setX(i, p.getX(i) * (1 - k * 0.25));
    }
    trunk.computeVertexNormals();
  }
  // --- ramas ---
  const parts: THREE.BufferGeometry[] = [trunk.toNonIndexed()];
  const branchDefs: [number, number, number, number][] = [
    // [y, ang, len, radius]
    [2.9, 0.4, 1.7, 0.12], [3.4, 2.4, 1.9, 0.11], [3.9, 4.3, 1.5, 0.09], [4.4, 5.6, 1.3, 0.08],
  ];
  for (const [y, ang, len, r] of branchDefs) {
    const b = new THREE.CylinderGeometry(r * 0.4, r, len, 6, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.62 + Math.sin(ang) * 0.18);
    b.rotateY(ang);
    b.translate(Math.sin(ang * 1.7) * 0.2, y, Math.cos(ang * 1.3) * 0.2);
    parts.push(b.toNonIndexed());
  }
  const trunkMerged = mergeGeometries(parts)!;

  // --- copa: 3 racimos de tarjetas cruzadas con follaje ---
  const cards: THREE.BufferGeometry[] = [];
  const clusters: [number, number, number, number][] = [
    // [x, y, z, radio]
    [0.15, 5.4, 0.55, 2.15], [1.15, 4.9, -0.5, 1.75], [-0.95, 5.0, -0.35, 1.65],
  ];
  for (const [cx, cy, cz, R] of clusters) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const card = new THREE.PlaneGeometry(R * 1.5, R * 1.5, 1, 1);
      const a = (i / n) * Math.PI * 2;
      const rr = R * 0.32;
      card.translate(0, R * 0.42, 0); // pivote abajo
      card.rotateX((Math.sin(a * 3.1) * 0.5) - 0.25);
      card.rotateY(a);
      card.translate(cx + Math.cos(a) * rr, cy + (i % 3) * R * 0.34, cz + Math.sin(a) * rr);
      cards.push(card.toNonIndexed());
    }
  }
  const canopy = mergeGeometries(cards)!;
  canopy.computeVertexNormals();
  return { trunk: trunkMerged, canopy };
}

/**
 * GEOMETRÍA DE PINO REALISTA: tronco fino + 4 pisos de tarjetas de
 * acículas en silueta cónica. Altura ~8 m.
 */
export function buildPineGeos(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.1, 0.3, 5.2, 8, 3);
  trunk.translate(0, 2.6, 0);
  const cards: THREE.BufferGeometry[] = [];
  const tiers: [number, number, number][] = [
    // [y, radio, cards]
    [2.6, 2.0, 7], [3.9, 1.65, 7], [5.1, 1.3, 6], [6.2, 0.92, 5], [7.1, 0.55, 4],
  ];
  let idx = 0;
  for (const [y, R, n] of tiers) {
    for (let i = 0; i < n; i++) {
      const a = ((i + idx * 0.35) / n) * Math.PI * 2;
      const card = new THREE.PlaneGeometry(R * 1.7, R * 1.15, 1, 1);
      card.translate(0, 0, 0);
      card.rotateX(-0.42 - (idx % 2) * 0.16); // inclinación hacia abajo
      card.translate(0, R * 0.18, 0);
      card.rotateY(a);
      card.translate(0, y, 0);
      cards.push(card.toNonIndexed());
    }
    idx++;
  }
  const canopy = mergeGeometries(cards)!;
  canopy.computeVertexNormals();
  return { trunk: trunk.toNonIndexed(), canopy };
}

/** Arbusto: mata baja de tarjetas de follaje (~1.1 m) */
export function bushGeo(): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.sin(i * 3.7);
    const card = new THREE.PlaneGeometry(1.05, 0.85, 1, 1);
    card.translate(0, 0.36, 0);
    card.rotateX(-0.2 + Math.sin(i * 2.3) * 0.3);
    card.rotateY(a);
    card.translate(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
    cards.push(card.toNonIndexed());
  }
  const g = mergeGeometries(cards)!;
  g.computeVertexNormals();
  return g;
}

/** Tronco caído (leño) con corteza PBR, ~2.4 m en el suelo */
export function logGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.21, 0.28, 2.4, 9, 2);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.24, 0);
  // extremo superior irregular
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    if (x > 1.0) { p.setY(i, p.getY(i) + 0.02 * Math.sin(p.getZ(i) * 9)); }
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Roca realista: icosaedro desplazado con ruido (irregular) */
export function rockRealGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 5.3 + z * 3.1) * Math.cos(y * 4.7 - x * 2.3);
    const k = 1 + n * 0.16;
    p.setXYZ(i, x * k, y * (k * 0.78), z * k);
  }
  g.computeVertexNormals();
  return g;
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
