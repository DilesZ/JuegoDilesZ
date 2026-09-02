import * as THREE from 'three';
import { dampAngle, terrainHeight } from './core';
import { buildBlacksmithRig, buildForgeSet, type HumanoidRig, type VisualRig, type ForgeSet } from './models';
import { PoseApplier, idlePose } from './animations';
import { createBlacksmithCharacter, type GlbCharacter, type CharacterPack } from './characters';

/* ============================================================
   HERRERO — Bran, forjador del campamento.
   Trabaja junto a su hornalla encendida: martillea el yunque
   (con chispas y clac metálico), mira al héroe al acercarse
   y la forja ilumina el campamento al caer la noche.
   ============================================================ */

export const SMITH_NAME = 'Bran';

/** Punto de la forja y del herrero (a la izquierda de la hoguera) */
export const SMITH_SPOT = {
  forge: { x: -6.3, z: 7.3 },
  smith: { x: -6.0, z: 6.9 },
  /** punto de interacción (frente al yunque) */
  front: { x: -5.0, z: 6.2 },
};

/** Dónde se considera "cerca del herrero" para interactuar */
export function smithDist(x: number, z: number): number {
  return Math.hypot(x - SMITH_SPOT.front.x, z - SMITH_SPOT.front.z);
}

/** Sprite de rótulo con texto (canvas → textura) */
function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(14, 8, 6, 0.8)';
  roundRect(ctx, 66, 26, 380, 76, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 122, 42, 0.9)';
  ctx.lineWidth = 4;
  roundRect(ctx, 66, 26, 380, 76, 20);
  ctx.stroke();
  ctx.font = '600 44px "Baloo 2", "Nunito", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb37d';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.7, 0.68, 1);
  sp.renderOrder = 15;
  return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Blacksmith {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  rig: VisualRig;
  forge: ForgeSet;
  private procRig: HumanoidRig;
  private glb: GlbCharacter | null = null;
  private applier: PoseApplier;
  private label: THREE.Sprite;
  private t = Math.random() * 10;
  /** ciclo de martilleo: fase dentro del clip (1.5 s) y descanso entre series */
  private hammerT = -1;      // -1 = descansando
  private restCd = rand(1.5, 4);
  /** clacs pendientes de reproducir (Game los convierte en chispas+sonido) */
  clangQueue = 0;

  constructor(pack: CharacterPack | null = null, onSpark?: (pos: THREE.Vector3) => void) {
    this.procRig = buildBlacksmithRig();
    this.rig = this.procRig;
    this.root.add(this.procRig.root);
    if (pack) {
      this.glb = createBlacksmithCharacter(pack);
      this.root.remove(this.procRig.root);
      this.rig = this.glb.rig;
      this.root.add(this.glb.root);
    }
    const m = SMITH_SPOT.smith;
    const h = terrainHeight(m.x, m.z);
    this.pos.set(m.x, h, m.z);
    // mira hacia el yunque/frente (este, hacia la hoguera)
    this.yaw = Math.atan2(SMITH_SPOT.front.x - m.x, SMITH_SPOT.front.z - m.z);
    this.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.applier = new PoseApplier(this.procRig, 10);

    // forja completa: hornalla + yunque + rack de armas + cubo
    // (la hornalla y el yunque miran al punto de interacción)
    const s = SMITH_SPOT.forge;
    const sh = terrainHeight(s.x, s.z);
    this.forge = buildForgeSet();
    this.forge.group.position.set(s.x - m.x, sh - h, s.z - m.z);
    this.forge.group.rotation.y = Math.atan2(SMITH_SPOT.front.x - s.x, SMITH_SPOT.front.z - s.z);
    this.root.add(this.forge.group);

    // rótulo flotante sobre la forja
    this.label = makeLabelSprite(`${SMITH_NAME} · HERRERO`);
    this.label.position.set(s.x - m.x, (sh - h) + 3.4, s.z - m.z);
    this.root.add(this.label);

    void onSpark;
  }

  /** posición mundial del yunque (para chispas al martillear) */
  anvilWorldPos(): THREE.Vector3 {
    const local = this.forge.anvilTop;
    const q = new THREE.Quaternion();
    this.forge.group.getWorldQuaternion(q);
    const out = local.clone().applyQuaternion(q).add(
      new THREE.Vector3().setFromMatrixPosition(this.forge.group.matrixWorld));
    return out;
  }

  /**
   * @param nightFactor 0 = día, 1 = noche cerrada
   * @returns número de clacs emitidos este frame (chispas + sonido)
   */
  update(dt: number, nightFactor: number, playerPos: THREE.Vector3): number {
    this.t += dt;
    let clangs = 0;

    // martilleo: series de 3-5 golpes con descanso
    if (this.hammerT < 0) {
      this.restCd -= dt;
      if (this.restCd <= 0) { this.hammerT = 0; this.restCd = rand(2.5, 5); }
    } else {
      const prev = this.hammerT;
      this.hammerT += dt;
      // el golpe cae en t≈0.9 del clip de 1.5 s (60 %)
      const HIT = 0.9;
      if (prev < HIT && this.hammerT >= HIT) { clangs++; this.clangQueue++; }
      if (this.hammerT >= 1.5) {
        this.hammerT = -1;
        // tras 3-5 golpes seguidos descansa más
        this.restCd = rand(2.5, 6);
      }
    }

    // mira al héroe cuando está cerca (vuelve al yunque al alejarse)
    const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    const toP = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    const working = this.hammerT >= 0;
    let want = this.yaw;
    if (working) {
      // martilleando: mirada al yunque
      const anvil = this.anvilWorldPos();
      want = Math.atan2(anvil.x - this.pos.x, anvil.z - this.pos.z);
    } else if (d < 7) {
      want = toP;
    }
    this.yaw = dampAngle(this.yaw, want, working ? 6 : (d < 7 ? 3 : 1.4), dt);
    this.rig.root.rotation.y = this.yaw;

    // pose: martilleo (GLB horneado) o idle procedural
    if (this.glb) {
      if (working) this.glb.animator.play('hammer', { fade: 0.14 });
      else this.glb.animator.play('idle', { fade: 0.4 });
      this.glb.animator.update(dt);
    } else {
      const pose = idlePose(this.t);
      if (working) {
        const t = this.hammerT;
        const w = Math.max(0, Math.sin(Math.min(1, t / 0.9) * Math.PI));
        pose.armR = [-0.5 - 2.1 * w, 0, -0.35];
        pose.torso = [0.06 + 0.16 * w, 0.18, 0];
        pose.armL = [-0.7, 0, 0.4];
        pose.bodyY = -0.02 - 0.03 * w;
      }
      this.applier.apply(pose, dt, 8);
    }
    this.root.position.y = this.pos.y + Math.sin(this.t * 1.6) * 0.012;

    // hornalla: luz cálida con parpadeo (siempre encendida, más de noche)
    const flicker = 0.86 + Math.sin(this.t * 9.3) * 0.08 + Math.sin(this.t * 23.7) * 0.06;
    const k = 0.55 + 0.45 * Math.max(0.15, nightFactor);
    this.forge.light.intensity = 6.5 * k * flicker;
    const pulse = 1 + Math.sin(this.t * 5.1) * 0.05;
    this.forge.coals.scale.set(1.25 * pulse, 0.5 * pulse, 1);
    (this.forge.coals.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.4 + flicker * 0.8;

    return clangs;
  }

  /** colisiones de la forja (hornalla, yunque y rack) */
  colliderList(): { x: number; z: number; r: number }[] {
    const s = SMITH_SPOT.forge;
    return [
      { x: s.x - 0.4, z: s.z - 0.3, r: 1.0 },
      { x: SMITH_SPOT.smith.x, z: SMITH_SPOT.smith.z, r: 0.55 },
    ];
  }

  static greetingLines(): string[] {
    return [
      '¡Trae acero, viajero! Mi forja no se apaga ni de noche.',
      'Esa hoja puede morder más fuerte… si sabes pagar.',
      'Arco, alabarda, bastón… todo sale de mis manos.',
      'Las brasas susurran: dicen que Bel\'Zaroth teme al fuego forjado.',
    ];
  }
}

// rand local (evita importar core entero)
function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
