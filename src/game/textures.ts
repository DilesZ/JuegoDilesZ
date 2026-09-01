import * as THREE from 'three';
import { fbm, mulberry32, WORLD } from './core';

/* ============================================================
   TEXTURAS — ESTILO ANIME (toon shading)
   - Rampa de bandas para MeshToonMaterial (cel shading plano).
   - Todo pintado por canvas con paleta saturada tipo anime:
     nada de fotos PBR — colores planos vivos, sombras limpias.
   ============================================================ */

let _ramp3: THREE.DataTexture | null = null;
let _ramp4: THREE.DataTexture | null = null;

/** Rampa de cel shading: 3 bandas (sombra / media / luz) */
export function toonRamp3(): THREE.DataTexture {
  if (_ramp3) return _ramp3;
  const v = new Uint8Array([110, 110, 110, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  _ramp3 = new THREE.DataTexture(v, 3, 1, THREE.RGBAFormat);
  _ramp3.minFilter = _ramp3.magFilter = THREE.NearestFilter;
  _ramp3.colorSpace = THREE.NoColorSpace;
  _ramp3.needsUpdate = true;
  return _ramp3;
}

/** Rampa suave de 4 bandas (para piel / detalles finos) */
export function toonRamp4(): THREE.DataTexture {
  if (_ramp4) return _ramp4;
  const v = new Uint8Array([
    90, 90, 100, 255, 160, 160, 168, 255, 225, 225, 228, 255, 255, 255, 255, 255,
  ]);
  _ramp4 = new THREE.DataTexture(v, 4, 1, THREE.RGBAFormat);
  _ramp4.minFilter = _ramp4.magFilter = THREE.NearestFilter;
  _ramp4.colorSpace = THREE.NoColorSpace;
  _ramp4.needsUpdate = true;
  return _ramp4;
}

const cache = new Map<string, THREE.CanvasTexture>();
const photoCache = new Map<string, THREE.Texture>();
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

/** Carga una textura de /public/textures (con cache). Uso residual. */
export function pbrTex(file: string, opts: { srgb?: boolean; repeat?: number } = {}): THREE.Texture {
  const key = `${file}|${opts.srgb ? 1 : 0}|${opts.repeat ?? 1}`;
  if (photoCache.has(key)) return photoCache.get(key)!;
  const t = texLoader.load(`/textures/${file}`, undefined, undefined, () => {
    /* si falla la descarga, los materiales conservan su fallback procedural */
  });
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (opts.repeat && opts.repeat !== 1) t.repeat.set(opts.repeat, opts.repeat);
  photoCache.set(key, t);
  return t;
}

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
 * Textura grande de color para el terreno (ESTILO MODERNO-PBR):
 * base pintada natural + FOTO CC0 de césped (ambientCG) mezclada por
 * encima, senderos ocre-tierra que conectan hoguera, santuarios y
 * arena, y roca gris en altura. La foto se estampa en async cuando
 * llega (needsUpdate), los senderos se redibujan encima.
 */
export function terrainSplat(): THREE.CanvasTexture {
  if (cache.has('splat')) return cache.get('splat')!;
  const S = 2048;
  const [c, ctx] = makeCanvas(S, S);
  const rock = [128, 130, 140];

  const paint = () => {
    const px = S / WORLD_TEX_SIZE; // píxeles por unidad de mundo
    const rng = mulberry32(4242);

    const grassA = [88, 128, 66], grassB = [112, 152, 78], grassDry = [148, 142, 88];
    const dirt = [124, 96, 62], dirtDark = [98, 76, 50];
    const rockDark = [100, 102, 112];

    // 1) base pintada: celdas grandes de verde natural con manchas
    ctx.clearRect(0, 0, S, S);
    {
      const cell = 12;
      for (let cy = 0; cy < S; cy += cell) {
        for (let cx = 0; cx < S; cx += cell) {
          const wx = (cx / S) * WORLD_TEX_SIZE - 100;
          const wz = (cy / S) * WORLD_TEX_SIZE - 100;
          const n = fbm(wx * 0.06, wz * 0.06, 3) * 0.5 + 0.5;
          const n2 = fbm(wx * 0.21 + 40, wz * 0.21 - 17, 2) * 0.5 + 0.5;
          const mix01 = (a: number[], bb: number[], t: number) => [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t];
          let col = mix01(grassA, grassB, n);
          if (n > 0.60) col = mix01(col, grassDry, (n - 0.60) * 2.1);
          if (n2 > 0.72) col = mix01(col, [130, 168, 92], (n2 - 0.72) * 2.4);
          const jitter = (rng() - 0.5) * 12;
          let r = col[0] + jitter, g = col[1] + jitter * 1.1, b = col[2] + jitter * 0.6;
          const rr = Math.hypot(wx, wz);
          if (rr > 70) {
            // corona rocosa del borde: mezcla COMPLETA en la base (evita mosaico)
            const t = Math.min(1, (rr - 70) / 8);
            const rc = n2 > 0.5 ? rock : rockDark;
            const gr = (rng() - 0.5) * 26;
            r = r + (rc[0] + gr - r) * t; g = g + (rc[1] + gr - g) * t; b = b + (rc[2] + gr - b) * t;
          }
          ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
          ctx.fillRect(cx, cy, cell, cell);
        }
      }
    }

    // manchas redondeadas claras/oscuras (parches suaves)
    for (let i = 0; i < 90; i++) {
      const x = rng() * S, y = rng() * S, R = 24 + rng() * 80;
      const light = rng() > 0.45;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, R);
      g2.addColorStop(0, light ? 'rgba(158,186,116,0.20)' : 'rgba(64,102,58,0.18)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
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
      g.addColorStop(0, `rgba(${dc[0]},${dc[1]},${dc[2]},0.6)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }
  };

  /** senderos + desgaste (se pintan al final, encima de la foto) */
  const paintPaths = (px: number, rng: () => number) => {
    const W = WORLD;
    const drawPath = (x1: number, z1: number, x2: number, z2: number, wUnits: number) => {
      const mx = (x1 + x2) / 2 + (z2 - z1) * 0.18;
      const mz = (z1 + z2) / 2 - (x2 - x1) * 0.18;
      const p = new Path2D();
      p.moveTo((x1 + 100) * px, (z1 + 100) * px);
      p.quadraticCurveTo((mx + 100) * px, (mz + 100) * px, (x2 + 100) * px, (z2 + 100) * px);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(92,70,44,0.45)';
      ctx.lineWidth = wUnits * px * 1.7;
      ctx.stroke(p);
      ctx.strokeStyle = 'rgba(168,136,92,0.92)';
      ctx.lineWidth = wUnits * px;
      ctx.stroke(p);
      ctx.strokeStyle = 'rgba(196,166,120,0.5)';
      ctx.lineWidth = wUnits * px * 0.45;
      ctx.stroke(p);
      // piedritas claras
      const steps = Math.hypot(x2 - x1, z2 - z1) * 2.2;
      for (let i = 0; i < steps; i++) {
        const t = rng();
        const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
        const bz = (1 - t) * (1 - t) * z1 + 2 * (1 - t) * t * mz + t * t * z2;
        const ox = (rng() - 0.5) * wUnits * 1.1, oz = (rng() - 0.5) * wUnits * 1.1;
        const shade = 160 + rng() * 70;
        ctx.fillStyle = `rgba(${shade},${shade * 0.97},${shade * 0.9},${0.3 + rng() * 0.4})`;
        ctx.beginPath();
        ctx.arc((bx + ox + 100) * px, (bz + oz + 100) * px, (0.05 + rng() * 0.12) * px, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const s of W.shrines) drawPath(W.bonfire.x, W.bonfire.z, s.x, s.z, 2.1);
    drawPath(W.bonfire.x, W.bonfire.z, W.arena.x, W.arena.z - W.arena.r, 2.6);

    // desgaste alrededor de hoguera y santuarios
    for (const p of [W.bonfire, ...W.shrines, { x: W.arena.x, z: W.arena.z }]) {
      const x = (p.x + 100) * px, y = (p.z + 100) * px;
      const R = 30;
      const g = ctx.createRadialGradient(x, y, 4, x, y, R);
      g.addColorStop(0, 'rgba(132,104,68,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }
  };

  paint();
  const rngPath = mulberry32(777);
  paintPaths(S / WORLD_TEX_SIZE, rngPath);

  // 3) FOTO CC0 de césped mezclada por encima (async); luego senderos encima
  texLoader.load('/textures/grass_color.jpg', (tex) => {
    const img = tex.image as HTMLImageElement | undefined;
    if (!img) return;
    const px = S / WORLD_TEX_SIZE;
    ctx.save();
    ctx.globalAlpha = 0.62;
    const tile = (6.5) * px; // celda de ~6.5 m
    for (let y = 0; y < S; y += tile) {
      for (let x = 0; x < S; x += tile) {
        // no estampar la foto en la corona rocosa del borde (evita mosaico visible)
        const wx = ((x + tile / 2) / S) * WORLD_TEX_SIZE - 100;
        const wz = ((y + tile / 2) / S) * WORLD_TEX_SIZE - 100;
        if (Math.hypot(wx, wz) > 74) continue;
        ctx.drawImage(img, x, y, tile + 1, tile + 1);
      }
    }
    ctx.restore();
    // roca en la corona del mundo (encima de la foto), con borde suave y grano
    const rng2 = mulberry32(99);
    ctx.save();
    for (let cy = 0; cy < S; cy += 7) {
      for (let cx = 0; cx < S; cx += 7) {
        const wx = (cx / S) * WORLD_TEX_SIZE - 100;
        const wz = (cy / S) * WORLD_TEX_SIZE - 100;
        const rr = Math.hypot(wx, wz);
        if (rr > 75) {
          const t = Math.min(1, (rr - 75) / 15);
          const shade = 0.72 + rng2() * 0.56;
          ctx.fillStyle = `rgba(${(rock[0] * shade) | 0},${(rock[1] * shade) | 0},${(rock[2] * shade) | 0},${0.95 * t})`;
          ctx.fillRect(cx + (rng2() - 0.5) * 9, cy + (rng2() - 0.5) * 9, 10, 10);
        }
      }
    }
    ctx.restore();
    paintPaths(px, mulberry32(777));
    t2.needsUpdate = true;
  });

  const t2 = toTexture(c, true, false);
  cache.set('splat', t2);
  return t2;
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

/** Corteza de pino pintada (anime): marrón cálido con vetas verticales claras */
export function barkMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture | null } {
  const key = 'barkAnime';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: null };
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#7c5636';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(606);
  for (let i = 0; i < 46; i++) {
    const x = rng() * S;
    const w = 3 + rng() * 9;
    const light = rng() > 0.42;
    ctx.fillStyle = light ? 'rgba(158,112,66,0.5)' : 'rgba(84,54,32,0.55)';
    ctx.fillRect(x, 0, w, S);
  }
  for (let i = 0; i < 26; i++) {
    const y = rng() * S, x = rng() * S, w = 4 + rng() * 12;
    ctx.fillStyle = 'rgba(60,38,22,0.5)';
    ctx.fillRect(x, y, w, 2 + rng() * 3);
  }
  const t = toTexture(c, true);
  cache.set(key, t);
  return { map: t, normalMap: null };
}

/** Metal forjado: base gris con arañazos + mapa de rugosidad + normal */
export function metalMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const key = 'metal';
  if (cache.has(key)) {
    return { map: cache.get(key)!, normalMap: cache.get(key + 'N')!, roughnessMap: cache.get(key + 'R')! };
  }
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#c4cedd';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(777);
  // cepillado horizontal
  for (let i = 0; i < 260; i++) {
    const y = rng() * S;
    const shade = 170 + rng() * 70;
    ctx.strokeStyle = `rgba(${shade},${shade + 5},${shade + 14},${0.08 + rng() * 0.1})`;
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
    ctx.strokeStyle = `rgba(240,246,255,${0.16 + rng() * 0.2})`;
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

/** Piedra pintada (anime): gris lavanda claro con grietas y musgo */
export function stoneMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture | null } {
  const key = 'stoneAnime';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: null };
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#aab0c4';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(808);
  for (let i = 0; i < 30; i++) {
    const x = rng() * S, y = rng() * S, R = 8 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rng() > 0.5 ? 'rgba(196,202,220,0.5)' : 'rgba(132,138,160,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  }
  // grietas
  ctx.strokeStyle = 'rgba(84,88,108,0.7)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 14; i++) {
    let x = rng() * S, y = rng() * S;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rng() - 0.5) * 26; y += (rng() - 0.5) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // musgo
  for (let i = 0; i < 12; i++) {
    const x = rng() * S, y = rng() * S, R = 4 + rng() * 12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, 'rgba(122,188,102,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  }
  const t = toTexture(c, true);
  cache.set(key, t);
  return { map: t, normalMap: null };
}

/** Madera con vetas para mangos/troncos de hoguera */
export function woodMaps(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const key = 'wood';
  if (cache.has(key)) return { map: cache.get(key)!, normalMap: cache.get(key + 'N')! };
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#8a663c';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(202);
  for (let i = 0; i < 60; i++) {
    const y = rng() * S;
    const v = 70 + rng() * 55;
    ctx.strokeStyle = `rgba(${v + 40},${v + 12},${v - 20},${0.2 + rng() * 0.3})`;
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

/** Hoja de hierba con alpha (para matas instanciadas) — tono natural PBR */
export function grassBladeTexture(): THREE.CanvasTexture {
  if (cache.has('blade')) return cache.get('blade')!;
  const W = 64, H = 64;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, '#3a5a28');
  g.addColorStop(0.55, '#5e7c34');
  g.addColorStop(1, '#93a04a');
  ctx.fillStyle = g;
  // hoja curvada
  ctx.beginPath();
  ctx.moveTo(W * 0.5 - 9, H);
  ctx.quadraticCurveTo(W * 0.5 - 5, H * 0.45, W * 0.5 - 1, 2);
  ctx.quadraticCurveTo(W * 0.5 + 1, 0, W * 0.5 + 2, 3);
  ctx.quadraticCurveTo(W * 0.5 + 6, H * 0.5, W * 0.5 + 9, H);
  ctx.closePath();
  ctx.fill();
  // nervadura central sutil
  ctx.strokeStyle = 'rgba(255,255,240,0.10)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(W * 0.5, H);
  ctx.quadraticCurveTo(W * 0.5 + 2, H * 0.5, W * 0.5 + 1, 3);
  ctx.stroke();
  const t = toTexture(c, true, false);
  cache.set('blade', t);
  return t;
}

/* ============================================================
   VEGETACIÓN FOTORREALISTA (tarjetas alpha para árboles reales)
   ============================================================ */

/**
 * Tarjeta de FOLLAJE de caducifolio con alpha: racimo de decenas de
 * hojas pequeñas con variación de tono, oclusión hacia el interior
 * y brillos solares en el borde. Se usa en tarjetas cruzadas por copa.
 */
export function foliageTexture(seed = 1): THREE.CanvasTexture {
  const key = `foliage${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const rng = mulberry32(seed * 977 + 13);
  const cx = S / 2, cy = S / 2;
  // base oscura de interior (profundidad de copa)
  const base = ctx.createRadialGradient(cx, cy, S * 0.08, cx, cy, S * 0.48);
  base.addColorStop(0, 'rgba(46,70,32,0.95)');
  base.addColorStop(0.7, 'rgba(56,84,40,0.55)');
  base.addColorStop(1, 'rgba(56,84,40,0)');
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.48, 0, Math.PI * 2); ctx.fill();

  const leaf = (x: number, y: number, rot: number, sz: number, tone: number, light: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // hoja = elipse puntiaguda con nervadura
    ctx.beginPath();
    ctx.moveTo(0, -sz);
    ctx.bezierCurveTo(sz * 0.55, -sz * 0.45, sz * 0.5, sz * 0.45, 0, sz);
    ctx.bezierCurveTo(-sz * 0.5, sz * 0.45, -sz * 0.55, -sz * 0.45, 0, -sz);
    ctx.closePath();
    const r = (58 + tone * 42) | 0, g = (102 + tone * 64 + light * 52) | 0, b = (38 + tone * 30) | 0;
    ctx.fillStyle = `rgba(${r},${g},${b},${0.72 + light * 0.28})`;
    ctx.fill();
    if (light > 0.62) {
      ctx.strokeStyle = `rgba(215,240,160,${(light - 0.62) * 0.9})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(0, -sz * 0.7); ctx.lineTo(0, sz * 0.7); ctx.stroke();
    }
    ctx.restore();
  };

  // capas de dentro (oscuro) → fuera (claro)
  const layers = 5;
  for (let l = 0; l < layers; l++) {
    const frac = l / (layers - 1);
    const count = 26 + l * 14;
    const radMax = S * (0.14 + frac * 0.33);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * radMax;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.92;
      const edge = rr / Math.max(1, radMax);
      const light = Math.min(1, frac * 0.75 + edge * 0.5 + rng() * 0.22);
      leaf(x, y, rng() * Math.PI * 2, S * (0.028 + rng() * 0.026), rng(), light);
    }
  }
  // ramitas visibles asomando
  ctx.strokeStyle = 'rgba(52,38,26,0.8)';
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const rr = S * (0.18 + rng() * 0.26);
    ctx.lineWidth = 2 + rng() * 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rr * 0.3, cy + Math.sin(a) * rr * 0.3);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    ctx.stroke();
  }
  const t = toTexture(c, true, false);
  cache.set(key, t);
  return t;
}

/**
 * Tarjeta de FOLLAJE DE PINO: ramas de acículas oscuras radiando,
 * con puntas iluminadas. Para pinos realistas por capas.
 */
export function pineFoliageTexture(seed = 3): THREE.CanvasTexture {
  const key = `pine${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const rng = mulberry32(seed * 613 + 7);
  const cx = S / 2, cy = S * 0.56;
  // masa base de la copa (profundidad interior verde media)
  const base = ctx.createRadialGradient(cx, cy, S * 0.06, cx, cy, S * 0.46);
  base.addColorStop(0, 'rgba(40,64,38,0.97)');
  base.addColorStop(0.65, 'rgba(48,76,44,0.6)');
  base.addColorStop(1, 'rgba(48,76,44,0)');
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2); ctx.fill();
  // rama central
  ctx.strokeStyle = 'rgba(48,34,22,0.9)';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + (rng() - 0.5) * 40, cy - S * 0.3, cx, cy - S * 0.42);
  ctx.stroke();
  // haces de acículas (más claros y densos)
  const needle = (x: number, y: number, a: number, len: number, light: number) => {
    const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
    const g = 74 + light * 78;
    ctx.strokeStyle = `rgba(${(30 + light * 30) | 0},${g | 0},${(30 + light * 22) | 0},${0.85 + light * 0.15})`;
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
  };
  for (let branch = 0; branch < 34; branch++) {
    const ba = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.25;
    const bl = S * (0.12 + rng() * 0.22);
    const bx = cx + Math.cos(ba + Math.PI / 2) * (rng() - 0.5) * 60;
    const by = cy + Math.sin(ba + Math.PI / 2) * (rng() - 0.5) * 60;
    const ex = bx + Math.cos(ba) * bl, ey = by + Math.sin(ba) * bl;
    ctx.strokeStyle = 'rgba(50,36,24,0.85)';
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    const n = 18 + (rng() * 12) | 0;
    for (let i = 0; i < n; i++) {
      const k = 0.2 + rng() * 0.8;
      const px = bx + (ex - bx) * k, py = by + (ey - by) * k;
      const side = rng() < 0.5 ? 1 : -1;
      const na = ba + side * (0.55 + rng() * 1.0);
      const light = Math.min(1, 0.25 + k * 0.45 + rng() * 0.45);
      needle(px, py, na, S * (0.055 + rng() * 0.07), light);
    }
  }
  const t = toTexture(c, true, false);
  cache.set(key, t);
  return t;
}

/** Pomponcloud suave para nubes billboard fotográficas */
export function cloudPuffTexture(): THREE.CanvasTexture {
  if (cache.has('puff')) return cache.get('puff')!;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const rng = mulberry32(4242);
  // acumulación de blobs radiales (más densos abajo-plano)
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * S * 0.34;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S / 2 + Math.sin(a) * rr * 0.62 - S * 0.04;
    const r = S * (0.1 + rng() * 0.14) * (1 - rr / (S * 0.75));
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(2, r));
    const o = 0.16 + rng() * 0.13;
    g.addColorStop(0, `rgba(255,255,255,${o})`);
    g.addColorStop(0.65, `rgba(250,251,253,${o * 0.5})`);
    g.addColorStop(1, 'rgba(250,251,253,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // núcleo brillante superior
  const core = ctx.createRadialGradient(S / 2, S * 0.4, 0, S / 2, S * 0.4, S * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,0.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(S / 2, S * 0.4, S * 0.32, 0, Math.PI * 2); ctx.fill();
  const t = toTexture(c, true, false);
  cache.set('puff', t);
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
  ctx.fillStyle = '#63636f';
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
    const v = (86 + rng() * 52) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v + 8},${0.08 + rng() * 0.14})`;
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
  ctx.fillStyle = '#6b1e2e';
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
