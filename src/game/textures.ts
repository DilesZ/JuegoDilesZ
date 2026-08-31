import * as THREE from 'three';
import { fbm, mulberry32, WORLD } from './core';

/* ============================================================
   TEXTURAS PROCEDURALES PBR (canvas)
   Todas se generan una vez y se cachean. Color en sRGB,
   normales en lineal. Dan el salto visual de "flat low-poly"
   a "estilizado AAA" sin descargar ningún asset externo.
   ============================================================ */

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

/** Genera un normal map a partir de un campo de altura */
function normalFromHeight(height: Float32Array, size: number, strength = 2): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = inv * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/* ---------- Terreno: splat pintado con senderos ---------- */

export const WORLD_TEX_SIZE = 200;

/**
 * Textura grande de color para el terreno: césped pictórico, parches de
 * tierra, roca en altura y senderos de grava que conectan hoguera,
 * santuarios y arena.
 */
export function terrainSplat(): THREE.CanvasTexture {
  if (cache.has('splat')) return cache.get('splat')!;
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const px = S / WORLD_TEX_SIZE; // píxeles por unidad de mundo
  const rng = mulberry32(4242);

  const grassA = [46, 62, 34], grassB = [66, 88, 44], grassDry = [92, 96, 48];
  const dirt = [74, 58, 38], dirtDark = [56, 44, 30];
  const rock = [86, 88, 98], rockDark = [64, 66, 76];

  // 1) base pictórica por celdas con ruido
  const cell = 7;
  for (let cy = 0; cy < S; cy += cell) {
    for (let cx = 0; cx < S; cx += cell) {
      const wx = (cx / S) * WORLD_TEX_SIZE - 100;
      const wz = (cy / S) * WORLD_TEX_SIZE - 100;
      const n = fbm(wx * 0.06, wz * 0.06, 3) * 0.5 + 0.5;
      const n2 = fbm(wx * 0.21 + 40, wz * 0.21 - 17, 2) * 0.5 + 0.5;
      let r: number, g: number, b: number;
      const mix01 = (a: number[], bb: number[], t: number) => [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t];
      let col = mix01(grassA, grassB, n);
      if (n > 0.62) col = mix01(col, grassDry, (n - 0.62) * 2.2);
      const jitter = (rng() - 0.5) * 14;
      r = col[0] + jitter; g = col[1] + jitter * 1.2; b = col[2] + jitter * 0.7;
      // altura del mundo → roca en el borde montañoso
      const rr = Math.hypot(wx, wz);
      if (rr > 78) {
        const t = Math.min(1, (rr - 78) / 16);
        const rc = n2 > 0.5 ? rock : rockDark;
        r = r + (rc[0] - r) * t; g = g + (rc[1] - g) * t; b = b + (rc[2] - b) * t;
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(cx, cy, cell, cell);
    }
  }

  // 2) parches de tierra irregulares
  for (let i = 0; i < 130; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 6 + rng() * (72 - 6);
    const wx = Math.cos(a) * rad, wz = Math.sin(a) * rad;
    if (fbm(wx * 0.09 + 7, wz * 0.09 + 3, 2) < 0.18) continue;
    const x = (wx + 100) * px, y = (wz + 100) * px;
    const R = (2 + rng() * 5) * px;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    const dc = rng() > 0.5 ? dirt : dirtDark;
    g.addColorStop(0, `rgba(${dc[0]},${dc[1]},${dc[2]},0.55)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  }

  // 3) senderos: hoguera → santuarios/arena, con bordes suaves y grava
  const W = WORLD;
  const drawPath = (x1: number, z1: number, x2: number, z2: number, wUnits: number) => {
    const mx = (x1 + x2) / 2 + (z2 - z1) * 0.18;
    const mz = (z1 + z2) / 2 - (x2 - x1) * 0.18;
    const p = new Path2D();
    p.moveTo((x1 + 100) * px, (z1 + 100) * px);
    p.quadraticCurveTo((mx + 100) * px, (mz + 100) * px, (x2 + 100) * px, (z2 + 100) * px);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,24,16,0.35)';
    ctx.lineWidth = wUnits * px * 1.7;
    ctx.stroke(p);
    ctx.strokeStyle = 'rgba(88,70,46,0.85)';
    ctx.lineWidth = wUnits * px;
    ctx.stroke(p);
    ctx.strokeStyle = 'rgba(112,92,62,0.5)';
    ctx.lineWidth = wUnits * px * 0.45;
    ctx.stroke(p);
    // piedritas sueltas
    const steps = Math.hypot(x2 - x1, z2 - z1) * 2.2;
    for (let i = 0; i < steps; i++) {
      const t = rng();
      const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
      const bz = (1 - t) * (1 - t) * z1 + 2 * (1 - t) * t * mz + t * t * z2;
      const ox = (rng() - 0.5) * wUnits * 1.1, oz = (rng() - 0.5) * wUnits * 1.1;
      const shade = 90 + rng() * 60;
      ctx.fillStyle = `rgba(${shade},${shade * 0.94},${shade * 0.85},${0.35 + rng() * 0.4})`;
      ctx.beginPath();
      ctx.arc((bx + ox + 100) * px, (bz + oz + 100) * px, (0.05 + rng() * 0.12) * px, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  for (const s of W.shrines) drawPath(W.bonfire.x, W.bonfire.z, s.x, s.z, 2.1);
  drawPath(W.bonfire.x, W.bonfire.z, W.arena.x, W.arena.z - W.arena.r, 2.6);

  // 4) desgaste alrededor de hoguera y santuarios
  for (const p of [W.bonfire, ...W.shrines, { x: W.arena.x, z: W.arena.z }]) {
    const x = (p.x + 100) * px, y = (p.z + 100) * px;
    const R = 26;
    const g = ctx.createRadialGradient(x, y, 4, x, y, R);
    g.addColorStop(0, 'rgba(70,56,38,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  }

  const t = toTexture(c, true, false);
  cache.set('splat', t);
  return t;
}

/** Mapa de normales de detalle en mosaico para el terreno */
export function terrainDetailNormal(): THREE.CanvasTexture {
  if (cache.has('terrainN')) return cache.get('terrainN')!;
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S * 14, v = y / S * 14;
      h[y * S + x] = fbm(u, v, 4) * 0.5 + fbm(u * 3.7 + 11, v * 3.7 - 5, 2) * 0.25;
    }
  }
  const t = normalFromHeight(h, S, 1.6);
  t.repeat.set(40, 40);
  cache.set('terrainN', t);
  return t;
}

/* ---------- Materiales de props ---------- */

/** Corteza de pino: vetas verticales + normal */
export function barkMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const key = 'bark';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: cache.get(key + 'N')! };
  const W = 128, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(0, 0, W, H);
  const rng = mulberry32(313);
  for (let i = 0; i < 90; i++) {
    const x = rng() * W;
    const w = 2 + rng() * 7;
    const shade = 30 + rng() * 50;
    ctx.fillStyle = `rgba(${shade + 30},${shade + 16},${shade},${0.25 + rng() * 0.3})`;
    ctx.fillRect(x, 0, w, H);
  }
  // nudos
  for (let i = 0; i < 7; i++) {
    const x = rng() * W, y = rng() * H, r = 3 + rng() * 6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(30,20,12,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // altura para normal
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W * 10, v = y / H * 20;
    h[y * W + x] = fbm(u, v, 3) * 0.6 + fbm(u * 6, v * 6, 2) * 0.3;
  }
  const map = toTexture(c, true);
  const nT = normalFromHeight(h, W, 2.2);
  cache.set(key, map); cache.set(key + 'N', nT);
  return { map, normalMap: nT };
}

/** Metal forjado: base gris con arañazos + mapa de rugosidad + normal */
export function metalMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const key = 'metal';
  if (cache.has(key)) {
    return { map: cache.get(key)!, normalMap: cache.get(key + 'N')!, roughnessMap: cache.get(key + 'R')! };
  }
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#9aa2ac';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(777);
  // cepillado horizontal
  for (let i = 0; i < 260; i++) {
    const y = rng() * S;
    const shade = 120 + rng() * 90;
    ctx.strokeStyle = `rgba(${shade},${shade + 4},${shade + 10},${0.06 + rng() * 0.1})`;
    ctx.lineWidth = 0.6 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y + (rng() - 0.5) * 6);
    ctx.stroke();
  }
  // arañazos brillantes
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S;
    const len = 6 + rng() * 30, a = rng() * Math.PI;
    ctx.strokeStyle = `rgba(228,232,240,${0.12 + rng() * 0.2})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // manchas de temple
  for (let i = 0; i < 16; i++) {
    const x = rng() * S, y = rng() * S, r = 14 + rng() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dk = rng() > 0.5;
    g.addColorStop(0, dk ? 'rgba(70,74,84,0.28)' : 'rgba(210,216,226,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const h = new Float32Array(S * S);
  for (let i = 0; i < 240; i++) {
    const y = (rng() * S) | 0;
    const amp = (rng() - 0.5) * 0.5;
    for (let x = 0; x < S; x++) h[y * S + x] += amp;
  }
  for (let i = 0; i < 50; i++) {
    const x = (rng() * S) | 0, y = (rng() * S) | 0, len = 6 + rng() * 30;
    for (let k = 0; k < len; k++) {
      const xx = (x + k) % S, yy = (y + ((k * (rng() > 0.5 ? 1 : 0)) | 0)) % S;
      h[yy * S + xx] += 0.5;
    }
  }
  const map = toTexture(c, true);
  const normalMap = normalFromHeight(h, S, 1.2);
  // rugosidad: base 0.45 con variación
  const [rc, rctx] = makeCanvas(S, S);
  rctx.fillStyle = '#787878';
  rctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) {
    const v = (110 + rng() * 90) | 0;
    rctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    rctx.fillRect(rng() * S, rng() * S, 2 + rng() * 20, 1 + rng() * 4);
  }
  const roughnessMap = toTexture(rc, false);
  cache.set(key, map); cache.set(key + 'N', normalMap); cache.set(key + 'R', roughnessMap);
  return { map, normalMap, roughnessMap };
}

/** Piedra tallada para ruinas: blotches + grietas + normal */
export function stoneMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const key = 'stone';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: cache.get(key + 'N')! };
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#6a6a74';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(909);
  for (let i = 0; i < 900; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 16;
    const v = (86 + rng() * 60) | 0;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v + 8},${0.10 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // grietas (caminatas aleatorias oscuras)
  for (let i = 0; i < 14; i++) {
    let x = rng() * S, y = rng() * S;
    ctx.strokeStyle = 'rgba(28,28,34,0.5)';
    ctx.lineWidth = 0.8 + rng() * 1.2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 26; k++) {
      x += (rng() - 0.5) * 22; y += (rng() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // musgo tenue
  for (let i = 0; i < 60; i++) {
    const x = rng() * S, y = rng() * S, r = 3 + rng() * 10;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(70,96,52,${0.10 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    h[y * S + x] = fbm(x / S * 9, y / S * 9, 4) * 0.7 + fbm(x / S * 22 + 5, y / S * 22, 2) * 0.3;
  }
  const map = toTexture(c, true);
  const normalMap = normalFromHeight(h, S, 2.4);
  cache.set(key, map); cache.set(key + 'N', normalMap);
  return { map, normalMap };
}

/** Madera con vetas para mangos/troncos de hoguera */
export function woodMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const key = 'wood';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: cache.get(key + 'N')! };
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#5b4226';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(202);
  for (let i = 0; i < 60; i++) {
    const y = rng() * S;
    const v = 40 + rng() * 55;
    ctx.strokeStyle = `rgba(${v + 30},${v + 8},${v - 18},${0.2 + rng() * 0.3})`;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + (rng() - 0.5) * 8, S * 0.7, y + (rng() - 0.5) * 8, S, y + (rng() - 0.5) * 4);
    ctx.stroke();
  }
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    h[y * S + x] = fbm(x / S * 4, y / S * 16, 3);
  }
  const map = toTexture(c, true);
  const normalMap = normalFromHeight(h, S, 1.8);
  cache.set(key, map); cache.set(key + 'N', normalMap);
  return { map, normalMap };
}

/** Hoja de hierba con alpha (para matas instanciadas) */
export function grassBladeTexture(): THREE.CanvasTexture {
  if (cache.has('blade')) return cache.get('blade')!;
  const W = 64, H = 64;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, '#2c4018');
  g.addColorStop(0.55, '#4a6a2a');
  g.addColorStop(1, '#7a9a46');
  ctx.fillStyle = g;
  // hoja curvada
  ctx.beginPath();
  ctx.moveTo(W * 0.5 - 9, H);
  ctx.quadraticCurveTo(W * 0.5 - 5, H * 0.45, W * 0.5 - 1, 2);
  ctx.quadraticCurveTo(W * 0.5 + 1, 0, W * 0.5 + 2, 3);
  ctx.quadraticCurveTo(W * 0.5 + 6, H * 0.5, W * 0.5 + 9, H);
  ctx.closePath();
  ctx.fill();
  const t = toTexture(c, true, false);
  cache.set('blade', t);
  return t;
}

/* ---------- Sprites y efectos ---------- */

/** Sprite radial suave para partículas */
export function softSprite(): THREE.CanvasTexture {
  if (cache.has('soft')) return cache.get('soft')!;
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = toTexture(c, false, false);
  cache.set('soft', t);
  return t;
}

/** Halo suave grande (luna, glorias) */
export function glowSprite(): THREE.CanvasTexture {
  if (cache.has('glow')) return cache.get('glow')!;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = toTexture(c, false, false);
  cache.set('glow', t);
  return t;
}

/** Alfa blotchy para planos de niebla a ras de suelo */
export function mistTexture(): THREE.CanvasTexture {
  if (cache.has('mist')) return cache.get('mist')!;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let a = fbm(u * 6, v * 6, 4) * 0.5 + 0.5;
      a *= smoothEdge(u) * smoothEdge(v);
      a = Math.max(0, a - 0.28) * 1.5;
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, false, false);
  cache.set('mist', t);
  return t;
}
function smoothEdge(x: number) {
  const e = Math.min(x, 1 - x) * 6;
  return Math.min(1, Math.max(0, e));
}

/** Superficie lunar con mares y cráteres */
export function moonTexture(): THREE.CanvasTexture {
  if (cache.has('moon')) return cache.get('moon')!;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#dfe6f4';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(1111);
  // mares
  for (let i = 0; i < 9; i++) {
    const x = rng() * S, y = rng() * S, r = 22 + rng() * 48;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(148,158,180,0.5)');
    g.addColorStop(1, 'rgba(148,158,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // cráteres
  for (let i = 0; i < 60; i++) {
    const x = rng() * S, y = rng() * S, r = 2 + rng() * 9;
    ctx.fillStyle = 'rgba(170,178,196,0.7)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,244,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.85, 0, Math.PI * 2); ctx.stroke();
  }
  const t = toTexture(c, true, false);
  cache.set('moon', t);
  return t;
}

/** Normal de agua ondulada (dos capas con scroll) */
export function waterNormal(): THREE.CanvasTexture {
  if (cache.has('waterN')) return cache.get('waterN')!;
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      h[y * S + x] =
        Math.sin(u * 3 + Math.sin(v * 2) * 1.4) * 0.35 +
        Math.sin(v * 4 + Math.sin(u * 3) * 1.1) * 0.3 +
        fbm(x / S * 8, y / S * 8, 3) * 0.5;
    }
  }
  const t = normalFromHeight(h, S, 1.4);
  cache.set('waterN', t);
  return t;
}

/** Suelo de la arena: losas radiales, grietas y runas escarlata */
export function arenaFloorTexture(): THREE.CanvasTexture {
  if (cache.has('arena')) return cache.get('arena')!;
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#41414c';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(666);
  const cx = S / 2;
  // anillos concéntricos
  for (let r = 30; r < S * 0.72; r += 26) {
    ctx.strokeStyle = `rgba(20,20,26,${0.35 + rng() * 0.2})`;
    ctx.lineWidth = 2 + rng() * 2;
    ctx.beginPath(); ctx.arc(cx, cx, r, 0, Math.PI * 2); ctx.stroke();
  }
  // juntas radiales
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    ctx.strokeStyle = 'rgba(20,20,26,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 26, cx + Math.sin(a) * 26);
    ctx.lineTo(cx + Math.cos(a) * S * 0.7, cx + Math.sin(a) * S * 0.7);
    ctx.stroke();
  }
  // desgaste
  for (let i = 0; i < 700; i++) {
    const a = rng() * Math.PI * 2, rr = rng() * S * 0.7;
    const x = cx + Math.cos(a) * rr, y = cx + Math.sin(a) * rr;
    const v = (52 + rng() * 46) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.08 + rng() * 0.14})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + rng() * 12, 0, Math.PI * 2); ctx.fill();
  }
  // círculo rúnico escarlata
  ctx.strokeStyle = 'rgba(150,32,38,0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cx, S * 0.31, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(cx, cx, S * 0.27, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * S * 0.31, y = cx + Math.sin(a) * S * 0.31;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI / 4);
    ctx.fillStyle = 'rgba(150,32,38,0.9)';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }
  const t = toTexture(c, true, false);
  cache.set('arena', t);
  return t;
}

/** Estandarte raído: paño oscuro con borde y rasgaduras (alpha) */
export function bannerTexture(): THREE.CanvasTexture {
  if (cache.has('banner')) return cache.get('banner')!;
  const W = 128, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#4a1420';
  ctx.fillRect(0, 0, W, H);
  const rng = mulberry32(1313);
  // trama
  for (let i = 0; i < 500; i++) {
    const v = rng();
    ctx.fillStyle = v > 0.5 ? 'rgba(90,26,40,0.25)' : 'rgba(30,8,14,0.3)';
    ctx.fillRect(rng() * W, rng() * H, 2 + rng() * 6, 1 + rng() * 2);
  }
  // borde dorado desgastado
  ctx.strokeStyle = 'rgba(158,122,58,0.8)';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  // emblema: ojo de Bel'Zaroth
  ctx.strokeStyle = 'rgba(200,150,70,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.34, 26, 15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(216,50,60,0.95)';
  ctx.beginPath(); ctx.arc(W / 2, H * 0.34, 7, 0, Math.PI * 2); ctx.fill();
  // rasgado inferior (alpha)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, H - 6 - rng() * 22);
  }
  ctx.lineTo(W, H);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const t = toTexture(c, true, false);
  cache.set('banner', t);
  return t;
}
