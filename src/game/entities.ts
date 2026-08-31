import * as THREE from 'three';
import { clamp, damp, dampAngle, rand, terrainHeight, WORLD, lerp } from './core';
import { buildHumanoid, buildPlayerRig, buildPickupOrb, buildArrowMesh, type HumanoidRig } from './models';
import { PoseApplier, idlePose, runPose, strafePose, sampleClip, CLIPS, ZERO_POSE } from './animations';
import type { Particles } from './particles';
import type { AudioEngine } from './audio';

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
  /** 0 = pleno día, 1 = noche cerrada (los enemigos se vuelven más rápidos) */
  nightFactor: number;
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
  protected mats: THREE.MeshStandardMaterial[] = [];
  protected flashT = 0;

  protected collectMats() {
    const set = new Set<THREE.MeshStandardMaterial>();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (m && m.isMeshStandardMaterial) set.add(m);
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

/* ---------- Estela de espada (cinta aditiva) ---------- */

export class SwordTrail {
  private segs = 16;
  private geo: THREE.BufferGeometry;
  private posAttr: Float32Array;
  private alphaAttr: Float32Array;
  mesh: THREE.Mesh;
  private strength = 0;
  private ring: { b: THREE.Vector3; t: THREE.Vector3 }[] = [];

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
    scene.add(this.mesh);
  }

  emit(base: THREE.Vector3, tip: THREE.Vector3) {
    this.ring.push({ b: base.clone(), t: tip.clone() });
    if (this.ring.length > this.segs) this.ring.shift();
    this.strength = 1;
  }

  update(dt: number, active: boolean) {
    if (!active) {
      this.strength -= dt * 4;
      if (this.strength < 0 && this.ring.length) this.ring.shift();
      if (this.strength < -1) this.strength = -1;
    }
    const n = this.ring.length;
    for (let i = 0; i < this.segs; i++) {
      const src = this.ring[Math.min(i, n - 1)] ?? { b: new THREE.Vector3(0, -999, 0), t: new THREE.Vector3(0, -999, 0) };
      const o = i * 6;
      this.posAttr[o] = src.b.x; this.posAttr[o + 1] = src.b.y; this.posAttr[o + 2] = src.b.z;
      this.posAttr[o + 3] = src.t.x; this.posAttr[o + 4] = src.t.y; this.posAttr[o + 5] = src.t.z;
      const a = n > 1 ? (i / (n - 1)) : 0;
      const fade = this.strength > 0 ? 1 : Math.max(0, 1 + this.strength);
      this.alphaAttr[i * 2] = a * a * Math.max(0, fade) * 0.9;
      this.alphaAttr[i * 2 + 1] = a * a * Math.max(0, fade) * 0.9;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------- Jugador ---------- */

export interface AttackDef {
  clip: string; dur: number; hitAt: number; dmg: number; range: number; arc: number;
  stam: number; impulse: number; soundPitch: number;
}

export const PLAYER_ATTACKS: AttackDef[] = [
  { clip: 'slash1', dur: 0.52, hitAt: 0.4, dmg: 15, range: 2.8, arc: 1.6, stam: 13, impulse: 3.6, soundPitch: 1 },
  { clip: 'slash2', dur: 0.5, hitAt: 0.38, dmg: 17, range: 2.8, arc: 1.6, stam: 13, impulse: 3.6, soundPitch: 1.12 },
  { clip: 'slash3', dur: 0.68, hitAt: 0.48, dmg: 26, range: 3.0, arc: 1.9, stam: 17, impulse: 5, soundPitch: 0.9 },
];
export const PLAYER_HEAVY: AttackDef = { clip: 'heavy', dur: 0.95, hitAt: 0.6, dmg: 44, range: 3.2, arc: 2.0, stam: 30, impulse: 6, soundPitch: 0.72 };

export class Player extends Entity {
  rig: HumanoidRig;
  applier: PoseApplier;
  stamina = 100; maxStamina = 100;
  potions = 4; maxPotions = 6;
  xp = 0; xpNext = 70; level = 1;
  gold = 0; kills = 0;
  baseDmg = 1;
  state: 'idle' | 'roll' | 'attack' | 'hurt' | 'potion' | 'dead' = 'idle';
  stateT = 0;
  attackIdx = 0;
  currentAttack: AttackDef | null = null;
  heavy = false;
  didHit = false;
  buffered = false;
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
    this.rig = buildPlayerRig();
    this.root.add(this.rig.root);
    this.maxHp = 100; this.hp = 100;
    this.radius = 0.55;
    this.height = 1.85;
    this.applier = new PoseApplier(this.rig, 16);
    this.collectMats();
  }

  get dmgMul() { return this.baseDmg * (1 + 0.09 * (this.level - 1)); }
  get xpProgress() { return this.xp / this.xpNext; }

  gainXp(amount: number, ctx: GameCtx) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(70 * Math.pow(this.level, 1.35));
      this.maxHp += 14;
      this.maxStamina += 4;
      this.hp = this.maxHp;
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
    ctx.audio.potion();
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z,
      count: 22, speed: 2.4, color: 0x51e07c, size: 0.22, life: 0.9, gravity: -3, drag: 2, glow: 1.8,
    });
    ctx.addDamageNumber(new THREE.Vector3(this.pos.x, this.pos.y + 2, this.pos.z), `+${Math.round(this.maxHp * 0.45)}`, '#51e07c');
    return true;
  }

  canAct(): boolean {
    return this.state === 'idle' || (this.state === 'attack' && !!this.currentAttack && this.stateT > this.currentAttack.dur * 0.72);
  }

  tryAttack(heavy: boolean, ctx: GameCtx, fwd: THREE.Vector3): boolean {
    const def = heavy ? PLAYER_HEAVY : PLAYER_ATTACKS[0];
    const cost = def.stam;
    if (this.stamina <= 0) return false;
    const isChain = this.state === 'attack';
    const idx = isChain ? Math.min(this.attackIdx + 1, 2) : 0;
    const use = heavy ? def : PLAYER_ATTACKS[idx];
    if (!heavy && this.stamina < use.stam * 0.5) return false;
    this.stamina = Math.max(0, this.stamina - use.stam);
    this.staminaDelay = 0.75;
    this.state = 'attack';
    this.stateT = 0;
    this.heavy = heavy;
    this.attackIdx = heavy ? 0 : idx;
    this.currentAttack = use;
    this.didHit = false;
    this.buffered = false;
    // impulso inicial
    this.knock.add(fwd.clone().multiplyScalar(use.impulse * 0.6));
    ctx.audio.swing(use.soundPitch);
    return true;
  }

  tryRoll(ctx: GameCtx, dir: THREE.Vector3): boolean {
    if (this.stamina <= 0) return false;
    if (this.state === 'roll' || this.state === 'dead') return false;
    if (this.state === 'attack' && this.stateT < this.currentAttack!.dur * 0.5) return false;
    this.stamina = Math.max(0, this.stamina - 22);
    this.staminaDelay = 0.75;
    this.state = 'roll'; this.stateT = 0;
    this.rollDir.copy(dir.lengthSq() > 0.01 ? dir : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    this.iFrames = 0.42;
    ctx.audio.roll();
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 0.15, z: this.pos.z,
      count: 10, speed: 2.2, color: 0x8a7a5e, size: 0.3, life: 0.55, gravity: 1.5, drag: 2.4, glow: 0.7,
    });
    return true;
  }

  takeDamage(dmg: number, srcPos: THREE.Vector3, ctx: GameCtx): boolean {
    if (this.iFrames > 0 || this.state === 'dead') return false;
    this.hp -= dmg;
    this.iFrames = 0.28;
    ctx.audio.hurt();
    ctx.playerHurt();
    ctx.addDamageNumber(new THREE.Vector3(this.pos.x + rand(-0.3, 0.3), this.pos.y + 2.1, this.pos.z), `-${Math.round(dmg)}`, '#ff5a4e');
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z,
      count: 14, speed: 3.2, color: 0xd8323c, size: 0.24, life: 0.7, gravity: 5, drag: 1.5,
    });
    // knockback
    const d = this.pos.clone().sub(srcPos).setY(0);
    if (d.lengthSq() > 0.001) d.normalize();
    this.knock.add(d.multiplyScalar(4));
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead'; this.stateT = 0;
      this.alive = false;
      ctx.audio.die();
      ctx.shake(0.8);
      return true;
    }
    if (this.state !== 'roll') {
      this.state = 'hurt'; this.stateT = 0;
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
    if (this.comboTimer === 0 && this.state !== 'attack') this.attackIdx = 0;

    // regeneración de aguante
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay === 0 && this.state !== 'dead') {
      this.stamina = Math.min(this.maxStamina, this.stamina + 26 * dt);
    }

    // dirección de movimiento relativa a cámara
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iz = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const moveDir = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
    const hasMove = moveDir.lengthSq() > 0.001;
    if (hasMove) moveDir.normalize();

    const locked = !!(this.lockTarget && this.lockTarget.alive);
    const targetPos = locked ? this.lockTarget!.pos : null;

    switch (this.state) {
      case 'dead': {
        this.stateT += dt;
        const clip = CLIPS.death;
        const p = sampleClip(clip, Math.min(this.stateT, clip.dur));
        this.applier.snap(p, dt);
        this.root.rotation.y = this.yaw;
        this.pos.addScaledVector(this.knock, dt);
        this.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
        this.applyTransform(ctx, dt);
        return;
      }
      case 'hurt': {
        this.stateT += dt;
        const clip = CLIPS.hurt;
        this.applier.snap(sampleClip(clip, Math.min(this.stateT, clip.dur)), dt);
        if (this.stateT >= clip.dur) this.state = 'idle';
        break;
      }
      case 'potion': {
        this.stateT += dt;
        this.applier.apply(idlePose(this.animT), dt, 14);
        if (this.stateT > 0.45) this.state = 'idle';
        break;
      }
      case 'roll': {
        this.stateT += dt;
        const clip = CLIPS.roll;
        const p = sampleClip(clip, Math.min(this.stateT, clip.dur));
        this.applier.snap(p, dt);
        this.pos.addScaledVector(this.rollDir, 10.5 * dt);
        if (Math.random() < 0.4) {
          ctx.particles.spawn({
            x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z,
            vx: rand(-1, 1), vy: rand(0.5, 1.5), vz: rand(-1, 1),
            color: 0x8a7a5e, size: 0.25, life: 0.4, gravity: 1, drag: 2, glow: 0.6,
          });
        }
        if (this.stateT >= clip.dur) { this.state = 'idle'; this.applier.apply(ZERO_POSE, dt, 20); }
        break;
      }
      case 'attack': {
        this.stateT += dt;
        const def = this.currentAttack!;
        const clip = CLIPS[def.clip];
        // buffer de combo: un clic durante el ataque encadena el siguiente
        if (input.consumeAttack()) this.buffered = true;
        // seguimiento del objetivo
        if (targetPos) {
          const ty = Math.atan2(targetPos.x - this.pos.x, targetPos.z - this.pos.z);
          this.yaw = dampAngle(this.yaw, ty, 10, dt);
        } else {
          this.yaw = dampAngle(this.yaw, Math.atan2(fwd.x, fwd.z), 8, dt);
        }
        // impulso hacia delante durante la fase activa
        const prog = this.stateT / def.dur;
        if (prog > 0.35 && prog < 0.75) {
          this.pos.addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), def.impulse * dt);
        }
        const p = sampleClip(clip, Math.min(this.stateT, clip.dur));
        this.applier.snap(p, dt);
        // momento del golpe
        if (!this.didHit && this.stateT >= def.hitAt) {
          this.didHit = true;
          this.strike(ctx, def);
        }
        if (this.stateT >= def.dur) {
          if (this.buffered && !this.heavy && this.attackIdx < 2 && this.stamina > 8) {
            this.tryAttack(false, ctx, fwd); // encadena el siguiente
          } else {
            this.state = 'idle';
            this.comboTimer = 0.85;
          }
        }
        break;
      }
      case 'idle': {
        // acciones nuevas
        if (input.consumePotion()) {
          if (this.healPotion(ctx)) break;
        }
        if (input.consumeRoll()) {
          const dir = hasMove ? moveDir : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.yaw = Math.atan2(dir.x, dir.z);
          if (this.tryRoll(ctx, dir)) break;
        }
        const wantHeavy = input.consumeHeavy();
        const wantLight = input.consumeAttack();
        if (wantHeavy || wantLight) {
          const faceDir = targetPos
            ? new THREE.Vector3(targetPos.x - this.pos.x, 0, targetPos.z - this.pos.z).normalize()
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
      const speed = this.sprinting ? 9.2 : 6.2;
      if (hasMove) {
        this.pos.addScaledVector(moveDir, speed * dt);
        if (!locked) {
          this.yaw = dampAngle(this.yaw, Math.atan2(moveDir.x, moveDir.z), 14, dt);
        } else {
          this.yaw = dampAngle(this.yaw, Math.atan2(targetPos!.x - this.pos.x, targetPos!.z - this.pos.z), 12, dt);
        }
      }
      this.moving = hasMove;
      // pose
      if (hasMove) {
        this.runPhase += dt * (this.sprinting ? 1.3 : 1);
        this.applier.apply(runPose(this.runPhase, this.sprinting ? 1.15 : 1), dt, 12);
      } else if (locked) {
        this.applier.apply(strafePose(this.animT, false), dt, 10);
      } else {
        this.applier.apply(idlePose(this.animT), dt, 8);
      }
    }

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

/* ---------- Drops (pociones) ---------- */

export class Pickup {
  root: THREE.Group;
  pos = new THREE.Vector3();
  life = 40;
  dead = false;
  kind: 'potion';
  private core: THREE.Mesh;
  private t = Math.random() * 10;

  constructor(pos: THREE.Vector3, kind: 'potion') {
    this.kind = kind;
    const { group, core } = buildPickupOrb(0xff4a4a);
    this.root = group;
    this.core = core;
    this.pos.copy(pos);
    this.pos.y = terrainHeight(pos.x, pos.z) + 0.5;
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
    if (d < 1.4 && Math.abs(p.y - this.pos.y) < 2.5 && !ctx.player.invulnHit) {
      if (ctx.player.potions < ctx.player.maxPotions) {
        ctx.player.potions++;
        ctx.audio.potion();
        ctx.addDamageNumber(this.root.position.clone(), '+1 POCIÓN', '#ff8a8a');
        this.dead = true;
      }
    }
  }
}
