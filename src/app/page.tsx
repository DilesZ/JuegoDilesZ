'use client';

import { useEffect, useRef, useState } from 'react';
import { loadCharacterAssets } from '@/game/characters';
import type { HudState, ItemView, ShopEntryView, ShopSellView, WeaponSlotView } from '@/game/core';
import type { Game, QualityTier } from '@/game/game';
import { WEAPON_TYPE_LABEL } from '@/game/items';

/* ============================================================
   AETHERIA — Eco del Reino Caído · Action RPG 3D
   Menú cinemático sobre el mundo en vivo + HUD + Inventario
   ============================================================ */

const INITIAL_HUD: HudState = {
  phase: 'menu',
  hp: 100, maxHp: 100,
  stamina: 100, maxStamina: 100,
  xp: 0, xpNext: 70, level: 1,
  gold: 0, potions: 4, maxPotions: 6,
  shrinesCleansed: 0, shrinesTotal: 3,
  objective: '',
  enemiesAlive: 0,
  bossActive: false, bossName: '', bossHp: 0, bossMaxHp: 1, bossPhase: 1,
  kills: 0, time: 0,
  lockOn: false,
  prompt: '',
  fps: 60,
  endless: false,
  quality: 'alto',
  clock: '08:09',
  dayNum: 1,
  night: false,
  notice: '',
  styleLetter: 'D',
  styleLabel: 'Descuidado',
  styleCss: '#9aa0a6',
  styleProgress: 0,
  comboHits: 0,
  comboActive: false,
  quest: 'act1_shrines',
  embers: 0,
  embersRequired: 3,
  gateOpen: false,
  inv: {
    open: false,
    bag: [], bagSize: 24,
    equip: { weapon: null, armor: null, helmet: null, acc1: null, acc2: null },
    totals: { dmg: 0, hp: 0, def: 0, speed: 0, stam: 0, crit: 0 },
    defRed: 0, dmgMul: 1, crit: 0,
    perm: { hp: 0, dmg: 0, stam: 0 },
  },
  shop: {
    open: false,
    name: 'Ferran',
    stock: [],
    bag: [],
    gold: 0,
    restockDay: 1,
  },
  smith: {
    open: false,
    name: 'Bran',
    gold: 0,
    weapon: null,
    forgeLevel: 0,
    maxForge: 5,
    upgradeCost: null,
    upgradeDesc: '',
    catalog: [],
  },
  weaponSlots: [],
  weaponType: 'sword',
};

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Bar({ value, max, className, height = 'h-3.5' }: { value: number; max: number; className: string; height?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`w-full ${height} rounded-sm border border-black/60 bg-black/70 overflow-hidden shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]`}>
      <div className={`h-full ${className} transition-[width] duration-150 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MenuButton({ onClick, children, primary = false, small = false }: { onClick: () => void; children: React.ReactNode; primary?: boolean; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${small ? 'px-4 py-2 text-[11px] min-h-[38px]' : 'px-8 py-3 min-h-[46px] text-sm'} font-display tracking-[0.2em] uppercase border transition-all duration-200
        ${primary
          ? 'border-amber-500/70 bg-amber-900/30 text-amber-100 hover:bg-amber-700/40 hover:border-amber-400 hover:shadow-[0_0_24px_rgba(245,180,80,0.25)]'
          : 'border-stone-600/60 bg-stone-900/70 text-stone-300 hover:bg-stone-800 hover:text-amber-100'}`}
    >
      {children}
    </button>
  );
}

/** Reloj del mundo: sol/luna + día + hora in-game */
function ClockChip({ clock, day, night }: { clock: string; day: number; night: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 bg-black/50 border border-amber-900/40 rounded px-3 py-1 backdrop-blur-[2px]">
      {night ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-indigo-200 drop-shadow-[0_0_6px_rgba(165,180,252,0.9)]">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.9)]">
          <circle cx="12" cy="12" r="4.4" fill="currentColor" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={i} x1="12" y1="1.5" x2="12" y2="4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${i * 45} 12 12)`} />
          ))}
        </svg>
      )}
      <span className="font-display text-[12px] tracking-[0.14em] text-amber-100/95">
        Día {day} · {clock}
      </span>
    </div>
  );
}

/** Esquinas ornamentales del panel */
function Corners() {
  const base = 'absolute w-5 h-5 border-amber-500/60 pointer-events-none';
  return (
    <>
      <span className={`${base} top-1.5 left-1.5 border-t-2 border-l-2`} />
      <span className={`${base} top-1.5 right-1.5 border-t-2 border-r-2`} />
      <span className={`${base} bottom-1.5 left-1.5 border-b-2 border-l-2`} />
      <span className={`${base} bottom-1.5 right-1.5 border-b-2 border-r-2`} />
    </>
  );
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Moverse'],
  ['Ratón', 'Cámara'],
  ['Rueda', 'Zoom de cámara'],
  ['Clic izq.', 'Ataca (combo distinto por arma)'],
  ['Clic der.', 'Golpe cargado (o remate en la cadena)'],
  ['1 2 3 4', 'Espada · Arco · Alabarda · Bastón (forja en Bran)'],
  ['Espacio', 'Esquiva rodando — cancela ataques (invulnerable)'],
  ['Tab', 'Fijar objetivo'],
  ['F', 'Beber poción'],
  ['E', 'Interactuar'],
  ['I', 'Inventario y equipo'],
  ['Shift', 'Esprintar'],
  ['Esc', 'Pausa'],
];

const QUALITIES: { id: QualityTier; label: string }[] = [
  { id: 'bajo', label: 'Bajo' },
  { id: 'medio', label: 'Medio' },
  { id: 'alto', label: 'Alto' },
];

/* ============================================================
   INVENTARIO / EQUIPO
   ============================================================ */

const RARITY_CSS: Record<string, string> = {
  comun: '#a8b2c0', raro: '#54a8ff', epico: '#c07aff', legendario: '#ffb347',
};
const RARITY_LABEL: Record<string, string> = {
  comun: 'Común', raro: 'Raro', epico: 'Épico', legendario: 'Legendario',
};
const KIND_LABEL: Record<string, string> = {
  weapon: 'Arma', armor: 'Armadura', helmet: 'Yelmo', accessory: 'Accesorio', consumible: 'Consumible',
};
const SLOT_LABEL: Record<string, string> = {
  weapon: 'Arma', armor: 'Armadura', helmet: 'Yelmo', acc1: 'Accesorio I', acc2: 'Accesorio II',
};

/** Líneas de estadísticas de un objeto, tipo "+26% Daño" */
function ItemStatLines({ item }: { item: ItemView }) {
  const s = item.stats;
  const rows: string[] = [];
  if (s.dmg) rows.push(`+${Math.round(s.dmg * 100)}% Daño`);
  if (s.hp) rows.push(`+${s.hp} Vida`);
  if (s.def) rows.push(`+${s.def} Defensa`);
  if (s.speed) rows.push(`+${Math.round(s.speed * 100)}% Velocidad`);
  if (s.stam) rows.push(`+${Math.round(s.stam * 100)}% Aguante`);
  if (s.crit) rows.push(`+${Math.round(s.crit * 100)}% Crítico`);
  if (!rows.length && item.useText) rows.push(item.useText);
  if (!rows.length) return null;
  return (
    <ul className="space-y-0.5">
      {rows.map(r => (
        <li key={r} className="text-[12px] text-emerald-300/90 font-semibold">{r}</li>
      ))}
    </ul>
  );
}

/** Hueco de equipo o de mochila */
function ItemSlot({
  item, label, onClick, onHover, size = 'w-16 h-16', iconSize = 'text-2xl',
}: {
  item: ItemView | null; label?: string; onClick?: () => void;
  onHover?: (it: ItemView | null) => void; size?: string; iconSize?: string;
}) {
  const rc = item ? RARITY_CSS[item.rarity] : null;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover?.(item)}
      onMouseLeave={() => onHover?.(null)}
      disabled={!onClick}
      className={`relative ${size} shrink-0 rounded-md border-2 bg-stone-950/85 transition-all duration-150 flex items-center justify-center
        ${item && onClick ? 'cursor-pointer hover:scale-[1.06] hover:z-10' : ''} ${!item && onClick ? 'cursor-default' : ''}`}
      style={rc ? { borderColor: rc, boxShadow: `0 0 10px ${rc}44, inset 0 0 8px ${rc}22` } : { borderColor: 'rgba(120,113,108,0.35)' }}
      title={item ? item.name : (label ?? '')}
    >
      {item ? (
        <span className={`${iconSize} leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]`}>{item.icon}</span>
      ) : (
        label && <span className="text-[9px] uppercase tracking-widest text-stone-600 px-1 text-center leading-tight">{label}</span>
      )}
      {item && item.count > 1 && (
        <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">×{item.count}</span>
      )}
      {item && rc && (item.rarity === 'epico' || item.rarity === 'legendario') && (
        <span className="absolute -top-1 -right-1 w-2 h-2 rotate-45" style={{ background: rc, boxShadow: `0 0 6px ${rc}` }} />
      )}
    </button>
  );
}

function InventoryPanel({ hud, g, onClose }: { hud: HudState; g: () => Game | null; onClose: () => void }) {
  const [hover, setHover] = useState<ItemView | null>(null);
  const inv = hud.inv;

  const clickBag = (i: number, it: ItemView) => {
    if (it.kind === 'consumible') g()?.useBagItem(i);
    else g()?.equipFromBag(i);
  };

  const stats: [string, string][] = [
    ['Nivel', `${hud.level}`],
    ['Vida', `${Math.ceil(hud.hp)} / ${hud.maxHp}`],
    ['Daño', `×${inv.dmgMul.toFixed(2)}`],
    ['Reducción', `${Math.round(inv.defRed * 100)}%`],
    ['Crítico', `${Math.round(inv.crit * 100)}%`],
    ['Velocidad', `+${Math.round(inv.totals.speed * 100)}%`],
    ['Aguante', `+${Math.round((inv.totals.stam + inv.perm.stam) * 100)}%`],
    ['Bajas', `${hud.kills}`],
  ];

  const detail = hover ?? inv.equip.weapon ?? null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[3px] pointer-events-auto">
      <div className="relative aetheria-frame w-[min(1040px,95vw)] max-h-[92vh] bg-[#0d0b14]/95 border border-amber-900/50 shadow-[0_0_80px_rgba(0,0,0,0.7)] flex flex-col aetheria-pop">
        <Corners />

        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-amber-900/30">
          <div className="flex items-baseline gap-4">
            <h2 className="font-display text-2xl text-amber-200 tracking-[0.2em] uppercase">Mochila</h2>
            <span className="text-[11px] text-stone-500 tracking-[0.25em] uppercase hidden sm:inline">Equipo del caballero</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-amber-300/90 font-semibold">◈ {hud.gold}</div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded border border-stone-700/70 bg-stone-900/80 text-stone-400 hover:text-amber-100 hover:border-amber-600/60 transition-colors text-lg leading-none"
              title="Cerrar (I / Esc)"
            >✕</button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="grid md:grid-cols-[290px_1fr] gap-5 p-5 overflow-y-auto aetheria-scroll">
          {/* Columna izquierda: equipo + atributos */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-amber-600/80 bg-stone-950/90 flex items-center justify-center font-display text-amber-200 text-xl shadow-[0_0_12px_rgba(0,0,0,0.8)]">
                {hud.level}
              </div>
              <div>
                <div className="font-display text-amber-100 tracking-[0.12em] text-sm">EL CABALLERO DEL ALBA</div>
                <div className="text-[11px] text-stone-500">Nivel {hud.level} · XP {hud.xp}/{hud.xpNext}</div>
              </div>
            </div>

            {/* Huecos de equipo */}
            <div className="grid grid-cols-3 gap-2 justify-items-center bg-black/30 border border-stone-800/70 rounded-lg p-3">
              <ItemSlot item={inv.equip.helmet} label="Yelmo" onClick={inv.equip.helmet ? () => g()?.unequipSlot('helmet') : undefined} onHover={setHover} />
              <ItemSlot item={inv.equip.weapon} label="Arma" onClick={inv.equip.weapon ? () => g()?.unequipSlot('weapon') : undefined} onHover={setHover} />
              <ItemSlot item={inv.equip.armor} label="Armadura" onClick={inv.equip.armor ? () => g()?.unequipSlot('armor') : undefined} onHover={setHover} />
              <ItemSlot item={inv.equip.acc1} label="Accesorio I" onClick={inv.equip.acc1 ? () => g()?.unequipSlot('acc1') : undefined} onHover={setHover} />
              <ItemSlot item={inv.equip.acc2} label="Accesorio II" onClick={inv.equip.acc2 ? () => g()?.unequipSlot('acc2') : undefined} onHover={setHover} />
            </div>

            {/* Atributos */}
            <div className="bg-black/30 border border-stone-800/70 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-display mb-2">Atributos</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {stats.map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[12px] border-b border-stone-800/50 pb-0.5">
                    <span className="text-stone-500">{k}</span>
                    <span className="text-amber-100/90 font-semibold">{v}</span>
                  </div>
                ))}
              </div>
              {inv.perm.hp > 0 && (
                <div className="mt-2 text-[10px] text-stone-500">Elixires bebidos: +{inv.perm.hp} vida · +{Math.round(inv.perm.dmg * 100)}% daño · +{Math.round(inv.perm.stam * 100)}% aguante</div>
              )}
            </div>
          </div>

          {/* Columna derecha: mochila + detalles */}
          <div className="space-y-4 min-w-0">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-display">Mochila · {inv.bag.length}/{inv.bagSize}</div>
                <div className="text-[10px] text-stone-600">Clic para equipar · consumibles: usar</div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 bg-black/30 border border-stone-800/70 rounded-lg p-3">
                {inv.bag.map((it, i) => (
                  <ItemSlot key={`${it.id}-${i}`} item={it} onClick={() => clickBag(i, it)} onHover={setHover} />
                ))}
                {Array.from({ length: Math.max(0, inv.bagSize - inv.bag.length) }).map((_, i) => (
                  <ItemSlot key={`empty-${i}`} item={null} onHover={setHover} />
                ))}
              </div>
            </div>

            {/* Detalles del objeto */}
            <div className="bg-black/30 border border-stone-800/70 rounded-lg p-4 min-h-[132px]">
              {detail ? (
                <div className="flex gap-4">
                  <div
                    className="w-16 h-16 shrink-0 rounded-md border-2 bg-stone-950/85 flex items-center justify-center text-3xl"
                    style={{ borderColor: RARITY_CSS[detail.rarity], boxShadow: `0 0 12px ${RARITY_CSS[detail.rarity]}44` }}
                  >
                    {detail.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-base tracking-wide" style={{ color: RARITY_CSS[detail.rarity] }}>{detail.name}</div>
                    <div className="text-[11px] text-stone-500 mb-1.5">{KIND_LABEL[detail.kind]} · {RARITY_LABEL[detail.rarity]}{detail.count > 1 ? ` · ×${detail.count}` : ''}</div>
                    <ItemStatLines item={detail} />
                    <p className="text-[12px] text-stone-400 italic mt-1.5 leading-relaxed">{detail.desc}</p>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12px] text-stone-600 italic">
                  Pasa el cursor sobre un objeto para ver sus detalles
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pie */}
        <div className="px-6 pb-4 pt-1 text-[10px] text-stone-600 flex justify-between">
          <span>Clic en un hueco de equipo para quitarlo · I / Esc cierra la mochila</span>
          <span className="hidden sm:inline">El botín cae de tus enemigos · Los jefes sueltan objetos épicos</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TIENDA DEL MERCADER
   ============================================================ */

function MerchantPanel({ hud, g, onClose }: { hud: HudState; g: () => Game | null; onClose: () => void }) {
  const [hover, setHover] = useState<{ item: ItemView; extra: string; accent: string } | null>(null);
  const shop = hud.shop;
  const afford = (e: ShopEntryView) => hud.gold >= e.price;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[3px] pointer-events-auto">
      <div className="relative aetheria-frame w-[min(1040px,95vw)] max-h-[92vh] bg-[#0d0b14]/95 border border-amber-900/50 shadow-[0_0_80px_rgba(0,0,0,0.7)] flex flex-col aetheria-pop">
        <Corners />

        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-amber-900/30">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full border-2 border-amber-600/80 bg-stone-950/90 flex items-center justify-center text-xl shadow-[0_0_12px_rgba(0,0,0,0.8)]">
              🧙
            </div>
            <div>
              <h2 className="font-display text-2xl text-amber-200 tracking-[0.18em] uppercase leading-none">
                {shop.name} · Mercader del Alba
              </h2>
              <div className="text-[11px] text-stone-500 tracking-[0.2em] uppercase mt-1">
                “Género honesto para caminos largos” · Día {shop.restockDay}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-sm font-semibold px-3 py-1.5 rounded border ${hud.gold > 0 ? 'text-amber-300/90 border-amber-800/50 bg-black/40' : 'text-red-300 border-red-900/50 bg-black/40'}`}>
              ◈ {hud.gold}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded border border-stone-700/70 bg-stone-900/80 text-stone-400 hover:text-amber-100 hover:border-amber-600/60 transition-colors text-lg leading-none"
              title="Cerrar (Esc)"
            >✕</button>
          </div>
        </div>

        {/* Cuerpo: comprar | vender */}
        <div className="grid md:grid-cols-2 gap-5 p-5 overflow-y-auto aetheria-scroll">
          {/* Mercadería */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-display">Mercadería · clic para comprar</div>
              <div className="text-[10px] text-stone-600">{shop.stock.length} objetos</div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2 bg-black/30 border border-stone-800/70 rounded-lg p-3">
              {shop.stock.map((e, i) => (
                <button
                  key={`${e.item.id}-${i}`}
                  onClick={() => g()?.buyItem(i)}
                  onMouseEnter={() => setHover({ item: e.item, extra: `Precio de compra: ${e.price} ◈`, accent: afford(e) ? '#8ef2a6' : '#ff8a7a' })}
                  onMouseLeave={() => setHover(null)}
                  className={`relative group rounded-md border-2 bg-stone-950/85 h-20 flex flex-col items-center justify-center gap-0.5 transition-all duration-150
                    ${afford(e) ? 'cursor-pointer hover:scale-[1.06] hover:z-10' : 'opacity-45 cursor-not-allowed'}`}
                  style={{
                    borderColor: RARITY_CSS[e.item.rarity],
                    boxShadow: `0 0 10px ${RARITY_CSS[e.item.rarity]}44, inset 0 0 8px ${RARITY_CSS[e.item.rarity]}22`,
                  }}
                  title={afford(e) ? `Comprar ${e.item.name}` : 'Oro insuficiente'}
                >
                  <span className="text-2xl leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]">{e.item.icon}</span>
                  <span className={`text-[11px] font-bold leading-none ${afford(e) ? 'text-amber-300' : 'text-red-400/90'}`}>◈ {e.price}</span>
                  {e.item.rarity === 'epico' || e.item.rarity === 'legendario' ? (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rotate-45" style={{ background: RARITY_CSS[e.item.rarity], boxShadow: `0 0 6px ${RARITY_CSS[e.item.rarity]}` }} />
                  ) : null}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-stone-600">El género se reabastece cada amanecer · Precios según rareza</div>
          </div>

          {/* Vender */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-display">Tu mochila · clic para vender</div>
              <div className="text-[10px] text-stone-600">40% del valor</div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2 bg-black/30 border border-stone-800/70 rounded-lg p-3 min-h-[120px] content-start">
              {shop.bag.length === 0 && (
                <div className="col-span-full text-center text-[12px] text-stone-600 italic py-6">
                  La mochila está vacía… caza algo de botín
                </div>
              )}
              {shop.bag.map((e) => (
                <button
                  key={`sell-${e.index}-${e.item.id}`}
                  onClick={() => g()?.sellBagItem(e.index)}
                  onMouseEnter={() => setHover({ item: e.item, extra: `Te pagan: ${e.sell} ◈`, accent: '#ffc84a' })}
                  onMouseLeave={() => setHover(null)}
                  className="relative rounded-md border-2 border-stone-700/70 bg-stone-950/85 h-20 flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:scale-[1.06] hover:z-10 hover:border-amber-500/70 transition-all duration-150"
                  style={{ borderColor: `${RARITY_CSS[e.item.rarity]}66` }}
                  title={`Vender 1 × ${e.item.name}`}
                >
                  <span className="text-2xl leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]">{e.item.icon}</span>
                  <span className="text-[11px] font-bold leading-none text-amber-300">+◈ {e.sell}</span>
                  {e.item.count > 1 && (
                    <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">×{e.item.count}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-stone-600">Cada clic vende una unidad · El equipo equipado está a salvo</div>
          </div>
        </div>

        {/* Detalle + pie */}
        <div className="px-5 pb-4">
          <div className="bg-black/30 border border-stone-800/70 rounded-lg p-3 min-h-[76px]">
            {hover ? (
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 shrink-0 rounded-md border-2 bg-stone-950/85 flex items-center justify-center text-2xl"
                  style={{ borderColor: RARITY_CSS[hover.item.rarity], boxShadow: `0 0 10px ${RARITY_CSS[hover.item.rarity]}44` }}
                >
                  {hover.item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm tracking-wide" style={{ color: RARITY_CSS[hover.item.rarity] }}>{hover.item.name}</div>
                  <div className="text-[10px] text-stone-500">{KIND_LABEL[hover.item.kind]} · {RARITY_LABEL[hover.item.rarity]}</div>
                  <ItemStatLines item={hover.item} />
                </div>
                <div className="text-sm font-bold shrink-0" style={{ color: hover.accent }}>{hover.extra}</div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-stone-600 italic">
                Pasa el cursor sobre un objeto para ver su precio y detalles
              </div>
            )}
          </div>
          <div className="mt-2 text-[10px] text-stone-600 flex justify-between">
            <span>Esc / ✕ cierra la tienda · El oro cae de tus enemigos</span>
            <span className="hidden sm:inline">Los épicos y legendarios destellan en el género de Ferran</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FORJA DEL HERRERO (Bran)
   ============================================================ */

function SmithPanel({ hud, g, onClose }: { hud: HudState; g: () => Game | null; onClose: () => void }) {
  const [hover, setHover] = useState<{ item: ItemView; extra: string; accent: string } | null>(null);
  const smith = hud.smith;
  const affordUp = smith.upgradeCost !== null && hud.gold >= smith.upgradeCost;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[3px] pointer-events-auto">
      <div className="relative aetheria-frame w-[min(880px,95vw)] max-h-[92vh] bg-[#140d0a]/95 border border-orange-900/50 shadow-[0_0_80px_rgba(0,0,0,0.7)] flex flex-col aetheria-pop">
        <Corners />

        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-orange-900/30">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full border-2 border-orange-600/80 bg-stone-950/90 flex items-center justify-center text-xl shadow-[0_0_12px_rgba(0,0,0,0.8)]">
              ⚒️
            </div>
            <div>
              <h2 className="font-display text-2xl text-orange-200 tracking-[0.18em] uppercase leading-none">
                {smith.name} · Herrero de la Forja
              </h2>
              <div className="text-[11px] text-stone-500 tracking-[0.2em] uppercase mt-1">
                “El acero se mejora golpes a golpes” · Forja encendida día y noche
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-sm font-semibold px-3 py-1.5 rounded border ${hud.gold > 0 ? 'text-amber-300/90 border-amber-800/50 bg-black/40' : 'text-red-300 border-red-900/50 bg-black/40'}`}>
              ◈ {hud.gold}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded border border-stone-700/70 bg-stone-900/80 text-stone-400 hover:text-amber-100 hover:border-amber-600/60 transition-colors text-lg leading-none"
              title="Cerrar (Esc)"
            >✕</button>
          </div>
        </div>

        {/* Cuerpo: mejorar | forjar */}
        <div className="grid md:grid-cols-2 gap-5 p-5 overflow-y-auto aetheria-scroll">
          {/* Mejorar arma equipada */}
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-[0.3em] text-orange-600/80 font-display mb-2">Yunque · Mejorar arma equipada</div>
            <div className="flex-1 bg-black/30 border border-stone-800/70 rounded-lg p-4 flex flex-col gap-3">
              {smith.weapon ? (
                <>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-14 h-14 shrink-0 rounded-md border-2 bg-stone-950/85 flex items-center justify-center text-3xl"
                      style={{ borderColor: RARITY_CSS[smith.weapon.rarity], boxShadow: `0 0 12px ${RARITY_CSS[smith.weapon.rarity]}44` }}
                    >
                      {smith.weapon.icon}
                    </div>
                    <div>
                      <div className="font-display text-base tracking-wide" style={{ color: RARITY_CSS[smith.weapon.rarity] }}>
                        {smith.weapon.name}
                      </div>
                      <div className="text-[11px] text-stone-500">{RARITY_LABEL[smith.weapon.rarity]} · {KIND_LABEL[smith.weapon.kind]}</div>
                      <div className="mt-1 flex items-center gap-1">
                        {Array.from({ length: smith.maxForge }).map((_, i) => (
                          <span
                            key={i}
                            className={`w-3 h-3 rotate-45 border ${i < smith.forgeLevel
                              ? 'bg-orange-400 border-orange-200 shadow-[0_0_6px_rgba(251,146,60,0.9)]'
                              : 'bg-stone-900 border-stone-700'}`}
                          />
                        ))}
                        <span className="ml-2 text-[11px] font-bold text-orange-300">Nv. {smith.forgeLevel}/{smith.maxForge}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[12px] text-emerald-300/90 font-semibold">⚒ {smith.upgradeDesc}</div>
                  <button
                    onClick={() => g()?.upgradeWeapon()}
                    disabled={smith.upgradeCost === null}
                    className={`mt-auto w-full py-3 rounded border-2 font-display tracking-[0.2em] uppercase text-sm transition-all
                      ${smith.upgradeCost !== null
                        ? affordUp
                          ? 'border-orange-500/70 bg-orange-900/30 text-orange-100 hover:bg-orange-700/40 hover:border-orange-400 cursor-pointer'
                          : 'border-stone-700/70 bg-stone-900/60 text-stone-500 cursor-not-allowed'
                        : 'border-stone-800/60 bg-stone-950/60 text-stone-600 cursor-not-allowed'}`}
                  >
                    {smith.upgradeCost !== null ? `⚒ Mejorar · ${smith.upgradeCost} ◈` : 'Al máximo'}
                  </button>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[12px] text-stone-600 italic text-center">
                  No llevas ninguna arma equipada…
                </div>
              )}
            </div>
          </div>

          {/* Forjar armas nuevas */}
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-[0.3em] text-orange-600/80 font-display mb-2">Hornalla · Forjar estilos de combate</div>
            <div className="flex-1 flex flex-col gap-2 bg-black/30 border border-stone-800/70 rounded-lg p-3">
              {smith.catalog.length === 0 && (
                <div className="text-[12px] text-stone-600 italic py-6 text-center">Catálogo no disponible</div>
              )}
              {smith.catalog.map((e, i) => {
                const afford = hud.gold >= e.price;
                return (
                  <button
                    key={`${e.item.id}-${i}`}
                    onClick={() => g()?.buySmithWeapon(i)}
                    onMouseEnter={() => setHover({
                      item: e.item,
                      extra: e.owned ? 'Ya posees un arma de este estilo' : `Precio de forja: ${e.price} ◈`,
                      accent: e.owned ? '#8ef2a6' : (afford ? '#8ef2a6' : '#ff8a7a'),
                    })}
                    onMouseLeave={() => setHover(null)}
                    className={`flex items-center gap-3 p-3 rounded-md border-2 bg-stone-950/85 text-left transition-all duration-150
                      ${e.owned ? 'opacity-55 cursor-default' : afford ? 'cursor-pointer hover:scale-[1.02] hover:border-orange-400/80' : 'opacity-70 cursor-not-allowed'}`}
                    style={{ borderColor: `${RARITY_CSS[e.item.rarity]}88` }}
                  >
                    <div
                      className="w-12 h-12 shrink-0 rounded-md border-2 bg-stone-950/85 flex items-center justify-center text-2xl"
                      style={{ borderColor: RARITY_CSS[e.item.rarity], boxShadow: `0 0 10px ${RARITY_CSS[e.item.rarity]}44` }}
                    >
                      {e.item.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-sm tracking-wide truncate" style={{ color: RARITY_CSS[e.item.rarity] }}>
                        {e.item.name}
                      </div>
                      <div className="text-[10px] text-stone-500 uppercase tracking-wider">
                        {WEAPON_TYPE_LABEL[e.wtype]}
                      </div>
                    </div>
                    {e.owned ? (
                      <span className="text-[11px] font-bold text-emerald-300 shrink-0">✓ ADQUIRIDA</span>
                    ) : (
                      <span className={`text-sm font-bold shrink-0 ${afford ? 'text-amber-300' : 'text-red-400/90'}`}>◈ {e.price}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detalle + pie */}
        <div className="px-5 pb-4">
          <div className="bg-black/30 border border-stone-800/70 rounded-lg p-3 min-h-[64px] flex items-center">
            {hover ? (
              <div className="flex items-center gap-3 w-full">
                <div
                  className="w-10 h-10 shrink-0 rounded-md border-2 bg-stone-950/85 flex items-center justify-center text-xl"
                  style={{ borderColor: RARITY_CSS[hover.item.rarity], boxShadow: `0 0 10px ${RARITY_CSS[hover.item.rarity]}44` }}
                >
                  {hover.item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm tracking-wide" style={{ color: RARITY_CSS[hover.item.rarity] }}>{hover.item.name}</div>
                  <div className="text-[10px] text-stone-500 italic">{hover.item.desc}</div>
                  <ItemStatLines item={hover.item} />
                </div>
                <div className="text-sm font-bold shrink-0" style={{ color: hover.accent }}>{hover.extra}</div>
              </div>
            ) : (
              <div className="w-full text-center text-[12px] text-stone-600 italic">
                Cada arma desbloquea un estilo de combate propio · cámbialas con las teclas 1-4
              </div>
            )}
          </div>
          <div className="mt-2 text-[10px] text-stone-600 flex justify-between">
            <span>Esc / ✕ cierra la forja · La mejora del arma es permanente</span>
            <span className="hidden sm:inline">Las brasas de Bran nunca se apagan</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [loadMsg, setLoadMsg] = useState('Forjando el mundo…');

  /* Arranque: construye el mundo en segundo plano y muestra el
     menú cinemático con la hoguera en vivo detrás del panel. */
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await new Promise(r => setTimeout(r, 250)); // deja pintar el velo de carga
        setLoadMsg('Invocando personajes…');
        // modelos GLB reales (héroe, enemigos, mercader, criaturas, ruinas)
        const chars = await loadCharacterAssets((frac, label) => {
          if (!cancelled) setLoadMsg(`Invocando ${label}… ${Math.round(frac * 100)}%`);
        });
        if (cancelled) return;
        setLoadMsg('Despertando AETHERIA…');
        const mod = await import('@/game/game');
        if (cancelled || !containerRef.current || !minimapRef.current || !vignetteRef.current) return;
        const game = new mod.Game(
          { container: containerRef.current, minimap: minimapRef.current, vignette: vignetteRef.current },
          setHud,
          chars,
        );
        gameRef.current = game;
        (window as unknown as { __game?: Game }).__game = game;
        game.start();
        setBooted(true);
      } catch (err) {
        console.error('[AETHERIA] fallo al arrancar:', err);
        if (!cancelled) setBootError(true);
      }
    };
    void boot();
    return () => { cancelled = true; gameRef.current?.dispose(); gameRef.current = null; };
  }, []);

  const g = () => gameRef.current;
  const startGame = () => {
    if (!booted) return;
    g()?.beginAdventure();
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };
  const inGame = hud.phase !== 'menu';
  const hpFrac = hud.hp / Math.max(1, hud.maxHp);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#05060a] select-none">
      {/* Lienzo del juego */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Viñeta de daño */}
      <div
        ref={vignetteRef}
        className="absolute inset-0 pointer-events-none z-10"
        style={{ opacity: 0, boxShadow: 'inset 0 0 140px 50px rgba(180, 20, 20, 0.75)', transition: 'opacity 80ms linear' }}
      />

      {/* Minimapa (siempre montado para que el ref exista al arrancar) */}
      <canvas
        ref={minimapRef}
        width={168}
        height={168}
        className={`absolute top-4 right-4 z-20 pointer-events-none rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.8)] transition-opacity duration-500 ${
          inGame && hud.phase !== 'menu' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* ============ VELO DE CARGA ============ */}
      {!booted && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#05060a]">
          <div className="w-10 h-10 border-2 border-amber-700/30 border-t-amber-400 rounded-full animate-spin" />
          <div className="mt-5 text-amber-300/90 font-display tracking-[0.35em] text-sm uppercase animate-pulse">
            {bootError ? 'No se pudo forjar el mundo' : loadMsg}
          </div>
          {!bootError && (
            <div className="mt-2 text-[11px] text-stone-600 tracking-widest">Modelos PBR reales · Animaciones Mixamo · Ciclo día/noche</div>
          )}
        </div>
      )}

      {/* ============ HUD DE JUEGO ============ */}
      {booted && inGame && (
        <div className="absolute inset-0 pointer-events-none z-20 font-body">
          {/* Punto de mira */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className={`w-1.5 h-1.5 rounded-full ${hud.lockOn ? 'bg-amber-300 shadow-[0_0_8px_#fcd34d]' : 'bg-white/50'}`} />
          </div>

          {/* Estado del jugador (arriba-izquierda) */}
          <div className="absolute top-4 left-4 w-72 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 shrink-0 rounded-full border-2 border-amber-600/80 bg-stone-950/90 flex items-center justify-center font-display text-amber-200 text-lg shadow-[0_0_12px_rgba(0,0,0,0.8)]">
                {hud.level}
              </div>
              <div className="flex-1 space-y-1.5">
                <Bar value={hud.hp} max={hud.maxHp} className={`bg-gradient-to-r from-rose-900 via-red-600 to-red-400 ${hpFrac < 0.3 ? 'animate-pulse' : ''}`} />
                <Bar value={hud.stamina} max={hud.maxStamina} className="bg-gradient-to-r from-emerald-800 to-emerald-400" height="h-2" />
                <Bar value={hud.xp} max={hud.xpNext} className="bg-gradient-to-r from-amber-700 to-amber-300" height="h-1" />
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-stone-300/90 pl-1" style={{ paddingLeft: '3.25rem' }}>
              <span className="text-amber-300/90 font-semibold">◈ {hud.gold}</span>
              <span>☠ {hud.kills}</span>
              <span className="text-stone-400">{fmtTime(hud.time)}</span>
            </div>
          </div>

          {/* Estado técnico bajo el minimapa */}
          <div className="absolute top-[188px] right-4">
            <div className="text-[10px] text-stone-400 bg-black/40 px-2 py-0.5 rounded">
              {hud.enemiesAlive} enemigos · {hud.fps} FPS · {hud.quality}
            </div>
          </div>

          {/* Medidor de ESTILO (DMC): rango D→SSS + cadena de golpes */}
          <div className={`absolute top-[218px] right-4 w-40 text-right transition-opacity duration-300 ${inGame && hud.phase === 'playing' ? 'opacity-100' : 'opacity-0'}`}>
            <div
              key={hud.styleLetter}
              className="aetheria-style-pop font-gothic leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
              style={{ color: hud.styleCss, fontSize: hud.styleLetter === 'SSS' ? '44px' : '36px', textShadow: `0 0 18px ${hud.styleCss}66, 0 2px 0 rgba(0,0,0,0.85)` }}
            >
              {hud.styleLetter}
            </div>
            <div className="font-display text-[10px] tracking-[0.2em] uppercase -mt-0.5" style={{ color: hud.styleCss }}>
              {hud.styleLabel}
            </div>
            <div className="mt-1 h-1 rounded-full bg-black/60 border border-black/70 overflow-hidden">
              <div
                className="h-full transition-[width] duration-200 ease-out"
                style={{ width: `${Math.round(hud.styleProgress * 100)}%`, background: `linear-gradient(90deg, ${hud.styleCss}55, ${hud.styleCss})`, boxShadow: `0 0 8px ${hud.styleCss}` }}
              />
            </div>
            {hud.comboActive && (
              <div key={hud.comboHits} className="aetheria-style-pop mt-1.5 font-display text-sm font-extrabold text-white/95 tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                {hud.comboHits} <span className="text-[10px] text-stone-300 tracking-[0.25em]">HITS</span>
              </div>
            )}
          </div>

          {/* Objetivo + reloj del mundo (arriba-centro) */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center max-w-md">
            <div
              className={`text-[13px] tracking-[0.18em] uppercase font-display bg-black/45 border rounded px-4 py-1.5 ${
                hud.quest.startsWith('act2')
                  ? 'text-sky-200/95 border-sky-700/50'
                  : 'text-amber-200/90 border-amber-900/40'
              }`}
            >
              {hud.objective}
            </div>
            <div className="mt-2">
              <ClockChip clock={hud.clock} day={hud.dayNum} night={hud.night} />
            </div>
            {/* Progreso: santuarios (acto I) o brasas (acto II) */}
            {hud.quest.startsWith('act2') ? (
              <div className="flex items-center justify-center gap-1.5 mt-2">
                {Array.from({ length: hud.embersRequired }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full border ${
                      i < hud.embers
                        ? 'bg-orange-400 border-orange-200 shadow-[0_0_10px_rgba(255,138,58,0.9)]'
                        : 'bg-stone-900/80 border-orange-900/60'
                    }`}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 mt-2">
                {Array.from({ length: hud.shrinesTotal }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rotate-45 border ${
                      i < hud.shrinesCleansed
                        ? 'bg-teal-400 border-teal-200 shadow-[0_0_8px_rgba(55,216,200,0.8)]'
                        : 'bg-red-900/70 border-red-500/70 shadow-[0_0_6px_rgba(216,50,60,0.5)]'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Aviso de amanecer/anochecer */}
          {hud.notice && (
            <div key={hud.notice + hud.dayNum} className="absolute top-[7.5rem] left-1/2 -translate-x-1/2 aetheria-notice">
              <div className="font-display text-[13px] tracking-[0.22em] uppercase text-amber-100/95 bg-black/55 border-y border-amber-700/50 px-6 py-1.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                {hud.notice}
              </div>
            </div>
          )}

          {/* Barra del jefe */}
          {hud.bossActive && (
            <div className="absolute top-28 left-1/2 -translate-x-1/2 w-[min(560px,70vw)]">
              <div className={`text-center font-gothic tracking-[0.14em] text-2xl mb-1 uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${hud.quest === 'act2_boss' ? 'text-sky-200' : 'text-red-200'}`}>
                {hud.bossName}
                {hud.bossPhase >= 2 && <span className={`ml-3 align-middle text-[11px] font-display animate-pulse tracking-[0.3em] ${hud.quest === 'act2_boss' ? 'text-sky-400' : 'text-red-400'}`}>FASE {hud.bossPhase}</span>}
              </div>
              <Bar
                value={hud.bossHp}
                max={hud.bossMaxHp}
                className={hud.quest === 'act2_boss'
                  ? 'bg-gradient-to-r from-sky-950 via-sky-500 to-cyan-300'
                  : 'bg-gradient-to-r from-red-950 via-red-600 to-red-400'}
                height="h-4"
              />
            </div>
          )}

          {/* Pociones + mochila (abajo-izquierda) */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-red-800/80 bg-stone-950/90 flex items-center justify-center text-red-300 text-lg shadow-[0_0_10px_rgba(0,0,0,0.8)]">
              ⚗
            </div>
            <div className="text-sm text-stone-200">
              <span className="font-bold text-lg">{hud.potions}</span>
              <span className="text-stone-500">/{hud.maxPotions}</span>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">F · Beber</div>
            </div>
            <button
              onClick={() => g()?.toggleInventory()}
              className="pointer-events-auto ml-2 h-10 px-3 rounded border-2 border-amber-800/70 bg-stone-950/90 text-amber-200 text-sm
                hover:bg-amber-900/40 hover:border-amber-500 transition-colors shadow-[0_0_10px_rgba(0,0,0,0.8)] flex items-center gap-2"
              title="Inventario y equipo (I)"
            >
              🎒 <span className="font-display tracking-wider text-xs uppercase">Mochila</span>
              <kbd className="text-[10px] text-stone-500 border border-stone-700 rounded px-1">I</kbd>
            </button>
          </div>

          {/* Barra de armas (cambio rápido 1-4) */}
          {hud.weaponSlots && hud.weaponSlots.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-2">
              {hud.weaponSlots.map((s: WeaponSlotView) => (
                <div
                  key={s.type}
                  className={`w-12 h-12 rounded-md border-2 bg-stone-950/85 flex flex-col items-center justify-center transition-all duration-150
                    ${s.active
                      ? 'border-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.7)] scale-110'
                      : s.owned ? 'border-stone-600/80' : 'border-stone-800/60 opacity-40'}`}
                  title={s.owned ? `${s.name} (${s.label})` : `${s.name} — forja en Bran el Herrero`}
                >
                  <span className="text-lg leading-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]">{s.icon}</span>
                  <span className={`text-[9px] font-bold leading-none mt-0.5 ${s.active ? 'text-amber-200' : 'text-stone-500'}`}>{s.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Prompt de interacción (abajo-centro) */}
          {hud.prompt && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
              <div className="bg-black/70 border border-amber-700/50 text-amber-100 text-sm px-5 py-2 rounded animate-pulse">
                {hud.prompt}
              </div>
            </div>
          )}

          {/* Ayuda de controles (abajo-derecha) */}
          <div className="absolute bottom-4 right-4 text-right text-[10px] leading-relaxed text-stone-500">
            <div>1-4 cambian de arma (espada/arco/alabarda/bastón) · clic izq. combo · clic der. cargado</div>
            <div>Tab objetivo · F poción · E interactuar · Esc pausa · Espacio esquiva-cancel</div>
            <div>Ferran comercia junto a la hoguera · Bran forja y mejora armas · ¡encadena para subir el ESTILO!</div>
          </div>
        </div>
      )}

      {/* ============ INVENTARIO / EQUIPO ============ */}
      {booted && hud.inv?.open && (
        <InventoryPanel hud={hud} g={g} onClose={() => g()?.toggleInventory()} />
      )}

      {/* ============ TIENDA DEL MERCADER ============ */}
      {booted && hud.shop?.open && (
        <MerchantPanel hud={hud} g={g} onClose={() => g()?.closeShop()} />
      )}

      {/* ============ FORJA DEL HERRERO ============ */}
      {booted && hud.smith?.open && (
        <SmithPanel hud={hud} g={g} onClose={() => g()?.closeSmith()} />
      )}

      {/* ============ MENÚ PRINCIPAL (mundo en vivo detrás) ============ */}
      {booted && hud.phase === 'menu' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(2,3,8,0.18)_0%,rgba(2,3,8,0.62)_62%,rgba(2,3,8,0.88)_100%)]">
          <div className="max-w-2xl w-full px-5 text-center max-h-[96vh] overflow-y-auto aetheria-scroll">
            <div className="relative aetheria-frame backdrop-blur-[3px] bg-black/50 border border-amber-900/40 px-6 sm:px-9 py-7 shadow-[0_0_70px_rgba(0,0,0,0.55)]">
              <Corners />
              <div className="font-display text-amber-600/80 tracking-[0.5em] text-[11px] uppercase mb-3">Un Action RPG de mundo abierto</div>
              <h1 className="font-logo text-5xl md:text-6xl aetheria-logo tracking-[0.08em]">
                AETHERIA
              </h1>
              <div className="font-display text-stone-400 tracking-[0.34em] text-sm mt-2 uppercase">Eco del Reino Caído</div>

              <div className="flex items-center justify-center gap-3 my-5">
                <span className="h-px w-16 bg-gradient-to-r from-transparent to-amber-700/60" />
                <span className="w-1.5 h-1.5 rotate-45 bg-amber-600/70" />
                <span className="h-px w-16 bg-gradient-to-l from-transparent to-amber-700/60" />
              </div>

              <p className="font-body text-stone-400 text-[13.5px] leading-relaxed max-w-lg mx-auto">
                La luna sangra sobre las ruinas de Aetheria. Tres santuarios corruptos alimentan
                la fuerza de <span className="text-red-300">Bel&apos;Zaroth</span>, el Señor Caído.
                Purifícalos, crece en poder y derriba al señor de la noche en su arena.
              </p>
              <p className="font-body text-amber-200/70 text-[12px] leading-relaxed max-w-lg mx-auto mt-2">
                Comercia con <span className="text-amber-300">Ferran el Mercader</span> y forja armas nuevas con{' '}
                <span className="text-orange-300">Bran el Herrero</span> (espada, arco, alabarda y bastón de hechizos) ·
                Los enemigos reaparecen en sus puestos con el tiempo, como en los MMORPG
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-7 text-[11px]">
                {CONTROLS.map(([k, v]) => (
                  <div key={k} className="flex flex-col items-center gap-0.5">
                    <kbd className="px-2 py-1 border border-stone-700 rounded bg-stone-900/90 text-amber-200/90 font-mono">{k}</kbd>
                    <span className="text-stone-500">{v}</span>
                  </div>
                ))}
              </div>

              {/* Calidad + pantalla completa */}
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <div className="flex items-center border border-stone-700/70 bg-stone-950/70 overflow-hidden">
                  <span className="px-3 text-[10px] uppercase tracking-widest text-stone-500 border-r border-stone-800 py-2">Gfx</span>
                  {QUALITIES.map(q => (
                    <button
                      key={q.id}
                      onClick={() => g()?.setQuality(q.id)}
                      className={`px-3.5 py-2 text-[11px] tracking-widest uppercase transition-colors ${
                        hud.quality === q.id
                          ? 'bg-amber-900/50 text-amber-200'
                          : 'text-stone-400 hover:bg-stone-800/80 hover:text-amber-100'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                <MenuButton small onClick={toggleFullscreen}>⛶ &nbsp;Pantalla completa</MenuButton>
              </div>

              <div className="mt-7">
                <MenuButton primary onClick={startGame}>⚔ &nbsp;Comenzar la aventura</MenuButton>
              </div>
              <div className="mt-3 text-[11px] text-amber-200/60 font-display tracking-[0.18em] uppercase">
                El ciclo día y noche comienza al alba · La noche acelera a tus enemigos
              </div>
              <div className="mt-4 text-[10px] text-stone-600 leading-relaxed">
                Arte: ambientCG · Poly Haven · Quaternius Ultimate Monsters (CC0) · Ready Player Me (uso con avatar RPM) · Sonido: Kenney · Little Robot Sound Factory (CC-BY 3.0) · Cleyton Kauffman · Fuentes: Google Fonts (OFL)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ PAUSA ============ */}
      {hud.phase === 'paused' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-[2px]">
          <div className="text-center max-w-lg w-full px-6">
            <h2 className="font-display text-4xl text-amber-100 tracking-[0.25em] mb-6">PAUSA</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-stone-400 mb-8 max-w-sm mx-auto">
              {CONTROLS.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-stone-800/70 pb-1">
                  <span className="text-amber-200/80 font-mono">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 justify-center">
              <MenuButton primary onClick={() => g()?.resume()}>Reanudar</MenuButton>
              <MenuButton onClick={() => g()?.restart()}>Reiniciar</MenuButton>
            </div>
            <div className="mt-8 text-[10px] text-stone-600">
              Día {hud.dayNum} · {hud.clock} · {hud.night ? 'Noche' : 'Día'} en Aetheria
            </div>
          </div>
        </div>
      )}

      {/* ============ MUERTE ============ */}
      {hud.phase === 'dead' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-red-950/60 via-black/90 to-black/95">
          <div className="text-center px-6">
            <h2 className="font-gothic text-7xl text-red-500 tracking-[0.12em] drop-shadow-[0_0_40px_rgba(220,38,38,0.5)] animate-pulse">
              HAS CAÍDO
            </h2>
            <p className="text-stone-400 mt-4 text-sm italic">La hoguera aún arde por ti, guerrero…</p>
            <div className="flex gap-6 justify-center mt-8 text-sm text-stone-300">
              <span>Nivel <b className="text-amber-300">{hud.level}</b></span>
              <span>Bajas <b className="text-amber-300">{hud.kills}</b></span>
              <span>Oro <b className="text-amber-300">{hud.gold}</b></span>
              <span>Tiempo <b className="text-amber-300">{fmtTime(hud.time)}</b></span>
            </div>
            <div className="mt-8">
              <MenuButton primary onClick={() => g()?.respawn()}>🔥 &nbsp;Reaparecer en la hoguera</MenuButton>
            </div>
          </div>
        </div>
      )}

      {/* ============ VICTORIA ============ */}
      {hud.phase === 'victory' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-amber-950/50 via-black/90 to-black/95">
          <div className="text-center px-6 max-w-xl">
            <div className="text-amber-500/80 tracking-[0.4em] text-xs uppercase mb-3">El Caballero Caído ha sido derrotado</div>
            <h2 className="font-display text-5xl text-amber-200 tracking-[0.15em] drop-shadow-[0_0_40px_rgba(245,180,80,0.35)]">
              EL REINO RESPIRA
            </h2>
            <p className="text-stone-400 mt-5 text-sm leading-relaxed">
              Los santuarios brillan de nuevo con luz esmeralda. Pero la noche es larga…
              el sigilo de la arena puede despertar a Bel&apos;Zaroth una y otra vez, cada vez más fuerte.
            </p>
            <div className="flex gap-6 justify-center mt-8 text-sm text-stone-300">
              <span>Nivel <b className="text-amber-300">{hud.level}</b></span>
              <span>Bajas <b className="text-amber-300">{hud.kills}</b></span>
              <span>Oro <b className="text-amber-300">{hud.gold}</b></span>
              <span>Tiempo <b className="text-amber-300">{fmtTime(hud.time)}</b></span>
            </div>
            <div className="flex gap-4 justify-center mt-8">
              <MenuButton primary onClick={() => g()?.continueEndless()}>Continuar (modo infinito)</MenuButton>
              <MenuButton onClick={() => g()?.restart()}>Nueva partida</MenuButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
