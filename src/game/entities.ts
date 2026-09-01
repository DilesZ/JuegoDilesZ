import * as THREE from 'three';
import { clamp, damp, dampAngle, rand, terrainHeight, WORLD, lerp } from './core';
import { buildHumanoid, buildPlayerRig, buildPickupOrb, buildArrowMesh, type HumanoidRig, type VisualRig, type CharMat } from './models';
import { PoseApplier, idlePose, runPose, strafePose, sampleClip, CLIPS, ZERO_POSE } from './animations';
import type { GlbCharacter } from './characters';
import type { Particles } from './particles';
import type { AudioEngine } from './audio';
import { NEUTRAL_STATS, RARITY_INFO, type EquipStats, type ItemDef } from './items';

/* ============================================================
   ENTIDADES: base, jugador, estela de espada, proyectiles, drops
   ============================================================ */

export interface InputState {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  sprint: boolean;
  // eventos de un solo disparo (consumidos al leerse)
  consumeAttack(): boolean;
  consumeHeavy(): boolean;
  consumeRoll(): boolean;
  consumePotion(): boolean;
}

export interface WorldApi {
  height(x: number, z: number): number;
  resolve(pos: THREE.Vector3, radius: number): void;
}

export interface GameCtx {
  scene: THREE.Scene;
  particles: Particles;
  audio: AudioEngine;
  world: WorldApi;
  player: Player;
  enemies: { pos: THREE.Vector3; alive: boolean; radius: number }[];
  camera: THREE.Camera;
  input: InputState;
  camYaw: number;
  addDamageNumber(pos: THREE.Vector3, text: string, cssColor: string, big?: boolean): void;
  shake(a: number): void;
  hitStop(d: number): void;
  spawnProjectile(o: { pos: THREE.Vector3; dir: THREE.Vector3; speed: number; dmg: number; kind: 'arrow' | 'orb' }): void;
  onEnemyDied(e: import('./enemies').Enemy): void;
  playerHurt(): void;
  /** Recoge un objeto de equipo/consumible del suelo */
  gainItem(def: ItemDef): void;
  /** 0 = pleno día, 1 = noche cerrada (los enemigos se vuelven más rápidos) */
  nightFactor: number;
  /** Golpe de FOV cinematográfico (DMC): +grados que decaen solos */
  fovKick(deg: number): void;
  /** Onda expansiva en el suelo (impactos pesados, slams) */
  shockwave(pos: THREE.Vector3, color?: number, maxR?: number): void;
}

export abstract class Entity {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  hp = 1; maxHp = 1;
  radius = 0.5;
  height = 1.8;
  alive = true;
  removable = false;
  knock = new THREE.Vector3();
  protected mats: CharMat[] = [];
  protected flashT = 0;

  protected collectMats() {
    const set = new Set<CharMat>();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as CharMat;
        if (m && ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshToonMaterial).isMeshToonMaterial)) {
          set.add(m);
        }
      }
    });
    this.mats = [...set];
    this.originals = this.mats.map(m => ({ e: m.emissive.clone(), i: m.emissiveIntensity }));
  }
  private originals: { e: THREE.Color; i: number }[] = [];

  flash(intensity = 2.2, time = 0.12) {
    this.flashT = time;
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].emissive.setRGB(1, 0.9, 0.8);
      this.mats[i].emissiveIntensity = intensity;
    }
  }
  protected updateFlash(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        for (let i = 0; i < this.mats.length; i++) {
          this.mats[i].emissive.copy(this.originals[i].e);
          this.mats[i].emissiveIntensity = this.originals[i].i;
        }
      }
    }
  }
  abstract update(dt: number, ctx: GameCtx): void;
}

/* ---------- Estela de espada (cinta aditiva, buffer de anillo sin allocations) ---------- */

export class SwordTrail {
  private segs = 16;
  private geo: THREE.BufferGeometry;
  private posAttr: Float32Array;
  private alphaAttr: Float32Array;
  mesh: THREE.Mesh;
  private strength = 0;
  /** anillo preasignado: cada segmento reutiliza sus dos Vector3 (cero GC) */
  private ring: { b: THREE.Vector3; t: THREE.Vector3 }[];
  private head = 0;   // siguiente índice a escribir
  private count = 0;  // puntos vivos (máx segs)

  constructor(scene: THREE.Scene, color = 0xffd9a0) {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new Float32Array(this.segs * 2 * 3);
    this.alphaAttr = new Float32Array(this.segs * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posAttr, 3));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1));
    const idx: number[] = [];
    for (let i = 0; i < this.segs - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        void main(){ if (vA <= 0.003) discard; gl_FragColor = vec4(uColor * (0.6 + vA), vA * 0.85); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.ring = [];
    for (let i = 0; i < this.segs; i++) {
      this.ring.push({ b: new THREE.Vector3(0, -999, 0), t: new THREE.Vector3(0, -999, 0) });
    }
    scene.add(this.mesh);
  }

  /** Registra un punto de la estela reutilizando la memoria del anillo */
  emit(base: THREE.Vector3, tip: THREE.Vector3) {
    const slot = this.ring[this.head];
    slot.b.copy(base);
    slot.t.copy(tip);
    this.head = (this.head + 1) % this.segs;
    if (this.count < this.segs) this.count++;
    this.strength = 1;
  }

  update(dt: number, active: boolean) {
    if (!active) {
      this.strength -= dt * 4;
      if (this.strength < -1) this.strength = -1;
      // drena el anillo suavemente al dejar de atacar
      if (this.strength <= 0 && this.count > 0) this.count--;
    }
    const n = this.count;
    if (n === 0 && this.strength <= 0) {
      // nada que dibujar: atributos ya limpios, evita subidas a GPU cada frame
      if (this.posAttr[1] !== -999) {
        for (let i = 0; i < this.segs * 2; i++) this.posAttr[i * 3 + 1] = -999;
        (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
      return;
    }
    // el más reciente es head-1; se recorre hacia atrás en orden de edad
    for (let i = 0; i < this.segs; i++) {
      let src: { b: THREE.Vector3; t: THREE.Vector3 } | undefined;
      if (i < n) {
        const idx = (this.head - 1 - i + this.segs * 2) % this.segs;
        src = this.ring[idx];
      }
      const o = i * 6;
      if (src) {
        this.posAttr[o] = src.b.x; this.posAttr[o + 1] = src.b.y; this.posAttr[o + 2] = src.b.z;
        this.posAttr[o + 3] = src.t.x; this.posAttr[o + 4] = src.t.y; this.posAttr[o + 5] = src.t.z;
      } else {
        this.posAttr[o + 1] = -999; this.posAttr[o + 4] = -999;
      }
      // el más reciente (i=0) con alpha alto, la cola se funde
      const a = n > 1 ? (1 - i / n) : 1;
      const fade = this.strength > 0 ? 1 : Math.max(0, 1 + this.strength);
      const alpha = a * a * Math.max(0, fade) * 0.9;
      this.alphaAttr[i * 2] = alpha;
      this.alphaAttr[i * 2 + 1] = alpha;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------- Jugador ---------- */

export type AttackKind = 'light' | 'heavy' | 'finisher';

export interface AttackDef {
  clip: string; dur: number; hitAt: number; dmg: number; range: number; arc: number;
  stam: number; impulse: number; soundPitch: number;
  /** fracción de dur a partir de la cual un ataque en buffer ENCADENA (cancela la recuperación) */
  chainAt: number;
  /** puntos de estilo al conectar (medidor estilo DMC) */
  style: number;
  kind: AttackKind;
}

/**
 * Combo estilo DMC: cadena de 4 fases (tajo → regreso → tajo alto → REMATE
 * con mandoble) con ventanas de cancelación tempranas: si pulsas durante el
 * ataque, el siguiente golpe arranca en cuanto la fase activa termina
 * (≈55-62 % de la animación) en lugar de esperar la recuperación completa.
 */
export const PLAYER_ATTACKS: AttackDef[] = [
  { clip: 'slash1', dur: 0.42, hitAt: 0.32, chainAt: 0.60, dmg: 14, range: 2.9, arc: 1.75, stam: 11, impulse: 3.8, soundPitch: 1.0, style: 8, kind: 'light' },
  { clip: 'slash2', dur: 0.40, hitAt: 0.30, chainAt: 0.60, dmg: 16, range: 2.9, arc: 1.75, stam: 11, impulse: 3.8, soundPitch: 1.12, style: 9, kind: 'light' },
  { clip: 'slash3', dur: 0.55, hitAt: 0.42, chainAt: 0.62, dmg: 24, range: 3.1, arc: 2.05, stam: 13, impulse: 4.4, soundPitch: 0.92, style: 12, kind: 'light' },
  { clip: 'heavy',  dur: 0.72, hitAt: 0.58, chainAt: 1.10, dmg: 36, range: 3.4, arc: 2.30, stam: 16, impulse: 5.4, soundPitch: 0.70, style: 20, kind: 'finisher' },
];
export const PLAYER_HEAVY: AttackDef = { clip: 'heavy', dur: 0.88, hitAt: 0.62, chainAt: 1.10, dmg: 46, range: 3.4, arc: 2.2, stam: 26, impulse: 5.0, soundPitch: 0.72, style: 15, kind: 'heavy' };

/* Scratches reutilizables (cero allocations en el bucle caliente) */
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();

export class Player extends Entity {
  /** rig visual activo (GLB real o procedural de respaldo) */
  rig: VisualRig;
  private procRig: HumanoidRig;
  glb: GlbCharacter | null = null;
  applier: PoseApplier;
  stamina = 100; maxStamina = 100;
  potions = 4; maxPotions = 6;
  xp = 0; xpNext = 70; level = 1;
  gold = 0; kills = 0;
  baseDmg = 1;
  // estadísticas de equipo (recalculadas por Game al cambiar el inventario)
  equip: EquipStats = { ...NEUTRAL_STATS };
  // bonos permanentes de consumibles
  perm = { hp: 0, dmg: 0, stam: 0 };
  state: 'idle' | 'roll' | 'attack' | 'hurt' | 'potion' | 'dead' = 'idle';
  stateT = 0;
  attackIdx = 0;
  /** índice del SIGUIENTE golpe de la cadena (0..3, wrap tras el remate) */
  comboNext = 0;
  currentAttack: AttackDef | null = null;
  heavy = false;
  didHit = false;
  buffered = false;
  bufferedHeavy = false;
  comboTimer = 0;
  iFrames = 0;
  staminaDelay = 0;
  rollDir = new THREE.Vector3();
  lockTarget: { pos: THREE.Vector3; alive: boolean; pos3?: THREE.Vector3 } | null = null;
  animT = 0;
  runPhase = 0;
  moving = false;
  sprinting = false;
  invulnHit = false;

  constructor() {
    super();
    this.procRig = buildPlayerRig();
    this.rig = this.procRig;
    this.root.add(this.procRig.root);
    this.maxHp = 100; this.hp = 100;
    this.radius = 0.55;
    this.height = 1.85;
    this.applier = new PoseApplier(this.procRig, 16);
    this.collectMats();
  }

  /** Sustituye el rig procedural por un personaje GLB real (si hay pack) */
  attachGlb(char: GlbCharacter) {
    if (this.glb) return;
    this.root.remove(this.procRig.root);
    this.glb = char;
    this.rig = char.rig;
    this.root.add(char.root);
    this.collectMats();
  }

  /** Idle del menú cinemático (GLB o procedural) */
  updateMenu(dt: number, t: number) {
    if (this.glb) {
      this.glb.animator.play('idle', { fade: 0.6 });
      this.glb.animator.update(dt);
    } else {
      this.applier.apply(idlePose(t), dt, 6);
    }
  }

  /** Vida base por nivel + equipo + permanentes */
  private recomputeMaxHp() {
    const levelHp = 100 + 14 * (this.level - 1);
    const newMax = levelHp + this.equip.hp + this.perm.hp;
    const diff = newMax - this.maxHp;
    this.maxHp = newMax;
    if (diff > 0) this.hp += diff; // equipar armadura también cura la diferencia
    this.hp = clamp(this.hp, 0, this.maxHp);
  }

  /** Game lo llama cada vez que cambia el equipamiento */
  applyEquipStats(s: EquipStats) {
    this.equip = s;
    this.recomputeMaxHp();
  }

  get dmgMul() {
    return this.baseDmg * (1 + 0.09 * (this.level - 1)) * (1 + this.equip.dmg + this.perm.dmg);
  }
  get moveSpeedMul() { return 1 + this.equip.speed; }
  get critChance() { return clamp(this.equip.crit, 0, 0.75); }
  get damageReduction() { return this.equip.def / (this.equip.def + 90); }
  get xpProgress() { return this.xp / this.xpNext; }

  gainXp(amount: number, ctx: GameCtx) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(70 * Math.pow(this.level, 1.35));
      this.maxStamina += 4;
      this.recomputeMaxHp();
      this.stamina = this.maxStamina;
      ctx.audio.levelUp();
      ctx.particles.burst({
        x: this.pos.x, y: this.pos.y + 1, z: this.pos.z,
        count: 40, speed: 5, color: 0xffc84a, size: 0.35, life: 1.2, gravity: -2, drag: 1.2, glow: 2.2,
      });
      ctx.addDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z), `¡NIVEL ${this.level}!`, '#ffc84a', true);
      ctx.shake(0.25);
    }
  }

  healPotion(ctx: GameCtx): boolean {
    if (this.potions <= 0 || this.hp >= this.maxHp || this.state === 'dead') return false;
    this.potions--;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.45);
    this.state = 'potion'; this.stateT = 0;
    this.buffered = false; this.bufferedHeavy = false;
    this.playAction('potion', 0.45, 0.12);
    ctx.audio.potion();
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z,
      count: 22, speed: 2.4, color: 0x51e07c, size: 0.22, life: 0.9, gravity: -3, drag: 2, glow: 1.8,
    });
    ctx.addDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 2, this.pos.z), `+${Math.round(this.maxHp * 0.45)}`, '#51e07c');
    return true;
  }

  canAct(): boolean {
    return this.state === 'idle' || (this.state === 'attack' && !!this.currentAttack && this.stateT > this.currentAttack.dur * this.currentAttack.chainAt);
  }

  /** Reproduce un clip de acción UNA vez sincronizado con la duración de jugabilidad */
  private playAction(clip: string, gameplayDur: number, fade = 0.055) {
    if (!this.glb) return;
    const baked = this.glb.animator.clipDur(clip);
    const ts = baked > 0.01 && gameplayDur > 0.01 ? baked / gameplayDur : 1;
    this.glb.animator.play(clip, { once: true, restart: true, fade, timeScale: ts });
  }

  /** Locomoción continua (play() corta si ya está sonando el mismo clip) */
  private anim(name: string, opts: { fade?: number; timeScale?: number } = {}) {
    this.glb?.animator.play(name, opts);
  }

  tryAttack(heavy: boolean, ctx: GameCtx, fwd: THREE.Vector3): boolean {
    let def: AttackDef;
    if (heavy) {
      if (this.stamina < PLAYER_HEAVY.stam * 0.35) return false;
      def = PLAYER_HEAVY;
      this.comboNext = 0; // el mandoble cargado reinicia la cadena
    } else {
      if (this.stamina <= 0) return false;
      def = PLAYER_ATTACKS[this.comboNext] ?? PLAYER_ATTACKS[0];
      if (this.stamina < def.stam * 0.5) return false;
      this.comboNext = def.kind === 'finisher' ? 0 : Math.min(this.comboNext + 1, PLAYER_ATTACKS.length - 1);
    }
    this.stamina = Math.max(0, this.stamina - def.stam);
    this.staminaDelay = 0.75;
    this.state = 'attack';
    this.stateT = 0;
    this.heavy = def.kind !== 'light';
    this.attackIdx = PLAYER_ATTACKS.indexOf(def) < 0 ? 0 : PLAYER_ATTACKS.indexOf(def);
    this.currentAttack = def;
    this.didHit = false;
    this.buffered = false;
    this.bufferedHeavy = false;
    // impulso inicial (sin allocations)
    this.knock.add(_tmpA.copy(fwd).multiplyScalar(def.impulse * 0.5));
    // la animación se dispara UNA vez por golpe (antes se reiniciaba cada frame)
    this.playAction(def.clip, def.dur);
    ctx.audio.swing(def.soundPitch);
    return true;
  }

  tryRoll(ctx: GameCtx, dir: THREE.Vector3): boolean {
    if (this.stamina <= 0) return false;
    if (this.state === 'roll' || this.state === 'dead') return false;
    if (this.state === 'attack' && this.stateT < this.currentAttack!.dur * 0.5) return false;
    this.stamina = Math.max(0, this.stamina - 22);
    this.staminaDelay = 0.75;
    this.state = 'roll'; this.stateT = 0;
    this.buffered = false; this.bufferedHeavy = false;
    this.rollDir.copy(dir.lengthSq() > 0.01 ? dir : _tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    this.iFrames = 0.42;
    this.playAction('roll', CLIPS.roll.dur, 0.05);
    ctx.audio.roll();
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 0.15, z: this.pos.z,
      count: 10, speed: 2.2, color: 0x8a7a5e, size: 0.3, life: 0.55, gravity: 1.5, drag: 2.4, glow: 0.7,
    });
    return true;
  }

  takeDamage(dmg: number, srcPos: THREE.Vector3, ctx: GameCtx): boolean {
    if (this.iFrames > 0 || this.state === 'dead') return false;
    // la defensa de la armadura reduce el daño entrante
    const final = dmg * (1 - this.damageReduction);
    this.hp -= final;
    this.iFrames = 0.28;
    ctx.audio.hurt();
    ctx.playerHurt();
    ctx.addDamageNumber(new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + 2.1, this.pos.z), `-${Math.round(final)}`, '#ff5a4e');
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z,
      count: 14, speed: 3.2, color: 0xd8323c, size: 0.24, life: 0.7, gravity: 5, drag: 1.5,
    });
    // knockback (sin allocations)
    const d = _tmpB.copy(this.pos).sub(srcPos).setY(0);
    if (d.lengthSq() > 0.001) d.normalize();
    this.knock.add(d.multiplyScalar(4));
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead'; this.stateT = 0;
      this.alive = false;
      this.buffered = false; this.bufferedHeavy = false;
      this.playAction('death', CLIPS.death.dur, 0.12);
      ctx.audio.die();
      ctx.shake(0.8);
      return true;
    }
    if (this.state !== 'roll') {
      this.state = 'hurt'; this.stateT = 0;
      this.buffered = false; this.bufferedHeavy = false;
      this.playAction('hurt', CLIPS.hurt.dur, 0.08);
    }
    ctx.shake(0.45);
    return true;
  }

  update(dt: number, ctx: GameCtx) {
    const input = ctx.input;
    const camYaw = ctx.camYaw;
    this.animT += dt;
    this.updateFlash(dt);
    this.iFrames = Math.max(0, this.iFrames - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0 && this.state !== 'attack') { this.comboNext = 0; this.attackIdx = 0; }

    // regeneración de aguante (mejorada por equipo y consumibles)
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay === 0 && this.state !== 'dead') {
      const regen = 26 * (1 + this.equip.stam + this.perm.stam);
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    }

    // dirección de movimiento relativa a cámara (scratches reutilizables)
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iz = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
    const fwd = _fwd.set(Math.sin(camYaw), 0, Math.cos(camYaw)).multiplyScalar(-1);
    const right = _right.set(-fwd.z, 0, fwd.x);
    const moveDir = _moveDir.set(0, 0, 0).addScaledVector(fwd, iz).addScaledVector(right, ix);
    const hasMove = moveDir.lengthSq() > 0.001;
    if (hasMove) moveDir.normalize();

    const locked = !!(this.lockTarget && this.lockTarget.alive);
    const targetPos = locked ? this.lockTarget!.pos : null;

    switch (this.state) {
      case 'dead': {
        this.stateT += dt;
        if (!this.glb) {
          const clip = CLIPS.death;
          const p = sampleClip(clip, Math.min(this.stateT, clip.dur));
          this.applier.snap(p, dt);
        }
        this.root.rotation.y = this.yaw;
        this.pos.addScaledVector(this.knock, dt);
        this.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
        this.applyTransform(ctx, dt);
        return;
      }
      case 'hurt': {
        this.stateT += dt;
        if (!this.glb) {
          const clip = CLIPS.hurt;
          this.applier.snap(sampleClip(clip, Math.min(this.stateT, clip.dur)), dt);
        }
        if (this.stateT >= CLIPS.hurt.dur) this.state = 'idle';
        break;
      }
      case 'potion': {
        this.stateT += dt;
        if (!this.glb) this.applier.apply(idlePose(this.animT), dt, 14);
        if (this.stateT > 0.45) this.state = 'idle';
        break;
      }
      case 'roll': {
        this.stateT += dt;
        if (!this.glb) {
          const clip = CLIPS.roll;
          const p = sampleClip(clip, Math.min(this.stateT, clip.dur));
          this.applier.snap(p, dt);
        }
        this.pos.addScaledVector(this.rollDir, 10.5 * dt);
        if (Math.random() < 0.4) {
          ctx.particles.spawn({
            x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z,
            vx: rand(-1, 1), vy: rand(0.5, 1.5), vz: rand(-1, 1),
            color: 0x8a7a5e, size: 0.25, life: 0.4, gravity: 1, drag: 2, glow: 0.6,
          });
        }
        if (this.stateT >= CLIPS.roll.dur) { this.state = 'idle'; this.applier.apply(ZERO_POSE, dt, 20); }
        break;
      }
      case 'attack': {
        this.stateT += dt;
        const def = this.currentAttack!;
        // buffers de combo (se consumen aquí para no arrastrar pulsos viejos)
        if (input.consumeAttack()) this.buffered = true;
        if (input.consumeHeavy()) this.bufferedHeavy = true;
        // seguimiento del objetivo
        if (targetPos) {
          const ty = Math.atan2(targetPos.x - this.pos.x, targetPos.z - this.pos.z);
          this.yaw = dampAngle(this.yaw, ty, 10, dt);
        } else {
          this.yaw = dampAngle(this.yaw, Math.atan2(fwd.x, fwd.z), 8, dt);
        }
        const prog = this.stateT / def.dur;
        // impulso hacia delante durante la fase activa (embestida del tajo)
        if (prog > 0.30 && prog < 0.72) {
          this.pos.addScaledVector(_tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), def.impulse * dt);
        }
        // pose procedural (fallback sin GLB) sincronizada con la jugabilidad
        if (!this.glb) {
          const clip = CLIPS[def.clip];
          const speedK = clip.dur > 0.01 ? clip.dur / def.dur : 1;
          const p = sampleClip(clip, Math.min(this.stateT * speedK, clip.dur));
          this.applier.snap(p, dt);
        }
        // momento del golpe
        if (!this.didHit && this.stateT >= def.hitAt) {
          this.didHit = true;
          this.strike(ctx, def);
        }
        // ESQUIVA-CANCEL: rodar cancela la recuperación del ataque
        if (input.consumeRoll() && prog >= Math.min(def.chainAt, 1.0) * 0.82) {
          const dir = hasMove ? moveDir : _tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.yaw = Math.atan2(dir.x, dir.z);
          if (this.tryRoll(ctx, dir)) break;
        }
        // ENCADENADO CON CANCELACIÓN (DMC): el siguiente golpe arranca en
        // cuanto termina la fase activa — sin esperar la recuperación
        if (prog >= def.chainAt && (this.buffered || this.bufferedHeavy)) {
          const wantHeavy = this.bufferedHeavy && this.stamina > PLAYER_HEAVY.stam * 0.4;
          if (this.tryAttack(wantHeavy, ctx, _tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)))) break;
        }
        if (this.stateT >= def.dur) {
          if (this.buffered && !this.bufferedHeavy && this.stamina > 8) {
            // golpes ligeros se auto-encadenan al acabar si hubo pulso tardío
            if (this.tryAttack(false, ctx, _tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)))) break;
          }
          // fin del ataque sin encadenar: la cadena sigue viva 0.9 s
          this.state = 'idle';
          this.comboTimer = 0.9;
          if (def.kind !== 'light') this.comboNext = 0;
          this.buffered = false;
          this.bufferedHeavy = false;
        }
        break;
      }
      case 'idle': {
        // acciones nuevas
        if (input.consumePotion()) {
          if (this.healPotion(ctx)) break;
        }
        if (input.consumeRoll()) {
          const dir = hasMove ? moveDir : _tmpA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.yaw = Math.atan2(dir.x, dir.z);
          if (this.tryRoll(ctx, dir)) break;
        }
        const wantHeavy = input.consumeHeavy();
        const wantLight = input.consumeAttack();
        if (wantHeavy || wantLight) {
          const faceDir = targetPos
            ? _tmpA.set(targetPos.x - this.pos.x, 0, targetPos.z - this.pos.z).normalize()
            : (hasMove ? moveDir : fwd);
          this.yaw = Math.atan2(faceDir.x, faceDir.z);
          this.tryAttack(wantHeavy, ctx, faceDir);
        }
        break;
      }
    }

    // movimiento normal (solo fuera de acciones que bloquean)
    if (this.state === 'idle') {
      this.sprinting = input.sprint && hasMove;
      const speed = (this.sprinting ? 9.2 : 6.2) * this.moveSpeedMul;
      if (hasMove) {
        this.pos.addScaledVector(moveDir, speed * dt);
        if (!locked) {
          this.yaw = dampAngle(this.yaw, Math.atan2(moveDir.x, moveDir.z), 14, dt);
        } else {
          this.yaw = dampAngle(this.yaw, Math.atan2(targetPos!.x - this.pos.x, targetPos!.z - this.pos.z), 12, dt);
        }
      }
      this.moving = hasMove;
      // pose (mocap GLB con crossfade o procedural)
      if (this.glb) {
        if (hasMove) {
          if (this.sprinting) {
            // esprintar: ciclo de carrera siempre orientado al avance
            this.anim('run', { fade: 0.22, timeScale: 1.32 });
          } else if (locked) {
            // lock-on: strafes/backpedal reales según dirección relativa
            const facing = _tmpB.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            const dot = moveDir.dot(facing);
            const side = moveDir.dot(_tmpA.set(-facing.z, 0, facing.x));
            if (dot > 0.45) this.anim('walk', { fade: 0.22, timeScale: 1.42 });
            else if (dot < -0.45) this.anim('back', { fade: 0.22, timeScale: 1.35 });
            else if (side > 0) this.anim('strafeR', { fade: 0.25, timeScale: 1.3 });
            else this.anim('strafeL', { fade: 0.25, timeScale: 1.3 });
          } else {
            this.anim('walk', { fade: 0.22, timeScale: 1.42 });
          }
        } else {
          this.anim('idle', { fade: 0.3 });
        }
      } else if (hasMove) {
        this.runPhase += dt * (this.sprinting ? 1.3 : 1);
        this.applier.apply(runPose(this.runPhase, this.sprinting ? 1.15 : 1), dt, 12);
      } else if (locked) {
        this.applier.apply(strafePose(this.animT, false), dt, 10);
      } else {
        this.applier.apply(idlePose(this.animT), dt, 8);
      }
    }

    this.glb?.animator.update(dt);

    // knockback decay
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.max(0, 1 - 7 * dt));

    this.applyTransform(ctx, dt);
  }

  private strike(ctx: GameCtx, def: AttackDef) {
    // (la resolución de impactos la hace Game mediante pendingStrike)
    this.pendingStrike = def;
  }
  pendingStrike: AttackDef | null = null;

  private applyTransform(ctx: GameCtx, dt: number) {
    const h = ctx.world.height(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, h, 25, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  /** Ancla de la punta/base de la espada para la estela */
  swordPoints(outBase: THREE.Vector3, outTip: THREE.Vector3) {
    const w = this.rig.weapon;
    if (!w) return;
    outBase.set(0, 0.15, 0);
    outTip.set(0, 1.05, 0);
    w.updateWorldMatrix(true, false);
    outBase.applyMatrix4(w.matrixWorld);
    outTip.applyMatrix4(w.matrixWorld);
  }
}

/* ---------- Proyectiles ---------- */

export class Projectile {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  dmg: number;
  kind: 'arrow' | 'orb';
  life = 4;
  dead = false;
  gravity: number;

  constructor(o: { pos: THREE.Vector3; dir: THREE.Vector3; speed: number; dmg: number; kind: 'arrow' | 'orb' }) {
    this.pos.copy(o.pos);
    this.vel.copy(o.dir).normalize().multiplyScalar(o.speed);
    this.dmg = o.dmg;
    this.kind = o.kind;
    this.gravity = o.kind === 'arrow' ? 4.5 : 0;
    if (o.kind === 'arrow') {
      this.root.add(buildArrowMesh());
    } else {
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.22, 0),
        new THREE.MeshStandardMaterial({ color: 0x2a0a0a, emissive: 0xff2211, emissiveIntensity: 2.6, roughness: 0.5 })
      );
      this.root.add(core);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.3 })
      );
      this.root.add(halo);
    }
    this.root.position.copy(this.pos);
  }

  update(dt: number, ctx: GameCtx) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.vel.y -= this.gravity * dt;
    if (this.kind === 'orb') {
      // ligero homing
      const to = ctx.player.pos.clone().setY(ctx.player.pos.y + 1.1).sub(this.pos).normalize().multiplyScalar(this.vel.length());
      this.vel.lerp(to, 1 - Math.exp(-1.6 * dt));
    }
    this.pos.addScaledVector(this.vel, dt);
    this.root.position.copy(this.pos);
    if (this.kind === 'arrow') {
      this.root.lookAt(this.pos.clone().add(this.vel));
      this.root.rotateX(Math.PI / 2);
    } else {
      this.root.rotation.y += dt * 6;
      if (Math.random() < 0.6) ctx.particles.spawn({
        x: this.pos.x, y: this.pos.y, z: this.pos.z,
        color: 0xff3a22, size: 0.22, life: 0.4, glow: 2.2, shrink: false,
        vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5), vz: rand(-0.5, 0.5),
      });
    }
    // impacto con el jugador
    const p = ctx.player.pos;
    const dx = p.x - this.pos.x, dy = (p.y + 1.1) - this.pos.y, dz = p.z - this.pos.z;
    if (dx * dx + dy * dy + dz * dz < 0.9 * 0.9) {
      if (ctx.player.takeDamage(this.dmg, this.pos, ctx)) {
        if (this.kind === 'orb') ctx.particles.burst({ x: this.pos.x, y: this.pos.y, z: this.pos.z, count: 18, speed: 4, color: 0xff3a22, size: 0.28, life: 0.6, glow: 2 });
      }
      this.dead = true;
      return;
    }
    // impacto con el suelo
    if (this.pos.y <= ctx.world.height(this.pos.x, this.pos.z) + 0.05) {
      this.dead = true;
      ctx.particles.burst({ x: this.pos.x, y: this.pos.y, z: this.pos.z, count: 6, speed: 1.5, color: 0x8a7a5e, size: 0.18, life: 0.4, gravity: 3 });
    }
  }
}

/* ---------- Drops (pociones y objetos de equipo) ---------- */

export class Pickup {
  root: THREE.Group;
  pos = new THREE.Vector3();
  life = 40;
  dead = false;
  kind: 'potion' | 'item';
  item: ItemDef | null = null;
  private core: THREE.Mesh;
  private t = Math.random() * 10;

  constructor(pos: THREE.Vector3, kind: 'potion' | 'item', item?: ItemDef) {
    this.kind = kind;
    const color = kind === 'item' && item ? RARITY_INFO[item.rarity].hex : 0xff4a4a;
    const { group, core } = buildPickupOrb(color);
    this.root = group;
    this.core = core;
    this.item = item ?? null;
    if (kind === 'item') {
      // los objetos flotan un poco más alto y giran una cartera de destellos
      this.root.scale.setScalar(1.25);
    }
    this.pos.copy(pos);
    this.pos.y = terrainHeight(pos.x, pos.z) + (kind === 'item' ? 0.7 : 0.5);
    this.root.position.copy(this.pos);
  }

  update(dt: number, ctx: GameCtx) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.root.position.y = this.pos.y + Math.sin(this.t * 2.4) * 0.12;
    this.core.rotation.y += dt * 2.5;
    this.core.rotation.x += dt * 1.2;
    const p = ctx.player.pos;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (d < 1.5 && Math.abs(p.y - this.pos.y) < 2.5 && !ctx.player.invulnHit) {
      if (this.kind === 'item' && this.item) {
        ctx.gainItem(this.item);
        this.dead = true;
        return;
      }
      if (ctx.player.potions < ctx.player.maxPotions) {
        ctx.player.potions++;
        ctx.audio.potion();
        ctx.addDamageNumber(this.root.position.clone(), '+1 POCIÓN', '#ff8a8a');
        this.dead = true;
      }
    }
  }
}
