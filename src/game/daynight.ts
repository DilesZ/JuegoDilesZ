import * as THREE from 'three';
import { clamp, lerp } from './core';
import type { World } from './world';

/* ============================================================
   CICLO DÍA/NOCHE — AETHERIA (ESTILO ANIME)
   Paleta saturada tipo Ghibli/anime: día azul vivo con nubes
   blancas, atardeceres rosa-naranja, noche azul-violeta con
   estrellas. Keyframes por hora interpolados suavemente.
   El juego EMPIEZA DE DÍA (t = 0.34 ≈ 08:09).
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

/* Keyframes a lo largo de las 24 h (t = hora/24) — paleta ANIME */
const STOPS: Stop[] = [
  //        t     skyTop    skyMid    skyBot    fog       fogD     light     li    hemiS     hemiG     hemiI fill      fillI  sunA moonA glow  tint      stars aurora ff   mist torch env   water    cloud    exp   night
  { t: 0.00, skyTop: 0x0b1032, skyMid: 0x1a2456, skyBottom: 0x303a70, fog: 0x141b38, fogD: 0.0110, light: 0xaebfff, lightI: 1.25, hemiS: 0x27305e, hemiG: 0x15121c, hemiI: 0.5, fill: 0x2a3866, fillI: 0.28, sunA: 0, moonA: 1, glow: 0.0, tint: 0x9fb0e8, stars: 1, aurora: 1, ff: 1, mist: 1.25, torch: 1.4, env: 0.35, water: 0x1d4a66, cloud: 0x39456e, exp: 1.04, night: 1 },
  { t: 0.21, skyTop: 0x101640, skyMid: 0x22306a, skyBottom: 0x3c4884, fog: 0x1a2244, fogD: 0.0105, light: 0xa8bcf2, lightI: 1.15, hemiS: 0x2c3666, hemiG: 0x181420, hemiI: 0.52, fill: 0x303e70, fillI: 0.28, sunA: 0, moonA: 0.9, glow: 0.05, tint: 0xa2b0e8, stars: 0.85, aurora: 0.85, ff: 0.9, mist: 1.35, torch: 1.35, env: 0.4, water: 0x1d4a66, cloud: 0x414d78, exp: 1.03, night: 0.95 },
  { t: 0.265, skyTop: 0x4a5aa8, skyMid: 0xd88aa0, skyBottom: 0xffc27a, fog: 0xc89890, fogD: 0.0085, light: 0xffc990, lightI: 2.5, hemiS: 0x8a7ab0, hemiG: 0x4a3a30, hemiI: 0.8, fill: 0xe0b0a0, fillI: 0.4, sunA: 0.9, moonA: 0.15, glow: 1.1, tint: 0xffb070, stars: 0.05, aurora: 0.1, ff: 0.15, mist: 1.4, torch: 1.1, env: 0.7, water: 0x6a7ab0, cloud: 0xffd0b8, exp: 1.0, night: 0.35 },
  { t: 0.33, skyTop: 0x2f7ad9, skyMid: 0x74b4ea, skyBottom: 0xd6ecf6, fog: 0xc2dcee, fogD: 0.0068, light: 0xfff3d8, lightI: 2.6, hemiS: 0x7fb0e0, hemiG: 0x5a7a46, hemiI: 1.05, fill: 0xd0e6ff, fillI: 0.5, sunA: 1, moonA: 0, glow: 0.5, tint: 0xffe8c0, stars: 0, aurora: 0, ff: 0, mist: 0.6, torch: 0.5, env: 1.0, water: 0x2e7a9e, cloud: 0xffffff, exp: 1.0, night: 0 },
  { t: 0.50, skyTop: 0x2a72d4, skyMid: 0x6fb0e8, skyBottom: 0xcfeaf4, fog: 0xc6e0ee, fogD: 0.006, light: 0xfffbee, lightI: 2.75, hemiS: 0x86b8e6, hemiG: 0x5f8248, hemiI: 1.15, fill: 0xdceeff, fillI: 0.55, sunA: 1, moonA: 0, glow: 0.4, tint: 0xfff2cf, stars: 0, aurora: 0, ff: 0, mist: 0.5, torch: 0.45, env: 1.1, water: 0x2e86aa, cloud: 0xffffff, exp: 1.0, night: 0 },
  { t: 0.66, skyTop: 0x3076cf, skyMid: 0x7ab0e0, skyBottom: 0xeae2c0, fog: 0xcadcd2, fogD: 0.0066, light: 0xffeecb, lightI: 2.6, hemiS: 0x84a8d4, hemiG: 0x5c7842, hemiI: 1.0, fill: 0xdce8dd, fillI: 0.48, sunA: 1, moonA: 0, glow: 0.6, tint: 0xffd9a0, stars: 0, aurora: 0, ff: 0, mist: 0.65, torch: 0.6, env: 1.0, water: 0x2e7a9a, cloud: 0xfff4e0, exp: 1.0, night: 0 },
  { t: 0.735, skyTop: 0x4a4a8e, skyMid: 0xc06a92, skyBottom: 0xff9a5e, fog: 0xc08a78, fogD: 0.0082, light: 0xffa060, lightI: 2.6, hemiS: 0x9a6a92, hemiG: 0x3a2a20, hemiI: 0.8, fill: 0xffb090, fillI: 0.45, sunA: 0.95, moonA: 0.1, glow: 1.15, tint: 0xff8a4a, stars: 0.08, aurora: 0.15, ff: 0.25, mist: 1.0, torch: 1.0, env: 0.75, water: 0x6a6a9e, cloud: 0xffb898, exp: 1.0, night: 0.3 },
  { t: 0.79, skyTop: 0x1a2450, skyMid: 0x3a3466, skyBottom: 0x6a4a68, fog: 0x322e4e, fogD: 0.0096, light: 0xb8a8e0, lightI: 1.1, hemiS: 0x303258, hemiG: 0x16121a, hemiI: 0.5, fill: 0x34305a, fillI: 0.28, sunA: 0.25, moonA: 0.55, glow: 0.35, tint: 0xd090b0, stars: 0.5, aurora: 0.55, ff: 0.7, mist: 1.2, torch: 1.25, env: 0.55, water: 0x2c4066, cloud: 0x4a4a80, exp: 1.02, night: 0.7 },
  { t: 0.86, skyTop: 0x0b1032, skyMid: 0x1a2456, skyBottom: 0x303a70, fog: 0x141b38, fogD: 0.0110, light: 0xaebfff, lightI: 1.25, hemiS: 0x27305e, hemiG: 0x15121c, hemiI: 0.5, fill: 0x2a3866, fillI: 0.28, sunA: 0, moonA: 1, glow: 0, tint: 0x9fb0e8, stars: 1, aurora: 1, ff: 1, mist: 1.25, torch: 1.4, env: 0.35, water: 0x1d4a66, cloud: 0x39456e, exp: 1.04, night: 1 },
  { t: 1.00, skyTop: 0x0b1032, skyMid: 0x1a2456, skyBottom: 0x303a70, fog: 0x141b38, fogD: 0.0110, light: 0xaebfff, lightI: 1.25, hemiS: 0x27305e, hemiG: 0x15121c, hemiI: 0.5, fill: 0x2a3866, fillI: 0.28, sunA: 0, moonA: 1, glow: 0, tint: 0x9fb0e8, stars: 1, aurora: 1, ff: 1, mist: 1.25, torch: 1.4, env: 0.35, water: 0x1d4a66, cloud: 0x39456e, exp: 1.04, night: 1 },
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
