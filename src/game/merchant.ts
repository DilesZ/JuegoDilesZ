import * as THREE from 'three';
import { dampAngle, terrainHeight, WORLD } from './core';
import { buildMerchantRig, buildMerchantStall, type HumanoidRig } from './models';
import { PoseApplier, idlePose } from './animations';

/* ============================================================
   MERCADER — Ferran, NPC comercial del campamento.
   De pie tras su puesto junto a la hoguera: respira en idle,
   mira al héroe cuando se acerca, saluda y enciende su farol
   al caer la noche.
   ============================================================ */

export const MERCHANT_NAME = 'Ferran';

/** Punto del puesto y del mercader (a la derecha de la hoguera) */
export const MERCHANT_SPOT = {
  stall: { x: 6.1, z: 7.3 },
  merchant: { x: 6.92, z: 7.3 },
  /** punto de interacción (frente al mostrador) */
  front: { x: 4.75, z: 7.3 },
};

/** Dónde se considera "cerca del mercader" para interactuar */
export function merchantDist(x: number, z: number): number {
  return Math.hypot(x - MERCHANT_SPOT.front.x, z - MERCHANT_SPOT.front.z);
}

/** Sprite de rótulo con texto (canvas → textura) */
function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  // píldora de fondo
  ctx.fillStyle = 'rgba(12, 9, 18, 0.78)';
  roundRect(ctx, 66, 26, 380, 76, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(199, 162, 74, 0.9)';
  ctx.lineWidth = 4;
  roundRect(ctx, 66, 26, 380, 76, 20);
  ctx.stroke();
  // texto
  ctx.font = '600 44px "Baloo 2", "Nunito", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd98a';
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

export class Merchant {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  rig: HumanoidRig;
  private applier: PoseApplier;
  private lantern: THREE.PointLight;
  private lanternCore: THREE.Mesh;
  private label: THREE.Sprite;
  private t = Math.random() * 10;
  /** segundos hasta el próximo saludo al acercarse el héroe */
  greetingCd = 0;
  /** fase del saludo (levanta el brazo) 0 = nada */
  private waveT = 0;

  constructor() {
    // mercader
    this.rig = buildMerchantRig();
    this.root.add(this.rig.root);
    const m = MERCHANT_SPOT.merchant;
    const h = terrainHeight(m.x, m.z);
    this.pos.set(m.x, h, m.z);
    // mira hacia el frente del puesto (oeste, hacia la hoguera)
    this.yaw = Math.atan2(MERCHANT_SPOT.front.x - m.x, MERCHANT_SPOT.front.z - m.z);
    this.root.position.copy(this.pos);
    // el root NO rota (el puesto y el rótulo viven en coords de mundo);
    // solo el rig del personaje gira para mirar al héroe
    this.rig.root.rotation.y = this.yaw;
    this.applier = new PoseApplier(this.rig, 10);

    // puesto: offset directo desde el mercader (root sin rotación)
    const s = MERCHANT_SPOT.stall;
    const sh = terrainHeight(s.x, s.z);
    const stall = buildMerchantStall();
    stall.group.position.set(s.x - m.x, sh - h, s.z - m.z);
    stall.group.rotation.y = this.yaw; // el frente del puesto mira al cliente
    this.root.add(stall.group);
    this.lantern = stall.lantern;
    this.lanternCore = stall.lanternCore;

    // rótulo flotante sobre el toldo (offset de mundo)
    this.label = makeLabelSprite(`${MERCHANT_NAME} · MERCADER`);
    this.label.position.set(s.x - m.x, (sh - h) + 2.85, s.z - m.z);
    this.root.add(this.label);
  }

  /**
   * @param nightFactor 0 = día, 1 = noche cerrada
   * @returns true si acaba de saludar (para que Game muestre el texto)
   */
  update(dt: number, nightFactor: number, playerPos: THREE.Vector3): boolean {
    this.t += dt;
    this.greetingCd = Math.max(0, this.greetingCd - dt);

    const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);

    // mira al héroe cuando está cerca (vuelve a su puesto al alejarse)
    const toP = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    const want = d < 8 ? toP : Math.atan2(MERCHANT_SPOT.front.x - this.pos.x, MERCHANT_SPOT.front.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, d < 8 ? 3.2 : 1.2, dt);
    this.rig.root.rotation.y = this.yaw;

    // saludo con la mano (1.2 s) al acercarse el héroe
    let greeted = false;
    if (d < 6.5 && this.greetingCd <= 0) {
      this.greetingCd = 26;
      this.waveT = 1.2;
      greeted = true;
    }
    if (this.waveT > 0) this.waveT -= dt;

    // pose: idle respirando + brazo levantado mientras saluda
    const pose = idlePose(this.t);
    if (this.waveT > 0) {
      const w = Math.min(1, this.waveT / 0.35); // entra y sale suave
      pose.armR = [-2.35 * w, 0, (-0.45 + Math.sin(this.t * 13) * 0.28) * w];
      pose.head = [0, 0, -0.06 * w];
    }
    this.applier.apply(pose, dt, 8);
    this.root.position.y = this.pos.y + Math.sin(this.t * 1.7) * 0.015;

    // rótulo siempre encarado a cámara (sprite, automático) + leve vaivén (offset)
    this.label.position.y = (terrainHeight(MERCHANT_SPOT.stall.x, MERCHANT_SPOT.stall.z) - this.pos.y) + 2.85 + Math.sin(this.t * 1.3) * 0.04;

    // farol: encendido de noche (con parpadeo cálido)
    const flicker = 0.82 + Math.sin(this.t * 11) * 0.1 + Math.sin(this.t * 27.3) * 0.08;
    const k = Math.max(0.12, nightFactor);
    this.lantern.intensity = 7.0 * k * flicker;
    this.lanternCore.scale.setScalar(0.9 + 0.12 * flicker * k);

    return greeted;
  }

  /** posición del frente del mostrador (para la interacción) */
  frontPos(): THREE.Vector3 {
    return new THREE.Vector3(MERCHANT_SPOT.front.x, terrainHeight(MERCHANT_SPOT.front.x, MERCHANT_SPOT.front.z), MERCHANT_SPOT.front.z);
  }

  /** el mercader no debe bloquear de forma extraña: colisión simple */
  colliderList(): { x: number; z: number; r: number }[] {
    return [
      { x: MERCHANT_SPOT.stall.x, z: MERCHANT_SPOT.stall.z, r: 1.15 },
      { x: MERCHANT_SPOT.merchant.x, z: MERCHANT_SPOT.merchant.z, r: 0.5 },
    ];
  }

  // referencia usada por Game para el saludo textual
  static greetingLines(): string[] {
    return [
      '¡Viajero! Tengo reliquias que ni la luna conoce…',
      '¡Elige, elige! El oro es pobre consuelo para los muertos.',
      '¿Sangre en la túnica? Te sale nueva, ¿eh?',
      'Dicen que Bel\'Zaroth teme más a mi farol que a tu espada.',
    ];
  }

  /** dirección hacia la hoguera (utilidad) */
  get dirToBonfire(): THREE.Vector3 {
    return new THREE.Vector3(WORLD.bonfire.x - this.pos.x, 0, WORLD.bonfire.z - this.pos.z).normalize();
  }
}
