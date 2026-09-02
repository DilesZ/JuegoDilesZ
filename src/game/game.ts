import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { clamp, dampAngle, damp, rand, randInt, pick, WORLD, terrainHeight, type HudState, type GamePhase, type GameRefs, type ItemView, type InvView, type ShopView, type SmithView, type WeaponSlotView, ENEMY_NAMES, STYLE_RANKS } from './core';
import { Inventory, RARITY_INFO, itemById, rollDrop, merchantStock, buyPrice, sellPrice, SMITH_CATALOG, upgradeCost, MAX_FORGE, FORGE_DMG_PER_LEVEL, weaponTypeOf, WEAPON_TYPE_ICON, WEAPON_TYPE_LABEL, type EquipSlot, type ItemDef, type WeaponType } from './items';
import { Particles } from './particles';
import { AudioEngine } from './audio';
import { World } from './world';
import { DayNightCycle } from './daynight';
import { Player, Projectile, Pickup, SwordTrail, type InputState, type GameCtx, type AttackDef } from './entities';
import { Enemy, ENEMY_CFG, type EnemyType } from './enemies';
import { SlashArcPool, ImpactDecalPool, HitFlarePool } from './vfx';
import { glowSprite } from './textures';
import { Merchant, MERCHANT_NAME, MERCHANT_SPOT, merchantDist } from './merchant';
import { Blacksmith, SMITH_NAME, SMITH_SPOT, smithDist } from './smith';
import { createHeroCharacter, createEnemyCharacter, createFoxes, Fox, monsterAttackTimings, type CharacterPack, type EnemyVariant } from './characters';
import { drawMinimap } from './minimap';

export type QualityTier = 'bajo' | 'medio' | 'alto';

/* Grading final cinematográfico (en HDR lineal, pre-tonemap): contraste S,
   viñeta, grano de film y aberración cromática suave */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.006 },
    uCA: { value: 0.0006 },
    uSat: { value: 1.06 },
    uCon: { value: 1.045 },
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
      // aberración cromática radial (leve, progresiva hacia bordes)
      vec2 off = d * r2 * uCA * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // purga de NaN/Inf (robustez HDR)
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      // saturación en lineal
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // curva S suave preservando medias luces (Menpher / filmic S)
      vec3 s = col * col * (3.0 - 2.0 * col);
      col = mix(col, s, 0.22);
      // contraste alrededor del gris medio (~0.18 lineal)
      col = (col - 0.18) * uCon + 0.18;
      // viñeta natural (no llega a negro puro)
      col *= 1.0 - uVignette * smoothstep(0.14, 0.7, r2);
      // grano de film sutil (lineal, proporcional a la señal)
      float g = (hash(uv * vec2(1287.0, 731.0) + fract(uTime) * 43.7) - 0.5);
      col += g * uGrain * (0.25 + l);
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

/* Onda expansiva en el suelo para impactos pesados (DMC) — POOL reutilizable */
class ShockwavePool {
  private items: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; active: boolean; maxR: number }[] = [];
  constructor(scene: THREE.Scene, size = 6) {
    for (let i = 0; i < size; i++) {
      const geo = new THREE.RingGeometry(0.42, 0.62, 36);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.12;
      mesh.renderOrder = 8;
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, t: 0, active: false, maxR: 3.4 });
    }
  }
  spawn(pos: THREE.Vector3, color = 0xffd9a0, maxR = 3.4) {
    // LRU: toma la primera libre o recicla la más antigua
    let it = this.items.find(i => !i.active);
    if (!it) it = this.items[0];
    it.active = true; it.t = 0; it.maxR = maxR;
    it.mat.color.setHex(color);
    it.mat.opacity = 0.85;
    it.mesh.position.copy(pos);
    it.mesh.position.y += 0.12;
    it.mesh.scale.setScalar(0.4);
    it.mesh.visible = true;
    this.items.splice(this.items.indexOf(it), 1);
    this.items.push(it);
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const k = it.t / 0.42;
      if (k >= 1) { it.active = false; it.mesh.visible = false; continue; }
      const r = 0.4 + (it.maxR - 0.4) * (1 - Math.pow(1 - k, 2.4));
      it.mesh.scale.setScalar(r);
      it.mat.opacity = 0.85 * (1 - k) * (1 - k);
    }
  }
}

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

/** Segundos de reaparición por tipo (estilo MMORPG: cada punto repuebla) */
const RESPAWN_T: Record<EnemyType, number> = {
  goblin: 26,
  archer: 32,
  orc: 48,
  boss: 140,
};

/** Probabilidad de que cada tipo de enemigo suelte un objeto de equipo */
const DROP_CHANCE: Record<string, number> = {
  goblin: 0.17,
  archer: 0.19,
  orc: 0.27,
  boss: 1,
};

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
  cycle!: DayNightCycle;
  particles: Particles;
  player: Player;

  // ciclo día/noche + avisos + pasos
  private notice = '';
  private noticeT = 0;
  private stepDist = 0;
  private lastStepPos = new THREE.Vector3();
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
  /** salida de pointer lock esperada (panel abierto): no pausar */
  private unlockGuard = false;
  // inventario / equipo / tienda
  inventory = new Inventory();
  uiOpen = false;
  uiPanel: 'inv' | 'shop' | 'smith' | null = null;
  merchant!: Merchant;
  smith!: Blacksmith;
  private shopStock: ItemDef[] = [];
  private restockDay = -1;
  private chars: CharacterPack | null;
  private foxes: Fox[] = [];
  /** reapariciones estilo MMORPG pendientes (punto de spawn + temporizador) */
  private respawnQueue: { type: EnemyType; x: number; z: number; guardianOf: number; t: number }[] = [];

  // cámara
  private camYaw = 0; private camPitch = 0.34;
  private camDist = 6.4;
  private camDistTarget = 6.4;
  private static readonly CAM_MIN = 2.6;
  private static readonly CAM_MAX = 13.5;
  private camPos = new THREE.Vector3();
  private shakeAmt = 0;
  private hitStopT = 0;
  private hitStopScale = 0.06;
  private hitStopGap = 0;        // guarda: evita hit-stops encadenados por multi-golpe
  private timeScale = 1;
  private slowmoT = 0;
  private baseFov = 65;
  private fovKickAmt = 0;
  private shockwaves!: ShockwavePool;
  // VFX de combate (pools)
  private slashArcs!: SlashArcPool;
  private impactDecals!: ImpactDecalPool;
  private hitFlares!: HitFlarePool;

  // medidor de estilo (DMC): puntos por golpe, decaimiento y rangos D→SSS
  private stylePts = 0;
  private comboHits = 0;
  private comboHitsTimer = 0;

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
  private interactTarget: { kind: 'bonfire' | 'shrine' | 'sigil' | 'merchant' | 'smith'; idx?: number } | null = null;
  private victoryDelay = -1;

  // números de daño (DOM pool)
  private dmgPool: DamageNumber[] = [];
  private dmgLayer: HTMLDivElement;

  // cachés de vistas HUD (evita serializar mochila/tienda 12 veces por segundo)
  private invCache: InvView | null = null;
  private shopCache: ShopView | null = null;
  private smithCache: SmithView | null = null;
  private slotsCache: WeaponSlotView[] | null = null;
  private invDirty = true;
  private shopDirty = true;
  private smithDirty = true;

  private onHud: (s: HudState) => void;
  private ctx: GameCtx;

  // calidad y menú cinemático
  quality: QualityTier = 'alto';
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass | null = null;
  private menuT = 0;
  private qualityTimer = 2.5;
  private started = false;

  constructor(refs: GameRefs, onHud: (s: HudState) => void, chars: CharacterPack | null = null) {
    this.refs = refs;
    this.container = refs.container;
    this.onHud = onHud;
    this.chars = chars;

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatioFor('alto'));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // ACES Filmic: respuesta tonal cinematográfica con modelos PBR
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // escena
    this.scene.fog = new THREE.FogExp2(0xc2dcee, 0.0068);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.1, 500);

    // mundo y sistemas
    this.world = new World(this.scene, this.renderer);
    this.cycle = new DayNightCycle(this.world, this.scene, this.renderer);
    // hora inicial opcional por query (?tod=0.5 → mediodía, 0.9 → noche)
    const todParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tod') : null;
    if (todParam) {
      const v = parseFloat(todParam);
      if (!Number.isNaN(v)) this.cycle.setTime(clamp(v, 0, 0.999));
    }
    this.cycle.onPhaseChange = (kind) => {
      this.notice = kind === 'night'
        ? 'La noche cae sobre AETHERIA… los enemigos se vuelven más rápidos'
        : 'Amanece sobre AETHERIA';
      this.noticeT = 7;
      if (kind === 'night') this.audio.goblinVox();
    };
    this.particles = new Particles(this.scene);
    this.player = new Player();
    if (this.chars) this.player.attachGlb(createHeroCharacter(this.chars));
    this.scene.add(this.player.root);
    this.trail = new SwordTrail(this.scene);
    this.shockwaves = new ShockwavePool(this.scene, 6);
    // VFX de combate AAA: arcos de tajo, decals de impacto y destellos
    this.slashArcs = new SlashArcPool(this.scene, 5);
    this.impactDecals = new ImpactDecalPool(this.scene, 8);
    this.hitFlares = new HitFlarePool(this.scene, 12, glowSprite());

    // IBL fotográfico (HDRIs CC0 de Poly Haven vía three.js)
    void this.world.loadHDRI();

    // sincroniza dur/hitAt de los ataques enemigos con los clips reales
    if (this.chars) {
      for (const t of monsterAttackTimings(this.chars)) {
        const atk = ENEMY_CFG[t.type as EnemyType]?.attacks[t.idx];
        if (atk) { atk.dur = t.dur; atk.hitAt = t.hitAt; }
      }
    }

    // jugador frente a la hoguera
    const bx = WORLD.bonfire.x, bz = WORLD.bonfire.z + 3.4;
    this.player.pos.set(bx, terrainHeight(bx, bz), bz);
    this.player.yaw = Math.atan2(WORLD.bonfire.x - bx, WORLD.bonfire.z - bz) + Math.PI;
    this.camYaw = this.player.yaw + Math.PI;

    // mercader con su puesto junto a la hoguera
    this.merchant = new Merchant(this.chars);
    this.scene.add(this.merchant.root);
    for (const c of this.merchant.colliderList()) this.world.colliders.push(c);
    this.shopStock = merchantStock(1);
    this.restockDay = this.cycle.day;

    // herrero con su forja encendida (lado opuesto del campamento)
    this.smith = new Blacksmith(this.chars);
    this.scene.add(this.smith.root);
    for (const c of this.smith.colliderList()) this.world.colliders.push(c);

    // zorros ambientales
    if (this.chars) {
      this.foxes = createFoxes(this.chars, 3);
      for (const f of this.foxes) this.scene.add(f.root);
    }

    // ruinas de la catedral (landmark panorámico sobre la cresta del borde)
    if (this.chars?.dungeon) {
      const d = this.chars.dungeon;
      const rx = 92, rz = -30;
      d.position.set(rx, terrainHeight(rx, rz) + 0.2, rz);
      d.rotation.y = 0.7;
      this.scene.add(d);
    }

    // post-procesado: MSAA + GTAO + bloom + tono + grading
    // ?lite=1: pipeline mínimo para diagnóstico en entornos lentos
    const lite = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lite') === '1';
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: lite ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!lite) {
      try {
        const gtao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
        if (typeof gtao.updateGtaoMaterial === 'function') {
          gtao.updateGtaoMaterial({
            radius: 0.4, distanceExponent: 1.2, thickness: 1.4,
            scale: 0.85, samples: 12, screenSpaceRadius: false,
            distanceFallOff: 1,
          });
        }
        gtao.output = GTAOPass.OUTPUT.Default;
        this.composer.addPass(gtao);
        this.gtao = gtao;
      } catch { this.gtao = null; }
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.85);
    this.composer.addPass(bloom);
    // grading EN HDR (lineal): viñeta/contraste/grano antes del tonemap ACES
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (lite) {
      this.renderer.setPixelRatio(0.7);
      this.composer.setPixelRatio(0.7);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }

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
      playerShotHit: (pos, dmg, aoe, isFire) => this.resolvePlayerShotHit(pos, dmg, aoe, isFire),
      onEnemyDied: (e) => this.handleEnemyDied(e),
      playerHurt: () => { this.hurtFlash = 1; this.comboHits = 0; this.stylePts *= 0.35; },
      gainItem: (def) => this.gainItem(def),
      nightFactor: 0,
      fovKick: (deg) => { this.fovKickAmt = Math.min(7, this.fovKickAmt + deg); },
      shockwave: (pos, color = 0xffd9a0, maxR = 3.4) => {
        this.shockwaves.spawn(pos, color, maxR);
      },
      flare: (pos, color = 0xfff2d8, size = 1.1, dur = 0.11) => {
        this.hitFlares.spawn(pos, { color, size, dur });
      },
    };

    this.phase = 'menu';

    this.grantStarterGear();

    this.bindEvents();
    this.emitHud();
  }

  /* ---------- Inventario y equipo ---------- */

  /** Equipo inicial del héroe: espada + túnica + un par de consumibles */
  private grantStarterGear() {
    const inv = this.inventory;
    inv.forceEquip('weapon', itemById('espada_errante'));
    inv.forceEquip('armor', itemById('tunica_errante'));
    inv.addItem(itemById('elixir_vida'));
    inv.addItem(itemById('piedra_afilar'));
    this.refreshEquipStats(false);
  }

  /** Aplica las stats de equipo al jugador y tiñe la gema del arma */
  private refreshEquipStats(sound = true) {
    this.player.applyEquipStats(this.inventory.totals());
    const wep = this.inventory.equip.weapon;
    const wm = this.player.rig.weaponMat;
    if (wm) {
      wm.emissive.setHex(wep ? RARITY_INFO[wep.rarity].hex : 0x54e0ff);
      wm.emissiveIntensity = wep && wep.rarity !== 'comun' ? 2.1 : 1.2;
    }
    if (sound) { this.audio.uiClick(); this.emitHud(); }
  }

  /** Recogida de objetos (llamada desde Pickup vía ctx) */
  private gainItem(def: ItemDef) {
    const ok = this.inventory.addItem(def);
    this.invDirty = true;
    this.shopDirty = true;
    this.slotsCache = null;
    this.smithDirty = true;
    if (!ok) {
      // mochila llena: se convierte en oro
      const gold = 20;
      this.player.gold += gold;
      this.audio.coin();
      this.addDamageNumber(new THREE.Vector3(this.player.pos.x, this.player.pos.y + 2.1, this.player.pos.z), `MOCHILA LLENA +${gold} ◈`, '#ffc84a');
      return;
    }
    this.audio.coin();
    this.addDamageNumber(
      new THREE.Vector3(this.player.pos.x, this.player.pos.y + 2.2, this.player.pos.z),
      `+ ${def.icon} ${def.name}`,
      RARITY_INFO[def.rarity].css,
      def.rarity === 'epico' || def.rarity === 'legendario',
    );
    this.emitHud();
  }

  toggleInventory() {
    if (this.phase !== 'playing') return;
    this.setPanel(this.uiPanel === 'inv' ? null : 'inv');
  }

  /** Abre/cierra un panel de UI (mochila, tienda o forja) congelando el mundo */
  private setPanel(panel: 'inv' | 'shop' | 'smith' | null) {
    this.uiPanel = panel;
    const open = panel !== null;
    this.uiOpen = open;
    this.keys.clear();
    this.queued = { attack: false, heavy: false, roll: false, potion: false };
    if (open) {
      this.audio.uiOpen();
      if (document.pointerLockElement) {
        // marca la salida de bloqueo como esperada (evita pausa fantasma)
        this.unlockGuard = true;
        document.exitPointerLock();
      }
    } else {
      this.audio.uiClick();
      if (this.phase === 'playing') this.requestLock();
    }
    this.emitHud();
  }

  equipFromBag(i: number) {
    if (!this.uiOpen) return;
    const res = this.inventory.equipFromBag(i);
    if (!res.ok) return;
    if (res.swapped) this.inventory.addItem(res.swapped);
    this.invDirty = true;
    this.slotsCache = null;
    this.smithDirty = true;
    this.refreshEquipStats();
  }

  unequipSlot(slot: EquipSlot) {
    if (!this.uiOpen) return;
    if (this.inventory.unequip(slot)) { this.invDirty = true; this.slotsCache = null; this.smithDirty = true; this.refreshEquipStats(); }
  }

  useBagItem(i: number) {
    if (!this.uiOpen) return;
    const def = this.inventory.useConsumable(i);
    if (!def) return;
    this.invDirty = true;
    const p = this.player;
    switch (def.id) {
      case 'elixir_vida':
        p.perm.hp += 12;
        p.applyEquipStats(this.inventory.totals());
        p.hp = p.maxHp;
        break;
      case 'piedra_afilar':
        p.perm.dmg += 0.04;
        break;
      case 'fruta_espiritu':
        p.perm.stam += 0.08;
        break;
    }
    this.audio.potion();
    this.addDamageNumber(new THREE.Vector3(p.pos.x, p.pos.y + 2.2, p.pos.z), `${def.icon} ${def.useText ?? def.name}`, '#8ef2a6', true);
    this.refreshEquipStats();
  }

  private invView(): InvView {
    const view = (d: ItemDef | null, count = 1): ItemView | null => d ? {
      id: d.id, name: d.name, kind: d.kind, rarity: d.rarity, icon: d.icon,
      desc: d.desc, stats: d.stats, useText: d.useText, count,
    } : null;
    const inv = this.inventory;
    const totals = inv.totals();
    return {
      open: this.uiPanel === 'inv',
      bag: inv.bag.map(e => view(e.def, e.count)!),
      bagSize: 24,
      equip: {
        weapon: view(inv.equip.weapon),
        armor: view(inv.equip.armor),
        helmet: view(inv.equip.helmet),
        acc1: view(inv.equip.acc1),
        acc2: view(inv.equip.acc2),
      },
      totals,
      defRed: this.player.damageReduction,
      dmgMul: this.player.dmgMul,
      crit: this.player.critChance,
      perm: { ...this.player.perm },
    };
  }

  /* ---------- Tienda del mercader ---------- */

  openShop() {
    if (this.phase !== 'playing' || this.uiOpen) return;
    this.setPanel('shop');
  }

  closeShop() {
    if (this.uiPanel === 'shop') this.setPanel(null);
  }

  private shopView(): ShopView {
    const view = (d: ItemDef, count = 1): ItemView => ({
      id: d.id, name: d.name, kind: d.kind, rarity: d.rarity, icon: d.icon,
      desc: d.desc, stats: d.stats, useText: d.useText, count,
    });
    return {
      open: this.uiPanel === 'shop',
      name: MERCHANT_NAME,
      stock: this.shopStock.map(d => ({ item: view(d), price: buyPrice(d) })),
      bag: this.inventory.bag.map((e, i) => ({ index: i, item: view(e.def, e.count), sell: sellPrice(e.def) })),
      gold: this.player.gold,
      restockDay: this.restockDay,
    };
  }

  /** Compra un objeto del surtido (clic en la tienda) */
  buyItem(i: number) {
    if (this.uiPanel !== 'shop') return;
    const def = this.shopStock[i];
    if (!def) return;
    const price = buyPrice(def);
    const p = this.player;
    const head = new THREE.Vector3(p.pos.x, p.pos.y + 2.15, p.pos.z);
    if (p.gold < price) {
      this.audio.uiClick();
      this.addDamageNumber(head, `FALTAN ${price - p.gold} ◈`, '#ff8a7a');
      return;
    }
    if (!this.inventory.addItem(def)) {
      this.audio.uiClick();
      this.addDamageNumber(head, 'MOCHILA LLENA', '#ff8a7a');
      return;
    }
    p.gold -= price;
    this.invDirty = true;
    this.shopDirty = true;
    this.slotsCache = null;
    this.smithDirty = true;
    this.audio.coin();
    this.addDamageNumber(head, `- ${price} ◈  ${def.icon} ${def.name}`, RARITY_INFO[def.rarity].css);
    this.emitHud();
  }

  /** Vende una unidad de la mochila al mercader (40% del valor) */
  sellBagItem(i: number) {
    if (this.uiPanel !== 'shop') return;
    const e = this.inventory.bag[i];
    if (!e) return;
    const gold = sellPrice(e.def);
    this.inventory.removeAt(i);
    this.player.gold += gold;
    this.invDirty = true;
    this.shopDirty = true;
    this.slotsCache = null;
    this.smithDirty = true;
    this.audio.coin();
    const p = this.player;
    this.addDamageNumber(new THREE.Vector3(p.pos.x, p.pos.y + 2.15, p.pos.z), `+ ${gold} ◈  ${e.def.icon} ${e.def.name}`, '#ffc84a');
    this.emitHud();
  }

  /* ---------- Forja del herrero ---------- */

  openSmith() {
    if (this.phase !== 'playing' || this.uiOpen) return;
    this.setPanel('smith');
  }

  closeSmith() {
    if (this.uiPanel === 'smith') this.setPanel(null);
  }

  private smithView(): SmithView {
    const view = (d: ItemDef | null, count = 1): ItemView | null => d ? {
      id: d.id, name: d.name, kind: d.kind, rarity: d.rarity, icon: d.icon,
      desc: d.desc, stats: d.stats, useText: d.useText, count,
    } : null;
    const wep = this.inventory.equip.weapon;
    const lvl = wep ? this.inventory.forgeLevel(wep.id) : 0;
    const catalog: SmithView['catalog'] = SMITH_CATALOG.map(id => {
      const def = itemById(id);
      const wt = weaponTypeOf(def);
      return { item: view(def)!, price: buyPrice(def), owned: this.inventory.ownsWeaponType(wt), wtype: wt };
    });
    return {
      open: this.uiPanel === 'smith',
      name: SMITH_NAME,
      gold: this.player.gold,
      weapon: view(wep),
      forgeLevel: lvl,
      maxForge: MAX_FORGE,
      upgradeCost: wep && lvl < MAX_FORGE ? upgradeCost(lvl) : null,
      upgradeDesc: wep && lvl < MAX_FORGE
        ? `+${Math.round(FORGE_DMG_PER_LEVEL * 100)}% de daño (nivel ${lvl} → ${lvl + 1})`
        : 'El acero ha alcanzado su perfección',
      catalog,
    };
  }

  /** Forja una nueva arma del catálogo de Bran */
  buySmithWeapon(i: number) {
    if (this.uiPanel !== 'smith') return;
    const def = itemById(SMITH_CATALOG[i]);
    if (!def) return;
    const wt = weaponTypeOf(def);
    if (this.inventory.ownsWeaponType(wt)) {
      this.audio.uiClick();
      this.addDamageNumber(this._headPos(), `YA TIENES UN ARMA DE ESE TIPO`, '#ffd98a');
      return;
    }
    const price = buyPrice(def);
    const p = this.player;
    if (p.gold < price) {
      this.audio.uiClick();
      this.addDamageNumber(this._headPos(), `FALTAN ${price - p.gold} ◈`, '#ff8a7a');
      return;
    }
    if (!this.inventory.addItem(def)) {
      this.audio.uiClick();
      this.addDamageNumber(this._headPos(), 'MOCHILA LLENA', '#ff8a7a');
      return;
    }
    p.gold -= price;
    this.invDirty = true;
    this.shopDirty = true;
    this.smithDirty = true;
    this.slotsCache = null;
    this.audio.anvil();
    this.audio.coin();
    this.addDamageNumber(this._headPos(), `⚒ FORJADA  ${def.icon} ${def.name}`, RARITY_INFO[def.rarity].css, true);
    this.emitHud();
  }

  /** Mejora el arma equipada en la forja (+8% daño por nivel) */
  upgradeWeapon() {
    if (this.uiPanel !== 'smith') return;
    const wep = this.inventory.equip.weapon;
    if (!wep) return;
    const lvl = this.inventory.forgeLevel(wep.id);
    if (lvl >= MAX_FORGE) return;
    const cost = upgradeCost(lvl);
    const p = this.player;
    if (p.gold < cost) {
      this.audio.uiClick();
      this.addDamageNumber(this._headPos(), `FALTAN ${cost - p.gold} ◈`, '#ff8a7a');
      return;
    }
    p.gold -= cost;
    this.inventory.addForgeLevel(wep.id);
    this.refreshEquipStats(false);
    this.invDirty = true;
    this.smithDirty = true;
    this.audio.anvil();
    this.addDamageNumber(this._headPos(), `⚒ +${wep.name} Nv.${lvl + 1}`, '#ffb37d', true);
    this.particles.burst({
      x: this.smith.pos.x, y: this.smith.pos.y + 1.2, z: this.smith.pos.z,
      count: 26, speed: 4.5, color: 0xffb347, size: 0.3, life: 0.8, gravity: 4, drag: 1.5, glow: 2.6,
    });
    this.emitHud();
  }

  private _headPos(): THREE.Vector3 {
    const p = this.player.pos;
    return new THREE.Vector3(p.x, p.y + 2.2, p.z);
  }

  /* ---------- Cambio rápido de arma (1-4) ---------- */

  switchWeaponType(t: WeaponType) {
    if (this.phase !== 'playing') return;
    const cur = weaponTypeOf(this.inventory.equip.weapon);
    if (cur === t) return; // ya está activa
    if (!this.inventory.ownsWeaponType(t)) {
      this.audio.uiClick();
      this.addDamageNumber(this._headPos(), `SIN ARMA · ${WEAPON_TYPE_LABEL[t]} — la forja Bran`, '#ffd98a');
      return;
    }
    // cambia el arma activa (si estaba en la mochila, se equipa)
    if (cur !== t) {
      const found = this.inventory.findWeaponByType(t);
      if (found && found.where === 'bag') {
        const res = this.inventory.equipFromBag(found.index);
        if (res.ok && res.swapped) this.inventory.addItem(res.swapped);
      }
    }
    this.player.setWeaponType(t);
    this.refreshEquipStats(false);
    this.invDirty = true;
    this.smithDirty = true;
    this.audio.uiClick();
    const wep = this.inventory.equip.weapon;
    if (wep) {
      this.addDamageNumber(this._headPos(), `${WEAPON_TYPE_ICON[t]} ${wep.name}`, RARITY_INFO[wep.rarity].css);
    }
    this.emitHud();
  }

  private weaponSlots(): WeaponSlotView[] {
    const types: WeaponType[] = ['sword', 'bow', 'halberd', 'staff'];
    const cur = this.player.weaponType;
    return types.map((t, i) => {
      const found = this.inventory.findWeaponByType(t);
      return {
        type: t,
        icon: WEAPON_TYPE_ICON[t],
        label: `${i + 1}`,
        name: found ? found.def.name : WEAPON_TYPE_LABEL[t],
        active: cur === t,
        owned: !!found,
      };
    });
  }

  /* ---------- Calidad ---------- */

  private pixelRatioFor(q: QualityTier): number {
    if (q === 'bajo') return 0.85;
    if (q === 'medio') return 1.2;
    return Math.min(window.devicePixelRatio, 1.5);
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
    // primer sondeo rápido para salir de arranques lentos (headless/GPU débil)
    this.qualityTimer = this.fps < 30 && this.quality === 'alto' ? 1.2 : 2.5;
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
    if (this.chars?.monsters?.[type as EnemyVariant]) {
      e.attachGlb(createEnemyCharacter(this.chars, type as EnemyVariant));
    }
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
    this.shopDirty = true;
    this.audio.coin();
    // jugosa recompensa de estilo por rematar (DMC)
    this.addStyle(22);
    this.ctx.fovKick(1.8);
    // estallido de esencia al morir (VFX de remate)
    const deathPos = this._gV3.set(e.pos.x, e.pos.y + e.rig.height * 0.5, e.pos.z);
    this.hitFlares.spawn(deathPos, { color: 0xffd9a0, size: e.isBoss ? 5 : 2.2, dur: 0.18 });
    this.particles.burst({
      x: e.pos.x, y: e.pos.y + e.rig.height * 0.4, z: e.pos.z,
      count: e.isBoss ? 60 : 22, speed: 6, color: 0xff9a3a, size: 0.28, life: 0.7,
      gravity: -0.5, drag: 1.4, glow: 2.6, fadePow: 1.4,
    });
    if (!e.isBoss && this.hitStopGap <= 0) {
      this.hitStopT = Math.max(this.hitStopT, 0.055);
      this.hitStopScale = 0.12;
      this.hitStopGap = 0.16;
    }
    this.player.gainXp(cfg.xp, this.ctx);
    // REAPARICIÓN ESTILO MMORPG: el punto de spawn repuebla tras un tiempo
    if (!e.isBoss) {
      const shrineCleansed = e.guardianOf >= 0 && this.world.shrines[e.guardianOf].cleansed;
      if (!shrineCleansed) {
        if (e.guardianOf >= 0) {
          // guardias: los santuarios sin purificar vuelven a llenarse
          this.respawnQueue.push({
            type: e.type, x: e.home.x, z: e.home.z, guardianOf: e.guardianOf,
            t: RESPAWN_T[e.type] * rand(0.85, 1.25),
          });
        } else {
          // errantes: solo se reponen si la población no supera el objetivo
          const pendingRoam = this.respawnQueue.filter(r => r.guardianOf === -1).length;
          const aliveRoam = this.enemies.filter(o => o.alive && o.guardianOf === -1 && !o.isBoss).length;
          if (aliveRoam + pendingRoam < ROAMER_TARGET + 2) {
            this.respawnQueue.push({
              type: e.type, x: e.home.x, z: e.home.z, guardianOf: -1,
              t: RESPAWN_T[e.type] * rand(0.85, 1.25),
            });
          }
        }
      }
    } else {
      // jefe del mundo: reaparece en modo infinito, cada vez más fuerte
      this.bossRespawnT = RESPAWN_T.boss;
    }
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
    // drop de objeto (armas, armaduras, accesorios…)
    const dropChance = e.isBoss ? 1 : DROP_CHANCE[e.type];
    if (Math.random() < dropChance) {
      const def = rollDrop(this.player.level, e.isBoss);
      const pk = new Pickup(
        new THREE.Vector3(e.pos.x + rand(-0.8, 0.8), 0, e.pos.z + rand(-0.8, 0.8)),
        'item', def,
      );
      this.pickups.push(pk);
      this.scene.add(pk.root);
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
    // puesto del mercader
    if (merchantDist(p.x, p.z) < 2.7) {
      this.interactTarget = { kind: 'merchant' };
      return;
    }
    // forja del herrero
    if (smithDist(p.x, p.z) < 2.7) {
      this.interactTarget = { kind: 'smith' };
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
    } else if (t.kind === 'merchant') {
      this.openShop();
    } else if (t.kind === 'smith') {
      this.openSmith();
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
      this.cycle.update(dt); // el mundo vive detrás del menú (con ciclo día/noche)
      this.updateMenuScene(dt);
      this.composer.render();
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) { this.hudTimer = 0.3; this.emitHud(); }
      return;
    }

    if (this.phase === 'playing') {
      this.autoQuality(dt);
      // ciclo día/noche (los enemigos son más rápidos de noche)
      this.cycle.update(dt);
      this.ctx.nightFactor = this.cycle.nightFactor;
      this.hitStopGap = Math.max(0, this.hitStopGap - dt);
      if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) this.notice = ''; }
      // pasos del jugador sobre el terreno
      const stepDx = this.player.pos.x - this.lastStepPos.x;
      const stepDz = this.player.pos.z - this.lastStepPos.z;
      this.stepDist += Math.hypot(stepDx, stepDz);
      this.lastStepPos.copy(this.player.pos);
      if (this.stepDist > 2.2 && this.player.state !== 'roll' && this.player.state !== 'dead') {
        this.stepDist = 0;
        this.audio.footstep();
        // polvo al correr (más denso esprintando)
        if (this.player.moving) {
          const n = this.player.sprinting ? 3 : 1;
          for (let i = 0; i < n; i++) {
            this.particles.spawn({
              x: this.player.pos.x + rand(-0.25, 0.25),
              y: this.player.pos.y + 0.08,
              z: this.player.pos.z + rand(-0.25, 0.25),
              vx: rand(-0.6, 0.6), vy: rand(0.3, 1.0), vz: rand(-0.6, 0.6),
              color: 0x9a8a6a, size: rand(0.16, 0.3), life: 0.5, gravity: 0.5, drag: 2.2, glow: 0.35,
            });
          }
        }
      }
      if (this.uiOpen) {
        // inventario abierto: mundo congelado, escena viva
        this.updateWorld(0.0001, true);
      } else if (this.hitStopT > 0) {
        // hit-stop cinematográfico (escala suave, no un congelado brusco)
        this.hitStopT -= dt;
        this.updateWorld(dt * this.hitStopScale);
      } else if (this.slowmoT > 0) {
        this.slowmoT -= dt;
        if (this.slowmoT <= 0) this.timeScale = 1;
        this.updateWorld(dt * this.timeScale);
      } else {
        this.updateWorld(dt);
      }
    } else if (this.phase === 'dead' || this.phase === 'victory') {
      // el mundo sigue con animaciones reducidas
      this.cycle.update(dt * 0.25);
      this.updateWorld(dt * 0.25, true);
    }

    this.updateCamera(dt);
    this.updateEffects(dt);
    this.composer.render();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.08; this.emitHud(); this.drawMinimap(); }
  };

  /* ---------- Escena cinemática del menú ---------- */

  /** callback reutilizado (sin closures nuevas por frame) para las llamas de hogueras */
  private emitFireParticles = (x: number, y: number, z: number) => {
    this.particles.spawn({
      x, y, z, vx: rand(-0.3, 0.3), vy: rand(1, 2.2), vz: rand(-0.3, 0.3),
      color: 0xff7a2a, size: rand(0.1, 0.2), life: rand(0.8, 1.6), glow: 2.2, drag: 0.5,
    });
  };

  private updateMenuScene(dt: number) {
    this.world.update(dt, this.camera, this.emitFireParticles);
    this.particles.update(dt, this.camera.position);
    // el mercader vive también en la escena del menú (mira a la cámara)
    this.merchant.update(dt, this.cycle.nightFactor, this.camera.position);
    for (const f of this.foxes) f.update(dt, this.player.pos);
    // héroe contemplando la hoguera
    this.player.updateMenu(dt, this.menuT);
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
    if (Math.abs(this.camera.fov - 58) > 0.05) {
      this.camera.fov = damp(this.camera.fov, 58, 3, dt);
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
    // separación entre enemigos (array reutilizado, sin allocations)
    const live = this._liveEnemies;
    live.length = 0;
    for (const e of this.enemies) {
      if (e.alive && e.state !== 'spawn') live.push(e);
    }
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

    // proyectiles y drops (borrado en sitio, sin filter)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.update(dt, this.ctx);
      if (pr.dead) { this.scene.remove(pr.root); this.projectiles.splice(i, 1); }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.update(dt, this.ctx);
      this.world.resolve(pk.pos, 0.3);
      if (pk.dead) { this.scene.remove(pk.root); this.pickups.splice(i, 1); }
    }

    // mundo visual
    this.world.update(dt, this.camera, this.emitFireParticles);

    // mercader: animación, mirada, saludo y farol nocturno
    const greeted = this.merchant.update(dt, this.cycle.nightFactor, this.player.pos);
    if (greeted && !this.uiOpen && this.phase === 'playing') {
      const line = pick(Merchant.greetingLines());
      this.addDamageNumber(new THREE.Vector3(this.merchant.pos.x, this.merchant.pos.y + 2.35, this.merchant.pos.z), `“${line}”`, '#ffd98a');
    }

    // herrero: martilleo (clacs → chispas en el yunque), hornalla y mirada
    const clangs = this.smith.update(dt, this.cycle.nightFactor, this.player.pos);
    if (clangs > 0 && !frozen) {
      const anvil = this.smith.anvilWorldPos();
      this.particles.burst({
        x: anvil.x, y: anvil.y, z: anvil.z,
        count: 14, speed: 3.6, color: 0xffc25a, size: 0.16, life: 0.5, gravity: 7, drag: 1.2, glow: 2.8,
      });
      if (this.player.pos.distanceTo(this.smith.pos) < 26) this.audio.anvil();
      // saludo ocasional del herrero
      if (Math.random() < 0.3 && !this.uiOpen && this.phase === 'playing') {
        const line = pick(Blacksmith.greetingLines());
        this.addDamageNumber(new THREE.Vector3(this.smith.pos.x, this.smith.pos.y + 2.5, this.smith.pos.z), `“${line}”`, '#ffb37d');
      }
    }
    for (const f of this.foxes) f.update(dt, this.player.pos);

    if (frozen) return;

    // ESTILO (DMC): decaimiento de la cadena y de los puntos
    this.comboHitsTimer = Math.max(0, this.comboHitsTimer - dt);
    if (this.comboHitsTimer <= 0) {
      if (this.comboHits > 0) this.comboHits = 0;
      if (this.stylePts > 0) this.stylePts = Math.max(0, this.stylePts - 16 * dt);
    }

    // estela de espada (solo durante la ventana activa del tajo)
    if (this.player.state === 'attack' && this.player.currentAttack) {
      const prog = this.player.stateT / this.player.currentAttack.dur;
      if (prog > 0.16 && prog < 0.85) {
        this.player.swordPoints(this._trailB, this._trailT);
        this.trail.emit(this._trailB, this._trailT);
      }
    }
    this.trail.update(dt, this.player.state === 'attack');

    // despawn/respawn de errantes (cuenta también las reapariciones pendientes)
    this.roamerTimer -= dt;
    if (this.roamerTimer <= 0) {
      this.roamerTimer = rand(3.5, 6);
      const aliveRoamers = this.enemies.filter(e => e.alive && e.guardianOf === -1 && !e.isBoss).length;
      const pendingRoamers = this.respawnQueue.filter(r => r.guardianOf === -1).length;
      if (aliveRoamers + pendingRoamers < ROAMER_TARGET) this.spawnRoamer();
    }

    // REAPARICIÓN ESTILO MMORPG: cada punto de spawn repuebla tras su tiempo
    if (this.respawnQueue.length > 0) {
      for (const r of this.respawnQueue) r.t -= dt;
      for (const r of this.respawnQueue) {
        if (r.t > 0) continue;
        // los guardias de santuarios ya purificados no vuelven
        if (r.guardianOf >= 0 && this.world.shrines[r.guardianOf].cleansed) { r.t = -1; continue; }
        // nunca reaparece delante del jugador (como en los MMO)
        const dP = Math.hypot(r.x - this.player.pos.x, r.z - this.player.pos.z);
        if (dP < 14) { r.t = 3; continue; }
        if (r.guardianOf >= 0) {
          // guardias: tope por santuario (4), exentos del tope global
          const aliveG = this.enemies.filter(e => e.alive && e.guardianOf === r.guardianOf).length;
          const pendG = this.respawnQueue.filter(o => o !== r && o.guardianOf === r.guardianOf && o.t > 0).length;
          if (aliveG + pendG >= 4) { r.t = 4; continue; }
        }
        // los errantes ya están acotados por la guarda de agenda
        // (aliveRoam + pendientes < ROAMER_TARGET + 2 al morir)
        this.spawnEnemy(r.type, r.x, r.z, r.guardianOf);
        r.t = -1;
      }
      this.respawnQueue = this.respawnQueue.filter(r => r.t > 0);
    }

    // reabastecimiento diario del mercader
    if (this.cycle.day !== this.restockDay) {
      this.restockDay = this.cycle.day;
      this.shopStock = merchantStock(this.player.level);
      this.shopDirty = true;
      this.notice = `${MERCHANT_NAME} ha reabastecido su tienda`;
      this.noticeT = 6;
      this.emitHud();
    }

    // despertar del jefe
    if (this.awakenTimer > 0) {
      this.awakenTimer -= dt;
      if (this.awakenTimer <= 0) this.spawnBoss();
    }
    // reaparición del jefe (tras morir el jugador en plena lucha o auto-respawn de mundo)
    if (this.bossRespawnT > 0) {
      this.bossRespawnT -= dt;
      if (this.bossRespawnT <= 0 && this.shrinesCleansed >= 3) this.spawnBoss(1.35 ** this.bossKills());
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

  /* Scratches del bucle principal (cero allocations por frame) */
  private _gV1 = new THREE.Vector3();
  private _gV2 = new THREE.Vector3();
  private _gV3 = new THREE.Vector3();
  private _gV4 = new THREE.Vector3();
  private _trailB = new THREE.Vector3();
  private _trailT = new THREE.Vector3();
  private _liveEnemies: Enemy[] = [];

  private resolvePlayerStrike(def: AttackDef) {
    const p = this.player;

    // DISPAROS (arco/bastón): el golpe nace como proyectil hacia el objetivo
    if (def.shot) {
      const origin = this._gV3.set(p.pos.x, p.pos.y + 1.45, p.pos.z);
      const dir = this._gV4;
      // puntería asistida: al objetivo fijado si existe
      if (p.lockTarget && p.lockTarget.alive) {
        dir.set(p.lockTarget.pos.x - origin.x, p.lockTarget.pos.y + 1.0 - origin.y, p.lockTarget.pos.z - origin.z);
      } else {
        // hacia donde mira el héroe (leve elevación para alcance)
        dir.set(Math.sin(p.yaw), 0.03, Math.cos(p.yaw));
      }
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.03, 1);
      this.ctx.spawnProjectile({
        pos: origin.clone().addScaledVector(dir, 0.5),
        dir: dir.clone().normalize(),
        speed: def.shotSpeed ?? 20,
        dmg: def.dmg * p.dmgMul,
        kind: def.shot === 'arrow' ? 'arrow' : 'orb',
        owner: 'player',
        aoe: def.aoe ?? 0,
      });
      // destello en la mano/arma al disparar
      this.particles.burst({
        x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6,
        count: def.shot === 'arrow' ? 5 : 10, speed: 2, color: def.shot === 'arrow' ? 0xffe0a0 : 0xff8a2a,
        size: 0.16, life: 0.3, drag: 2, glow: 2.2,
      });
      if (def.shot === 'fire') this.audio.castSpell();
      else this.audio.swing(1.35);
      return;
    }

    const kind = def.kind;
    const halfArc = def.spin ? Math.PI + 0.01 : def.arc / 2;
    let hitCount = 0;
    const to = this._gV1;
    // arco de tajo AAA: media luna que barre el cono del golpe
    if (!def.shot) {
      const arcColor = def.kind === 'finisher'
        ? 0xffb45a
        : (this.player.weaponType === 'staff' ? 0xff8a3a : 0xffe0b0);
      this.slashArcs.spawn(this.player.pos, this.player.yaw, {
        color: arcColor,
        radius: def.range * 0.92,
        dur: Math.max(0.2, def.dur * 0.55),
      });
    }
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      to.subVectors(e.pos, p.pos).setY(0);
      const d = to.length() - e.radius;
      if (d > def.range) continue;
      const ang = Math.atan2(to.x, to.z);
      let diff = Math.abs(((ang - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff <= halfArc) {
        const dmg = def.dmg * p.dmgMul;
        e.takeDamage(dmg, p.pos, this.ctx, kind !== 'light');
        hitCount++;
        // chispas direccionales del impacto (DMC)
        const hitPos = this._gV2.set(
          e.pos.x - to.x * 0.3,
          e.pos.y + e.rig.height * 0.55,
          e.pos.z - to.z * 0.3,
        );
        this.particles.burst({
          x: hitPos.x, y: hitPos.y, z: hitPos.z,
          count: kind === 'light' ? 10 : 22, speed: kind === 'light' ? 5 : 7, color: 0xffd9a0,
          size: kind === 'light' ? 0.2 : 0.26, life: 0.38, drag: 2, glow: 2.6, gravity: 4,
        });
        // destello de impacto en el punto exacto de contacto
        this.hitFlares.spawn(hitPos, {
          color: kind === 'light' ? 0xfff2d8 : 0xffd9a0,
          size: kind === 'light' ? 0.9 : (def.kind === 'finisher' ? 2.0 : 1.5),
          dur: kind === 'light' ? 0.1 : 0.14,
        });
        if (kind !== 'light') {
          this.particles.burst({
            x: hitPos.x, y: hitPos.y, z: hitPos.z,
            count: 12, speed: 4.5, color: 0xff8848, size: 0.3, life: 0.5, drag: 1.6, glow: 2.2, gravity: 2,
          });
          // decal radial en el suelo bajo el enemigo golpeado
          this.impactDecals.spawn(
            this._gV3.set(e.pos.x, terrainHeight(e.pos.x, e.pos.z), e.pos.z),
            { color: 0xffa86a, radius: kind === 'finisher' ? 2.2 : 1.6, dur: 0.5 },
          );
        }
      }
    }
    if (hitCount === 0) return;

    // ESTILO: puntos por golpe conectado (bonus por multi-impacto)
    this.stylePts = Math.min(420, this.stylePts + def.style + (hitCount - 1) * 5);
    this.comboHits += hitCount;
    this.comboHitsTimer = 2.1;

    if (kind === 'light') {
      // hit-stop corto con guarda (no congela en cadena → se siente ágil, no laggy)
      if (this.hitStopGap <= 0) {
        this.hitStopT = Math.max(this.hitStopT, 0.05);
        this.hitStopScale = 0.14;
        this.hitStopGap = 0.14;
      }
      this.shakeAmt = Math.min(1.2, this.shakeAmt + 0.14);
      this.audio.hitMetal();
    } else {
      // pesado / remate: onda expansiva + sacudida + golpe de FOV
      this.hitStopT = Math.max(this.hitStopT, kind === 'finisher' ? 0.11 : 0.095);
      this.hitStopScale = 0.09;
      this.hitStopGap = 0.2;
      this.shakeAmt = Math.min(1.2, this.shakeAmt + (kind === 'finisher' ? 0.6 : 0.5));
      this.audio.heavyHit();
      this.fovKickAmt = Math.min(7, this.fovKickAmt + (kind === 'finisher' ? 6 : 4.5));
      const impact = this._gV3.copy(p.pos).addScaledVector(this._gV4.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)), def.spin ? 0.5 : 1.7);
      impact.y = terrainHeight(impact.x, impact.z);
      this.ctx.shockwave(impact, 0xffc87d, def.spin ? 5.2 : (kind === 'finisher' ? 4.4 : 3.6));
      if (kind === 'finisher') {
        // anillo extra de chispas del remate
        this.particles.burst({
          x: impact.x, y: impact.y + 0.35, z: impact.z,
          count: 26, speed: 8.5, color: 0xffd9a0, size: 0.3, life: 0.55, drag: 1.8, glow: 2.9, gravity: 5,
        });
        // nova del bastón: anillo de llamas ascendentes
        if (def.spin && p.weaponType === 'staff') {
          this.particles.burst({
            x: impact.x, y: impact.y + 0.5, z: impact.z,
            count: 40, speed: 6, color: 0xff7a2a, size: 0.34, life: 0.9, drag: 1.4, glow: 3, gravity: -2.5,
          });
        }
      }
    }
  }

  /** Impacto de un disparo del héroe: daño directo + AoE de fuego + estilo */
  private resolvePlayerShotHit(pos: THREE.Vector3, dmg: number, aoe: number, isFire: boolean) {
    const p = this.player;
    let hitCount = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      const inAoe = aoe > 0 && d <= aoe + e.radius;
      const inDirect = d <= e.radius + 0.6 && Math.abs(e.pos.y - pos.y) < 2.4;
      if (!inAoe && !inDirect) continue;
      // los impactos secundarios del AoE hacen 55% de daño
      const factor = inDirect ? 1 : 0.55;
      e.takeDamage(dmg * factor, pos, this.ctx, isFire);
      hitCount++;
    }
    if (hitCount === 0 && aoe === 0) return;

    if (isFire && aoe > 0) {
      // explosión de bola de fuego
      this.particles.burst({
        x: pos.x, y: pos.y, z: pos.z,
        count: 30, speed: 6.5, color: 0xff7a2a, size: 0.3, life: 0.6, drag: 1.6, glow: 2.8, gravity: 1,
      });
      this.particles.burst({
        x: pos.x, y: pos.y + 0.3, z: pos.z,
        count: 14, speed: 3.5, color: 0xffd98a, size: 0.24, life: 0.45, drag: 2, glow: 2.4, gravity: -1,
      });
      this.hitFlares.spawn(pos, { color: 0xffc47d, size: aoe * 1.6, dur: 0.16 });
      this.impactDecals.spawn(
        this._gV3.set(pos.x, terrainHeight(pos.x, pos.z), pos.z),
        { color: 0xff8a3a, radius: aoe * 0.9, dur: 0.55 },
      );
      this.ctx.shockwave(pos, 0xff8a3a, aoe * 1.4);
      this.shakeAmt = Math.min(1.2, this.shakeAmt + 0.35);
      this.audio.heavyHit();
    } else {
      // impacto de flecha
      this.particles.burst({
        x: pos.x, y: pos.y, z: pos.z,
        count: 10, speed: 4, color: 0xffe0a0, size: 0.18, life: 0.35, drag: 2, glow: 2.4, gravity: 3,
      });
      this.hitFlares.spawn(pos, { color: 0xfff2d8, size: 0.8, dur: 0.09 });
      this.audio.hitMetal();
    }
    if (hitCount > 0) {
      this.stylePts = Math.min(420, this.stylePts + (isFire ? 12 : 9) + (hitCount - 1) * 5);
      this.comboHits += hitCount;
      this.comboHitsTimer = 2.1;
      if (this.hitStopGap <= 0) {
        this.hitStopT = Math.max(this.hitStopT, 0.045);
        this.hitStopScale = 0.16;
        this.hitStopGap = 0.14;
      }
    }
  }

  /** Añade puntos de estilo y recalcula el rango (D→SSS) */
  private addStyle(n: number) {
    this.stylePts = Math.min(420, this.stylePts + n);
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
    if (this.locked && this.phase === 'playing' && !this.uiOpen) {
      this.camYaw -= this.mouseDX * 0.0023;
      this.camPitch += this.mouseDY * 0.0018;
      this.camPitch = clamp(this.camPitch, -0.25, 1.15);
    }
    this.mouseDX = 0; this.mouseDY = 0;

    const target = this.player.pos;
    const head = this._gV1.set(target.x, target.y + 1.55, target.z);

    if (this.lockEnemy && this.lockEnemy.alive) {
      // cámara de objetivo fijado
      const desired = Math.atan2(target.x - this.lockEnemy.pos.x, target.z - this.lockEnemy.pos.z);
      this.camYaw = dampAngle(this.camYaw, desired, 3.2, dt);
      this.camPitch = damp(this.camPitch, 0.3, 3, dt);
    }

    // zoom suave hacia la distancia objetivo (rueda del ratón)
    this.camDist = damp(this.camDist, this.camDistTarget, 9, dt);
    const dist = this.camDist;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const off = this._gV2.set(Math.sin(this.camYaw) * cp, sp, Math.cos(this.camYaw) * cp);
    const desiredPos = this._gV3.copy(head).addScaledVector(off, dist);
    // hombro
    const right = this._gV4.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
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
    const lookAt = this._gV2.copy(head);
    if (this.lockEnemy && this.lockEnemy.alive) {
      lookAt.lerp(this._gV3.set(this.lockEnemy.pos.x, this.lockEnemy.pos.y + 1.2, this.lockEnemy.pos.z), 0.22);
    }
    this.camera.lookAt(lookAt);

    // FOV dinámico: esprintar + golpes cinematográficos (DMC)
    this.fovKickAmt = Math.max(0, this.fovKickAmt - dt * 22);
    const targetFov = this.baseFov + (this.player.sprinting ? 5 : 0) + this.fovKickAmt;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, this.fovKickAmt > 0.5 ? 26 : 6, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateEffects(dt: number) {
    this.particles.update(dt, this.camera.position);
    // ondas expansivas (pool)
    this.shockwaves.update(dt);
    // VFX de combate (pool)
    this.slashArcs.update(dt);
    this.impactDecals.update(dt);
    this.hitFlares.update(dt);
    // números de daño
    const w = window.innerWidth, h = window.innerHeight;
    const v = this._gV4;
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
        text-shadow:0 2px 0 rgba(28,20,40,0.95), 0 0 4px rgba(28,20,40,0.85), -1.5px 0 0 rgba(28,20,40,0.8), 1.5px 0 0 rgba(28,20,40,0.8);
        font-family:'Baloo 2','Nunito',system-ui,sans-serif;letter-spacing:0.05em;`;
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
      { x: MERCHANT_SPOT.stall.x, z: MERCHANT_SPOT.stall.z },
      { x: SMITH_SPOT.forge.x, z: SMITH_SPOT.forge.z },
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
    // vistas cacheadas: solo se reconstruyen cuando cambia el inventario/tienda
    if (this.invDirty || !this.invCache) { this.invCache = this.invView(); this.invDirty = false; }
    this.invCache.open = this.uiPanel === 'inv';
    if (this.shopDirty || !this.shopCache) { this.shopCache = this.shopView(); this.shopDirty = false; }
    this.shopCache.open = this.uiPanel === 'shop';
    if (this.smithDirty || !this.smithCache) { this.smithCache = this.smithView(); this.smithDirty = false; }
    this.smithCache.open = this.uiPanel === 'smith';
    if (!this.slotsCache) this.slotsCache = this.weaponSlots();
    for (const s of this.slotsCache) s.active = s.type === this.player.weaponType;
    // rango de estilo actual (D→SSS)
    let rankIdx = 0;
    for (let i = STYLE_RANKS.length - 1; i >= 0; i--) {
      if (this.stylePts >= STYLE_RANKS[i].min) { rankIdx = i; break; }
    }
    const rk = STYLE_RANKS[rankIdx];
    const next = STYLE_RANKS[rankIdx + 1];
    const progress = next ? clamp((this.stylePts - rk.min) / (next.min - rk.min), 0, 1) : 1;
    let enemiesAlive = 0;
    for (const e of this.enemies) if (e.alive) enemiesAlive++;
    this.onHud({
      phase: this.phase,
      hp: this.player.hp, maxHp: this.player.maxHp,
      stamina: this.player.stamina, maxStamina: this.player.maxStamina,
      xp: this.player.xp, xpNext: this.player.xpNext, level: this.player.level,
      gold: this.player.gold, potions: this.player.potions, maxPotions: this.player.maxPotions,
      shrinesCleansed: this.shrinesCleansed, shrinesTotal: 3,
      objective: this.objective(),
      enemiesAlive,
      bossActive: this.bossActive && !!boss?.alive,
      bossName: ENEMY_NAMES.boss,
      bossHp: boss?.hp ?? 0, bossMaxHp: boss?.maxHp ?? 1, bossPhase: boss?.phase ?? 1,
      kills: this.player.kills, time: this.elapsed,
      lockOn: !!this.lockEnemy,
      prompt: this.promptText(),
      fps: Math.round(this.fps),
      endless: this.endless,
      quality: this.quality,
      clock: this.cycle.sampleClockText(),
      dayNum: this.cycle.day,
      night: this.cycle.nightFactor > 0.5,
      notice: this.notice,
      styleLetter: rk.letter,
      styleLabel: rk.label,
      styleCss: rk.css,
      styleProgress: progress,
      comboHits: this.comboHits,
      comboActive: this.comboHitsTimer > 0 && this.comboHits > 1,
      inv: this.invCache,
      shop: this.shopCache,
      smith: this.smithCache,
      weaponSlots: this.slotsCache,
      weaponType: this.player.weaponType,
    });
  }

  private promptText(): string {
    if (!this.interactTarget || this.player.state === 'dead') return '';
    switch (this.interactTarget.kind) {
      case 'bonfire': return 'E · Descansar en la hoguera (cura y reabastece)';
      case 'merchant': return `E · Comerciar con ${MERCHANT_NAME} el Mercader`;
      case 'smith': return `E · Hablar con ${SMITH_NAME} el Herrero (forjar y mejorar)`;
      case 'shrine': return `E · Purificar ${WORLD.shrines[this.interactTarget.idx!].name}`;
      case 'sigil': return 'E · Despertar al jefe de nuevo';
    }
  }

  private setPhase(p: GamePhase) {
    const prev = this.phase;
    this.phase = p;
    if (p !== prev) {
      if (p === 'victory') { this.audio.victory(); this.audio.duckTheme(0.2, 1.5); }
      else if (p === 'dead') { this.audio.defeat(); this.audio.duckTheme(0.2, 1.5); }
      else if (p === 'playing') { this.audio.duckTheme(1); }
    }
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
      try {
        // Chrome moderno devuelve Promise; sin gesto válido rechaza (NotAllowedError)
        const p = c.requestPointerLock?.() as unknown;
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => {
            /* el jugador puede hacer clic en el lienzo para recuperar el bloqueo */
          });
        }
      } catch { /* navegadores antiguos: API síncrona, ignorar */ }
    }
  }

  respawn() {
    // limpiar enemigos vivos, proyectiles, drops y reapariciones pendientes
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
    this.respawnQueue = [];
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
    window.addEventListener('wheel', this.onWheel, { passive: false });
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
    // con un panel abierto (mochila/tienda/forja) solo se permite cerrarlo
    if (this.uiOpen) {
      if (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'KeyB') {
        if (this.uiPanel === 'shop' || this.uiPanel === 'smith') this.setPanel(null);
        else this.toggleInventory();
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Tab': this.toggleLockOn(); break;
      case 'Space': this.queued.roll = true; break;
      case 'KeyF': this.queued.potion = true; break;
      case 'KeyE': this.doInteract(); break;
      case 'KeyI': case 'KeyB': this.toggleInventory(); break;
      // cambio rápido de arma (solo si la posees)
      case 'Digit1': this.switchWeaponType('sword'); break;
      case 'Digit2': this.switchWeaponType('bow'); break;
      case 'Digit3': this.switchWeaponType('halberd'); break;
      case 'Digit4': this.switchWeaponType('staff'); break;
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
    if (this.phase !== 'playing' || this.uiOpen) return;
    if (!this.locked) { this.requestLock(); return; }
    if (e.button === 0) this.queued.attack = true;
    if (e.button === 2) this.queued.heavy = true;
  };

  /** Zoom de cámara con la rueda del ratón */
  private onWheel = (e: WheelEvent) => {
    if (this.phase !== 'playing' || this.uiOpen) return;
    e.preventDefault();
    // normaliza deltaY (modo píxel o línea)
    const dy = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
    this.camDistTarget = clamp(this.camDistTarget + dy * 0.012, Game.CAM_MIN, Game.CAM_MAX);
  };

  private onContextMenu = (e: Event) => { e.preventDefault(); };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    if (this.locked) this.unlockGuard = false;
    // no pausar si la salida de bloqueo fue por abrir la mochila
    if (!this.locked && this.phase === 'playing' && !this.uiOpen) {
      if (this.unlockGuard) { this.unlockGuard = false; return; }
      this.pause();
    }
  };

  /* ---------- Limpieza ---------- */

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.dmgLayer.remove();
  }
}
