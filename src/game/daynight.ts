import * as THREE from 'three';
import { clamp, lerp } from './core';
import type { World } from './world';

/* ============================================================
   CICLO DÍA/NOCHE — AETHERIA (CINE REALISTA)
   Paleta cinematográfica: mediodía azul natural, amanecer/atardecer
   dorados dramáticos (estilo Dark Souls/DMC), noche azul profunda
   con luna fría. El juego EMPIEZA DE DÍA (t = 0.34 ≈ 08:09).
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
  cloudTint: THREE.Color;          // color de las nubes Ghibli
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
  water: number; cloud: number; exp: number; night: number;
}

/* Keyframes a lo largo de las 24 h (t = hora/24) — paleta CINE */
const STOPS: Stop[] = [
  //        t     skyTop    skyMid    skyBot    fog       fogD     light     li    hemiS     hemiG     hemiI fill      fillI  sunA moonA glow  tint      stars aurora ff   mist torch env   water    cloud    exp   night
  { t: 0.00, skyTop: 0x05081a, skyMid: 0x0e1836, skyBottom: 0x1c2a4e, fog: 0x0e1528, fogD: 0.0105, light: 0xa8bcE8, lightI: 1.3, hemiS: 0x1c294e, hemiG: 0x0f0e14, hemiI: 0.42, fill: 0x202c50, fillI: 0.22, sunA: 0, moonA: 1, glow: 0.0, tint: 0x9fb0e8, stars: 1, aurora: 0.8, ff: 1, mist: 1.3, torch: 1.4, env: 0.3, water: 0x16344a, cloud: 0x2c3554, exp: 1.05, night: 1 },
  { t: 0.21, skyTop: 0x0a0f2c, skyMid: 0x16244a, skyBottom: 0x2a3a62, fog: 0x141c38, fogD: 0.0098, light: 0xa0b4e0, lightI: 1.2, hemiS: 0x222e56, hemiG: 0x120f16, hemiI: 0.44, fill: 0x263358, fillI: 0.22, sunA: 0, moonA: 0.9, glow: 0.05, tint: 0xa2b0e8, stars: 0.85, aurora: 0.7, ff: 0.9, mist: 1.35, torch: 1.35, env: 0.32, water: 0x16344a, cloud: 0x34405e, exp: 1.04, night: 0.95 },
  { t: 0.265, skyTop: 0x3a4a80, skyMid: 0xb87a62, skyBottom: 0xffb874, fog: 0xb08868, fogD: 0.0078, light: 0xffb870, lightI: 2.6, hemiS: 0x6a6288, hemiG: 0x3c3226, hemiI: 0.7, fill: 0xd0a488, fillI: 0.34, sunA: 0.9, moonA: 0.15, glow: 1.25, tint: 0xffa860, stars: 0.05, aurora: 0.1, ff: 0.15, mist: 1.45, torch: 1.15, env: 0.75, water: 0x5a6690, cloud: 0xf0c8a8, exp: 1.0, night: 0.35 },
  { t: 0.33, skyTop: 0x2a5ca8, skyMid: 0x6898c8, skyBottom: 0xc4d8e4, fog: 0xaec4d4, fogD: 0.0058, light: 0xffedc8, lightI: 2.55, hemiS: 0x6e94c0, hemiG: 0x4e6238, hemiI: 0.8, fill: 0xc8dcf0, fillI: 0.42, sunA: 1, moonA: 0, glow: 0.55, tint: 0xffe4b8, stars: 0, aurora: 0, ff: 0, mist: 0.6, torch: 0.5, env: 0.9, water: 0x28688a, cloud: 0xf2f4f6, exp: 1.0, night: 0 },
  { t: 0.50, skyTop: 0x27579e, skyMid: 0x6290c4, skyBottom: 0xbccfdf, fog: 0xa8bfce, fogD: 0.0052, light: 0xfff6e0, lightI: 2.6, hemiS: 0x789cc4, hemiG: 0x546440, hemiI: 0.85, fill: 0xd0e0f0, fillI: 0.46, sunA: 1, moonA: 0, glow: 0.42, tint: 0xffeecf, stars: 0, aurora: 0, ff: 0, mist: 0.5, torch: 0.45, env: 0.95, water: 0x28708e, cloud: 0xf4f6f8, exp: 1.0, night: 0 },
  { t: 0.66, skyTop: 0x2a5494, skyMid: 0x6690be, skyBottom: 0xd8d2b4, fog: 0xa8bcae, fogD: 0.0058, light: 0xffe8bc, lightI: 2.5, hemiS: 0x7090b8, hemiG: 0x50603a, hemiI: 0.8, fill: 0xccdcd0, fillI: 0.4, sunA: 1, moonA: 0, glow: 0.65, tint: 0xffd89e, stars: 0, aurora: 0, ff: 0, mist: 0.65, torch: 0.6, env: 0.9, water: 0x286888, cloud: 0xf6ead2, exp: 1.0, night: 0 },
  { t: 0.735, skyTop: 0x38326a, skyMid: 0xa85a54, skyBottom: 0xff8e50, fog: 0x9a6850, fogD: 0.0074, light: 0xff9048, lightI: 2.7, hemiS: 0x6e5070, hemiG: 0x32221a, hemiI: 0.72, fill: 0xe89a68, fillI: 0.4, sunA: 0.95, moonA: 0.1, glow: 1.4, tint: 0xff7c38, stars: 0.08, aurora: 0.12, ff: 0.25, mist: 1.05, torch: 1.0, env: 0.8, water: 0x585878, cloud: 0xf0b088, exp: 1.0, night: 0.3 },
  { t: 0.79, skyTop: 0x121638, skyMid: 0x2a2a4e, skyBottom: 0x4e3a54, fog: 0x262440, fogD: 0.009, light: 0xa898c8, lightI: 1.15, hemiS: 0x262848, hemiG: 0x120e14, hemiI: 0.44, fill: 0x2a2c50, fillI: 0.24, sunA: 0.25, moonA: 0.55, glow: 0.4, tint: 0xd090b0, stars: 0.5, aurora: 0.45, ff: 0.7, mist: 1.25, torch: 1.3, env: 0.5, water: 0x22365a, cloud: 0x3c3c60, exp: 1.03, night: 0.7 },
  { t: 0.86, skyTop: 0x05081a, skyMid: 0x0e1836, skyBottom: 0x1c2a4e, fog: 0x0e1528, fogD: 0.0105, light: 0xa8bcE8, lightI: 1.3, hemiS: 0x1c294e, hemiG: 0x0f0e14, hemiI: 0.42, fill: 0x202c50, fillI: 0.22, sunA: 0, moonA: 1, glow: 0, tint: 0x9fb0e8, stars: 1, aurora: 0.8, ff: 1, mist: 1.3, torch: 1.4, env: 0.3, water: 0x16344a, cloud: 0x2c3554, exp: 1.05, night: 1 },
  { t: 1.00, skyTop: 0x05081a, skyMid: 0x0e1836, skyBottom: 0x1c2a4e, fog: 0x0e1528, fogD: 0.0105, light: 0xa8bcE8, lightI: 1.3, hemiS: 0x1c294e, hemiG: 0x0f0e14, hemiI: 0.42, fill: 0x202c50, fillI: 0.22, sunA: 0, moonA: 1, glow: 0, tint: 0x9fb0e8, stars: 1, aurora: 0.8, ff: 1, mist: 1.3, torch: 1.4, env: 0.3, water: 0x16344a, cloud: 0x2c3554, exp: 1.05, night: 1 },
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
  out.cloudTint.copy(cA.setHex(a.cloud)).lerp(cB.setHex(b.cloud), s);
  out.exposure = numLerp(a.exp, b.exp, s);
  out.night = numLerp(a.night, b.night, s);
  out.isNight = out.night > 0.5;
}

export class DayNightCycle {
  /** Hora del mundo: 0..1 (0 = medianoche). El juego empieza de día (08:09). */
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
      waterTint: new THREE.Color(), cloudTint: new THREE.Color(), exposure: 1.0,
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

  /** Intensidad del sol (0 noche · ~0.5 mediodía · >1 alba/ocaso) — para bloom adaptativo */
  get sunGlow() { return this.sample.sunGlow; }

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
