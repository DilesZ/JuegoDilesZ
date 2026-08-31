'use client';

import { useEffect, useRef, useState } from 'react';
import type { HudState } from '@/game/core';
import type { Game } from '@/game/game';

/* ============================================================
   AETHERIA — Eco del Reino Caído · Action RPG 3D
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

function MenuButton({ onClick, children, primary = false }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-8 py-3 min-h-[44px] font-serif tracking-[0.2em] uppercase text-sm border transition-all duration-200
        ${primary
          ? 'border-amber-500/70 bg-amber-900/30 text-amber-100 hover:bg-amber-700/40 hover:border-amber-400 hover:shadow-[0_0_24px_rgba(245,180,80,0.25)]'
          : 'border-stone-600/60 bg-stone-900/70 text-stone-300 hover:bg-stone-800 hover:text-amber-100'}`}
    >
      {children}
    </button>
  );
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Moverse'],
  ['Ratón', 'Cámara'],
  ['Clic izq.', 'Ataque ligero (combo ×3)'],
  ['Clic der.', 'Ataque cargado'],
  ['Espacio', 'Esquiva rodando (invulnerable)'],
  ['Tab', 'Fijar objetivo'],
  ['F', 'Beber poción'],
  ['E', 'Interactuar'],
  ['Shift', 'Esprintar'],
  ['Esc', 'Pausa'],
];

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const startingRef = useRef(false);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [booting, setBooting] = useState(false);
  const [booted, setBooted] = useState(false);

  const startGame = async () => {
    if (startingRef.current || gameRef.current) return;
    startingRef.current = true;
    setBooting(true);
    try {
      const mod = await import('@/game/game');
      if (!containerRef.current || !minimapRef.current || !vignetteRef.current) {
        console.log('[AETHERIA] refs ausentes');
        startingRef.current = false;
        setBooting(false);
        return;
      }
      const game = new mod.Game(
        { container: containerRef.current, minimap: minimapRef.current, vignette: vignetteRef.current },
        setHud,
      );
      gameRef.current = game;
      (window as unknown as { __game?: Game }).__game = game; // utilidad de depuración
      game.audio.unlock();
      game.audio.startMusic();
      game.start();
      game.requestLock();
      setBooted(true);
    } catch (err) {
      console.error('[AETHERIA] fallo al arrancar:', err);
      startingRef.current = false;
      setBooting(false);
    }
  };

  useEffect(() => {
    return () => { gameRef.current?.dispose(); gameRef.current = null; };
  }, []);

  const g = () => gameRef.current;
  const inGame = hud.phase !== 'menu' || booted;
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

      {/* ============ HUD DE JUEGO ============ */}
      {inGame && hud.phase !== 'menu' && (
        <div className="absolute inset-0 pointer-events-none z-20 font-sans">
          {/* Punto de mira */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className={`w-1.5 h-1.5 rounded-full ${hud.lockOn ? 'bg-amber-300 shadow-[0_0_8px_#fcd34d]' : 'bg-white/50'}`} />
          </div>

          {/* Estado del jugador (arriba-izquierda) */}
          <div className="absolute top-4 left-4 w-72 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 shrink-0 rounded-full border-2 border-amber-600/80 bg-stone-950/90 flex items-center justify-center font-serif text-amber-200 text-lg shadow-[0_0_12px_rgba(0,0,0,0.8)]">
                {hud.level}
              </div>
              <div className="flex-1 space-y-1.5">
                <Bar value={hud.hp} max={hud.maxHp} className={`bg-gradient-to-r from-red-800 to-red-500 ${hpFrac < 0.3 ? 'animate-pulse' : ''}`} />
                <Bar value={hud.stamina} max={hud.maxStamina} className="bg-gradient-to-r from-emerald-800 to-emerald-400" height="h-2" />
                <Bar value={hud.xp} max={hud.xpNext} className="bg-gradient-to-r from-amber-700 to-amber-300" height="h-1" />
              </div>
            </div>
            <div className="flex items-center gap-4 pl-13 text-xs text-stone-300/90 pl-1" style={{ paddingLeft: '3.25rem' }}>
              <span className="text-amber-300/90 font-semibold">◈ {hud.gold}</span>
              <span>☠ {hud.kills}</span>
              <span className="text-stone-400">{fmtTime(hud.time)}</span>
            </div>
          </div>

          {/* Minimapa: etiqueta (el canvas vive fuera de este bloque) */}
          <div className="absolute top-[188px] right-4">
            <div className="text-[10px] text-stone-400 bg-black/40 px-2 py-0.5 rounded">
              {hud.enemiesAlive} enemigos · {hud.fps} FPS
            </div>
          </div>

          {/* Objetivo (arriba-centro) */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center max-w-md">
            <div className="text-[13px] tracking-[0.18em] uppercase text-amber-200/90 font-serif bg-black/45 border border-amber-900/40 rounded px-4 py-1.5">
              {hud.objective}
            </div>
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
          </div>

          {/* Barra del jefe */}
          {hud.bossActive && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[min(560px,70vw)]">
              <div className="text-center font-serif tracking-[0.25em] text-red-200 text-sm mb-1 uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                {hud.bossName}
                {hud.bossPhase >= 2 && <span className="ml-2 text-red-400 animate-pulse">Fase {hud.bossPhase}</span>}
              </div>
              <Bar value={hud.bossHp} max={hud.bossMaxHp} className="bg-gradient-to-r from-red-950 via-red-600 to-red-400" height="h-4" />
            </div>
          )}

          {/* Pociones (abajo-izquierda) */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2">
            <div className="w-10 h-10 rounded-full border-2 border-red-800/80 bg-stone-950/90 flex items-center justify-center text-red-300 text-lg shadow-[0_0_10px_rgba(0,0,0,0.8)]">
              ⚗
            </div>
            <div className="text-sm text-stone-200">
              <span className="font-bold text-lg">{hud.potions}</span>
              <span className="text-stone-500">/{hud.maxPotions}</span>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">F · Beber</div>
            </div>
          </div>

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
            <div>Clic izq. atacar · Clic der. cargado · Espacio esquivar</div>
            <div>Tab objetivo · F poción · E interactuar · Esc pausa</div>
          </div>
        </div>
      )}

      {/* ============ MENÚ PRINCIPAL ============ */}
      {hud.phase === 'menu' && !booted && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-black/95 via-black/85 to-black/95">
          <div className="max-w-2xl w-full px-6 text-center">
            <div className="text-amber-600/80 tracking-[0.5em] text-xs uppercase mb-3">Un Action RPG de mundo abierto</div>
            <h1 className="font-serif text-5xl md:text-6xl text-amber-100 tracking-[0.12em] drop-shadow-[0_0_30px_rgba(245,180,80,0.25)]">
              AETHERIA
            </h1>
            <div className="font-serif text-stone-400 tracking-[0.3em] text-sm mt-2 uppercase">Eco del Reino Caído</div>
            <p className="text-stone-400 text-sm leading-relaxed mt-6 max-w-lg mx-auto">
              La luna sangra sobre las ruinas de Aetheria. Tres santuarios corruptos alimentan
              la fuerza de <span className="text-red-300">Bel&apos;Zaroth</span>, el Caballero Caído.
              Purifícalos, crece en poder y derriba al señor de la noche en su arena.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 mt-8 text-[11px]">
              {CONTROLS.map(([k, v]) => (
                <div key={k} className="flex flex-col items-center gap-0.5">
                  <kbd className="px-2 py-1 border border-stone-700 rounded bg-stone-900 text-amber-200/90 font-mono">{k}</kbd>
                  <span className="text-stone-500">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-9">
              {booting ? (
                <div className="text-amber-300 animate-pulse font-serif tracking-widest">FORJANDO EL MUNDO…</div>
              ) : (
                <MenuButton primary onClick={startGame}>⚔ &nbsp;Comenzar la aventura</MenuButton>
              )}
            </div>
            <div className="mt-4 text-[11px] text-stone-600">
              Se recomienda teclado y ratón · El cursor se bloqueará al comenzar
            </div>
          </div>
        </div>
      )}

      {/* ============ PAUSA ============ */}
      {hud.phase === 'paused' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-[2px]">
          <div className="text-center max-w-lg w-full px-6">
            <h2 className="font-serif text-4xl text-amber-100 tracking-[0.25em] mb-6">PAUSA</h2>
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
          </div>
        </div>
      )}

      {/* ============ MUERTE ============ */}
      {hud.phase === 'dead' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-red-950/60 via-black/90 to-black/95">
          <div className="text-center px-6">
            <h2 className="font-serif text-6xl text-red-500 tracking-[0.2em] drop-shadow-[0_0_40px_rgba(220,38,38,0.5)] animate-pulse">
              HAS CAÍDO
            </h2>
            <p className="text-stone-400 mt-4 text-sm italic">La hoguera aún arde por ti, caballero…</p>
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
            <h2 className="font-serif text-5xl text-amber-200 tracking-[0.15em] drop-shadow-[0_0_40px_rgba(245,180,80,0.35)]">
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
