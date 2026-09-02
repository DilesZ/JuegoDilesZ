import * as THREE from 'three';

/* ============================================================
   NÚCLEO: utilidades, ruido procedural, terreno y layout del mundo
   ============================================================ */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(t: number) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
export function damp(cur: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.damp(cur, target, lambda, dt);
}
/** Interpolación angular por el camino corto */
export function dampAngle(cur: number, target: number, lambda: number, dt: number) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------- Ruido de valor determinista ---------- */

function hash2(x: number, y: number): number {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1; // [-1, 1]
}

export function fbm(x: number, y: number, octaves = 4): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

/* ---------- Layout del mundo ---------- */

export const WORLD = {
  size: 200,
  radius: 92,            // radio jugable
  bonfire: { x: 0, z: 6 },
  arena: { x: 0, z: 76, r: 21 },
  /** nido del dragón ancestral (jefe 2): cráter helado al norte-este */
  roost: { x: 64, z: -52, r: 19 },
  shrines: [
    { x: 58, z: 20, name: 'Santuario del Alba', r: 12 },
    { x: -54, z: 40, name: 'Santuario del Crepúsculo', r: 12 },
    { x: -6, z: -64, name: 'Santuario de las Sombras', r: 12 },
  ],
} as const;

// Alturas base de las zonas planas (calculadas una vez, sin aplanado)
function rawHeight(x: number, z: number): number {
  let h = fbm(x * 0.016, z * 0.016, 4) * 7.0;
  h += fbm(x * 0.055 + 9.2, z * 0.055 + 3.1, 2) * 1.2;
  return h;
}
const CAMP_FLATS: { x: number; z: number; r: number; h: number }[] = [
  { x: WORLD.bonfire.x, z: WORLD.bonfire.z, r: 10, h: rawHeight(WORLD.bonfire.x, WORLD.bonfire.z) },
  ...WORLD.shrines.map(s => ({ x: s.x, z: s.z, r: s.r + 3, h: rawHeight(s.x, s.z) })),
  { x: WORLD.arena.x, z: WORLD.arena.z, r: WORLD.arena.r + 4, h: rawHeight(WORLD.arena.x, WORLD.arena.z) },
  // nido del dragón: cuenco hundido (cráter) con borde elevado
  { x: WORLD.roost.x, z: WORLD.roost.z, r: WORLD.roost.r + 5, h: rawHeight(WORLD.roost.x, WORLD.roost.z) - 2.5 },
];

export function terrainHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const f of CAMP_FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r) {
      const t = smoothstep(1 - d / f.r);
      h = lerp(h, f.h, t);
    }
  }
  // Borde del mundo: muralla natural
  const r = Math.hypot(x, z);
  if (r > WORLD.radius - 10) h += ((r - (WORLD.radius - 10)) / 10) * 9;
  return h;
}

export function terrainNormalY(x: number, z: number): number {
  const e = 0.6;
  const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
  const nx = hL - hR, nz = hD - hU, ny = 2 * e;
  const len = Math.hypot(nx, ny, nz);
  return ny / len; // componente Y de la normal (pendiente)
}

/* ---------- Tipos compartidos ---------- */

export type GamePhase = 'menu' | 'loading' | 'playing' | 'paused' | 'dead' | 'victory';

/* Vistas serializables del inventario para la UI (React) */
import type { EquipSlot, EquipStats, ItemKind, Rarity, WeaponType } from './items';

export interface ItemView {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  icon: string;
  desc: string;
  stats: Partial<EquipStats>;
  useText?: string;
  count: number;
}

export interface InvView {
  open: boolean;
  bag: ItemView[];
  bagSize: number;
  equip: Record<EquipSlot, ItemView | null>;
  totals: EquipStats;   // bonus de equipo
  defRed: number;       // reducción de daño 0..1
  dmgMul: number;       // multiplicador total de daño
  crit: number;         // prob. crítica total
  perm: { hp: number; dmg: number; stam: number };  // bonos permanentes de consumibles
}

/* Vista serializable de la tienda del mercader para la UI (React) */
export interface ShopEntryView {
  item: ItemView;
  price: number;   // precio de compra ◈
}
export interface ShopSellView {
  index: number;   // índice en la mochila (para vender)
  item: ItemView;
  sell: number;    // oro recibido ◈
}
export interface ShopView {
  open: boolean;
  name: string;
  stock: ShopEntryView[];
  bag: ShopSellView[];
  gold: number;
  restockDay: number; // día en que se reabasteció
}

/* Vista serializable de la FORJA del herrero para la UI (React) */
export interface SmithCatalogView {
  item: ItemView;
  price: number;
  owned: boolean;
  wtype: WeaponType;
}
export interface SmithView {
  open: boolean;
  name: string;
  gold: number;
  /** arma equipada (para mejorar) */
  weapon: ItemView | null;
  forgeLevel: number;
  maxForge: number;
  upgradeCost: number | null;   // null = al máximo o sin arma
  upgradeDesc: string;
  catalog: SmithCatalogView[];
}

/** Slots de cambio rápido de arma (1-4) para el HUD */
export interface WeaponSlotView {
  type: WeaponType;
  icon: string;
  label: string;
  name: string;
  active: boolean;
  owned: boolean;
}

export interface HudState {
  phase: GamePhase;
  hp: number; maxHp: number;
  stamina: number; maxStamina: number;
  xp: number; xpNext: number; level: number;
  gold: number; potions: number; maxPotions: number;
  shrinesCleansed: number; shrinesTotal: number;
  objective: string;
  enemiesAlive: number;
  bossActive: boolean; bossName: string; bossHp: number; bossMaxHp: number; bossPhase: number;
  kills: number; time: number;
  lockOn: boolean;
  prompt: string;        // texto de interacción o ''
  fps: number;
  endless: boolean;
  quality: 'bajo' | 'medio' | 'alto';
  clock: string;
  dayNum: number;
  night: boolean;
  notice: string;
  /** medidor de estilo DMC */
  styleLetter: string;
  styleLabel: string;
  styleCss: string;
  styleProgress: number;
  comboHits: number;
  comboActive: boolean;
  inv: InvView;
  shop: ShopView;
  smith: SmithView;
  /** slots de cambio rápido de arma (teclas 1-4) */
  weaponSlots: WeaponSlotView[];
  /** tipo de arma activa (para la barra del HUD) */
  weaponType: WeaponType;
  /** misión activa del argumento (acto I / acto II) */
  quest: QuestStage;
  /** Núcleos de Brasa recogidos (misión del acto II) */
  embers: number;
  embersRequired: number;
  /** el nido del dragón está abierto (portal visible) */
  gateOpen: boolean;
}

/* Rangos del medidor de estilo (D→SSS, estilo Devil May Cry) */
export const STYLE_RANKS: { min: number; letter: string; label: string; css: string }[] = [
  { min: 0,   letter: 'D',   label: 'Descuidado',      css: '#9aa0a6' },
  { min: 30,  letter: 'C',   label: 'Combativo',       css: '#7fd45f' },
  { min: 70,  letter: 'B',   label: 'Brutal',          css: '#4fc3f7' },
  { min: 120, letter: 'A',   label: 'Asombroso',       css: '#ffd54f' },
  { min: 180, letter: 'S',   label: 'Salvaje',         css: '#ff9e3d' },
  { min: 250, letter: 'SS',  label: 'Sobrenatural',    css: '#ff5a4e' },
  { min: 340, letter: 'SSS', label: '¡Estilo Demoníaco!', css: '#ff4fd8' },
];

export interface GameRefs {
  container: HTMLElement;
  minimap: HTMLCanvasElement;
  vignette: HTMLDivElement;
}

export const ENEMY_NAMES: Record<string, string> = {
  goblin: 'Bruto Tribal',
  archer: 'Espectro Errante',
  orc: 'Orco Brutal',
  boss: "Bel'Zaroth, el Señor Caído",
  boss2: "Vaelrath, la Furia Ancestral",
};

/* ---------- Misiones ----------
   Acto I: purificar los 3 santuarios → despertar de Bel'Zaroth
   Acto II (nueva): tras derrotar a Bel'Zaroth, el héroe descubre
   que el poder del jefe fluye hacia el norte: hay que recolectar
   3 Núcleos de Brasa (drops raros) para abrir el paso al nido y
   despertar a Vaelrath, el dragón ancestral. */
export type QuestStage = 'act1_shrines' | 'act1_boss' | 'act2_embers' | 'act2_gate' | 'act2_boss' | 'free';

export const EMBER_NAME = 'Núcleo de Brasa';
export const EMBERS_REQUIRED = 3;
