/* ============================================================
   ITEMS — Inventario, equipo y botín de AETHERIA
   Armas, armaduras, yelmos, accesorios y consumibles con
   rarezas (común → legendario) que alteran las estadísticas.
   ============================================================ */

export type Rarity = 'comun' | 'raro' | 'epico' | 'legendario';
export type ItemKind = 'weapon' | 'armor' | 'helmet' | 'accessory' | 'consumible';
export type EquipSlot = 'weapon' | 'armor' | 'helmet' | 'acc1' | 'acc2';

/** Tipos de arma: cada uno tiene su propio estilo de combate y modelo 3D */
export type WeaponType = 'sword' | 'bow' | 'halberd' | 'staff';
export const WEAPON_TYPE_LABEL: Record<WeaponType, string> = {
  sword: 'Espada', bow: 'Arco', halberd: 'Alabarda', staff: 'Bastón',
};
export const WEAPON_TYPE_ICON: Record<WeaponType, string> = {
  sword: '⚔️', bow: '🏹', halberd: '🪓', staff: '🔥',
};

/** Stats de equipo. dmg/speed/stam son BONOS aditivos sobre 1; crit es 0..1 */
export interface EquipStats {
  dmg: number;    // bonus multiplicador de daño (+0.10 = +10%)
  hp: number;     // vida máxima extra
  def: number;    // defensa (reducción = def / (def + 90))
  speed: number;  // bonus de velocidad (+0.05 = +5%)
  stam: number;   // bonus de regeneración de aguante
  crit: number;   // probabilidad de crítico adicional
}

export const NEUTRAL_STATS: EquipStats = { dmg: 0, hp: 0, def: 0, speed: 0, stam: 0, crit: 0 };

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  icon: string;      // glifo/emoji del objeto
  desc: string;
  stats: Partial<EquipStats>;
  useText?: string;  // solo consumibles: efecto al usar
  /** solo armas: estilo de combate que desbloquea (espada por defecto) */
  wtype?: WeaponType;
}

export function weaponTypeOf(def: ItemDef | null): WeaponType {
  return def?.wtype ?? 'sword';
}

/* ---------- Rarezas ---------- */

export const RARITY_INFO: Record<Rarity, { label: string; css: string; hex: number; glow: string }> = {
  comun:      { label: 'Común',      css: '#a8b2c0', hex: 0xb8c4d4, glow: 'rgba(168,178,192,0.55)' },
  raro:       { label: 'Raro',       css: '#54a8ff', hex: 0x4ea1ff, glow: 'rgba(84,168,255,0.65)' },
  epico:      { label: 'Épico',      css: '#c07aff', hex: 0xb06aff, glow: 'rgba(192,122,255,0.7)' },
  legendario: { label: 'Legendario', css: '#ffb347', hex: 0xffb347, glow: 'rgba(255,179,71,0.8)' },
};

export const RARITY_ORDER: Rarity[] = ['comun', 'raro', 'epico', 'legendario'];

export const KIND_LABEL: Record<ItemKind, string> = {
  weapon: 'Arma',
  armor: 'Armadura',
  helmet: 'Yelmo',
  accessory: 'Accesorio',
  consumible: 'Consumible',
};

/** Kind → slot de equipo por defecto (accesorios: acc1 o acc2) */
export function slotForKind(kind: ItemKind): EquipSlot | null {
  switch (kind) {
    case 'weapon': return 'weapon';
    case 'armor': return 'armor';
    case 'helmet': return 'helmet';
    case 'accessory': return 'acc1';
    default: return null;
  }
}

/* ---------- Catálogo ---------- */

export const ITEMS: ItemDef[] = [
  /* ----- ARMAS ----- */
  {
    id: 'espada_errante', name: 'Espada del Errante', kind: 'weapon', rarity: 'comun', icon: '⚔️',
    desc: 'Una hoja honesta de viajero. Ligera y sin Historia… todavía.',
    stats: { dmg: 0.10 },
  },
  {
    id: 'filo_alba', name: 'Filo del Alba', kind: 'weapon', rarity: 'raro', icon: '⚔️',
    desc: 'Forjada con la primera luz del amanecer. Zumba al amanecer.',
    stats: { dmg: 0.26, crit: 0.06 },
  },
  {
    id: 'katana_viento', name: 'Katana del Viento', kind: 'weapon', rarity: 'raro', icon: '🗡️',
    desc: 'Corta el aire antes de que el aire lo sepa.',
    stats: { dmg: 0.20, speed: 0.06, crit: 0.05 },
  },
  {
    id: 'colmillo_carmesi', name: 'Colmillo Carmesí', kind: 'weapon', rarity: 'epico', icon: '🗡️',
    desc: 'Bebe de cada herida. Sus arterias ardientes laten al ritmo del combate.',
    stats: { dmg: 0.40, crit: 0.08 },
  },
  {
    id: 'katana_espectral', name: 'Katana Espectral', kind: 'weapon', rarity: 'epico', icon: '🌀',
    desc: 'Hoja de niebla consagrada. Quien la empuña parece no tocar el suelo.',
    stats: { dmg: 0.32, speed: 0.12, crit: 0.06 },
  },
  {
    id: 'tensaiga_lunar', name: 'Tensaiga Lunar', kind: 'weapon', rarity: 'legendario', icon: '🌙',
    desc: 'La colmilluna. Dice la leyenda que puede cortar la noche en dos.',
    stats: { dmg: 0.58, crit: 0.12, speed: 0.06 },
  },

  /* ----- ARMAS DE OTROS ESTILOS (forjadas por Bran el Herrero) ----- */
  {
    id: 'arco_silvano', name: 'Arco Silvano', kind: 'weapon', rarity: 'comun', icon: '🏹', wtype: 'bow',
    desc: 'Madera de tejo flexible y cuerda de seda. Caza desde la distancia.',
    stats: { dmg: 0.14, crit: 0.05 },
  },
  {
    id: 'arco_tormenta', name: 'Arco de la Tormenta', kind: 'weapon', rarity: 'epico', icon: '🏹', wtype: 'bow',
    desc: 'Sus flechas silban como el viento antes del rayo.',
    stats: { dmg: 0.30, crit: 0.12, speed: 0.05 },
  },
  {
    id: 'alabarda_centinela', name: 'Alabarda del Centinela', kind: 'weapon', rarity: 'comun', icon: '🔱', wtype: 'halberd',
    desc: 'El alcance de la lanza, el filo del hacha. Barrieras a todos.',
    stats: { dmg: 0.22, hp: 10 },
  },
  {
    id: 'cosechadora_almas', name: 'Cosechadora de Almas', kind: 'weapon', rarity: 'epico', icon: '💀', wtype: 'halberd',
    desc: 'Cada giro siega una vida. Su hoja canta con voces antiguas.',
    stats: { dmg: 0.42, crit: 0.05, hp: 15 },
  },
  {
    id: 'baston_ascuas', name: 'Bastón de las Ascuas', kind: 'weapon', rarity: 'comun', icon: '🔥', wtype: 'staff',
    desc: 'Un cristal de brasa late en su punta. Escupe fuego a tu voluntad.',
    stats: { dmg: 0.16 },
  },
  {
    id: 'bordon_lunar', name: 'Bordón Lunar', kind: 'weapon', rarity: 'epico', icon: '🌙', wtype: 'staff',
    desc: 'Tallado en un meteoro caído. Sus llamas son de otro cielo.',
    stats: { dmg: 0.38, crit: 0.06, stam: 0.08 },
  },

  /* ----- ARMADURAS ----- */
  {
    id: 'tunica_errante', name: 'Túnica del Errante', kind: 'armor', rarity: 'comun', icon: '🧥',
    desc: 'Tela curtida por mil caminos. Mejor que nada.',
    stats: { hp: 20, def: 8 },
  },
  {
    id: 'coraza_guardian', name: 'Coraza del Guardián', kind: 'armor', rarity: 'raro', icon: '🛡️',
    desc: 'Placas de los centinelas de Aetheria. Aún huele a gloria.',
    stats: { hp: 45, def: 18 },
  },
  {
    id: 'armadura_dragon', name: 'Armadura del Dragón Caído', kind: 'armor', rarity: 'epico', icon: '🐉',
    desc: 'Escamas de un wyrm que desafió a la luna. Su calor aún protege.',
    stats: { hp: 80, def: 30 },
  },
  {
    id: 'manto_celestial', name: 'Manto Celestial', kind: 'armor', rarity: 'legendario', icon: '✨',
    desc: 'Tejido con hilo de estrellas. El peso del mundo resbala sobre él.',
    stats: { hp: 120, def: 42, speed: 0.05 },
  },

  /* ----- YELMOS ----- */
  {
    id: 'yelmo_errante', name: 'Yelmo del Errante', kind: 'helmet', rarity: 'comun', icon: '⛑️',
    desc: 'Abollado pero digno. Cuenta más batallas que su portador.',
    stats: { hp: 12, def: 6 },
  },
  {
    id: 'yelmo_guardian', name: 'Yelmo del Guardián', kind: 'helmet', rarity: 'raro', icon: '⛑️',
    desc: 'Visera de plata con grabados de vigilia.',
    stats: { hp: 25, def: 12, stam: 0.05 },
  },
  {
    id: 'diadema_arcana', name: 'Diadema Arcana', kind: 'helmet', rarity: 'epico', icon: '👑',
    desc: 'Agudiza los sentidos hasta ver el hilo del destino.',
    stats: { hp: 15, crit: 0.07, stam: 0.12 },
  },
  {
    id: 'corona_rey_caido', name: 'Corona del Rey Caído', kind: 'helmet', rarity: 'legendario', icon: '👑',
    desc: 'Aún susurra órdenes a un reino que ya no existe.',
    stats: { hp: 50, def: 18, crit: 0.08 },
  },

  /* ----- ACCESORIOS ----- */
  {
    id: 'campana_espiritu', name: 'Campana del Espíritu', kind: 'accessory', rarity: 'comun', icon: '🔔',
    desc: 'Su tintineo calma al alma cansada.',
    stats: { hp: 18, stam: 0.05 },
  },
  {
    id: 'amuleto_lobo', name: 'Amuleto del Lobo', kind: 'accessory', rarity: 'raro', icon: '🐺',
    desc: 'Colmillo atado con cuero. Corre como la manada.',
    stats: { speed: 0.07, stam: 0.08 },
  },
  {
    id: 'anillo_jade', name: 'Anillo de Jade', kind: 'accessory', rarity: 'raro', icon: '💍',
    desc: 'Piedra verde que absorbe el impacto de los golpes.',
    stats: { hp: 30, def: 6 },
  },
  {
    id: 'colgante_lunar', name: 'Colgante Lunar', kind: 'accessory', rarity: 'epico', icon: '🌙',
    desc: 'Brilla más fuerte cuando la batalla se decanta.',
    stats: { crit: 0.10, dmg: 0.06 },
  },
  {
    id: 'ojo_dragon', name: 'Ojo del Dragón', kind: 'accessory', rarity: 'epico', icon: '👁️',
    desc: 'Ve el instante exacto en que la guardia baja.',
    stats: { dmg: 0.14 },
  },
  {
    id: 'reliquia_alba', name: 'Reliquia del Alba', kind: 'accessory', rarity: 'legendario', icon: '🔱',
    desc: 'Fragmento del primer sol. Arde sin quemar.',
    stats: { dmg: 0.15, crit: 0.10, speed: 0.05 },
  },

  /* ----- CONSUMIBLES ----- */
  {
    id: 'elixir_vida', name: 'Elixir de Vida', kind: 'consumible', rarity: 'raro', icon: '🧪',
    desc: 'Líquido dorado que late como un corazón pequeño.',
    stats: {},
    useText: 'Cura toda la vida y +12 de vida máxima (permanente)',
  },
  {
    id: 'piedra_afilar', name: 'Piedra de Afilar', kind: 'consumible', rarity: 'comun', icon: '🪨',
    desc: 'Grano áspero que devuelve el filo a cualquier acero.',
    stats: {},
    useText: '+4% de daño permanente',
  },
  {
    id: 'fruta_espiritu', name: 'Fruta del Espíritu', kind: 'consumible', rarity: 'comun', icon: '🍡',
    desc: 'Dulce de festival que despierta el cuerpo.',
    stats: {},
    useText: '+8% de regeneración de aguante (permanente)',
  },
];

const ITEM_MAP = new Map(ITEMS.map(i => [i.id, i]));
export function itemById(id: string): ItemDef {
  const it = ITEM_MAP.get(id);
  if (!it) throw new Error(`[items] objeto desconocido: ${id}`);
  return it;
}

/* ---------- Economía (mercader) ---------- */

/** Valor base por rareza en monedas ◈ */
export const RARITY_VALUE: Record<Rarity, number> = {
  comun: 30,
  raro: 85,
  epico: 190,
  legendario: 420,
};

/** Precio de compra al mercader (ligero recargo sobre el valor) */
export function buyPrice(def: ItemDef): number {
  const base = RARITY_VALUE[def.rarity];
  const kindMul = def.kind === 'consumible' ? 0.8 : 1; // los consumibles son más baratos
  return Math.max(10, Math.round((base * kindMul) / 5) * 5);
}

/** Precio de venta al mercader (40% del valor, mínimo 6 ◈) */
export function sellPrice(def: ItemDef): number {
  return Math.max(6, Math.round(RARITY_VALUE[def.rarity] * 0.4));
}

/**
 * Surtido del mercader: consumibles siempre + N piezas de equipo
 * con sesgo de rareza según el nivel del héroe (sin repeticiones).
 */
export function merchantStock(level: number, nEquip = 6): ItemDef[] {
  const stock: ItemDef[] = [
    itemById('elixir_vida'),
    itemById('piedra_afilar'),
    itemById('fruta_espiritu'),
  ];
  const lv = Math.max(1, level);
  const weights: [Rarity, number][] = [
    ['comun', Math.max(0.6, 2.6 - lv * 0.15)],
    ['raro', 1.7],
    ['epico', 0.55 + Math.min(0.5, lv * 0.05)],
    ['legendario', 0.12 + Math.min(0.25, lv * 0.02)],
  ];
  const picked = new Set<string>();
  let guard = 0;
  while (stock.length - 3 < nEquip && guard++ < 200) {
    const def = rollDropRarity(weights);
    if (picked.has(def.id)) continue;
    picked.add(def.id);
    stock.push(def);
  }
  return stock;
}

function rollDropRarity(weights: [Rarity, number][]): ItemDef {
  const rarity = pickWeighted(weights);
  const kind = pickWeighted(KIND_WEIGHTS);
  const pool = ITEMS.filter(i => i.rarity === rarity && i.kind === kind && i.kind !== 'consumible');
  const fallback = ITEMS.filter(i => i.rarity === rarity && i.kind !== 'consumible');
  const src = pool.length ? pool : fallback;
  return src[Math.floor(Math.random() * src.length)];
}

/* ---------- Botín ---------- */

const KIND_WEIGHTS: [ItemKind, number][] = [
  ['weapon', 0.30], ['armor', 0.24], ['helmet', 0.14], ['accessory', 0.22], ['consumible', 0.10],
];

function pickWeighted<T>(entries: [T, number][]): T {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1][0];
}

/**
 * Sortea un objeto de botín. El nivel del héroe y si es jefe
 * inclinan las rarezas hacia arriba.
 */
export function rollDrop(level: number, boss = false): ItemDef {
  const lv = Math.max(1, level);
  let weights: [Rarity, number][];
  if (boss) {
    weights = [['raro', 0.18], ['epico', 0.44], ['legendario', 0.38]];
  } else {
    const wComun = Math.max(0.30, 0.62 - (lv - 1) * 0.022);
    const wRaro = 0.28;
    const wEpico = 0.08 + Math.min(0.14, (lv - 1) * 0.013);
    const wLeg = 0.02 + Math.min(0.08, (lv - 1) * 0.007);
    weights = [['comun', wComun], ['raro', wRaro], ['epico', wEpico], ['legendario', wLeg]];
  }
  const rarity = pickWeighted(weights);
  const kind = pickWeighted(KIND_WEIGHTS);
  const pool = ITEMS.filter(i => i.rarity === rarity && i.kind === kind);
  const fallback = ITEMS.filter(i => i.rarity === rarity);
  const src = pool.length ? pool : fallback;
  return src[Math.floor(Math.random() * src.length)];
}

/* ---------- Forja del herrero ---------- */

/** Nivel máximo de mejora de un arma en la forja de Bran */
export const MAX_FORGE = 5;

/** Bonus de daño por nivel de forja (+8% por nivel, acumulativo) */
export const FORGE_DMG_PER_LEVEL = 0.08;

/** Coste en ◈ de subir el arma equipada de nivel `level` a `level+1` */
export function upgradeCost(level: number): number {
  return 60 + level * 75;
}

/** Catálogo que forja Bran: una pieza estrella por cada estilo de combate */
export const SMITH_CATALOG: string[] = [
  'baston_ascuas',
  'arco_silvano',
  'alabarda_centinela',
];

/* ---------- Inventario ---------- */

export const BAG_SIZE = 24;

export interface BagEntry { def: ItemDef; count: number; }

export class Inventory {
  bag: BagEntry[] = [];
  equip: Record<EquipSlot, ItemDef | null> = { weapon: null, armor: null, helmet: null, acc1: null, acc2: null };
  /** nivel de forja por id de arma (mejoras permanentes de Bran) */
  forge: Record<string, number> = {};

  /** Añade a la mochila (los consumibles se apilan). false si está llena. */
  addItem(def: ItemDef): boolean {
    if (def.kind === 'consumible') {
      const e = this.bag.find(b => b.def.id === def.id);
      if (e) { e.count = Math.min(99, e.count + 1); return true; }
    }
    if (this.bag.length >= BAG_SIZE) return false;
    this.bag.push({ def, count: 1 });
    return true;
  }

  removeAt(i: number) {
    const e = this.bag[i];
    if (!e) return;
    e.count--;
    if (e.count <= 0) this.bag.splice(i, 1);
  }

  /**
   * Equipa el objeto de la mochila en su hueco. Devuelve el objeto
   * desplazado para devolverlo a la mochila (o null si no había).
   */
  equipFromBag(i: number): { ok: boolean; swapped: ItemDef | null } {
    const e = this.bag[i];
    if (!e) return { ok: false, swapped: null };
    const def = e.def;
    const base = slotForKind(def.kind);
    if (!base) return { ok: false, swapped: null };
    let target = base;
    if (base === 'acc1') {
      if (!this.equip.acc1) target = 'acc1';
      else if (!this.equip.acc2) target = 'acc2';
      else target = 'acc1';
    }
    const prev = this.equip[target];
    this.equip[target] = def;
    this.removeAt(i);
    return { ok: true, swapped: prev };
  }

  /** Quita un equipo y lo devuelve a la mochila (null si no cabe). */
  unequip(slot: EquipSlot): ItemDef | null {
    const cur = this.equip[slot];
    if (!cur) return null;
    if (this.bag.length >= BAG_SIZE) return null;
    this.equip[slot] = null;
    this.bag.push({ def: cur, count: 1 });
    return cur;
  }

  /** Equipa directamente (equipo inicial, sin pasar por la mochila). */
  forceEquip(slot: EquipSlot, def: ItemDef) { this.equip[slot] = def; }

  /** Consume un consumible de la mochila y devuelve su definición. */
  useConsumable(i: number): ItemDef | null {
    const e = this.bag[i];
    if (!e || e.def.kind !== 'consumible') return null;
    const def = e.def;
    this.removeAt(i);
    return def;
  }

  /** Nivel de forja de un arma (0 si no tiene). */
  forgeLevel(id: string): number {
    return this.forge[id] ?? 0;
  }

  /** Sube un nivel de forja. Devuelve el nuevo nivel o -1 si estaba al máximo. */
  addForgeLevel(id: string): number {
    const cur = this.forgeLevel(id);
    if (cur >= MAX_FORGE) return -1;
    this.forge[id] = cur + 1;
    return cur + 1;
  }

  /** ¿Posee el jugador (equipada o en la mochila) un arma de este tipo? */
  ownsWeaponType(t: WeaponType): boolean {
    const w = this.equip.weapon;
    if (w && weaponTypeOf(w) === t) return true;
    return this.bag.some(e => e.def.kind === 'weapon' && weaponTypeOf(e.def) === t);
  }

  /** Devuelve el arma equipada si es del tipo, o la mejor de la mochila. */
  findWeaponByType(t: WeaponType): { where: 'equip' | 'bag'; index: number; def: ItemDef } | null {
    const w = this.equip.weapon;
    if (w && weaponTypeOf(w) === t) return { where: 'equip', index: -1, def: w };
    for (let i = 0; i < this.bag.length; i++) {
      const e = this.bag[i];
      if (e.def.kind === 'weapon' && weaponTypeOf(e.def) === t) return { where: 'bag', index: i, def: e.def };
    }
    return null;
  }

  /** Suma de todos los bonus de equipo (+ forja del arma equipada). */
  totals(): EquipStats {
    const t: EquipStats = { ...NEUTRAL_STATS };
    for (const slot of ['weapon', 'armor', 'helmet', 'acc1', 'acc2'] as const) {
      const it = this.equip[slot];
      if (!it) continue;
      t.dmg += it.stats.dmg ?? 0;
      t.hp += it.stats.hp ?? 0;
      t.def += it.stats.def ?? 0;
      t.speed += it.stats.speed ?? 0;
      t.stam += it.stats.stam ?? 0;
      t.crit += it.stats.crit ?? 0;
    }
    // forja del arma equipada: +8% de daño por nivel
    const w = this.equip.weapon;
    if (w) t.dmg += this.forgeLevel(w.id) * FORGE_DMG_PER_LEVEL;
    t.crit = Math.min(0.75, t.crit);
    return t;
  }
}
