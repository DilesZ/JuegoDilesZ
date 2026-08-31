import * as THREE from 'three';
import { clamp, lerp } from './core';
import type { World } from './world';

/* ============================================================
   CICLO DÍA/NOCHE — AETHERIA
   Paleta con keyframes por hora del día interpolada suavemente.
   El juego EMPIEZA DE DÍA (t = 0.30 ≈ 07:12 de la mañana).
   Controla: cielo (shader), sol y luna (malla + luz direccional
   compartida), niebla, estrellas, aurora, luciérnagas, antorchas,
   niebla rasante, exposición y tinte atmosférico.
   ============================================================ */

export interface DayNightSample {
  t: number;                       // 0..1 (0 = medianoche)
  clock: string;                   // "07:12"
  day: number;                     // contador de días
  night: number;                   // 0 = pleno día, 1 = noche cerrada
  isNight: boolean;

  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyBottom: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;

  lightDir: THREE.Vector3;         // dirección HACIA la luz activa
  lightColor: THREE.Color;
  lightIntensity: number;
  isSun: number;                   // 1 = sol, 0 = luna

  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fillColor: THREE.Color;
  fillIntensity: number;

  sunA: number;                    // opacidad disco/sol
  moonA: number;                   // opacidad luna + halos
  sunGlow: number;                 // dispersión atmosférica en el cielo
  sunTint: THREE.Color;            // tinte del resplandor solar
  stars: number;
  aurora: number;
  fireflies: number;
  mistMul: number;                 // multiplicador de niebla rasante
  torchBoost: number;              // realce de llamas de noche
  envIntensity: number;
  waterTint: THREE.Color;
  exposure: number;
}

interface Stop {
  t: number;
  skyTop: number; skyMid: number; skyBottom: number;
  fog: number; fogD: number;
  light: number; lightI: number;
  hemiS: number; hemiG: number; hemiI: number;
  fill: number; fillI: number;
  sunA: number; moonA: number; glow: number; tint: number;
  stars: number; aurora: number; ff: number;
  mist: number; torch: number; env: number;
  water: number; exp: number; night: number;
}

/* Keyframes a lo largo de las 24 h (t = hora/24) */
const STOPS: Stop[] = [
  //        t     skyTop    skyMid    skyBot    fog       fogD     light     li    hemiS     hemiG     hemiI fill      fillI  sunA moonA glow  tint      stars aurora ff   mist torch env   water    exp   night
  { t: 0.00, skyTop: 0x040711, skyMid: 0x0a1322, skyBottom: 0x101a28, fog: 0x0a0f1a, fogD: 0.0115, light: 0xa9c2ff, lightI: 1.15, hemiS: 0x1c2b4a, hemiG: 0x0d0b08, hemiI: 0.42, fill: 0x22304d, fillI: 0.25, sunA: 0, moonA: 1, glow: 0.0, tint: 0x8098c8, stars: 1, aurora: 1, ff: 1, mist: 1.3, torch: 1.4, env: 0.45, water: 0x27405e, exp: 1.16, night: 1 },
  { t: 0.21, skyTop: 0x060a18, skyMid: 0x101a30, skyBottom: 0x1d2740, fog: 0x0d1220, fogD: 0.0110, light: 0x9fb6e8, lightI: 1.05, hemiS: 0x243354, hemiG: 0x120e0a, hemiI: 0.45, fill: 0x28385c, fillI: 0.25, sunA: 0, moonA: 0.9, glow: 0.05, tint: 0x8898c8, stars: 0.85, aurora: 0.85, ff: 0.9, mist: 1.4, torch: 1.35, env: 0.5, water: 0x27405e, exp: 1.14, night: 0.95 },
  { t: 0.265, skyTop: 0x2a3d64, skyMid: 0x6f6a8e, skyBottom: 0xd98a56, fog: 0x6a5648, fogD: 0.0092, light: 0xffb877, lightI: 2.3, hemiS: 0x4a4a66, hemiG: 0x241a12, hemiI: 0.72, fill: 0x6a5a58, fillI: 0.38, sunA: 0.85, moonA: 0.25, glow: 1.0, tint: 0xff9a4a, stars: 0.06, aurora: 0.12, ff: 0.15, mist: 1.55, torch: 1.1, env: 0.7, water: 0x585a6e, exp: 1.1, night: 0.35 },
  { t: 0.33, skyTop: 0x3f74b8, skyMid: 0x8fb8dd, skyBottom: 0xd8e6ea, fog: 0xa8bcc8, fogD: 0.0072, light: 0xfff1d8, lightI: 2.3, hemiS: 0x7d9cc0, hemiG: 0x3a4632, hemiI: 0.9, fill: 0xcfe0f0, fillI: 0.42, sunA: 1, moonA: 0, glow: 0.55, tint: 0xffe8c0, stars: 0, aurora: 0, ff: 0, mist: 0.7, torch: 0.55, env: 1.0, water: 0x4a7a9e, exp: 1.06, night: 0 },
  { t: 0.50, skyTop: 0x3568b0, skyMid: 0x86b4dc, skyBottom: 0xcfe2ec, fog: 0xb0c4d2, fogD: 0.0062, light: 0xfffbe8, lightI: 2.45, hemiS: 0x86a8cc, hemiG: 0x42503a, hemiI: 1.0, fill: 0xd8e8f8, fillI: 0.46, sunA: 1, moonA: 0, glow: 0.4, tint: 0xfff2cf, stars: 0, aurora: 0, ff: 0, mist: 0.55, torch: 0.45, env: 1.1, water: 0x4a86ac, exp: 1.05, night: 0 },
  { t: 0.66, skyTop: 0x3a6cae, skyMid: 0x93b4d4, skyBottom: 0xe2dfc8, fog: 0xb2bcb4, fogD: 0.0070, light: 0xffedc8, lightI: 2.3, hemiS: 0x84a0bc, hemiG: 0x40462e, hemiI: 0.9, fill: 0xd8dcd0, fillI: 0.42, sunA: 1, moonA: 0, glow: 0.6, tint: 0xffd9a0, stars: 0, aurora: 0, ff: 0, mist: 0.7, torch: 0.6, env: 1.0, water: 0x4a7a9a, exp: 1.05, night: 0 },
  { t: 0.735, skyTop: 0x33406e, skyMid: 0x8a5f7e, skyBottom: 0xe8865a, fog: 0x7a5a4e, fogD: 0.0088, light: 0xff9a5e, lightI: 2.5, hemiS: 0x5c4a70, hemiG: 0x2a1c16, hemiI: 0.75, fill: 0x7a5a68, fillI: 0.4, sunA: 0.9, moonA: 0.1, glow: 1.1, tint: 0xff8a3a, stars: 0.1, aurora: 0.15, ff: 0.25, mist: 1.1, torch: 1.0, env: 0.75, water: 0x58506a, exp: 1.08, night: 0.3 },
  { t: 0.79, skyTop: 0x101a34, skyMid: 0x2c2848, skyBottom: 0x5c3a52, fog: 0x2e2a3e, fogD: 0.0098, light: 0xb8a0d8, lightI: 0.9, hemiS: 0x303254, hemiG: 0x140f0c, hemiI: 0.48, fill: 0x343050, fillI: 0.28, sunA: 0.3, moonA: 0.5, glow: 0.35, tint: 0xc088a8, stars: 0.5, aurora: 0.55, ff: 0.7, mist: 1.25, torch: 1.25, env: 0.6, water: 0x33405e, exp: 1.12, night: 0.7 },
  { t: 0.86, skyTop: 0x040711, skyMid: 0x0a1322, skyBottom: 0x101a28, fog: 0x0a0f1a, fogD: 0.0115, light: 0xa9c2ff, lightI: 1.15, hemiS: 0x1c2b4a, hemiG: 0x0d0b08, hemiI: 0.42, fill: 0x22304d, fillI: 0.25, sunA: 0, moonA: 1, glow: 0, tint: 0x8098c8, stars: 1, aurora: 1, ff: 1, mist: 1.3, torch: 1.4, env: 0.45, water: 0x27405e, exp: 1.16, night: 1 },
  { t: 1.00, skyTop: 0x040711, skyMid: 0x0a1322, skyBottom: 0x101a28, fog: 0x0a0f1a, fogD: 0.0115, light: 0xa9c2ff, lightI: 1.15, hemiS: 0x1c2b4a, hemiG: 0x0d0b08, hemiI: 0.42, fill: 0x22304d, fillI: 0.25, sunA: 0, moonA: 1, glow: 0, tint: 0x8098c8, stars: 1, aurora: 1, ff: 1, mist: 1.3, torch: 1.4, env: 0.45, water: 0x27405e, exp: 1.16, night: 1 },
];

const cA = new THREE.Color();
const cB = new THREE.Color();

function numLerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function sampleStops(t: number, out: DayNightSample) {
  // encontrar par de stops
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].t <= t) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const k = clamp((t - a.t) / Math.max(1e-5, b.t - a.t), 0, 1);
  const s = k * k * (3 - 2 * k); // smoothstep para transiciones suaves

  out.skyTop.copy(cA.setHex(a.skyTop)).lerp(cB.setHex(b.skyTop), s);
  out.skyMid.copy(cA.setHex(a.skyMid)).lerp(cB.setHex(b.skyMid), s);
  out.skyBottom.copy(cA.setHex(a.skyBottom)).lerp(cB.setHex(b.skyBottom), s);
  out.fogColor.copy(cA.setHex(a.fog)).lerp(cB.setHex(b.fog), s);
  out.fogDensity = numLerp(a.fogD, b.fogD, s);
  out.lightColor.copy(cA.setHex(a.light)).lerp(cB.setHex(b.light), s);
  out.lightIntensity = numLerp(a.lightI, b.lightI, s);
  out.hemiSky.copy(cA.setHex(a.hemiS)).lerp(cB.setHex(b.hemiS), s);
  out.hemiGround.copy(cA.setHex(a.hemiG)).lerp(cB.setHex(b.hemiG), s);
  out.hemiIntensity = numLerp(a.hemiI, b.hemiI, s);
  out.fillColor.copy(cA.setHex(a.fill)).lerp(cB.setHex(b.fill), s);
  out.fillIntensity = numLerp(a.fillI, b.fillI, s);
  out.sunA = numLerp(a.sunA, b.sunA, s);
  out.moonA = numLerp(a.moonA, b.moonA, s);
  out.sunGlow = numLerp(a.glow, b.glow, s);
  out.sunTint.copy(cA.setHex(a.tint)).lerp(cB.setHex(b.tint), s);
  out.stars = numLerp(a.stars, b.stars, s);
  out.aurora = numLerp(a.aurora, b.aurora, s);
  out.fireflies = numLerp(a.ff, b.ff, s);
  out.mistMul = numLerp(a.mist, b.mist, s);
  out.torchBoost = numLerp(a.torch, b.torch, s);
  out.envIntensity = numLerp(a.env, b.env, s);
  out.waterTint.copy(cA.setHex(a.water)).lerp(cB.setHex(b.water), s);
  out.exposure = numLerp(a.exp, b.exp, s);
  out.night = numLerp(a.night, b.night, s);
  out.isNight = out.night > 0.5;
}

export class DayNightCycle {
  /** Hora del mundo: 0..1 (0 = medianoche). El juego empieza de día (07:12). */
  t = 0.34;
  day = 1;
  /** Duración del día completo en segundos de juego */
  dayLength = 480;
  onPhaseChange: ((kind: 'night' | 'day') => void) | null = null;

  private wasNight = false;
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private sample: DayNightSample;

  constructor(
    private world: World,
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.sample = {
      t: this.t, clock: '', day: 1, night: 1, isNight: false,
      skyTop: new THREE.Color(), skyMid: new THREE.Color(), skyBottom: new THREE.Color(),
      fogColor: new THREE.Color(), fogDensity: 0.01,
      lightDir: new THREE.Vector3(0, 1, 0), lightColor: new THREE.Color(), lightIntensity: 1, isSun: 1,
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0.5,
      fillColor: new THREE.Color(), fillIntensity: 0.3,
      sunA: 0, moonA: 1, sunGlow: 0, sunTint: new THREE.Color(),
      stars: 1, aurora: 1, fireflies: 1, mistMul: 1, torchBoost: 1, envIntensity: 0.5,
      waterTint: new THREE.Color(), exposure: 1.14,
    };
    this.sampleClock();
    // aplicar el estado inicial de inmediato (evita flash de noche al cargar)
    this.world.applyDayNight(this.sample, this.renderer);
  }

  setTime(t: number) {
    this.t = ((t % 1) + 1) % 1;
    this.sampleClock();
    this.world.applyDayNight(this.sample, this.renderer);
  }

  /** Factores de velocidad de enemigos / ambiente */
  get nightFactor() { return this.sample.night; }

  /** Hora del mundo formateada "07:12" */
  sampleClockText() { return this.sample.clock; }

  private sampleClock() {
    const hours = this.t * 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    this.sample.clock = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  update(dt: number) {
    const prev = this.t;
    this.t += dt / this.dayLength;
    if (this.t >= 1) {
      this.t -= 1;
      this.day++;
    }

    // ¿amanecer o anochecer? (cruce del umbral nocturno)
    const crossedNight = prev < 0.79 && this.t >= 0.79;
    const crossedDay = prev < 0.265 && this.t >= 0.265;
    if (crossedNight && !this.wasNight) {
      this.wasNight = true;
      this.onPhaseChange?.('night');
    } else if (crossedDay && this.wasNight) {
      this.wasNight = false;
      this.onPhaseChange?.('day');
    }

    const s = this.sample;
    s.t = this.t;
    s.day = this.day;
    this.sampleClock();

    // ---- Trayectorias del sol y la luna ----
    const ang = (this.t - 0.25) * Math.PI * 2;
    const sunElev = Math.sin(ang);
    const sunAzim = Math.cos(ang);
    this.sunDir.set(sunAzim * 0.85, Math.max(sunElev, -0.35) * 0.9 + 0.03, -0.45).normalize();
    const mAng = ang + Math.PI;
    const moonElev = Math.sin(mAng);
    const moonAzim = Math.cos(mAng);
    this.moonDir.set(moonAzim * 0.8, Math.max(moonElev, -0.35) * 0.9 + 0.05, -0.5).normalize();

    sampleStops(this.t, s);

    // la luz activa (con sombras) es el sol de día y la luna de noche
    const sunUp = sunElev > 0.02;
    s.isSun = sunUp ? 1 : 0;
    s.lightDir.copy(sunUp ? this.sunDir : this.moonDir);

    this.world.applyDayNight(s, this.renderer);
  }
}
