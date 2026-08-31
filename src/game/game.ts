import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { clamp, dampAngle, damp, rand, randInt, WORLD, terrainHeight, type HudState, type GamePhase, type GameRefs, ENEMY_NAMES } from './core';
import { idlePose } from './animations';
import { Particles } from './particles';
import { AudioEngine } from './audio';
import { World } from './world';
import { Player, Projectile, Pickup, SwordTrail, type InputState, type GameCtx, PLAYER_HEAVY, type AttackDef } from './entities';
import { Enemy, ENEMY_CFG, type EnemyType } from './enemies';
import { drawMinimap } from './minimap';

export type QualityTier = 'bajo' | 'medio' | 'alto';

/* Grading final: viñeta, grano fílmico, aberración cromática y color */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.44 },
    uGrain: { value: 0.038 },
    uCA: { value: 0.0015 },
    uSat: { value: 1.08 },
    uCon: { value: 1.04 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette;
    uniform float uGrain; uniform float uCA; uniform float uSat; uniform float uCon;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uCA * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uCon + 0.5;
      col *= 1.0 - uVignette * smoothstep(0.12, 0.72, r2);
      col += (hash(uv * vec2(1287.0, 731.0) + fract(uTime) * 43.7) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/* ============================================================
   GAME: orquestador principal (render, input, cámara, combate, fases)
   ============================================================ */

interface DamageNumber {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  life: number;
  vy: number;
  active: boolean;
}

const ROAMER_TARGET = 8;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private container: HTMLElement;
  private refs: GameRefs;
  private raf = 0;
  private lastT = 0;
  private running = false;

  // sistemas
  audio = new AudioEngine();
  world: World;
  particles: Particles;
  player: Player;
  private trail: SwordTrail;
  enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];

  // input
  private keys = new Set<string>();
  private queued = { attack: false, heavy: false, roll: false, potion: false };
  private inputState: InputState;
  private mouseDX = 0; private mouseDY = 0;
  private locked = false;

  // cámara
  private camYaw = 0; private camPitch = 0.34;
  private camDist = 6.4;
  private camPos = new THREE.Vector3();
  private shakeAmt = 0;
  private hitStopT = 0;
  private timeScale = 1;
  private slowmoT = 0;
  private baseFov = 55;

  // estado de juego
  phase: GamePhase = 'playing';
  private shrinesCleansed = 0;
  private boss: Enemy | null = null;
  bossActive = false;
  private bossDefeated = false;
  private endless = false;
  private awakenTimer = -1;
  private roamerTimer = 3;
  private elapsed = 0;
  private hurtFlash = 0;
  private fps = 60;
  private hudTimer = 0;
  private minimapTimer = 0;
  private lockEnemy: Enemy | null = null;
  private interactTarget: { kind: 'bonfire' | 'shrine' | 'sigil'; idx?: number } | null = null;
  private victoryDelay = -1;

  // números de daño (DOM pool)
  private dmgPool: DamageNumber[] = [];
  private dmgLayer: HTMLDivElement;

  private onHud: (s: HudState) => void;
  private ctx: GameCtx;

  // calidad y menú cinemático
  quality: QualityTier = 'alto';
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass | null = null;
  private menuT = 0;
  private qualityTimer = 2.5;
  private started = false;

  constructor(refs: GameRefs, onHud: (s: HudState) => void) {
    this.refs = refs;
    this.container = refs.container;
    this.onHud = onHud;

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatioFor('alto'));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // escena
    this.scene.fog = new THREE.FogExp2(0x0d1322, 0.0105);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.1, 500);

    // mundo y sistemas
    this.world = new World(this.scene, this.renderer);
    this.particles = new Particles(this.scene);
    this.player = new Player();
    this.scene.add(this.player.root);
    this.trail = new SwordTrail(this.scene);

    // jugador frente a la hoguera
    const bx = WORLD.bonfire.x, bz = WORLD.bonfire.z + 3.4;
    this.player.pos.set(bx, terrainHeight(bx, bz), bz);
    this.player.yaw = Math.atan2(WORLD.bonfire.x - bx, WORLD.bonfire.z - bz) + Math.PI;
    this.camYaw = this.player.yaw + Math.PI;

    // post-procesado: MSAA + GTAO + bloom + tono + grading
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    try {
      const gtao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      if (typeof gtao.updateGtaoMaterial === 'function') {
        gtao.updateGtaoMaterial({
          radius: 0.45, distanceExponent: 1.2, thickness: 1.4,
          scale: 1.3, samples: 12, screenSpaceRadius: false,
          distanceFallOff: 1,
        });
      }
      gtao.output = GTAOPass.OUTPUT.Default;
      this.composer.addPass(gtao);
      this.gtao = gtao;
    } catch { this.gtao = null; }
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.85, 0.75);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // capa de números de daño
    this.dmgLayer = document.createElement('div');
    this.dmgLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
    this.container.appendChild(this.dmgLayer);

    this.inputState = {
      fwd: false, back: false, left: false, right: false, sprint: false,
      consumeAttack: () => { const v = this.queued.attack; this.queued.attack = false; return v; },
      consumeHeavy: () => { const v = this.queued.heavy; this.queued.heavy = false; return v; },
      consumeRoll: () => { const v = this.queued.roll; this.queued.roll = false; return v; },
      consumePotion: () => { const v = this.queued.potion; this.queued.potion = false; return v; },
    };

    // contexto para entidades
    this.ctx = {
      scene: this.scene,
      particles: this.particles,
      audio: this.audio,
      world: this.world,
      player: this.player,
      enemies: this.enemies,
      camera: this.camera,
      input: this.inputState,
      camYaw: 0,
      addDamageNumber: (pos, text, color, big) => this.addDamageNumber(pos, text, color, big),
      shake: (a) => { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); },
      hitStop: (d) => { this.hitStopT = Math.max(this.hitStopT, d); },
      spawnProjectile: (o) => { this.projectiles.push(new Projectile(o)); },
      onEnemyDied: (e) => this.handleEnemyDied(e),
      playerHurt: () => { this.hurtFlash = 1; },
    };

    this.phase = 'menu';

    this.bindEvents();
    this.emitHud();
  }

  /* ---------- Calidad ---------- */

  private pixelRatioFor(q: QualityTier): number {
    if (q === 'bajo') return 0.85;
    if (q === 'medio') return 1.2;
    return Math.min(window.devicePixelRatio, 1.75);
  }

  setQuality(q: QualityTier) {
    this.quality = q;
    const pr = this.pixelRatioFor(q);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    if (this.gtao) this.gtao.enabled = q !== 'bajo';
    this.emitHud();
  }

  private autoQuality(dt: number) {
    this.qualityTimer -= dt;
    if (this.qualityTimer > 0) return;
    this.qualityTimer = 2.5;
    if (this.fps < 42) {
      if (this.quality === 'alto') this.setQuality('medio');
      else if (this.quality === 'medio') this.setQuality('bajo');
    }
  }

  /* ---------- Inicio de aventura (desde el menú) ---------- */

  beginAdventure() {
    if (this.started) return;
    this.started = true;
    this.spawnGuardians();
    for (let i = 0; i < 6; i++) this.spawnRoamer(true);
    this.audio.unlock();
    this.audio.startMusic();
    this.setPhase('playing');
    this.requestLock();
  }

  /* ---------- Spawns ---------- */

  private scaling() {
    const lv = this.player.level;
    const eMul = this.endless ? 1.35 : 1;
    return {
      hp: (1 + 0.08 * (lv - 1)) * eMul,
      dmg: (1 + 0.05 * (lv - 1)) * eMul,
    };
  }

  private spawnEnemy(type: EnemyType, x: number, z: number, guardianOf = -1): Enemy {
    const s = this.scaling();
    const e = new Enemy(type, new THREE.Vector3(x, 0, z), guardianOf, s.hp, s.dmg);
    this.enemies.push(e);
    this.scene.add(e.root);
    return e;
  }

  private spawnGuardians() {
    const compositions: EnemyType[][] = [
      ['goblin', 'goblin', 'goblin', 'archer'],
      ['goblin', 'goblin', 'archer', 'archer'],
      ['orc', 'goblin', 'goblin', 'archer'],
    ];
    compositions.forEach((comp, idx) => {
      const s = WORLD.shrines[idx];
      comp.forEach((type, i) => {
        const a = (i / comp.length) * Math.PI * 2 + rand(0, 1);
        const r = rand(4.5, 7.5);
        this.spawnEnemy(type, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, idx);
      });
    });
  }

  private spawnRoamer(initial = false) {
    if (this.enemies.filter(e => e.alive && e.guardianOf === -1 && !e.isBoss).length >= ROAMER_TARGET + 4) return;
    for (let tries = 0; tries < 20; tries++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(24, WORLD.radius - 12);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const dPlayer = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
      const dBonfire = Math.hypot(x - WORLD.bonfire.x, z - WORLD.bonfire.z);
      const nearShrine = WORLD.shrines.some((s, i) => !this.world.shrines[i].cleansed && Math.hypot(x - s.x, z - s.z) < 16);
      if (dPlayer > (initial ? 20 : 26) && dBonfire > 16 && !nearShrine) {
        // tipos según nivel
        const roll = Math.random();
        let type: EnemyType = 'goblin';
        if (roll > 0.82 - Math.min(0.15, this.player.level * 0.01)) type = 'orc';
        else if (roll > 0.5) type = 'archer';
        this.spawnEnemy(type, x, z);
        return;
      }
    }
  }

  private spawnBoss(mul = 1) {
    if (this.boss && this.boss.alive) return;
    const s = this.scaling();
    const A = WORLD.arena;
    const e = this.spawnEnemy('boss', A.x, A.z - 6);
    e.maxHp = Math.round(e.maxHp * mul); e.hp = e.maxHp;
    void s;
    this.boss = e;
    this.bossActive = true;
    this.awakenTimer = -1;
    this.audio.bossRoar();
    this.audio.setIntensity(1);
    this.ctx.shake(1);
    // pilar de luz rojo dramático
    for (let i = 0; i < 60; i++) {
      setTimeout(() => {
        if (!this.running) return;
        this.particles.spawn({
          x: e.pos.x + rand(-1.5, 1.5), y: e.pos.y + rand(0, 1), z: e.pos.z + rand(-1.5, 1.5),
          vy: rand(8, 16), color: 0xff2211, size: rand(0.3, 0.6), life: 1.4, drag: 0.4, glow: 2.6, gravity: -2,
        });
      }, i * 22);
    }
    this.emitHud();
  }

  /* ---------- Muertes y recompensas ---------- */

  private handleEnemyDied(e: Enemy) {
    this.player.kills++;
    const cfg = ENEMY_CFG[e.type];
    const gold = randInt(cfg.gold[0], cfg.gold[1]);
    this.player.gold += gold;
    this.player.gainXp(cfg.xp, this.ctx);
    // orbes de alma
    for (let i = 0; i < 10; i++) {
      this.particles.spawn({
        x: e.pos.x + rand(-0.6, 0.6), y: e.pos.y + 0.6, z: e.pos.z + rand(-0.6, 0.6),
        color: 0x6ae8ff, size: 0.26, life: 2.2, glow: 2.2, shrink: false,
        seek: { getPos: () => this.player.pos, speed: 6 },
      });
    }
    // drop de poción
    if (Math.random() < cfg.potionChance) {
      this.pickups.push(new Pickup(e.pos.clone(), 'potion'));
      this.scene.add(this.pickups[this.pickups.length - 1].root);
    }
    // guardianes → santuario purificable
    if (e.guardianOf >= 0) {
      const alive = this.enemies.filter(o => o.guardianOf === e.guardianOf && o.alive && o !== e).length;
      if (alive === 0) {
        // todos los guardias muertos
        void e.guardianOf;
      }
    }
    if (e.isBoss) {
      this.bossActive = false;
      this.bossDefeated = true;
      this.endless = true;
      this.world.activateSigil();
      this.world.sigilReady();
      this.slowmoT = 2.2;
      this.timeScale = 0.3;
      this.victoryDelay = 2.0;
      this.audio.setIntensity(0.2);
      this.audio.cleanse();
      this.ctx.shake(1);
      this.particles.burst({
        x: e.pos.x, y: e.pos.y + 2, z: e.pos.z,
        count: 90, speed: 10, color: 0xffc84a, size: 0.5, life: 2, gravity: -1, drag: 0.8, glow: 2.6,
      });
    }
  }

  /* ---------- Interacción ---------- */

  private updateInteract() {
    this.interactTarget = null;
    const p = this.player.pos;
    const dB = Math.hypot(p.x - WORLD.bonfire.x, p.z - WORLD.bonfire.z);
    if (dB < 3.4) {
      this.interactTarget = { kind: 'bonfire' };
      return;
    }
    for (const sh of this.world.shrines) {
      if (sh.cleansed) continue;
      const guardians = this.enemies.filter(e => e.guardianOf === sh.idx && e.alive);
      const d = Math.hypot(p.x - sh.pos.x, p.z - sh.pos.z);
      if (d < 5 && guardians.length === 0) {
        this.interactTarget = { kind: 'shrine', idx: sh.idx };
        return;
      }
    }
    if (this.world.sigil && this.world.sigil.group.visible && this.bossDefeated) {
      const A = WORLD.arena;
      const d = Math.hypot(p.x - A.x, p.z - A.z);
      if (d < 4.5) this.interactTarget = { kind: 'sigil' };
    }
  }

  private doInteract() {
    const t = this.interactTarget;
    if (!t) return;
    if (t.kind === 'bonfire') {
      const p = this.player;
      p.hp = p.maxHp; p.stamina = p.maxStamina; p.potions = p.maxPotions;
      this.audio.bonfireRest();
      this.particles.burst({
        x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z,
        count: 26, speed: 2.6, color: 0xffb347, size: 0.3, life: 1.1, gravity: -1.5, drag: 1.5, glow: 2,
      });
      this.addDamageNumber(new THREE.Vector3(p.pos.x, p.pos.y + 2.3, p.pos.z), 'REPOSO', '#ffb347');
    } else if (t.kind === 'shrine' && t.idx !== undefined) {
      const sh = this.world.shrines[t.idx];
      this.world.cleanseShrine(t.idx);
      this.shrinesCleansed++;
      this.audio.cleanse();
      this.player.gainXp(60, this.ctx);
      this.player.gold += 40;
      this.particles.burst({
        x: sh.pos.x, y: sh.pos.y + 4, z: sh.pos.z,
        count: 70, speed: 7, color: 0x37d8c8, size: 0.42, life: 1.8, gravity: -0.5, drag: 0.9, glow: 2.4,
      });
      this.ctx.shake(0.5);
      if (this.shrinesCleansed >= 3 && !this.bossDefeated && !this.bossActive) {
        this.awakenTimer = 2.5;
      }
      this.emitHud();
    } else if (t.kind === 'sigil') {
      this.world.sigilReady();
      this.spawnBoss(1.35 ** this.bossKills());
      this.addDamageNumber(new THREE.Vector3(this.player.pos.x, this.player.pos.y + 2.3, this.player.pos.z), 'EL JEFE DESPIERTA DE NUEVO', '#ff5a4e', true);
    }
  }

  private bossKills(): number {
    return this.endless ? Math.max(1, Math.floor((this.player.level - 3) / 2)) : 1;
  }

  /* ---------- Lock-on ---------- */

  private toggleLockOn() {
    if (this.lockEnemy) { this.lockEnemy = null; this.player.lockTarget = null; return; }
    let best: Enemy | null = null, bestD = 34;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const d = e.pos.distanceTo(this.player.pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    this.lockEnemy = best;
    this.player.lockTarget = best;
  }

  /* ---------- Bucle principal ---------- */

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.loop(this.lastT);
  }

  private loop = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.fps = this.fps * 0.95 + (1 / Math.max(0.0001, dt)) * 0.05;

    if (this.phase === 'menu') {
      this.menuT += dt;
      this.updateMenuScene(dt);
      this.composer.render();
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) { this.hudTimer = 0.3; this.emitHud(); }
      return;
    }

    if (this.phase === 'playing') {
      this.autoQuality(dt);
      // hit-stop y cámara lenta
      if (this.hitStopT > 0) {
        this.hitStopT -= dt;
        this.updateWorld(dt * 0.06);
      } else if (this.slowmoT > 0) {
        this.slowmoT -= dt;
        if (this.slowmoT <= 0) this.timeScale = 1;
        this.updateWorld(dt * this.timeScale);
      } else {
        this.updateWorld(dt);
      }
    } else if (this.phase === 'dead' || this.phase === 'victory') {
      // el mundo sigue con animaciones reducidas
      this.updateWorld(dt * 0.25, true);
    }

    this.updateCamera(dt);
    this.updateEffects(dt);
    this.composer.render();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.08; this.emitHud(); this.drawMinimap(); }
  };

  /* ---------- Escena cinemática del menú ---------- */

  private updateMenuScene(dt: number) {
    this.world.update(dt, this.camera, (x, y, z) => {
      this.particles.spawn({
        x, y, z, vx: rand(-0.3, 0.3), vy: rand(1, 2.2), vz: rand(-0.3, 0.3),
        color: 0xff7a2a, size: rand(0.1, 0.2), life: rand(0.8, 1.6), glow: 2.2, drag: 0.5,
      });
    });
    this.particles.update(dt, this.camera.position);
    // héroe contemplando la hoguera
    this.player.applier.apply(idlePose(this.menuT), dt, 6);
    this.player.root.position.copy(this.player.pos);
    this.player.root.rotation.y = this.player.yaw;
    if (this.grade) this.grade.uniforms.uTime.value = this.menuT;

    // órbita lenta alrededor de la hoguera
    const a = this.menuT * 0.055 + 2.2;
    const r = 9.6 + Math.sin(this.menuT * 0.1) * 1.4;
    const bx = WORLD.bonfire.x, bz = WORLD.bonfire.z;
    const by = terrainHeight(bx, bz);
    const desired = new THREE.Vector3(
      bx + Math.cos(a) * r,
      by + 4.3 + Math.sin(this.menuT * 0.13) * 0.8,
      bz + Math.sin(a) * r,
    );
    const groundH = terrainHeight(desired.x, desired.z) + 0.5;
    if (desired.y < groundH) desired.y = groundH;
    this.camPos.lerp(desired, 1 - Math.exp(-2.2 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(bx, by + 1.9, bz);
    if (Math.abs(this.camera.fov - 52) > 0.05) {
      this.camera.fov = damp(this.camera.fov, 52, 3, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateWorld(dt: number, frozen = false) {
    this.elapsed += frozen ? 0 : dt;

    // input → estado
    const k = this.keys;
    this.inputState.fwd = k.has('KeyW') || k.has('ArrowUp');
    this.inputState.back = k.has('KeyS') || k.has('ArrowDown');
    this.inputState.left = k.has('KeyA') || k.has('ArrowLeft');
    this.inputState.right = k.has('KeyD') || k.has('ArrowRight');
    this.inputState.sprint = k.has('ShiftLeft') || k.has('ShiftRight');

    // jugador
    this.ctx.input = frozen ? this.frozenInput : this.inputState;
    this.ctx.camYaw = this.camYaw;
    this.player.update(dt, this.ctx);
    this.world.resolve(this.player.pos, this.player.radius);
    this.worldClamp(this.player.pos, this.player.radius);

    // resolver golpe pendiente del jugador
    if (this.player.pendingStrike) {
      this.resolvePlayerStrike(this.player.pendingStrike);
      this.player.pendingStrike = null;
    }

    // lock-on: limpiar si muere o se aleja
    if (this.lockEnemy && (!this.lockEnemy.alive || this.lockEnemy.pos.distanceTo(this.player.pos) > 38)) {
      this.lockEnemy = null;
      this.player.lockTarget = null;
    }

    // enemigos
    for (const e of this.enemies) {
      if (e.removable) continue;
      e.update(dt, this.ctx);
      if (e.alive) {
        this.world.resolve(e.pos, e.radius);
        this.worldClamp(e.pos, e.radius);
      }
    }
    // separación entre enemigos
    const live = this.enemies.filter(e => e.alive && e.state !== 'spawn');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const minD = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-5) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / d * 0.5;
          a.pos.x -= dx * push; a.pos.z -= dz * push;
          b.pos.x += dx * push; b.pos.z += dz * push;
        }
      }
      // el jugador empuja y es empujado ligeramente
      const p = this.player;
      const dx = p.pos.x - live[i].pos.x, dz = p.pos.z - live[i].pos.z;
      const minD = live[i].radius + p.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / d * 0.6;
        live[i].pos.x -= dx * push; live[i].pos.z -= dz * push;
        p.pos.x += dx * push * 0.3; p.pos.z += dz * push * 0.3;
      }
    }
    // limpiar cadáveres
    if (this.enemies.some(e => e.removable)) {
      for (const e of this.enemies) {
        if (e.removable) { this.scene.remove(e.root); }
      }
      this.enemies = this.enemies.filter(e => !e.removable);
    }

    // proyectiles y drops
    for (const pr of this.projectiles) pr.update(dt, this.ctx);
    this.projectiles = this.projectiles.filter(pr => {
      if (pr.dead) { this.scene.remove(pr.root); return false; }
      return true;
    });
    for (const pk of this.pickups) {
      pk.update(dt, this.ctx);
      this.world.resolve(pk.pos, 0.3);
    }
    this.pickups = this.pickups.filter(pk => {
      if (pk.dead) { this.scene.remove(pk.root); return false; }
      return true;
    });

    // mundo visual
    this.world.update(dt, this.camera, (x, y, z) => {
      this.particles.spawn({
        x, y, z, vx: rand(-0.3, 0.3), vy: rand(1, 2.2), vz: rand(-0.3, 0.3),
        color: 0xff7a2a, size: rand(0.1, 0.2), life: rand(0.8, 1.6), glow: 2.2, drag: 0.5,
      });
    });

    if (frozen) return;

    // estela de espada
    if (this.player.state === 'attack') {
      const b = new THREE.Vector3(), ti = new THREE.Vector3();
      this.player.swordPoints(b, ti);
      this.trail.emit(b, ti);
    }
    this.trail.update(dt, this.player.state === 'attack');

    // despawn/respawn de errantes
    this.roamerTimer -= dt;
    if (this.roamerTimer <= 0) {
      this.roamerTimer = rand(3.5, 6);
      const aliveRoamers = this.enemies.filter(e => e.alive && e.guardianOf === -1 && !e.isBoss).length;
      if (aliveRoamers < ROAMER_TARGET) this.spawnRoamer();
    }

    // despertar del jefe
    if (this.awakenTimer > 0) {
      this.awakenTimer -= dt;
      if (this.awakenTimer <= 0) this.spawnBoss();
    }
    // reaparición del jefe tras morir el jugador en plena lucha
    if (this.bossRespawnT > 0) {
      this.bossRespawnT -= dt;
      if (this.bossRespawnT <= 0 && this.shrinesCleansed >= 3) this.spawnBoss();
    }

    // interacción
    this.updateInteract();

    // música: intensidad
    if (this.elapsed % 1 < dt) {
      let intensity = 0.12;
      if (this.bossActive) intensity = 1;
      else {
        const near = this.enemies.some(e => e.alive && e.aggroed && e.pos.distanceTo(this.player.pos) < 30);
        intensity = near ? 0.75 : 0.12;
      }
      this.audio.setIntensity(intensity);
    }

    // victoria
    if (this.victoryDelay > 0) {
      this.victoryDelay -= dt;
      if (this.victoryDelay <= 0) {
        this.setPhase('victory');
      }
    }
  }

  private bossRespawnT = -1;
  private frozenInput: InputState = {
    fwd: false, back: false, left: false, right: false, sprint: false,
    consumeAttack: () => false, consumeHeavy: () => false,
    consumeRoll: () => false, consumePotion: () => false,
  };

  private resolvePlayerStrike(def: AttackDef) {
    const p = this.player;
    const heavy = def === PLAYER_HEAVY;
    let hitAny = false;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const to = new THREE.Vector3().subVectors(e.pos, p.pos).setY(0);
      const d = to.length() - e.radius;
      if (d > def.range) continue;
      const ang = Math.atan2(to.x, to.z);
      let diff = Math.abs(((ang - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff <= def.arc / 2) {
        const dmg = def.dmg * p.dmgMul;
        e.takeDamage(dmg, p.pos, this.ctx, heavy);
        hitAny = true;
        this.particles.burst({
          x: e.pos.x - to.x * 0.3, y: e.pos.y + e.rig.height * 0.55, z: e.pos.z - to.z * 0.3,
          count: heavy ? 14 : 8, speed: 5, color: 0xffd9a0, size: 0.2, life: 0.35, drag: 2, glow: 2.4, gravity: 4,
        });
      }
    }
    if (hitAny) {
      this.hitStopT = Math.max(this.hitStopT, heavy ? 0.11 : 0.07);
      this.shakeAmt = Math.min(1.2, this.shakeAmt + (heavy ? 0.4 : 0.16));
      if (heavy) this.audio.heavyHit();
      else this.audio.hitMetal();
    }
  }

  private worldClamp(pos: THREE.Vector3, radius: number) {
    const r = Math.hypot(pos.x, pos.z);
    const max = WORLD.radius - 2 - radius;
    if (r > max) {
      pos.x *= max / r;
      pos.z *= max / r;
    }
  }

  /* ---------- Cámara ---------- */

  private updateCamera(dt: number) {
    // ratón → rotación
    if (this.locked && this.phase === 'playing') {
      this.camYaw -= this.mouseDX * 0.0023;
      this.camPitch += this.mouseDY * 0.0018;
      this.camPitch = clamp(this.camPitch, -0.25, 1.15);
    }
    this.mouseDX = 0; this.mouseDY = 0;

    const target = this.player.pos;
    const head = new THREE.Vector3(target.x, target.y + 1.55, target.z);

    if (this.lockEnemy && this.lockEnemy.alive) {
      // cámara de objetivo fijado
      const desired = Math.atan2(target.x - this.lockEnemy.pos.x, target.z - this.lockEnemy.pos.z);
      this.camYaw = dampAngle(this.camYaw, desired, 3.2, dt);
      this.camPitch = damp(this.camPitch, 0.3, 3, dt);
    }

    const dist = this.camDist;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const off = new THREE.Vector3(Math.sin(this.camYaw) * cp, sp, Math.cos(this.camYaw) * cp);
    const desiredPos = head.clone().addScaledVector(off, dist);
    // hombro
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    desiredPos.addScaledVector(right, 0.55);
    // colisión con terreno
    const groundH = terrainHeight(desiredPos.x, desiredPos.z) + 0.5;
    if (desiredPos.y < groundH) desiredPos.y = groundH;

    this.camPos.lerp(desiredPos, 1 - Math.exp(-(this.lockEnemy ? 9 : 12) * dt));

    // sacudida
    const sh = this.shakeAmt;
    this.camera.position.copy(this.camPos);
    if (sh > 0.001) {
      this.camera.position.x += rand(-1, 1) * sh * 0.18;
      this.camera.position.y += rand(-1, 1) * sh * 0.18;
      this.camera.position.z += rand(-1, 1) * sh * 0.18;
      this.shakeAmt = Math.max(0, sh - dt * 2.4);
    }
    const lookAt = head.clone();
    if (this.lockEnemy && this.lockEnemy.alive) {
      lookAt.lerp(new THREE.Vector3(this.lockEnemy.pos.x, this.lockEnemy.pos.y + 1.2, this.lockEnemy.pos.z), 0.22);
    }
    this.camera.lookAt(lookAt);

    // FOV dinámico al esprintar
    const targetFov = this.baseFov + (this.player.sprinting ? 5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateEffects(dt: number) {
    this.particles.update(dt, this.camera.position);
    // números de daño
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    for (const d of this.dmgPool) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) { d.active = false; d.el.style.display = 'none'; continue; }
      d.worldPos.y += d.vy * dt;
      d.vy = Math.max(0.2, d.vy - dt * 1.4);
      v.copy(d.worldPos).project(this.camera);
      if (v.z > 1) { d.el.style.display = 'none'; continue; }
      d.el.style.display = 'block';
      d.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      d.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      d.el.style.opacity = `${Math.min(1, d.life * 2.5)}`;
    }
    // viñeta de daño + grano/tiempo del grading
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    const lowHp = this.player.hp / this.player.maxHp < 0.3 && this.player.alive;
    const pulse = lowHp ? 0.22 + Math.sin(this.elapsed * 5) * 0.08 : 0;
    this.refs.vignette.style.opacity = `${Math.min(1, this.hurtFlash * 0.9 + pulse)}`;
    if (this.grade) this.grade.uniforms.uTime.value = this.elapsed;
  }

  private addDamageNumber(pos: THREE.Vector3, text: string, color: string, big = false) {
    let d = this.dmgPool.find(x => !x.active);
    if (!d) {
      if (this.dmgPool.length >= 34) return;
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;transform:translate(-50%,-50%);font-weight:800;pointer-events:none;
        text-shadow:0 0 6px rgba(0,0,0,0.9), 0 2px 2px rgba(0,0,0,0.8);font-family:Georgia,serif;`;
      this.dmgLayer.appendChild(el);
      d = { el, worldPos: new THREE.Vector3(), life: 0, vy: 1.6, active: false };
      this.dmgPool.push(d);
    }
    d.worldPos.copy(pos);
    d.worldPos.x += rand(-0.3, 0.3);
    d.life = big ? 1.6 : 0.9;
    d.vy = 1.7;
    d.active = true;
    d.el.textContent = text;
    d.el.style.color = color;
    d.el.style.fontSize = big ? '26px' : '17px';
    d.el.style.display = 'block';
  }

  private drawMinimap() {
    const entities = this.enemies
      .filter(e => e.alive && e.state !== 'spawn')
      .map(e => ({ x: e.pos.x, z: e.pos.z, kind: e.type as 'goblin' | 'archer' | 'orc' | 'boss' }));
    drawMinimap(
      this.refs.minimap,
      this.player.pos,
      this.player.yaw,
      entities,
      this.world.shrines.map(s => ({ x: s.pos.x, z: s.pos.z, cleansed: s.cleansed })),
      this.bossActive,
      this.bossDefeated,
    );
  }

  /* ---------- HUD ---------- */

  private objective(): string {
    if (this.bossDefeated) return 'Modo infinito — el sigilo de la arena invoca al jefe de nuevo';
    if (this.bossActive) return `Derrota a ${ENEMY_NAMES.boss}`;
    if (this.shrinesCleansed >= 3) return 'El aire vibra… algo despierta en la arena del norte';
    return `Purifica los santuarios corruptos (${this.shrinesCleansed}/3)`;
  }

  private emitHud() {
    const boss = this.boss;
    this.onHud({
      phase: this.phase,
      hp: this.player.hp, maxHp: this.player.maxHp,
      stamina: this.player.stamina, maxStamina: this.player.maxStamina,
      xp: this.player.xp, xpNext: this.player.xpNext, level: this.player.level,
      gold: this.player.gold, potions: this.player.potions, maxPotions: this.player.maxPotions,
      shrinesCleansed: this.shrinesCleansed, shrinesTotal: 3,
      objective: this.objective(),
      enemiesAlive: this.enemies.filter(e => e.alive).length,
      bossActive: this.bossActive && !!boss?.alive,
      bossName: ENEMY_NAMES.boss,
      bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 1, bossPhase: boss?.phase ?? 1,
      kills: this.player.kills, time: this.elapsed,
      lockOn: !!this.lockEnemy,
      prompt: this.promptText(),
      fps: Math.round(this.fps),
      endless: this.endless,
      quality: this.quality,
    });
  }

  private promptText(): string {
    if (!this.interactTarget || this.player.state === 'dead') return '';
    switch (this.interactTarget.kind) {
      case 'bonfire': return 'E · Descansar en la hoguera (cura y reabastece)';
      case 'shrine': return `E · Purificar ${WORLD.shrines[this.interactTarget.idx!].name}`;
      case 'sigil': return 'E · Despertar al jefe de nuevo';
    }
  }

  private setPhase(p: GamePhase) {
    this.phase = p;
    this.emitHud();
  }

  /* ---------- API pública (React) ---------- */

  pause() {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.setPhase('playing');
    this.requestLock();
  }

  requestLock() {
    const c = this.renderer.domElement;
    if (document.pointerLockElement !== c) {
      c.requestPointerLock?.();
    }
  }

  respawn() {
    // limpiar enemigos vivos, proyectiles y drops
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
    this.boss = null;
    this.bossActive = false;
    this.lockEnemy = null;
    this.player.lockTarget = null;
    for (const pr of this.projectiles) this.scene.remove(pr.root);
    this.projectiles = [];
    for (const pk of this.pickups) this.scene.remove(pk.root);
    this.pickups = [];
    // guardianes frescos en santuarios sin purificar
    this.spawnGuardians();
    for (let i = 0; i < 4; i++) this.spawnRoamer(true);
    // jugador
    const p = this.player;
    p.hp = p.maxHp; p.stamina = p.maxStamina; p.potions = Math.max(p.potions, p.maxPotions);
    p.state = 'idle'; p.stateT = 0; p.iFrames = 2;
    p.knock.set(0, 0, 0);
    p.pos.set(WORLD.bonfire.x, 0, WORLD.bonfire.z + 3.4);
    p.pos.y = terrainHeight(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(WORLD.bonfire.x - p.pos.x, WORLD.bonfire.z - p.pos.z) + Math.PI;
    this.camYaw = p.yaw + Math.PI;
    if (this.shrinesCleansed >= 3 && !this.bossDefeated) this.bossRespawnT = 6;
    this.setPhase('playing');
    this.requestLock();
  }

  continueEndless() {
    this.setPhase('playing');
    this.requestLock();
  }

  restart() {
    window.location.reload();
  }

  toggleLockOnAction() { this.toggleLockOn(); }
  interactAction() { this.doInteract(); }

  /* ---------- Eventos ---------- */

  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    const c = this.renderer.domElement;
    c.addEventListener('mousedown', this.onMouseDown);
    c.addEventListener('contextmenu', this.onContextMenu);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (this.phase !== 'playing') return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Tab': this.toggleLockOn(); break;
      case 'Space': this.queued.roll = true; break;
      case 'KeyF': this.queued.potion = true; break;
      case 'KeyE': this.doInteract(); break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.phase !== 'playing') return;
    if (!this.locked) { this.requestLock(); return; }
    if (e.button === 0) this.queued.attack = true;
    if (e.button === 2) this.queued.heavy = true;
  };

  private onContextMenu = (e: Event) => { e.preventDefault(); };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    if (!this.locked && this.phase === 'playing') this.pause();
  };

  /* ---------- Limpieza ---------- */

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.dmgLayer.remove();
  }
}
