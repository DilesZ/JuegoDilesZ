import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dampAngle, rand, terrainHeight } from './core';
import { buildSword, buildGreatsword, buildAxe, buildClub, buildBow, buildShield, stoneMat, type VisualRig } from './models';
import { CLIPS, sampleClip, idlePose, strafePose, type Pose } from './animations';

/* ============================================================
   PERSONAJES GLB REALES (rigged + animados, licencia libre Mixamo)
   - Héroe: readyplayer.me.glb + locomoción retargeteada desde Soldier.glb
   - Enemigos: Xbot.glb clonado (SkeletonUtils) con variantes de tinte
   - Mercader: Soldier.glb clonado (Idle/Walk nativos)
   - Zorros: Fox.glb (Survey/Walk/Run)
   - Ruinas: dungeon_warkarma.glb fusionado por material

   Los clips de COMBATE se hornean sobre el esqueleto real a partir de
   los mismos CLIPS procedurales del juego (mismas duraciones → los
   tiempos de hitAt/dur de la jugabilidad se conservan exactos).
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
  current = '';
  speed = 1;

  constructor(root: THREE.Object3D, clips: Record<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of Object.entries(clips)) {
      this.actions.set(name, this.mixer.clipAction(clip));
    }
  }

  has(name: string) { return this.actions.has(name); }

  play(name: string, opts: { fade?: number; once?: boolean; restart?: boolean; timeScale?: number } = {}) {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === name && !opts.restart) return;
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

export interface GlbCharacter {
  root: THREE.Group;
  model: THREE.Object3D;
  rig: VisualRig;
  animator: GlbAnimator;
  height: number;
}

export interface CharacterPack {
  heroSource: THREE.Object3D;
  soldierSource: THREE.Object3D;
  /** clips crudos del Soldier (fuente del retarget del héroe) */
  soldierClipsRaw: THREE.AnimationClip[];
  /** clips del Soldier renombrados en minúscula (mercader) */
  soldierClips: Record<string, THREE.AnimationClip>;
  xbotSource: THREE.Object3D;
  /** clips nativos de Xbot renombrados (idle/walk/run...) */
  xbotClips: Record<string, THREE.AnimationClip>;
  /** clips de combate horneados sobre el esqueleto Xbot (compartidos) */
  xbotCombat: Record<string, THREE.AnimationClip>;
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

function enableShadows(model: THREE.Object3D) {
  model.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
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

/* ---------- Retarget de locomoción (Soldier → héroe) ---------- */

function retargetLocomotion(
  targetModel: THREE.Object3D,
  sourceModel: THREE.Object3D,
  sourceClips: THREE.AnimationClip[],
): Record<string, THREE.AnimationClip> | null {
  try {
    const targetSkin = targetModel.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined;
    const sourceSkin = sourceModel.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined;
    if (!targetSkin || !sourceSkin) return null;
    const sourceNames = new Set(sourceSkin.skeleton.bones.map(b => b.name));
    // GLTFLoader sanea los nombres ('mixamorig:Hips' → 'mixamorigHips'):
    // probamos las tres variantes al construir el mapa destino→fuente
    const names: Record<string, string> = {};
    for (const b of targetSkin.skeleton.bones) {
      for (const cand of [`mixamorig:${b.name}`, `mixamorig${b.name}`, b.name]) {
        if (sourceNames.has(cand) && cand !== b.name) { names[b.name] = cand; break; }
      }
    }
    const hipName = names['Hips'] ?? 'mixamorigHips';
    const out: Record<string, THREE.AnimationClip> = {};
    for (const clip of sourceClips) {
      if (!/^(idle|walk|run)$/i.test(clip.name)) continue;
      const retargeted = SkeletonUtils.retargetClip(targetSkin, sourceSkin, clip, {
        hip: hipName,
        names,
      });
      if (retargeted && retargeted.tracks.length > 0) {
        // retargetClip genera tracks '.bones[X].quaternion' (requieren mixer
        // sobre el SkinnedMesh); los reescribimos a 'X.quaternion' para que
        // convivan con los clips horneados en el mixer de la escena.
        for (const tr of retargeted.tracks) {
          tr.name = tr.name.replace(/^\.bones\[(.+?)\]\./, '$1.');
        }
        out[clip.name.toLowerCase()] = retargeted;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch (err) {
    console.warn('[AETHERIA] retarget de locomoción falló:', err);
    return null;
  }
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
    handR = findBone(model, 'RightHand', 'RightForeArm');
    handL = findBone(model, 'LeftHand', 'LeftForeArm');
  }
  model.updateMatrixWorld(true);
  if (weapon && handR) {
    handR.add(weapon);
    // La orientación de los huesos de mano varía por rig: fijamos la hoja
    // en espacio mundo (arriba y ligeramente al frente) calculando
    // q_local = q_mundo_mano⁻¹ · q_deseado, con el modelo en pose de reposo.
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
    // cara del escudo (+Z local) hacia fuera-izquierda y algo al frente
    const desiredL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.15, 0));
    sh.quaternion.copy(handWorldL.invert().multiply(desiredL));
    sh.position.set(0, -0.07, 0);
  }
  const animator = new GlbAnimator(model, clips);
  return {
    root, model,
    rig: { root, weapon, weaponMat: (weaponMat ?? null) as VisualRig['weaponMat'], handR, handL, height },
    animator, height,
  };
}

/** Héroe: readyplayer.me + locomoción retargeteada + combate horneado */
export function createHeroCharacter(pack: CharacterPack): GlbCharacter {
  const targetH = 1.62;
  const model = SkeletonUtils.clone(pack.heroSource);
  normalizeModel(model, targetH);
  enableShadows(model);
  const rest = captureRest(model);

  const binder = new SkeletonBinder(model, true);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const n of ['slash1', 'slash2', 'slash3', 'heavy', 'roll', 'hurt', 'death']) {
    clips[n] = bakeActionClip(n, n, binder, targetH);
  }
  clips.strafe = bakeLoopClip('strafe', Math.PI / 4, 12, t => strafePose(t, false), binder, targetH);
  clips.potion = bakeLoopClip('potion', 0.45, 8, t => potionPose(t), binder, targetH);

  // locomoción real (mocap) retargeteada desde Soldier; el soldado queda
  // poseído tras el retarget → se restaura su reposo para clones posteriores
  const soldierRest = captureRest(pack.soldierSource);
  const loco = retargetLocomotion(model, pack.soldierSource, pack.soldierClipsRaw);
  restoreRest(pack.soldierSource, soldierRest);
  if (loco) {
    Object.assign(clips, loco);
  } else {
    console.warn('[AETHERIA] héroe sin mocap: loops horneados de respaldo');
    clips.idle = bakeLoopClip('idle', Math.PI / 0.9, 14, t => idlePose(t), binder, targetH);
  }

  restoreRest(model, rest);

  const weapon = buildSword(1.05);
  let weaponMat: THREE.Material | null = null;
  weapon.traverse(m => {
    if (m instanceof THREE.Mesh) {
      const mm = m.material as THREE.MeshStandardMaterial;
      if (mm && mm.emissive && mm.emissiveIntensity > 0) weaponMat = mm;
    }
  });
  return makeCharacter(model, targetH, clips, weapon, weaponMat, true);
}

export type EnemyVariant = 'goblin' | 'archer' | 'orc' | 'boss';

const ENEMY_LOOK: Record<EnemyVariant, { h: number; tint: number; emissive: number | null; weapon: 'club' | 'bow' | 'axe' | 'greatsword'; ws: number }> = {
  goblin: { h: 1.06, tint: 0x8fae4a, emissive: null, weapon: 'club', ws: 0.75 },
  archer: { h: 1.5, tint: 0xb8a888, emissive: null, weapon: 'bow', ws: 1.1 },
  orc: { h: 2.14, tint: 0x9a4a3a, emissive: null, weapon: 'axe', ws: 1.45 },
  boss: { h: 2.95, tint: 0x34303e, emissive: 0xff2a1e, weapon: 'greatsword', ws: 1.9 },
};

/** Enemigo: Xbot clonado + tinte por tipo + clips compartidos (nativos y horneados) */
export function createEnemyCharacter(pack: CharacterPack, type: EnemyVariant): GlbCharacter {
  const look = ENEMY_LOOK[type];
  const model = SkeletonUtils.clone(pack.xbotSource);
  // materiales propios (flash, fundido y tinte por variante)
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      m.color = new THREE.Color(look.tint);
      m.roughness = 0.62;
      m.metalness = 0.22;
      if (look.emissive) {
        m.emissive = new THREE.Color(look.emissive);
        m.emissiveIntensity = type === 'boss' ? 0.55 : 0.25;
      }
      o.material = m;
    }
  });
  normalizeModel(model, look.h);
  enableShadows(model);

  const clips: Record<string, THREE.AnimationClip> = { ...pack.xbotClips, ...pack.xbotCombat };
  let weaponMat: THREE.Material | null = null;
  let weapon: THREE.Group | null = null;
  switch (look.weapon) {
    case 'club': weapon = buildClub(); break;
    case 'bow': weapon = buildBow(); break;
    case 'axe': weapon = buildAxe(); break;
    case 'greatsword': weapon = buildGreatsword(1); break;
  }
  if (weapon) {
    weapon.scale.setScalar(look.ws);
    weapon.traverse(m => {
      if (m instanceof THREE.Mesh) {
        const mm = m.material as THREE.MeshStandardMaterial;
        if (mm && mm.emissive && mm.emissiveIntensity > 0) weaponMat = mm;
      }
    });
  }
  return makeCharacter(model, look.h, clips, weapon, weaponMat, false);
}

/** Mercader: Soldier clonado (Idle/Walk nativos + saludo horneado) */
export function createMerchantCharacter(pack: CharacterPack): GlbCharacter {
  const targetH = 1.58;
  const model = SkeletonUtils.clone(pack.soldierSource);
  model.traverse(o => {
    if (o instanceof THREE.Mesh && o.material && !Array.isArray(o.material)) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (m.name.includes('Body')) m.color.lerp(new THREE.Color(0x7a3b52), 0.55);
      m.roughness = 0.7;
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
        this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), 6, dt);
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
  // Material de piedra estilizada del juego: cohesiona las ruinas con
  // obeliscos/pilares y evita materiales negros del GLB (metálicos sin IBL)
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
  { file: 'Soldier.glb', label: 'aliados' },
  { file: 'Xbot.glb', label: 'enemigos' },
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
    const xbotG = loaded['Xbot.glb'];
    const foxG = loaded['Fox.glb'];
    const dungeonG = loaded['dungeon_warkarma.glb'];

    // clips compartidos de Xbot: nativos + combate horneado UNA vez.
    // Se hornean sobre el esqueleto SIN escalar con su altura real: al
    // escalar después cada variante, bodyY queda proporcionalmente correcto.
    xbotG.scene.updateMatrixWorld(true);
    const xbBox = new THREE.Box3().setFromObject(xbotG.scene);
    const xbH = Math.max(0.5, xbBox.max.y - xbBox.min.y);
    const xbRest = captureRest(xbotG.scene);
    const xbBinder = new SkeletonBinder(xbotG.scene, true);
    const xbotCombat: Record<string, THREE.AnimationClip> = {};
    for (const n of ['enemySlash', 'enemyOverhead', 'bossSlam', 'bossSpin', 'bowShot', 'hurt', 'death']) {
      xbotCombat[n] = bakeActionClip(n, n, xbBinder, xbH);
    }
    xbotCombat.strafe = bakeLoopClip('strafe', Math.PI / 4, 12, t => strafePose(t, false), xbBinder, xbH);
    restoreRest(xbotG.scene, xbRest);

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
      soldierSource: soldierG.scene,
      soldierClipsRaw: soldierG.animations,
      soldierClips: lowercaseClips(soldierG.animations),
      xbotSource: xbotG.scene,
      xbotClips: lowercaseClips(xbotG.animations),
      xbotCombat,
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
