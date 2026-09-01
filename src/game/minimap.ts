import * as THREE from 'three';
import { WORLD, clamp } from './core';

/* ============================================================
   MINIMAPA: dibuja el mundo en un canvas 2D
   ============================================================ */

export interface MinimapEntity {
  x: number; z: number; kind: 'goblin' | 'archer' | 'orc' | 'boss';
}

export function drawMinimap(
  canvas: HTMLCanvasElement,
  playerPos: THREE.Vector3,
  playerYaw: number,
  enemies: MinimapEntity[],
  shrines: { x: number; z: number; cleansed: boolean }[],
  bossActive: boolean,
  victory: boolean,
  merchant?: { x: number; z: number },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const S = canvas.width;
  const half = S / 2;
  const scale = half / 105; // mundo radio ~100

  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half - 2, 0, Math.PI * 2);
  ctx.clip();

  // fondo
  const g = ctx.createRadialGradient(half, half, 10, half, half, half);
  g.addColorStop(0, '#1c2418');
  g.addColorStop(1, '#0d120c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const toMap = (wx: number, wz: number): [number, number] => {
    return [half + wx * scale, half + wz * scale];
  };

  // límite del mundo
  ctx.strokeStyle = 'rgba(180, 190, 210, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(half, half, WORLD.radius * scale, 0, Math.PI * 2);
  ctx.stroke();

  // arena
  const [ax, az] = toMap(WORLD.arena.x, WORLD.arena.z);
  ctx.strokeStyle = bossActive || victory ? 'rgba(255, 80, 60, 0.8)' : 'rgba(255, 140, 60, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ax, az, WORLD.arena.r * scale, 0, Math.PI * 2);
  ctx.stroke();

  // hoguera
  const [bx, bz] = toMap(WORLD.bonfire.x, WORLD.bonfire.z);
  ctx.fillStyle = '#ffb347';
  ctx.beginPath();
  ctx.arc(bx, bz, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a2c10';
  ctx.lineWidth = 1;
  ctx.stroke();

  // santuarios (rombos)
  for (const s of shrines) {
    const [sx, sz] = toMap(s.x, s.z);
    ctx.save();
    ctx.translate(sx, sz);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = s.cleansed ? '#37d8c8' : '#d8323c';
    ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
    ctx.strokeStyle = s.cleansed ? '#a8fff4' : '#ff8a8a';
    ctx.lineWidth = 1;
    ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
    ctx.restore();
  }

  // mercader (rombo dorado)
  if (merchant) {
    const [mx, mz] = toMap(merchant.x, merchant.z);
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffc84a';
    ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
    ctx.strokeStyle = '#5a3c10';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2.6, -2.6, 5.2, 5.2);
    ctx.restore();
  }

  // enemigos
  for (const e of enemies) {
    const [ex, ez] = toMap(e.x, e.z);
    if (e.kind === 'boss') {
      ctx.fillStyle = '#ff2211';
      ctx.beginPath();
      ctx.moveTo(ex, ez - 6); ctx.lineTo(ex + 5, ez + 4); ctx.lineTo(ex - 5, ez + 4);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    const colors: Record<string, string> = { goblin: '#7ba33e', archer: '#d8d3c0', orc: '#9a5641' };
    ctx.fillStyle = colors[e.kind] ?? '#fff';
    ctx.beginPath();
    ctx.arc(ex, ez, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // jugador (flecha orientada)
  const [px, pz] = toMap(playerPos.x, playerPos.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-playerYaw + Math.PI);
  ctx.fillStyle = '#f5e8c8';
  ctx.strokeStyle = '#1a1208';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(4.6, 5);
  ctx.lineTo(0, 2.6);
  ctx.lineTo(-4.6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  // borde
  ctx.strokeStyle = 'rgba(212, 175, 106, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(half, half, half - 2, 0, Math.PI * 2);
  ctx.stroke();
}

export function clampMinimap() { void clamp; }
