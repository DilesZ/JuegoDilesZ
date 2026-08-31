import * as THREE from 'three';
import { lerp, clamp } from './core';
import type { HumanoidRig } from './models';

/* ============================================================
   ANIMACIÓN PROCEDURAL por keyframes sobre el rig humanoide.
   Cada pose define rotaciones (Euler) por articulación + offset de cuerpo.
   ============================================================ */

export type Vec3 = [number, number, number];
export type JointName = 'body' | 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'weapon';
export type Pose = Record<JointName, Vec3> & { bodyY: number };

export function makePose(p: Partial<Record<JointName, Vec3>> & { bodyY?: number }): Pose {
  return {
    body: p.body ?? [0, 0, 0],
    torso: p.torso ?? [0, 0, 0],
    head: p.head ?? [0, 0, 0],
    armL: p.armL ?? [0, 0, 0],
    armR: p.armR ?? [0, 0, 0],
    legL: p.legL ?? [0, 0, 0],
    legR: p.legR ?? [0, 0, 0],
    weapon: p.weapon ?? [0, 0, 0],
    bodyY: p.bodyY ?? 0,
  };
}
export const ZERO_POSE = makePose({});

type Track = number[][]; // [t, x, y, z] (bodyY usa [t, v])
interface PoseClip {
  dur: number;
  ch: Partial<Record<JointName | 'bodyY', Track>>;
}

function sample(track: Track, t: number, out: Vec3): Vec3 {
  if (track.length === 0) return out;
  if (t <= track[0][0]) { out[0] = track[0][1]; out[1] = track[0][2]; out[2] = track[0][3]; return out; }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const k = (t - a[0]) / Math.max(1e-5, b[0] - a[0]);
      const e = k * k * (3 - 2 * k); // smoothstep
      out[0] = lerp(a[1], b[1], e); out[1] = lerp(a[2], b[2], e); out[2] = lerp(a[3], b[3], e);
      return out;
    }
  }
  const last = track[track.length - 1];
  out[0] = last[1]; out[1] = last[2]; out[2] = last[3];
  return out;
}

const _v: Vec3 = [0, 0, 0];
export function sampleClip(clip: PoseClip, t: number): Pose {
  const nt = clamp(t / clip.dur, 0, 1) * clip.dur;
  const pose = makePose({});
  for (const key of Object.keys(clip.ch) as (keyof typeof clip.ch)[]) {
    const track = clip.ch[key]!;
    if (key === 'bodyY') {
      const tmp = sample(track, nt, [0, 0, 0]);
      pose.bodyY = tmp[0];
    } else {
      sample(track, nt, _v);
      pose[key] = [_v[0], _v[1], _v[2]];
    }
  }
  return pose;
}

/* ---------- Clips de acciones (ataques, rodar, morir...) ---------- */

// T0 = anticipación (viento atrás), T1 = golpe activo, T2 = recuperación
export const CLIPS: Record<string, PoseClip> = {
  slash1: { dur: 0.52, ch: { // tajo horizontal derecha→izquierda
    body: [[0, 0, 0, 0], [0.3, 0.1, 0.55, 0], [0.42, -0.06, -0.75, 0], [0.52, 0, -0.2, 0]],
    torso: [[0, 0, 0, 0], [0.3, 0.05, 0.7, 0], [0.42, 0.08, -0.55, 0], [0.52, 0, -0.1, 0]],
    armR: [[0, -0.12, 0, -0.1], [0.3, -2.4, 0, -0.9], [0.42, -1.15, 0, 0.55], [0.52, -0.5, 0, 0.1]],
    armL: [[0, -0.12, 0, 0.1], [0.3, -0.4, 0, 0.5], [0.42, -0.9, 0, 0.35], [0.52, -0.3, 0, 0.2]],
    legL: [[0, 0, 0, 0], [0.3, 0.15, 0, 0], [0.42, -0.2, 0, 0], [0.52, 0, 0, 0]],
    legR: [[0, 0, 0, 0], [0.3, -0.2, 0, 0], [0.42, 0.25, 0, 0], [0.52, 0, 0, 0]],
  } },
  slash2: { dur: 0.5, ch: { // regreso izquierda→derecha
    body: [[0, 0, 0, 0], [0.28, 0.08, -0.7, 0], [0.4, -0.05, 0.6, 0], [0.5, 0, 0.1, 0]],
    torso: [[0, 0, 0, 0], [0.28, 0.05, -0.6, 0], [0.4, 0.08, 0.5, 0], [0.5, 0, 0, 0]],
    armR: [[0, -0.5, 0, 0.1], [0.28, -1.3, 0, 0.6], [0.4, -2.3, 0, -0.8], [0.5, -0.35, 0, -0.2]],
    armL: [[0, -0.9, 0, 0.35], [0.28, -0.5, 0, 0.3], [0.4, -0.3, 0, 0.5], [0.5, -0.2, 0, 0.2]],
  } },
  slash3: { dur: 0.66, ch: { // golpe de arriba abajo (final de combo)
    body: [[0, 0, 0, 0], [0.34, -0.25, 0.05, 0], [0.48, 0.3, 0, 0], [0.62, 0.05, 0, 0], [0.66, 0, 0, 0]],
    torso: [[0, 0, 0, 0], [0.34, -0.3, 0, 0], [0.48, 0.35, 0, 0], [0.62, 0.05, 0, 0], [0.66, 0, 0, 0]],
    armR: [[0, -0.35, 0, -0.2], [0.34, -2.9, 0, -0.15], [0.48, -0.7, 0, 0.05], [0.66, -0.3, 0, 0]],
    armL: [[0, -0.2, 0, 0.2], [0.34, -0.8, 0, 0.5], [0.48, -0.4, 0, 0.4], [0.66, -0.2, 0, 0.2]],
    legL: [[0, 0, 0, 0], [0.34, -0.3, 0, 0], [0.48, 0.2, 0, 0], [0.66, 0, 0, 0]],
    legR: [[0, 0, 0, 0], [0.34, 0.3, 0, 0], [0.48, -0.3, 0, 0], [0.66, 0, 0, 0]],
    bodyY: [[0, 0], [0.34, -0.08], [0.48, 0.04], [0.66, 0]],
  } },
  heavy: { dur: 0.95, ch: { // mandoble vertical cargado
    body: [[0, 0, 0, 0], [0.42, -0.32, 0.15, 0], [0.6, 0.38, -0.1, 0], [0.82, 0.08, 0, 0], [0.95, 0, 0, 0]],
    torso: [[0, 0, 0, 0], [0.42, -0.4, 0.3, 0], [0.6, 0.45, -0.2, 0], [0.82, 0.1, 0, 0], [0.95, 0, 0, 0]],
    armR: [[0, -0.3, 0, -0.3], [0.42, -3.0, 0, -0.35], [0.6, -0.55, 0, 0.1], [0.82, -0.4, 0, 0], [0.95, -0.12, 0, -0.1]],
    armL: [[0, -0.2, 0, 0.3], [0.42, -1.0, 0, 0.6], [0.6, -0.5, 0, 0.4], [0.82, -0.3, 0, 0.2], [0.95, -0.12, 0, 0.1]],
    legL: [[0, 0, 0, 0], [0.42, -0.35, 0, 0], [0.6, 0.3, 0, 0], [0.95, 0, 0, 0]],
    legR: [[0, 0, 0, 0], [0.42, 0.35, 0, 0], [0.6, -0.35, 0, 0], [0.95, 0, 0, 0]],
    bodyY: [[0, 0], [0.42, -0.14], [0.6, 0.06], [0.95, 0]],
  } },
  enemySlash: { dur: 0.85, ch: { // tajo genérico de enemigo (lento y legible)
    body: [[0, 0, 0, 0], [0.5, 0.12, 0.5, 0], [0.66, -0.1, -0.6, 0], [0.85, 0, -0.1, 0]],
    torso: [[0, 0, 0, 0], [0.5, 0.05, 0.55, 0], [0.66, 0.1, -0.45, 0], [0.85, 0, -0.05, 0]],
    armR: [[0, -0.12, 0, -0.1], [0.5, -2.5, 0, -0.8], [0.66, -1.0, 0, 0.5], [0.85, -0.4, 0, 0]],
    armL: [[0, -0.12, 0, 0.1], [0.5, -0.3, 0, 0.4], [0.66, -0.8, 0, 0.3], [0.85, -0.2, 0, 0.15]],
  } },
  enemyOverhead: { dur: 1.05, ch: { // mandoble enemigo (bruto/orco)
    body: [[0, 0, 0, 0], [0.55, -0.3, 0, 0], [0.72, 0.35, 0, 0], [1.05, 0, 0, 0]],
    torso: [[0, 0, 0, 0], [0.55, -0.35, 0, 0], [0.72, 0.4, 0, 0], [1.05, 0, 0, 0]],
    armR: [[0, -0.3, 0, -0.2], [0.55, -2.9, 0, -0.2], [0.72, -0.6, 0, 0.05], [1.05, -0.3, 0, -0.1]],
    armL: [[0, -0.3, 0, 0.2], [0.55, -2.6, 0, 0.3], [0.72, -0.6, 0, 0.1], [1.05, -0.3, 0, 0.1]],
    bodyY: [[0, 0], [0.55, -0.1], [0.72, 0.05], [1.05, 0]],
  } },
  bowShot: { dur: 0.9, ch: {
    torso: [[0, 0, 0.5, 0], [0.45, 0, 0.5, 0], [0.6, 0, 0.15, 0], [0.9, 0, 0, 0]],
    armL: [[0, -1.5, 0, 0.2], [0.45, -1.5, 0, 0.2], [0.6, -1.5, 0, 0.2], [0.9, -0.3, 0, 0.1]],
    armR: [[0, -1.2, 0, -0.3], [0.45, -1.55, 0, -0.55], [0.6, -1.2, 0, -0.3], [0.9, -0.2, 0, -0.1]],
  } },
  roll: { dur: 0.46, ch: {
    body: [[0, 0, 0, 0], [0.15, -1.4, 0, 0], [0.3, -3.1, 0, 0], [0.44, -5.2, 0, 0], [0.46, -6.28, 0, 0]],
    bodyY: [[0, 0], [0.15, -0.32], [0.3, -0.38], [0.44, -0.1], [0.46, 0]],
    legL: [[0, 0, 0, 0], [0.1, 1.9, 0, 0], [0.4, 1.6, 0, 0], [0.46, 0, 0, 0]],
    legR: [[0, 0, 0, 0], [0.1, 1.7, 0, 0], [0.4, 1.5, 0, 0], [0.46, 0, 0, 0]],
    armL: [[0, 0, 0, 0], [0.1, 1.2, 0, 0.3], [0.46, 0, 0, 0.1]],
    armR: [[0, 0, 0, 0], [0.1, 1.2, 0, -0.3], [0.46, 0, 0, -0.1]],
  } },
  hurt: { dur: 0.38, ch: {
    body: [[0, 0, 0, 0], [0.12, 0.25, 0, 0], [0.38, 0.05, 0, 0]],
    torso: [[0, 0, 0, 0], [0.12, -0.35, 0, 0], [0.38, -0.05, 0, 0]],
    head: [[0, 0, 0, 0], [0.12, -0.3, 0, 0], [0.38, 0, 0, 0]],
    armL: [[0, 0, 0, 0.1], [0.12, -0.6, 0, 0.9], [0.38, 0, 0, 0.1]],
    armR: [[0, 0, 0, -0.1], [0.12, -0.6, 0, -0.9], [0.38, 0, 0, -0.1]],
  } },
  death: { dur: 1.1, ch: {
    body: [[0, 0, 0, 0], [0.35, -0.6, 0.2, 0], [0.75, -1.42, 0.1, 0], [1.1, -1.5, 0.1, 0]],
    bodyY: [[0, 0], [0.35, -0.25], [0.75, -0.48], [1.1, -0.5]],
    torso: [[0, 0, 0, 0], [0.5, -0.3, 0, 0], [1.1, -0.2, 0, 0]],
    head: [[0, 0, 0, 0], [0.5, -0.5, 0, 0], [1.1, -0.3, 0, 0]],
    armL: [[0, 0, 0, 0.1], [0.5, -1.2, 0, 1.0], [1.1, -0.4, 0, 1.3]],
    armR: [[0, 0, 0, -0.1], [0.5, -1.0, 0, -1.0], [1.1, -0.3, 0, -1.2]],
    legL: [[0, 0, 0, 0], [0.5, 0.5, 0, 0], [1.1, 0.2, 0.3, 0]],
    legR: [[0, 0, 0, 0], [0.5, 0.3, 0, 0], [1.1, 0.1, -0.4, 0]],
  } },
  bossSlam: { dur: 1.25, ch: {
    body: [[0, 0, 0, 0], [0.55, -0.42, 0, 0], [0.72, 0.5, 0, 0], [1.0, 0.1, 0, 0], [1.25, 0, 0, 0]],
    torso: [[0, 0, 0, 0], [0.55, -0.5, 0, 0], [0.72, 0.55, 0, 0], [1.25, 0, 0, 0]],
    armR: [[0, -0.4, 0, -0.2], [0.55, -3.1, 0, -0.15], [0.72, -0.5, 0, 0.05], [1.25, -0.2, 0, -0.1]],
    armL: [[0, -0.4, 0, 0.2], [0.55, -2.9, 0, 0.3], [0.72, -0.5, 0, 0.15], [1.25, -0.2, 0, 0.1]],
    legL: [[0, 0, 0, 0], [0.55, -0.4, 0, 0], [0.72, 0.35, 0, 0], [1.25, 0, 0, 0]],
    legR: [[0, 0, 0, 0], [0.55, 0.4, 0, 0], [0.72, -0.4, 0, 0], [1.25, 0, 0, 0]],
    bodyY: [[0, 0], [0.55, -0.18], [0.72, 0.08], [1.25, 0]],
  } },
  bossSpin: { dur: 1.0, ch: {
    body: [[0, 0, 0, 0], [0.3, 0, 0, 0], [0.55, -0.15, 3.3, 0], [0.8, -0.15, 6.6, 0], [1.0, 0, 6.28, 0]],
    armR: [[0, -0.5, 0, -1.2], [0.3, -1.6, 0, -1.35], [0.8, -1.6, 0, -1.35], [1.0, -0.3, 0, -0.1]],
    armL: [[0, -0.5, 0, 1.2], [0.3, -1.6, 0, 1.35], [0.8, -1.6, 0, 1.35], [1.0, -0.3, 0, 0.1]],
    bodyY: [[0, 0], [0.3, -0.08], [0.8, -0.08], [1.0, 0]],
  } },
};

/* ---------- Poses continuas ---------- */

export function idlePose(t: number): Pose {
  const b = Math.sin(t * 1.8);
  return makePose({
    torso: [b * 0.03, 0, 0],
    head: [-b * 0.02, Math.sin(t * 0.5) * 0.06, 0],
    armL: [-0.12 - b * 0.045, 0, 0.12],
    armR: [-0.12 + b * 0.045, 0, -0.12],
    bodyY: b * 0.012,
  });
}

export function runPose(t: number, intensity: number): Pose {
  const f = t * 11;
  const s = Math.sin(f), c = Math.cos(f);
  const k = intensity;
  return makePose({
    torso: [0.14 * k + Math.abs(c) * 0.04, s * 0.1 * k, 0],
    head: [-0.1 * k, 0, 0],
    armL: [(-0.12 - s * 0.85) * k, 0, 0.14],
    armR: [(-0.12 + s * 0.85) * k, 0, -0.14],
    legL: [s * 0.85 * k, 0, 0],
    legR: [-s * 0.85 * k, 0, 0],
    bodyY: Math.abs(c) * 0.05 * k - 0.02 * k,
  });
}

export function strafePose(t: number, moving: boolean): Pose {
  // Pose de combate: ligera guardia; pasos si se mueve
  const f = t * 8;
  const s = moving ? Math.sin(f) : 0;
  return makePose({
    torso: [0.08, 0, 0],
    armL: [-0.5 - s * 0.1, 0, 0.35],
    armR: [-0.45 + s * 0.1, 0, -0.35],
    legL: [s * 0.3, 0, 0],
    legR: [-s * 0.3, 0, 0],
    bodyY: moving ? Math.abs(Math.cos(f)) * 0.03 : Math.sin(t * 1.8) * 0.012,
  });
}

/* ---------- Aplicador con suavizado por articulación ---------- */

const JOINT_KEYS: JointName[] = ['body', 'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'weapon'];

export class PoseApplier {
  private cur: Pose = makePose({});
  constructor(private rig: HumanoidRig, private rate = 14) {}

  /** Aplica una pose objetivo con suavizado exponencial. */
  apply(target: Pose, dt: number, rate = this.rate) {
    const c = this.cur, r = rig(this.rig);
    const k = 1 - Math.exp(-rate * dt);
    for (const j of JOINT_KEYS) {
      const cj = c[j], tj = target[j];
      cj[0] += (tj[0] - cj[0]) * k;
      cj[1] += (tj[1] - cj[1]) * k;
      cj[2] += (tj[2] - cj[2]) * k;
    }
    c.bodyY += (target.bodyY - c.bodyY) * k;
    setRot(r.body, c.body);
    r.body.position.y = r.body.position.y * 0 + (c.bodyY + baseBodyY(r));
    setRot(r.torso, c.torso);
    setRot(r.head, c.head);
    setRot(r.armL, c.armL);
    setRot(r.armR, c.armR);
    setRot(r.legL, c.legL);
    setRot(r.legR, c.legR);
    if (r.weapon) setRot(r.weapon, c.weapon);
  }

  /** Aplicación directa (sin blend) para clips rápidos */
  snap(target: Pose, dt: number) { this.apply(target, dt, 60); }
}

function rig(r: HumanoidRig) { return r; }

function setRot(o: THREE.Object3D, v: Vec3) {
  o.rotation.set(v[0], v[1], v[2]);
}

/** Altura y=del grupo body según escala del rig (piernas) */
export function baseBodyY(r: HumanoidRig): number {
  return 0.52; // constante de buildHumanoid (legLen) antes de escalar;
  // body está dentro de root escalado, así que la escala se aplica sola.
}
