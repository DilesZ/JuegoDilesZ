import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand, terrainHeight } from './core';
import { buildSword, buildShield, buildBow, buildHalberd, buildStaff, buildHammer, stoneMat, type VisualRig } from './models';
import { CLIPS, sampleClip, idlePose, strafePose, type Pose } from './animations';

/* ============================================================
   PERSONAJES GLB REALES (rigged + animados, licencia libre)
   - Héroe: readyplayer.me.glb + MOCAP de Ready Player Me
     (Animation Library — mismo esqueleto, carga directa;
      licencia RPM: uso con avatares Ready Player Me).
   - Enemigos: Quaternius "Ultimate Monsters" (CC0):
       goblin → Tribal · archer → Ghost_Skull (espectro)
       orc    → Orc    · boss  → Demon (Bel'Zaroth)
     Clips mapeados: Idle/Walk/Run/HitReact/Death/Punch/Weapon.
   - Mercader: Soldier.glb (Idle/Walk nativos)
   - Zorros: Fox.glb (Survey/Walk/Run)
   - Ruinas: dungeon_warkarma.glb fusionado por material

   Los clips de COMBATE del héroe se hornean sobre el esqueleto real
   a partir de los mismos CLIPS procedurales del juego (mismas
   duraciones → hitAt/dur de la jugabilidad intactos).
   Si algún GLB falla, loadCharacterAssets devuelve null y el juego
   sigue con los rigs procedurales de siempre (fallback completo).
   ============================================================ */

const MODEL_DIR = '/assets/models';
/** altura del rig procedural sin escalar (para escalar bodyY) */
const PROC_HEIGHT = 1.574;

/* ---------- Animador con crossfade por estados ---------- */

export class GlbAnimator {
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private durations = new Map<string, number>();
  current = '';
  speed = 1;

  constructor(root: THREE.Object3D, clips: Record<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of Object.entries(clips)) {
      this.actions.set(name, this.mixer.clipAction(clip));
      this.durations.set(name, clip.duration);
    }
  }

  has(name: string) { return this.actions.has(name); }
  clipDur(name: string) { return this.durations.get(name) ?? 0; }

  play(name: string, opts: { fade?: number; once?: boolean; restart?: boolean; timeScale?: number } = {}) {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === name && !opts.restart) {
      if (opts.timeScale !== undefined) next.setEffectiveTimeScale(opts.timeScale);
      return;
    }
    const fade = opts.fade ?? 0.18;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, opts.once ? 1 : Infinity);
    next.clampWhenFinished = !!opts.once;
    next.setEffectiveTimeScale(opts.timeScale ?? 1);
    next.setEffectiveWeight(1);
    next.fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = name;
  }

  update(dt: number) { this.mixer.update(dt * this.speed); }
}

/* ---------- Carácter GLB genérico ---------- */

export type HeroWeaponVisual = 'sword' | 'bow' | 'halberd' | 'staff';

export interface GlbCharacter {
  root: THREE.Group;
  model: THREE.Object3D;
  rig: VisualRig;
  animator: GlbAnimator;
  height: number;
  /** huesos para overlay procedural (mirada/inclinación) */
  head?: THREE.Object3D | null;
  spine?: THREE.Object3D | null;
  /** cambia el arma visible en la mano derecha (héroe) */
  setWeapon?: (t: HeroWeaponVisual) => void;
}

/** Pack de un monstruo: fuente + clips ya renombrados a nombres del motor */
export interface MonsterPack {
  source: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
}

export interface CharacterPack {
  heroSource: THREE.Object3D;
  /** mocap RPM (idle/walk/run/back/strafeL/strafeR) — esqueleto idéntico al héroe */
  rpmClips: Record<string, THREE.AnimationClip>;
  soldierSource: THREE.Object3D;
  /** clips del Soldier renombrados en minúscula (mercader) */
  soldierClips: Record<string, THREE.AnimationClip>;
  /** monstruos por variante de enemigo (Quaternius CC0) */
  monsters: Partial<Record<'goblin' | 'archer' | 'orc' | 'boss' | 'boss2', MonsterPack>>;
  foxSource: THREE.Object3D;
  foxClips: THREE.AnimationClip[];
  dungeon: THREE.Group | null;
  dungeonRadius: number;
}

/* ============================================================
   HORNEADO DE CLIPS: pose procedural → pistas del esqueleto real
   La rotación procedural (euler XYZ) se aplica en ejes del mundo
   sobre la dirección de reposo alineada del hueso:
     D  = qAnim · R_align          (espacio mundo del personaje)
     L' = Pw⁻¹ · D · Pw · L0       (local del hueso)
   ============================================================ */

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

function findBone(model: THREE.Object3D, ...candidates: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  const wanted = candidates.map(c => c.toLowerCase());
  model.traverse(o => {
    if (found) return;
    const raw = o.name.includes(':') ? o.name.slice(o.name.lastIndexOf(':') + 1) : o.name;
    if (wanted.includes(raw.toLowerCase())) found = o;
  });
  return found;
}

/** dirección de reposo del hueso hacia su primer hijo (espacio raíz) */
function boneDirection(bone: THREE.Object3D, model: THREE.Object3D): THREE.Vector3 {
  model.updateMatrixWorld(true);
  const a = bone.getWorldPosition(new THREE.Vector3());
  const child = bone.children.find(c => c.type === 'Bone') ?? bone.children[0];
  const b = child ? child.getWorldPosition(new THREE.Vector3()) : a.clone().add(new THREE.Vector3(0, 0.1, 0));
  const d = b.sub(a);
  if (d.lengthSq() < 1e-8) d.set(0, -1, 0);
  return d.normalize();
}

class SkeletonBinder {
  hips: THREE.Object3D | null = null;
  private hipsParentInv = new THREE.Matrix4();
  private hipsRestWorld = new THREE.Vector3();
  private joints = new Map<string, { bone: THREE.Object3D; align: THREE.Quaternion; parentW: THREE.Quaternion; restLocal: THREE.Quaternion }>();

  constructor(model: THREE.Object3D, withLimbs: boolean) {
    model.updateMatrixWorld(true);
    const hips = findBone(model, 'Hips', 'Pelvis');
    this.hips = hips;
    if (hips && hips.parent) {
      this.hipsParentInv.copy(hips.parent.matrixWorld).invert();
      this.hipsRestWorld.copy(hips.getWorldPosition(new THREE.Vector3()));
    }
    const bind = (key: string, bone: THREE.Object3D | null, alignDir: THREE.Vector3 | null) => {
      if (!bone || !bone.parent) return;
      const parentW = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(parentW);
      const align = new THREE.Quaternion();
      if (alignDir) align.setFromUnitVectors(boneDirection(bone, model), alignDir);
      this.joints.set(key, { bone, align, parentW, restLocal: bone.quaternion.clone() });
    };
    bind('body', this.hips, null);
    bind('torso', findBone(model, 'Spine1', 'Spine2', 'Spine', 'Chest'), null);
    bind('head', findBone(model, 'Head', 'Neck'), null);
    if (withLimbs) {
      bind('armL', findBone(model, 'LeftArm', 'LeftForeArm'), DOWN);
      bind('armR', findBone(model, 'RightArm', 'RightForeArm'), DOWN);
      bind('legL', findBone(model, 'LeftUpLeg', 'LeftLeg'), DOWN);
      bind('legR', findBone(model, 'RightUpLeg', 'RightLeg'), DOWN);
    }
  }

  /** Construye las pistas del esqueleto para poses muestreadas */
  tracks(samples: { t: number; pose: Pose }[], height: number): THREE.KeyframeTrack[] {
    const tracks: THREE.KeyframeTrack[] = [];
    const times = samples.map(s => s.t);
    const k = height / PROC_HEIGHT;
    for (const [key, b] of this.joints) {
      const vals = new Float32Array(samples.length * 4);
      samples.forEach((s, i) => {
        const e = s.pose[key as keyof Pose] as [number, number, number];
        // qAnim = qX·qY·qZ (mismo orden que Euler 'XYZ' del rig procedural)
        _q1.setFromAxisAngle(AX, e[0]);
        _q2.setFromAxisAngle(AY, e[1]);
        _q1.multiply(_q2);
        _q2.setFromAxisAngle(AZ, e[2]);
        _q1.multiply(_q2);        // _q1 = qAnim
        _q1.multiply(b.align);    // D = qAnim · R_align
        _q3.copy(b.parentW).invert().multiply(_q1).multiply(b.parentW).multiply(b.restLocal);
        vals[i * 4] = _q3.x; vals[i * 4 + 1] = _q3.y; vals[i * 4 + 2] = _q3.z; vals[i * 4 + 3] = _q3.w;
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.bone.name}.quaternion`, times, vals));
    }
    // posición de caderas (bodyY del rig procedural)
    if (this.hips) {
      const vals = new Float32Array(samples.length * 3);
      samples.forEach((s, i) => {
        _v1.set(0, s.pose.bodyY * k, 0).add(this.hipsRestWorld);
        _v2.copy(_v1).applyMatrix4(this.hipsParentInv);
        vals[i * 3] = _v2.x; vals[i * 3 + 1] = _v2.y; vals[i * 3 + 2] = _v2.z;
      });
      tracks.push(new THREE.VectorKeyframeTrack(`${this.hips.name}.position`, times, vals));
    }
    return tracks;
  }
}

/** Hornea un clip de acción (duración EXACTA de CLIPS → jugabilidad intacta) */
function bakeActionClip(name: string, clipName: string, binder: SkeletonBinder, height: number, steps = 14): THREE.AnimationClip {
  const dur = CLIPS[clipName].dur;
  const samples: { t: number; pose: Pose }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = dur * (i / steps);
    samples.push({ t, pose: sampleClip(CLIPS[clipName], t) });
  }
  return new THREE.AnimationClip(name, dur, binder.tracks(samples, height));
}

/** Hornea un clip en bucle a partir de una función de pose */
function bakeLoopClip(name: string, dur: number, steps: number, fn: (t: number) => Pose, binder: SkeletonBinder, height: number): THREE.AnimationClip {
  const samples: { t: number; pose: Pose }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = dur * (i / steps);
    samples.push({ t, pose: fn(t) });
  }
  return new THREE.AnimationClip(name, dur, binder.tracks(samples, height));
}

/** Saludo del mercader: brazo derecho saludando (1.2 s) */
function greetPose(t: number): Pose {
  const dur = 1.2;
  const p = idlePose(t);
  const w = Math.min(1, Math.min(t, dur - t) / 0.35);
  p.armR = [-2.35 * w, 0, (-0.45 + Math.sin(t * 13) * 0.28) * w];
  p.head = [0, 0, -0.06 * w];
  return p;
}

/** Martilleo del herrero: alza el martillo y golpea el yunque (1.5 s) */
function hammerPose(t: number): Pose {
  const dur = 1.5;
  const p = idlePose(t);
  // fase: 0-0.55 alza el martillo, 0.55-0.7 golpe cae, 0.7-1.0 recupera
  const up = Math.min(1, t / (dur * 0.42));
  const down = t > dur * 0.42 && t < dur * 0.6 ? (t - dur * 0.42) / (dur * 0.18) : 0;
  const settle = t >= dur * 0.6 ? Math.max(0, 1 - (t - dur * 0.6) / (dur * 0.4)) : 1;
  const lift = up * (1 - down) * (t < dur * 0.6 ? 1 : 0);
  const w = t < dur * 0.6 ? lift : 0;
  p.armR = [-0.5 - 2.0 * w + down * 1.6 * (1 - settle * 0.0), 0, -0.35];
  p.torso = [0.06 + 0.16 * w - down * 0.12, 0.18, 0];
  p.head = [0.1 + 0.08 * w, 0.1, 0];
  p.armL = [-0.7, 0, 0.4];   // sostiene la pieza sobre el yunque
  p.bodyY = -0.02 - 0.03 * w;
  return p;
}

/** Beber poción (0.45 s): lleva la mano izquierda a la cara */
function potionPose(t: number): Pose {
  const dur = 0.45;
  const p = idlePose(t);
  const w = Math.sin((t / dur) * Math.PI);
  p.armL = [-1.9 * w, 0, 0.35 * w];
  p.head = [0.12 * w, 0, 0];
  return p;
}

/* ---------- Utilidades de normalización y materiales ---------- */

/**
 * Quita el "root motion" de un clip de mocap: el desplazamiento en XZ de la
 * pelvis queda anclado a su primer keyframe (solo se conserva el bob vertical).
 * Sin esto, el clip en bucle desplaza al personaje hacia delante y al
 * reiniciar lo devuelve atrás: el clásico "avanza tres, retrocede dos".
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const posTracks: THREE.VectorKeyframeTrack[] = [];
  for (const track of clip.tracks) {
    if (track.name.endsWith('.position')) posTracks.push(track as THREE.VectorKeyframeTrack);
  }
  for (const t of posTracks) {
    // pelvis/caderas: anclar XZ al valor del primer keyframe, conservar Y
    if (/(Hips|Pelvis|Root)/i.test(t.name)) {
      const v = t.values as Float32Array;
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
      }
    }
  }
  return clip;
}

/** Escala el modelo a una altura objetivo y apoya los pies en y=0 */
function normalizeModel(model: THREE.Object3D, targetH: number): number {
  model.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(model);
  const h = Math.max(0.001, bbox.max.y - bbox.min.y);
  model.scale.setScalar(targetH / h);
  model.updateMatrixWorld(true);
  const bb2 = new THREE.Box3().setFromObject(model);
  model.position.y -= bb2.min.y;
  return targetH;
}

/** Prepara materiales de personaje para PBR (rugosidad, sombras) */
function enableShadows(model: THREE.Object3D) {
  model.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
}

function tuneCharacterMaterials(model: THREE.Object3D) {
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) {
        m.roughness = Math.min(0.95, Math.max(0.55, m.roughness));
        m.metalness = Math.min(0.35, m.metalness);
        if (m.map) m.map.anisotropy = 4;
        m.envMapIntensity = 0.85;
      }
    }
  });
}

function captureRest(model: THREE.Object3D): Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }> {
  const map = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  model.traverse(o => {
    if (o instanceof THREE.Bone) map.set(o, { q: o.quaternion.clone(), p: o.position.clone() });
  });
  return map;
}

function restoreRest(model: THREE.Object3D, rest: Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>) {
  for (const [bone, r] of rest) {
    bone.quaternion.copy(r.q);
    bone.position.copy(r.p);
  }
  model.updateMatrixWorld(true);
}

function lowercaseClips(clips: THREE.AnimationClip[]): Record<string, THREE.AnimationClip> {
  const out: Record<string, THREE.AnimationClip> = {};
  for (const c of clips) out[c.name.toLowerCase()] = c;
  return out;
}

/* ============================================================
   FÁBRICAS DE PERSONAJES
   ============================================================ */

function makeCharacter(
  model: THREE.Object3D,
  height: number,
  clips: Record<string, THREE.AnimationClip>,
  weapon: THREE.Group | null,
  weaponMat: THREE.Material | null,
  shield: boolean,
): GlbCharacter {
  const root = new THREE.Group();
  root.add(model);
  let handR: THREE.Object3D | null = null;
  let handL: THREE.Object3D | null = null;
  if (weapon || shield) {
    handR = findBone(model, 'RightHand', 'RightForeArm', 'Hand.R');
    handL = findBone(model, 'LeftHand', 'LeftForeArm', 'Hand.L');
  }
  model.updateMatrixWorld(true);
  if (weapon && handR) {
    handR.add(weapon);
    // Fija la hoja en espacio mundo (arriba y ligeramente al frente):
    // q_local = q_mundo_mano⁻¹ · q_deseado, con el modelo en reposo.
    const handWorld = new THREE.Quaternion();
    handR.getWorldQuaternion(handWorld);
    const desired = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0));
    weapon.quaternion.copy(handWorld.invert().multiply(desired));
    weapon.position.set(0, 0.06, 0.02);
  }
  if (shield && handL) {
    const sh = buildShield();
    sh.scale.setScalar(0.9);
    handL.add(sh);
    const handWorldL = new THREE.Quaternion();
    handL.getWorldQuaternion(handWorldL);
    const desiredL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.15, 0));
    sh.quaternion.copy(handWorldL.invert().multiply(desiredL));
    sh.position.set(0, -0.07, 0);
  }
  const animator = new GlbAnimator(model, clips);
  const head = findBone(model, 'Head', 'Neck');
  const spine = findBone(model, 'Spine1', 'Spine2', 'Spine', 'Chest');
  return {
    root, model,
    rig: { root, weapon, weaponMat: (weaponMat ?? null) as VisualRig['weaponMat'], handR, handL, height },
    animator, height, head, spine,
  };
}

/** MOCAP RPM → nombres de motor (mismo esqueleto que readyplayer.me) */
const RPM_MAP: [string, string][] = [
  ['idle', 'M_Standing_Idle_001'],
  ['walk', 'M_Walk_001'],           // caminar REAL (antes: jog)
  ['jog', 'M_Jog_001'],             // transición/sprint corto
  ['run', 'M_Run_001'],
  ['back', 'M_Walk_Backwards_001'], // retroceso caminado (antes: jog)
  ['strafeL', 'M_Jog_Strafe_Left_001'],
  ['strafeR', 'M_Jog_Strafe_Right_001'],
];

/** Héroe: readyplayer.me + mocap RPM directo + combate horneado */
export function createHeroCharacter(pack: CharacterPack): GlbCharacter {
  const targetH = 1.62;
  const model = SkeletonUtils.clone(pack.heroSource);
  normalizeModel(model, targetH);
  enableShadows(model);
  tuneCharacterMaterials(model);
  // Vestimenta de fantasía: tiñe el chándal salmón del avatar hacia
  // cueros/tejidos oscuros de espadachín (DMC). Piel y cara intactas.
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.name.startsWith('Wolf3D_Outfit')) {
        m.color.lerp(new THREE.Color(0x4a4238), 0.82);   // cuero gris-pardo
        m.roughness = 0.82;
        m.metalness = 0.05;
      } else if (m.name === 'Wolf3D_Body') {
        m.color.lerp(new THREE.Color(0xc8a888), 0.18);   // piel ligeramente morena
        m.roughness = 0.74;
      }
    }
  });
  const rest = captureRest(model);

  const binder = new SkeletonBinder(model, true);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const n of ['slash1', 'slash2', 'slash3', 'heavy', 'halb1', 'halb2', 'spin',
    'bow1', 'bow2', 'bow3', 'cast1', 'cast2', 'nova', 'roll', 'hurt', 'death']) {
    clips[n] = bakeActionClip(n, n, binder, targetH);
  }
  clips.strafe = bakeLoopClip('strafe', Math.PI / 4, 12, t => strafePose(t, false), binder, targetH);
  clips.potion = bakeLoopClip('potion', 0.45, 8, t => potionPose(t), binder, targetH);
  // locomoción REAL (mocap RPM, sin retarget: mismo esqueleto)
  for (const [engine, raw] of RPM_MAP) {
    const clip = pack.rpmClips[raw];
    if (clip) clips[engine] = clip;
  }
  restoreRest(model, rest);

  // ARSENAL COMPLETO: las 4 armas viven en la mano derecha y se
  // muestran/ocultan según el arma equipada (cambio instantáneo).
  const arsenal: Record<HeroWeaponVisual, THREE.Group> = {
    sword: buildSword(1.05),
    bow: buildBow(),
    halberd: buildHalberd(0.92),
    staff: buildStaff(0.95),
  };
  let weaponMat: THREE.Material | null = null;
  for (const g of Object.values(arsenal)) {
    g.traverse(m => {
      if (m instanceof THREE.Mesh) {
        const mm = m.material as THREE.MeshStandardMaterial;
        if (mm && mm.emissive && mm.emissiveIntensity > 0 && !weaponMat) weaponMat = mm;
      }
    });
  }
  const char = makeCharacter(model, targetH, clips, arsenal.sword, weaponMat, true);
  // el resto de armas cuelga también de la mano (ocultas)
  const handR = char.rig.handR;
  if (handR) {
    for (const key of ['bow', 'halberd', 'staff'] as const) {
      const g = arsenal[key];
      g.visible = false;
      handR.add(g);
      // misma orientación base que la espada (fijada en espacio mundo)
      g.quaternion.copy(arsenal.sword.quaternion);
      g.position.copy(arsenal.sword.position);
    }
    // el arco se empuña girado (perpendicular al brazo)
    arsenal.bow.rotateY(Math.PI / 2);
  }
  // el escudo fue añadido como último hijo de la mano izquierda (makeCharacter)
  const handL = char.rig.handL;
  const shieldObj: THREE.Object3D | null = handL && handL.children.length > 0
    ? handL.children[handL.children.length - 1] : null;

  char.setWeapon = (t: HeroWeaponVisual) => {
    for (const key of Object.keys(arsenal) as HeroWeaponVisual[]) {
      arsenal[key].visible = key === t;
    }
    if (shieldObj) shieldObj.visible = t === 'sword'; // alabarda/bastón son a dos manos
  };
  return char;
}

export type EnemyVariant = 'goblin' | 'archer' | 'orc' | 'boss' | 'boss2';

const ENEMY_LOOK: Record<EnemyVariant, {
  h: number; tint: number; emissive: number | null; emissiveI: number;
}> = {
  goblin: { h: 1.12, tint: 0xb2c48a, emissive: null, emissiveI: 0 },
  archer: { h: 1.38, tint: 0xbadce8, emissive: 0x2ad8ff, emissiveI: 0.3 },
  orc: { h: 2.16, tint: 0xd8a898, emissive: null, emissiveI: 0 },
  boss: { h: 2.95, tint: 0x8a7a94, emissive: 0xff2a1e, emissiveI: 0.16 },
  // dragón ancestral: azul glacial con vientre de brasa
  boss2: { h: 3.4, tint: 0x6a9ac8, emissive: 0x37d8ff, emissiveI: 0.34 },
};

/** Mapeo de clips nativos del monstruo → nombres del motor */
const MONSTER_CLIPS: Record<EnemyVariant, Record<string, string>> = {
  goblin: { idle: 'Idle', walk: 'Walk', run: 'Run', strafe: 'Idle', hurt: 'HitReact', death: 'Death', attack1: 'Punch', attack2: 'Weapon', cast: 'Punch' },
  archer: { idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying', strafe: 'Flying_Idle', hurt: 'HitReact', death: 'Death', attack1: 'Headbutt', attack2: 'Headbutt', cast: 'Punch' },
  orc: { idle: 'Idle', walk: 'Walk', run: 'Run', strafe: 'Idle', hurt: 'HitReact', death: 'Death', attack1: 'Punch', attack2: 'Weapon', cast: 'Punch' },
  boss: { idle: 'Idle', walk: 'Walk', run: 'Run', strafe: 'Idle', hurt: 'HitReact', death: 'Death', attack1: 'Punch', attack2: 'Weapon', cast: 'Weapon' },
  boss2: { idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying', strafe: 'Flying_Idle', hurt: 'HitReact', death: 'Death', attack1: 'Headbutt', attack2: 'Punch', cast: 'Punch' },
};

/** Velocidad de reproducción por clip (ajusta paso natural a velocidad de juego) */
const MONSTER_TIMESCALE: Record<EnemyVariant, Record<string, number>> = {
  goblin: { walk: 1.5, run: 1.35 },
  archer: { walk: 0.6, run: 1.0 },
  orc: { walk: 1.35, run: 1.25 },
  boss: { walk: 1.1, run: 1.05 },
  boss2: { walk: 0.9, run: 1.0 },
};

export function monsterTimeScale(type: EnemyVariant, clip: string): number {
  return MONSTER_TIMESCALE[type]?.[clip] ?? 1;
}

/** Enemigo: monstruo Quaternius clonado + tinte por tipo + clips del motor */
export function createEnemyCharacter(pack: CharacterPack, type: EnemyVariant): GlbCharacter {
  const mp = pack.monsters[type];
  if (!mp) throw new Error(`sin monstruo para ${type}`);
  const look = ENEMY_LOOK[type];
  const model = SkeletonUtils.clone(mp.source);
  // materiales propios (flash, fundido y tinte por variante)
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      m.color = new THREE.Color(look.tint).multiply(m.color);
      m.roughness = 0.66;
      m.metalness = 0.12;
      m.envMapIntensity = 0.8;
      if (look.emissive) {
        m.emissive = new THREE.Color(look.emissive);
        m.emissiveIntensity = look.emissiveI;
      }
      o.material = m;
    }
  });
  normalizeModel(model, look.h);
  enableShadows(model);

  // clips renombrados a nombres del motor
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const [engine, native] of Object.entries(MONSTER_CLIPS[type])) {
    const c = mp.clips[native];
    if (c) clips[engine] = c;
  }
  // clips de combate del héroe NO aplican; los nombres usados por la IA:
  // idle/walk/run/strafe/hurt/death + attack1/attack2/cast (ENEMY_CFG)
  return makeCharacter(model, look.h, clips, null, null, false);
}

/**
 * Devuelve duraciones reales de los clips de ataque de cada tipo para
 * sincronizar ENEMY_CFG (hitAt/dur) con la animación. Game lo aplica al iniciar.
 */
export function monsterAttackTimings(pack: CharacterPack): {
  type: EnemyVariant; idx: number; dur: number; hitAt: number;
}[] {
  const defs: { type: EnemyVariant; idx: number; clip: string; frac: number }[] = [
    { type: 'goblin', idx: 0, clip: 'attack1', frac: 0.62 },
    { type: 'archer', idx: 0, clip: 'cast', frac: 0.45 },
    { type: 'orc', idx: 0, clip: 'attack2', frac: 0.62 },
    { type: 'boss', idx: 0, clip: 'attack1', frac: 0.58 },
    { type: 'boss', idx: 1, clip: 'attack2', frac: 0.62 },
    { type: 'boss', idx: 2, clip: 'attack1', frac: 0.45 },
    { type: 'boss', idx: 3, clip: 'cast', frac: 0.5 },
    { type: 'boss2', idx: 0, clip: 'attack1', frac: 0.52 },
    { type: 'boss2', idx: 1, clip: 'attack2', frac: 0.62 },
    { type: 'boss2', idx: 2, clip: 'cast', frac: 0.55 },
    { type: 'boss2', idx: 3, clip: 'attack2', frac: 0.48 },
  ];
  const out: { type: EnemyVariant; idx: number; dur: number; hitAt: number }[] = [];
  for (const d of defs) {
    const mp = pack.monsters[d.type];
    if (!mp) continue;
    const native = MONSTER_CLIPS[d.type][d.clip];
    const clip = native ? mp.clips[native] : null;
    if (!clip || clip.duration < 0.15) continue;
    out.push({ type: d.type, idx: d.idx, dur: clip.duration, hitAt: clip.duration * d.frac });
  }
  return out;
}

/** Mercader: Soldier clonado (Idle/Walk nativos + saludo horneado) */
export function createMerchantCharacter(pack: CharacterPack): GlbCharacter {
  const targetH = 1.58;
  const model = SkeletonUtils.clone(pack.soldierSource);
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (m.name.includes('Body')) m.color.lerp(new THREE.Color(0x7a3b52), 0.55);
      m.roughness = 0.72;
      o.material = m;
    }
  });
  normalizeModel(model, targetH);
  enableShadows(model);
  const rest = captureRest(model);
  const binder = new SkeletonBinder(model, true);
  const clips: Record<string, THREE.AnimationClip> = { ...pack.soldierClips };
  clips.greet = bakeLoopClip('greet', 1.2, 16, t => greetPose(t), binder, targetH);
  restoreRest(model, rest);
  return makeCharacter(model, targetH, clips, null, null, false);
}

/** Herrero Bran: Soldier corpulento teñido de cuero, martillo en mano y martilleo horneado */
export function createBlacksmithCharacter(pack: CharacterPack): GlbCharacter {
  const targetH = 1.72;
  const model = SkeletonUtils.clone(pack.soldierSource);
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (m.name.includes('Body')) m.color.lerp(new THREE.Color(0x4a3226), 0.7); // delantal de cuero
      m.roughness = 0.78;
      o.material = m;
    }
  });
  normalizeModel(model, targetH);
  enableShadows(model);
  const rest = captureRest(model);
  const binder = new SkeletonBinder(model, true);
  const clips: Record<string, THREE.AnimationClip> = { ...pack.soldierClips };
  clips.hammer = bakeLoopClip('hammer', 1.5, 24, t => hammerPose(t), binder, targetH);
  restoreRest(model, rest);
  const hammer = buildHammer(1.15);
  return makeCharacter(model, targetH, clips, hammer, null, false);
}

/* ============================================================
   ZORROS — criaturas ambientales (Survey/Walk/Run nativos)
   ============================================================ */

export class Fox {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  private animator: GlbAnimator;
  private target = new THREE.Vector3();
  private state: 'survey' | 'walk' | 'run' = 'survey';
  private t = rand(0, 5);
  private cd = rand(1, 4);

  constructor(pack: CharacterPack, x: number, z: number) {
    const model = SkeletonUtils.clone(pack.foxSource);
    normalizeModel(model, 0.58);
    enableShadows(model);
    const clips = lowercaseClips(pack.foxClips);
    if (clips.survey) clips.idle = clips.survey;
    this.animator = new GlbAnimator(model, clips);
    this.root.add(model);
    this.pos.set(x, terrainHeight(x, z), z);
    this.root.position.copy(this.pos);
    this.pickTarget();
  }

  private pickTarget() {
    const a = rand(0, Math.PI * 2);
    const r = rand(8, 46);
    this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.target.y = terrainHeight(this.target.x, this.target.z);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.t += dt;
    this.cd -= dt;
    const dPlayer = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    if (dPlayer < 4.5) {
      const away = new THREE.Vector3(this.pos.x - playerPos.x, 0, this.pos.z - playerPos.z).normalize();
      this.target.copy(this.pos).addScaledVector(away, 12);
      this.target.y = terrainHeight(this.target.x, this.target.z);
      this.state = 'run';
    } else if (this.cd <= 0) {
      if (this.state !== 'survey') {
        this.state = 'survey'; this.cd = rand(2, 5);
      } else {
        this.pickTarget();
        this.state = rand(0, 1) > 0.35 ? 'walk' : 'run';
        this.cd = rand(4, 9);
      }
    }
    if (this.state !== 'survey') {
      const to = new THREE.Vector3().subVectors(this.target, this.pos).setY(0);
      if (to.length() < 1.4) { this.state = 'survey'; this.cd = rand(2, 6); }
      else {
        to.normalize();
        const spd = this.state === 'run' ? 5.2 : 1.7;
        this.pos.addScaledVector(to, spd * dt);
        this.pos.y = terrainHeight(this.pos.x, this.pos.z);
        this.yaw = this.yaw + (Math.atan2(to.x, to.z) - this.yaw) * (1 - Math.exp(-6 * dt));
      }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 78) { this.pos.multiplyScalar(78 / r); this.pickTarget(); }
    this.animator.play(this.state, { fade: 0.25 });
    this.animator.update(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

export function createFoxes(pack: CharacterPack, count: number): Fox[] {
  const foxes: Fox[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(20, 55);
    foxes.push(new Fox(pack, Math.cos(a) * r, Math.sin(a) * r));
  }
  return foxes;
}

/* ============================================================
   RUINAS — mazmorra GLB fusionada por material (1 landmark)
   ============================================================ */

function mergeDungeon(scene: THREE.Object3D): { group: THREE.Group; radius: number } {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !o.material || Array.isArray(o.material)) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const list = byMat.get(o.material as THREE.Material) ?? [];
    list.push(geo);
    byMat.set(o.material as THREE.Material, list);
  });
  const group = new THREE.Group();
  let radius = 6;
  // Material de piedra del juego: cohesiona las ruinas y evita
  // materiales metálicos del GLB sin IBL (salían negros)
  const stone = stoneMat();
  for (const [, geos] of byMat) {
    const merged = mergeDungeonGeos(geos);
    if (!merged) continue;
    merged.computeBoundingSphere();
    radius = Math.max(radius, merged.boundingSphere?.radius ?? 6);
    const mesh = new THREE.Mesh(merged, stone);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'ruina';
    group.add(mesh);
  }
  // normalizar: la mazmorra llega en unidades arbitrarias → landmark de ~34 m
  const bbox = new THREE.Box3().setFromObject(group);
  const maxDim = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
  const s = 34 / Math.max(1, maxDim);
  group.scale.setScalar(s);
  group.updateMatrixWorld(true);
  const bbox2 = new THREE.Box3().setFromObject(group);
  group.position.y = -bbox2.min.y;
  radius *= s;
  return { group, radius };
}

function mergeDungeonGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  try {
    const clean = geos.map(g => {
      const c = g.index ? g.toNonIndexed() : g;
      for (const name of [...Object.keys(c.attributes)]) {
        if (!['position', 'normal', 'uv', 'color'].includes(name)) c.deleteAttribute(name);
      }
      if (!c.attributes.uv) {
        const count = c.attributes.position.count;
        c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (!c.attributes.normal) c.computeVertexNormals();
      return c;
    });
    return mergeGeometries(clean, false);
  } catch (err) {
    console.warn('[AETHERIA] no se pudieron fusionar las ruinas:', err);
    return null;
  }
}

/* ============================================================
   CARGA DE ASSETS (local, desde public/assets/models)
   ============================================================ */

const ASSETS: { file: string; label: string }[] = [
  { file: 'readyplayer.me.glb', label: 'el héroe' },
  { file: 'rpm-anims/M_Standing_Idle_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Walk_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Walk_Backwards_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Jog_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Run_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Jog_Strafe_Left_001.glb', label: 'el mocap' },
  { file: 'rpm-anims/M_Jog_Strafe_Right_001.glb', label: 'el mocap' },
  { file: 'Soldier.glb', label: 'aliados' },
  { file: 'monsters/Tribal.gltf', label: 'las bestias' },
  { file: 'monsters/Ghost_Skull.gltf', label: 'los espectros' },
  { file: 'monsters/Orc.gltf', label: 'los orcos' },
  { file: 'monsters/Demon.gltf', label: 'el señor de la noche' },
  { file: 'monsters/Dragon.gltf', label: 'el dragón ancestral' },
  { file: 'Fox.glb', label: 'criaturas' },
  { file: 'dungeon_warkarma.glb', label: 'las ruinas' },
];

interface LoadedGltf { scene: THREE.Group; animations: THREE.AnimationClip[] }

export async function loadCharacterAssets(
  onProgress?: (frac: number, label: string) => void,
): Promise<CharacterPack | null> {
  try {
    const loader = new GLTFLoader();
    const loaded: Record<string, LoadedGltf> = {};
    for (let i = 0; i < ASSETS.length; i++) {
      const a = ASSETS[i];
      onProgress?.(i / ASSETS.length, a.label);
      loaded[a.file] = await new Promise<LoadedGltf>((res, rej) => {
        loader.load(`${MODEL_DIR}/${a.file}`, res, undefined, rej);
      });
    }
    onProgress?.(0.95, 'despertar al mundo');

    const heroG = loaded['readyplayer.me.glb'];
    const soldierG = loaded['Soldier.glb'];
    const foxG = loaded['Fox.glb'];
    const dungeonG = loaded['dungeon_warkarma.glb'];

    // mocap RPM: guardado con el nombre de archivo como clave
    const rpmClips: Record<string, THREE.AnimationClip> = {};
    for (const [engine, raw] of RPM_MAP) {
      const file = `rpm-anims/${raw}.glb`;
      const gltf = loaded[file];
      if (gltf && gltf.animations.length > 0) {
        rpmClips[raw] = stripRootMotion(gltf.animations[0]);
      }
      void engine;
    }

    // monstruos: fuente + clips nativos indexados por nombre
    const monsters: CharacterPack['monsters'] = {};
    const monsterFiles: [EnemyVariant, string][] = [
      ['goblin', 'monsters/Tribal.gltf'],
      ['archer', 'monsters/Ghost_Skull.gltf'],
      ['orc', 'monsters/Orc.gltf'],
      ['boss', 'monsters/Demon.gltf'],
      ['boss2', 'monsters/Dragon.gltf'],
    ];
    for (const [variant, file] of monsterFiles) {
      const gltf = loaded[file];
      if (!gltf) continue;
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const c of gltf.animations) clips[c.name] = c;
      monsters[variant] = { source: gltf.scene, clips };
    }
    const monsterCount = Object.keys(monsters).length;
    if (monsterCount === 0) {
      console.warn('[AETHERIA] monstruos no disponibles — fallback procedural');
    }

    let dungeon: THREE.Group | null = null;
    let dungeonRadius = 8;
    try {
      const d = mergeDungeon(dungeonG.scene);
      dungeon = d.group;
      dungeonRadius = d.radius;
    } catch (err) {
      console.warn('[AETHERIA] ruinas no disponibles:', err);
    }

    return {
      heroSource: heroG.scene,
      rpmClips,
      soldierSource: soldierG.scene,
      soldierClips: lowercaseClips(soldierG.animations),
      monsters,
      foxSource: foxG.scene,
      foxClips: foxG.animations,
      dungeon,
      dungeonRadius,
    };
  } catch (err) {
    console.warn('[AETHERIA] modelos GLB no disponibles — se usan los rigs procedurales:', err);
    return null;
  }
}
