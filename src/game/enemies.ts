import * as THREE from 'three';
import { clamp, dampAngle, damp, rand, randInt, terrainHeight, WORLD, ENEMY_NAMES } from './core';
import { buildGoblinRig, buildArcherRig, buildOrcRig, buildBossRig, type HumanoidRig, type VisualRig } from './models';
import { PoseApplier, idlePose, runPose, strafePose, sampleClip, CLIPS } from './animations';
import { Entity, type GameCtx } from './entities';
import type { GlbCharacter, EnemyVariant } from './characters';
import { monsterTimeScale } from './characters';

/* ============================================================
   ENEMIGOS: IA por máquina de estados + jefe con fases
   ============================================================ */

export type EnemyType = 'goblin' | 'archer' | 'orc' | 'boss';

interface EnemyAttackDef {
  clip: string;
  dur: number;
  hitAt: number;
  dmg: number;
  range: number;
  arc: number;          // radians total (PI = 180°)
  impulse: number;
  special?: 'aoe' | 'orbs' | 'spin';
  weight: number;
  minPhase?: number;
}

interface EnemyCfg {
  make: () => HumanoidRig;
  hp: number;
  dmg: number;
  speed: number;
  aggro: number;
  radius: number;
  xp: number;
  gold: [number, number];
  potionChance: number;
  attacks: EnemyAttackDef[];
  cooldown: number;
  strafe?: boolean;      // mantiene distancia (arquero)
  preferredRange?: number;
  scale: number;
}

export const ENEMY_CFG: Record<EnemyType, EnemyCfg> = {
  goblin: {
    make: buildGoblinRig, hp: 36, dmg: 9, speed: 4.5, aggro: 15, radius: 0.5,
    xp: 22, gold: [4, 9], potionChance: 0.07, cooldown: 1.15, scale: 0.72,
    attacks: [{ clip: 'attack1', dur: 0.85, hitAt: 0.53, dmg: 9, range: 2.1, arc: 2.0, impulse: 1.6, weight: 1 }],
  },
  archer: {
    make: buildArcherRig, hp: 30, dmg: 11, speed: 3.8, aggro: 26, radius: 0.5,
    xp: 26, gold: [5, 11], potionChance: 0.11, cooldown: 2.3, scale: 0.95,
    strafe: true, preferredRange: 14,
    attacks: [{ clip: 'cast', dur: 0.9, hitAt: 0.45, dmg: 11, range: 30, arc: 6.3, impulse: 0, special: 'orbs', weight: 1 }],
  },
  orc: {
    make: buildOrcRig, hp: 100, dmg: 21, speed: 2.8, aggro: 14, radius: 0.9,
    xp: 55, gold: [11, 20], potionChance: 0.22, cooldown: 1.8, scale: 1.42,
    attacks: [{ clip: 'attack2', dur: 1.05, hitAt: 0.65, dmg: 21, range: 2.8, arc: 2.2, impulse: 2.4, weight: 1 }],
  },
  boss: {
    make: buildBossRig, hp: 780, dmg: 20, speed: 3.6, aggro: 40, radius: 1.15,
    xp: 420, gold: [120, 180], potionChance: 1, cooldown: 1.4, scale: 1.95,
    attacks: [
      { clip: 'attack1', dur: 0.8, hitAt: 0.46, dmg: 20, range: 4.0, arc: 2.4, impulse: 2, weight: 3 },
      { clip: 'attack2', dur: 1.25, hitAt: 0.78, dmg: 28, range: 5.0, arc: 6.3, impulse: 2.5, special: 'aoe', weight: 2 },
      { clip: 'attack1', dur: 1.0, hitAt: 0.45, dmg: 22, range: 4.6, arc: 6.3, impulse: 2, special: 'spin', weight: 2, minPhase: 2 },
      { clip: 'cast', dur: 1.0, hitAt: 0.5, dmg: 14, range: 40, arc: 0, impulse: 0, special: 'orbs', weight: 2, minPhase: 2 },
    ],
  },
};

type AiState = 'spawn' | 'idle' | 'wander' | 'chase' | 'strafe' | 'windup' | 'recover' | 'hurt' | 'dead';

/* Scratches reutilizables (cero allocations por enemigo y frame) */
const _eTmpA = new THREE.Vector3();
const _eTmpB = new THREE.Vector3();
const _eTmpC = new THREE.Vector3();
const _eTmpD = new THREE.Vector3();

export class Enemy extends Entity {
  type: EnemyType;
  cfg: EnemyCfg;
  /** rig visual activo (GLB real o procedural de respaldo) */
  rig: VisualRig;
  private procRig: HumanoidRig;
  glb: GlbCharacter | null = null;
  applier: PoseApplier;
  state: AiState = 'spawn';
  stateT = 0;
  attack: EnemyAttackDef | null = null;
  didHit = false;
  cd = 0;
  home = new THREE.Vector3();
  wanderTarget = new THREE.Vector3();
  animT = Math.random() * 10;
  runPhase = 0;
  moving = false;
  bar: THREE.Group;
  private barFill: THREE.Mesh;
  private barBg: THREE.Mesh;
  /** todos los materiales del rig (para fundir también los contornos) */
  private fadeMats: THREE.Material[] = [];
  scale = 1;
  hpBarWidth = 1.0;
  phase = 1;
  aggroed = false;
  stunThreshold = 0;
  isBoss = false;
  guardianOf = -1; // índice de santuario al que protege (-1 = errante)
  tint = 0; // acumulador paraflash
  /** hit-react direccional acumulado (decae solo) */
  private ovHitLean = 0;

  constructor(type: EnemyType, pos: THREE.Vector3, guardianOf = -1, hpMul = 1, dmgMul = 1) {
    super();
    this.type = type;
    this.cfg = ENEMY_CFG[type];
    this.guardianOf = guardianOf;
    this.isBoss = type === 'boss';
    this.procRig = this.cfg.make();
    this.rig = this.procRig;
    this.root.add(this.procRig.root);
    this.scale = this.cfg.scale;
    this.maxHp = Math.round(this.cfg.hp * hpMul);
    this.hp = this.maxHp;
    this.dmgMul = dmgMul;
    this.radius = this.cfg.radius;
    this.pos.copy(pos);
    this.pos.y = terrainHeight(pos.x, pos.z);
    this.home.copy(this.pos);
    this.root.position.copy(this.pos);
    this.applier = new PoseApplier(this.procRig, 12);
    this.collectMats();
    // materiales para el fundido de muerte (incluye contornos de tinta)
    this.rebuildFadeMats();
    // barra de vida sobre la cabeza
    this.bar = new THREE.Group();
    const w = this.isBoss ? 0 : this.cfg.radius * 2 + 0.6;
    this.hpBarWidth = w;
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.72, depthTest: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xd8323c, transparent: true, opacity: 0.95, depthTest: false });
    this.barBg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.11), bgMat);
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.11), fillMat);
    // anclar el relleno por la izquierda
    this.barFill.geometry.translate(w / 2, 0, 0);
    this.barFill.position.x = -w / 2;
    this.barBg.renderOrder = 20; this.barFill.renderOrder = 21;
    this.bar.add(this.barBg, this.barFill);
    this.bar.visible = false;
    this.bar.position.y = this.rig.height + 0.4;
    this.root.add(this.bar);
    // spawn: hundido
    this.root.position.y -= 2.2;
  }
  private dmgMul: number;

  /** Sustituye el rig procedural por un personaje GLB real */
  attachGlb(char: GlbCharacter) {
    if (this.glb) return;
    this.root.remove(this.procRig.root);
    this.glb = char;
    this.rig = char.rig;
    this.root.add(char.root);
    this.collectMats();
    this.rebuildFadeMats();
    this.bar.position.y = char.height + 0.45;
  }

  private anim(name: string, opts: { once?: boolean; restart?: boolean; fade?: number; timeScale?: number } = {}) {
    this.glb?.animator.play(name, opts);
  }

  /** Dispara el clip de ataque UNA vez al entrar en windup, sincronizado con atk.dur */
  private playWindup(atk: EnemyAttackDef) {
    if (!this.glb) return;
    const baked = this.glb.animator.clipDur(atk.clip);
    const ts = baked > 0.01 && atk.dur > 0.01 ? baked / atk.dur : 1;
    this.glb.animator.play(atk.clip, { once: true, restart: true, fade: 0.1, timeScale: ts });
  }

  /** timeScale del clip locomotor para casar el paso con la velocidad */
  private glbTime(clip: string): number {
    return this.glb ? monsterTimeScale(this.type as EnemyVariant, clip) : 1;
  }

  private rebuildFadeMats() {
    const fm = new Set<THREE.Material>();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.Material;
        if (m && !Array.isArray(m)) fm.add(m);
      }
    });
    // excluir la barra de vida (materiales basic con depthTest false)
    this.fadeMats = [...fm].filter(m => !(m as THREE.MeshBasicMaterial).isMeshBasicMaterial);
  }

  get dmg() { return this.cfg.dmg * this.dmgMul * (this.phase === 3 ? 1.15 : 1); }

  pickAttack(dist: number): EnemyAttackDef | null {
    const pool = this.cfg.attacks.filter(a => {
      if (a.minPhase && this.phase < a.minPhase) return false;
      return dist <= a.range + 0.5;
    });
    if (pool.length === 0) return null;
    let total = 0;
    for (const a of pool) total += a.weight;
    let r = Math.random() * total;
    for (const a of pool) { r -= a.weight; if (r <= 0) return a; }
    return pool[0];
  }

  takeDamage(dmg: number, srcPos: THREE.Vector3, ctx: GameCtx, heavy: boolean): boolean {
    if (!this.alive || this.state === 'spawn' || this.state === 'dead') return false;
    // la probabilidad de crítico proviene del equipo del héroe
    const crit = Math.random() < ctx.player.critChance;
    const final = Math.round(dmg * (crit ? 1.85 : 1));
    this.hp -= final;
    this.aggroed = true;
    this.flash();
    ctx.audio.hitFlesh();
    // hit-react direccional: el enemigo se sacude ALEJÁNDOSE del golpe
    // (retroceso de caderas hacia la fuente de daño — más orgánico)
    const hitDir = _eTmpC.copy(srcPos).sub(this.pos).setY(0);
    if (hitDir.lengthSq() > 0.001) {
      hitDir.normalize();
      // pequeño giro de cuerpo para telegrafiar el punto de impacto
      const hitYaw = Math.atan2(hitDir.x, hitDir.z) - this.yaw;
      this.ovHitLean += clamp(Math.sin(hitYaw), -1, 1) * 0.12;
    }
    ctx.addDamageNumber(
      new THREE.Vector3(this.pos.x + rand(-0.4, 0.4), this.pos.y + this.rig.height * 0.9, this.pos.z),
      crit ? `${final}!` : `${final}`,
      crit ? '#ffc84a' : '#ffffff',
      crit,
    );
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + this.rig.height * 0.55, z: this.pos.z,
      count: crit ? 16 : 10, speed: 3.4, color: 0xd8323c, size: 0.22, life: 0.6, gravity: 6, drag: 1.2,
    });
    // destello en el punto de impacto (AA): visible en cada golpe
    ctx.flare(
      _eTmpC.copy(this.pos).setY(this.pos.y + this.rig.height * 0.6),
      crit ? 0xffe08a : 0xfff2d8, crit ? 1.4 : 0.85, 0.09,
    );
    // empuje (sin allocations)
    const d = _eTmpD.copy(this.pos).sub(srcPos).setY(0);
    if (d.lengthSq() > 0.001) {
      d.normalize();
      this.knock.add(d.multiplyScalar(heavy ? 5 : 2.2));
    }
    // aturdir
    const staggerChance = this.isBoss ? 0 : (heavy ? 0.9 : 0.45);
    if (this.hp <= 0) {
      this.die(ctx);
      return true;
    }
    if (Math.random() < staggerChance && this.state !== 'hurt') {
      this.state = 'hurt'; this.stateT = 0;
      this.attack = null;
      this.anim('hurt', { once: true, restart: true, fade: 0.06 });
    }
    // fases del jefe
    if (this.isBoss) {
      const frac = this.hp / this.maxHp;
      if (this.phase === 1 && frac <= 0.6) { this.phase = 2; this.bossPhaseUp(ctx); }
      else if (this.phase === 2 && frac <= 0.3) { this.phase = 3; this.bossPhaseUp(ctx); }
    }
    return true;
  }

  private bossPhaseUp(ctx: GameCtx) {
    ctx.audio.bossRoar();
    ctx.shake(0.6);
    ctx.particles.burst({
      x: this.pos.x, y: this.pos.y + 2, z: this.pos.z,
      count: 50, speed: 7, color: 0xff2211, size: 0.4, life: 1.1, gravity: -1, drag: 1, glow: 2.4,
    });
    if (this.rig.weaponMat) this.rig.weaponMat.emissiveIntensity = this.phase === 2 ? 0.9 : 1.6;
  }

  die(ctx: GameCtx) {
    this.hp = 0;
    this.alive = false;
    this.state = 'dead';
    this.stateT = 0;
    this.bar.visible = false;
    ctx.audio.die();
    ctx.onEnemyDied(this);
  }

  update(dt: number, ctx: GameCtx) {
    this.animT += dt;
    this.updateFlash(dt);
    const p = ctx.player;
    const toPlayer = _eTmpA.copy(p.pos).sub(this.pos).setY(0);
    const dist = toPlayer.length();
    const cfg = this.cfg;

    switch (this.state) {
      case 'spawn': {
        this.stateT += dt;
        const t = clamp(this.stateT / 1.0, 0, 1);
        this.root.position.y = this.pos.y - 2.2 * (1 - t) + Math.sin(t * Math.PI) * 0.15;
        if (Math.random() < 0.5) ctx.particles.spawn({
          x: this.pos.x + rand(-0.8, 0.8) * this.scale, y: this.pos.y + 0.1, z: this.pos.z + rand(-0.8, 0.8) * this.scale,
          color: 0x8a2ac8, size: 0.3, life: 0.8, vy: rand(1, 2.5), glow: 1.6,
        });
        if (t >= 1) { this.state = 'idle'; this.stateT = 0; }
        if (this.glb) this.anim('idle');
        else this.applier.apply(idlePose(this.animT), dt);
        return;
      }
      case 'dead': {
        this.stateT += dt;
        const deathDur = this.glb ? Math.max(0.9, this.glb.animator.clipDur('death') || 1.4) : CLIPS.death.dur;
        const k = clamp(this.stateT / deathDur, 0, 1);
        if (this.glb) {
          this.anim('death', { once: true });
        } else {
          this.applier.snap(sampleClip(CLIPS.death, this.stateT), dt);
        }
        if (k >= 1) {
          // hundirse y desaparecer
          this.root.position.y -= dt * 0.5;
          for (const m of this.fadeMats) {
            m.transparent = true;
            m.opacity = Math.max(0, m.opacity - dt * 0.8);
          }
          if (this.stateT > deathDur + 2.2) this.removable = true;
        }
        return;
      }
      case 'hurt': {
        this.stateT += dt;
        if (this.glb) {
          this.anim('hurt');
          const hurtDur = Math.max(0.45, Math.min(0.85, this.glb.animator.clipDur('hurt') || 0.7));
          if (this.stateT >= hurtDur) { this.state = 'chase'; this.stateT = 0; }
        } else {
          this.applier.snap(sampleClip(CLIPS.hurt, Math.min(this.stateT, CLIPS.hurt.dur)), dt);
          if (this.stateT >= CLIPS.hurt.dur) { this.state = 'chase'; this.stateT = 0; }
        }
        break;
      }
      case 'idle':
      case 'wander': {
        // deambular cerca de casa
        this.cd -= dt;
        if (dist < cfg.aggro && !this.aggroed) {
          this.aggroed = true;
          // gruñido de alerta al detectar al héroe
          if (this.type === 'goblin') ctx.audio.goblinVox();
        }
        if (this.aggroed && dist < cfg.aggro * 2.2) {
          this.state = cfg.strafe ? 'strafe' : 'chase';
          this.stateT = 0;
          break;
        }
        if (this.state === 'idle') {
          this.stateT += dt;
          if (this.stateT > rand(1.5, 3)) {
            this.state = 'wander'; this.stateT = 0;
            this.wanderTarget.copy(this.home).add(_eTmpB.set(rand(-6, 6), 0, rand(-6, 6)));
          }
          if (this.glb) this.anim('idle', { fade: 0.35 });
          else this.applier.apply(idlePose(this.animT), dt);
          this.moving = false;
        } else {
          const toT = _eTmpB.copy(this.wanderTarget).sub(this.pos).setY(0);
          if (toT.length() < 1) { this.state = 'idle'; this.stateT = 0; }
          else {
            toT.normalize();
            this.pos.addScaledVector(toT, cfg.speed * 0.4 * dt);
            this.yaw = dampAngle(this.yaw, Math.atan2(toT.x, toT.z), 6, dt);
            this.runPhase += dt * 0.5;
            if (this.glb) this.anim('walk', { fade: 0.3, timeScale: this.glbTime('walk') });
            else this.applier.apply(runPose(this.runPhase, 0.5), dt);
            this.moving = true;
          }
        }
        break;
      }
      case 'chase': {
        this.cd -= dt;
        if (dist > cfg.aggro * 2.6 || p.state === 'dead') { this.aggroed = false; this.state = 'wander'; this.stateT = 0; break; }
        const range = this.cfg.strafe ? this.cfg.preferredRange! : cfg.attacks[0].range;
        if (dist <= cfg.attacks[0].range && this.cd <= 0) {
          // atacar
          const atk = this.pickAttack(dist);
          if (atk) {
            this.attack = atk; this.state = 'windup'; this.stateT = 0; this.didHit = false;
            this.playWindup(atk);
            // encarar
            this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
            break;
          }
        }
        const dir = _eTmpB.copy(toPlayer).normalize();
        const stopDist = cfg.attacks[0].range * 0.85;
        if (dist > stopDist) {
          const nightBoost = 1 + 0.12 * ctx.nightFactor; // de noche los enemigos aceleran
          this.pos.addScaledVector(dir, cfg.speed * nightBoost * (this.phase === 3 ? 1.2 : 1) * dt);
          this.runPhase += dt * (cfg.speed / 5);
          if (this.glb) this.anim('run', { fade: 0.22, timeScale: this.glbTime('run') });
          else this.applier.apply(runPose(this.runPhase, 1), dt);
          this.moving = true;
        } else {
          if (this.glb) this.anim('strafe', { fade: 0.3 });
          else this.applier.apply(strafePose(this.animT, false), dt);
          this.moving = false;
        }
        this.yaw = dampAngle(this.yaw, Math.atan2(toPlayer.x, toPlayer.z), 8, dt);
        break;
      }
      case 'strafe': {
        // arquero: mantener rango y disparar
        this.cd -= dt;
        if (dist > cfg.aggro * 2.6 || p.state === 'dead') { this.aggroed = false; this.state = 'wander'; this.stateT = 0; break; }
        this.yaw = dampAngle(this.yaw, Math.atan2(toPlayer.x, toPlayer.z), 10, dt);
        const pref = cfg.preferredRange!;
        const dir = _eTmpB.copy(toPlayer).normalize();
        const move = _eTmpC.set(0, 0, 0);
        if (dist > pref + 3) move.add(dir);
        else if (dist < pref - 4) move.sub(dir);
        // circlear
        const side = Math.sin(this.animT * 0.7) > 0 ? 1 : -1;
        move.add(_eTmpD.set(-dir.z * side * 0.7, 0, dir.x * side * 0.7));
        if (move.lengthSq() > 0.01) {
          move.normalize();
          this.pos.addScaledVector(move, cfg.speed * dt);
          this.runPhase += dt;
          if (this.glb) this.anim('walk', { fade: 0.25, timeScale: this.glbTime('walk') });
          else this.applier.apply(runPose(this.runPhase, 0.8), dt);
          this.moving = true;
        } else {
          if (this.glb) this.anim('strafe', { fade: 0.3 });
          else this.applier.apply(strafePose(this.animT, false), dt);
          this.moving = false;
        }
        if (this.cd <= 0 && dist < 28) {
          const atk = this.cfg.attacks[0];
          this.attack = atk; this.state = 'windup'; this.stateT = 0; this.didHit = false;
          this.playWindup(atk);
        }
        break;
      }
      case 'windup': {
        this.stateT += dt;
        const atk = this.attack!;
        const clip = CLIPS[atk.clip];
        const speed = this.isBoss && this.phase === 3 ? 1.18 : 1;
        const localT = this.stateT * speed;
        // encara al jugador durante la anticipación (no para proyectiles girados)
        if (localT < atk.hitAt * 0.7 && !cfg.strafe && atk.special !== 'orbs') {
          this.yaw = dampAngle(this.yaw, Math.atan2(toPlayer.x, toPlayer.z), 6, dt);
        }
        if (this.glb) {
          // (el clip de ataque se dispara UNA vez al entrar en windup)
          this.glb.animator.update(dt * (speed - 1)); // aceleración del jefe en fase 3
        } else {
          this.applier.snap(sampleClip(clip, Math.min(localT, clip.dur)), dt);
        }
        // brillo del arma como telegrafía
        if (this.rig.weaponMat && localT > atk.hitAt * 0.35) {
          this.rig.weaponMat.emissiveIntensity = 1.4 + Math.sin(localT * 30) * 0.6;
        }
        // chispas de carga durante la anticipación (telegrafía legible)
        if (localT < atk.hitAt && Math.random() < 0.35) {
          const wPos = _eTmpC;
          if (this.rig.handR) this.rig.handR.getWorldPosition(wPos);
          else wPos.set(this.pos.x, this.pos.y + this.rig.height * 0.6, this.pos.z);
          ctx.particles.spawn({
            x: wPos.x + rand(-0.2, 0.2), y: wPos.y + rand(-0.1, 0.2), z: wPos.z + rand(-0.2, 0.2),
            color: 0xffa04a, size: 0.14, life: 0.3, glow: 2.4, drag: 2,
            vx: rand(-0.8, 0.8), vy: rand(0.5, 1.6), vz: rand(-0.8, 0.8),
          });
        }
        if (localT >= atk.hitAt && !this.didHit) {
          this.didHit = true;
          this.executeAttack(atk, ctx);
          if (this.rig.weaponMat) this.rig.weaponMat.emissiveIntensity = 0;
        }
        if (localT >= atk.dur) {
          this.state = 'recover'; this.stateT = 0;
          this.cd = cfg.cooldown * (this.isBoss && this.phase === 3 ? 0.7 : 1) * rand(0.85, 1.2);
        }
        break;
      }
      case 'recover': {
        this.stateT += dt;
        if (this.glb) this.anim('strafe', { fade: 0.3 });
        else this.applier.apply(strafePose(this.animT, false), dt, 10);
        if (this.stateT > 0.25) { this.state = p.state === 'dead' ? 'wander' : (this.aggroed ? (cfg.strafe ? 'strafe' : 'chase') : 'wander'); this.stateT = 0; }
        break;
      }
    }

    if (this.glb) this.glb.animator.update(dt);

    // hit-react direccional: inclina el spine según el último golpe y decae
    if (this.ovHitLean !== 0) {
      const spine = this.glb?.spine;
      if (spine) spine.rotation.z += this.ovHitLean;
      this.ovHitLean *= Math.max(0, 1 - dt * 9);
      if (Math.abs(this.ovHitLean) < 0.002) this.ovHitLean = 0;
    }

    // knockback + separación + límites
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.max(0, 1 - 7 * dt));

    // límites del mundo y de su zona
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD.radius - 3) {
      this.pos.multiplyScalar((WORLD.radius - 3) / r);
    }
    if (!this.isBoss && !this.aggroed) {
      const dh = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
      if (dh > 16) {
        const back = _eTmpB.copy(this.home).sub(this.pos).setY(0).normalize();
        this.pos.addScaledVector(back, dt * 3);
      }
    }

    const h = terrainHeight(this.pos.x, this.pos.z);
    // (los estados 'dead' y 'spawn' ya retornaron antes)
    this.pos.y = damp(this.pos.y, h, 20, dt);
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.yaw;

    // barra de vida
    const showBar = !this.isBoss && this.alive && (this.hp < this.maxHp || this.aggroed);
    this.bar.visible = showBar;
    if (showBar) {
      this.bar.quaternion.copy(ctx.camera.quaternion);
      const frac = clamp(this.hp / this.maxHp, 0, 1);
      this.barFill.scale.x = Math.max(0.0001, frac);
    }
  }

  private executeAttack(atk: EnemyAttackDef, ctx: GameCtx) {
    const p = ctx.player;
    if (atk.special === 'orbs' && this.type === 'archer') {
      // flecha del arquero
      const bowPos = new THREE.Vector3();
      if (this.rig.handR) this.rig.handR.getWorldPosition(bowPos);
      else bowPos.copy(this.pos).setY(this.pos.y + this.rig.height * 0.7);
      const target = p.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
      // predicción simple
      target.addScaledVector(new THREE.Vector3(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize(), dist_to(this, p) * 0.06);
      const dir = target.sub(bowPos).normalize();
      ctx.spawnProjectile({ pos: bowPos, dir, speed: 21, dmg: atk.dmg * this.dmgMul, kind: 'arrow' });
      ctx.audio.arrow();
      return;
    }
    if (atk.special === 'orbs' && this.isBoss) {
      // abanico de 3 orbes oscuros
      const base = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0).normalize();
      const origin = this.pos.clone().add(new THREE.Vector3(0, this.rig.height * 0.7, 0));
      for (let i = -1; i <= 1; i++) {
        const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.28);
        ctx.spawnProjectile({ pos: origin.clone(), dir, speed: 12.5, dmg: atk.dmg * this.dmgMul, kind: 'orb' });
      }
      ctx.audio.slam();
      return;
    }
    if (atk.special === 'aoe') {
      // impacto sísmico
      ctx.audio.slam();
      ctx.shake(0.7);
      const impact = this.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 2.2);
      impact.y = terrainHeight(impact.x, impact.z) + 0.1;
      ctx.particles.burst({ x: impact.x, y: impact.y + 0.3, z: impact.z, count: 40, speed: 8, spread: 0.6, color: 0xff5a2a, size: 0.4, life: 0.8, gravity: 8, drag: 1.4, glow: 1.8 });
      ctx.particles.burst({ x: impact.x, y: impact.y + 0.3, z: impact.z, count: 24, speed: 5, spread: 0.4, color: 0x6b5a4a, size: 0.5, life: 1.1, gravity: 5, drag: 2, glow: 0.8 });
      // daño radial
      const d = Math.hypot(p.pos.x - impact.x, p.pos.z - impact.z);
      if (d < atk.range * 0.85 && Math.abs(p.pos.y - impact.y) < 2.5) {
        p.takeDamage(atk.dmg * this.dmgMul, this.pos, ctx);
      }
      return;
    }
    // golpe cuerpo a cuerpo (cono)
    const toP = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0);
    const dist = toP.length();
    if (dist <= atk.range + p.radius) {
      const angTo = Math.atan2(toP.x, toP.z);
      let diff = Math.abs(((angTo - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      diff = Math.abs(diff);
      if (diff <= atk.arc / 2) {
        p.takeDamage(atk.dmg * this.dmgMul, this.pos, ctx);
      }
    }
    if (atk.special === 'spin') {
      ctx.audio.swing(0.6);
    } else {
      ctx.audio.swing(0.8);
    }
  }
}

function dist_to(e: Enemy, p: { pos: THREE.Vector3 }): number {
  return Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
}

export function bossName(): string { return ENEMY_NAMES.boss; }
