import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, terrainHeight, WORLD, fbm, lerp, rand, clamp } from './core';
import {
  buildObelisk, buildBonfire, buildTorch, buildRuinedPillar, buildBrokenArch,
  buildSigil, grassGeometry, grassMaterial, canopyMat, pineCanopyMat,
  buildOakGeos, buildPineGeos, bushGeo, logGeo, rockRealGeo, monolithGeo,
  barkMat, stoneMat, woodMat, emisMat, stdMat, mushroomGeos, toonMat,
  updateWindAndFlames, registerWind, flowerGeometry, flowerMaterial, type ToonMat,
} from './models';
import { Particles } from './particles';
import {
  terrainSplat, glowSprite, mistTexture, moonTexture, pbrTex, cloudPuffTexture,
  waterNormal, arenaFloorTexture, bannerTexture, stoneMaps, milkyWayTexture,
  butterflyWingTexture,
} from './textures';
import type { DayNightSample } from './daynight';

/* ============================================================
   MUNDO REALISTA: HDRI de PolyHaven/three.js para IBL, árboles con
   tarjetas de follaje fotográficas, rocas PBR irregulares, nubes
   billboard suaves, niebla exponencial y hoguera/santuarios/arena.
   ============================================================ */

interface Collider { x: number; z: number; r: number }

export interface ShrineState {
  idx: number;
  name: string;
  pos: THREE.Vector3;
  cleansed: boolean;
  group: THREE.Group;
  crystal: THREE.Mesh;
  runes: THREE.Mesh[];
  crystalMat: ToonMat;
  runeMats: ToonMat[];
  light: THREE.PointLight;
  shards: THREE.Mesh[];
  aura: THREE.Mesh;
  runeRing: THREE.Mesh;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  beamTarget: number;
}

const AURORA_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTime; uniform float uPhase; uniform float uGlobalA; uniform vec3 uColA; uniform vec3 uColB;
void main(){
  float x = vUv.x * 6.28318;
  float band = sin(x*2.0 + uTime*0.11 + uPhase) * 0.5
             + sin(x*5.0 - uTime*0.17 + uPhase*2.1) * 0.3
             + sin(x*11.0 + uTime*0.29) * 0.2;
  float y = vUv.y;
  float curtain = smoothstep(0.02, 0.3, y) * (1.0 - smoothstep(0.45, 0.98, y));
  float rays = 0.5 + 0.5 * sin(x*26.0 + band*4.0 + uTime*0.4 + uPhase*3.0);
  float i = curtain * (0.35 + 0.65 * rays);
  vec3 col = mix(uColA, uColB, clamp(y * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(col * i * 0.9 * uGlobalA, i * uGlobalA);
}`;

const AURORA_VERT = `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export class World {
  scene: THREE.Scene;
  colliders: Collider[] = [];
  shrines: ShrineState[] = [];
  bonfirePos = new THREE.Vector3(WORLD.bonfire.x, 0, WORLD.bonfire.z);
  bonfireLight!: THREE.PointLight;
  bonfireFlame: THREE.Mesh | null = null;
  sigil: { group: THREE.Group; ring: THREE.Mesh; ringMat: ToonMat } | null = null;

  private time = 0;
  private moonLight!: THREE.DirectionalLight;
  private skyTime: { value: number } = { value: 0 };
  private waterTime: { value: number } = { value: 0 };
  private mist: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseO: number; spin: number }[] = [];
  private smoke: Particles;
  private fx: Particles;
  private shrineWispT = 0;
  private meteorT = 9;
  private auroraMats: THREE.ShaderMaterial[] = [];
  private moonDir = new THREE.Vector3();

  /* ---- referencias para el ciclo día/noche ---- */
  private dn = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunTint: { value: new THREE.Color(0xffe8c0) },
    sunGlow: { value: 0.5 },
    starsA: { value: 1 },
    auroraA: { value: 1 },
    ffA: { value: 1 },
    pollenA: { value: 0 },
  };
  /** colores temporales reutilizables (evita GC en applyDayNight) */
  private _c1 = new THREE.Color();
  private _c2 = new THREE.Color();
  private _c3 = new THREE.Color();
  private skyMat!: THREE.ShaderMaterial;
  private hemi!: THREE.HemisphereLight;
  private fill!: THREE.DirectionalLight;
  private moonGroup: THREE.Group | null = null;
  private moonHaloMats: THREE.SpriteMaterial[] = [];
  private moonMat: THREE.MeshBasicMaterial | null = null;
  /** banda de Vía Láctea (opacidad por la noche) */
  private milkyWayMat: THREE.MeshBasicMaterial | null = null;
  private sunSprites: THREE.Sprite[] = [];
  private sunMat: THREE.SpriteMaterial | null = null;
  private sunGlowMat: THREE.SpriteMaterial | null = null;
  private waterMat: THREE.ShaderMaterial | null = null;
  private envIntensityTarget = 0.5;
  private nightK = 1; // factor de oscuridad actual (para antorchas etc.)
  private mistMul = 1.2; // multiplicador de niebla rasante
  private terrainMat: THREE.MeshStandardMaterial | null = null;

  /* ---- nubes billboard fotorrealistas ---- */
  private clouds: { mat: THREE.ShaderMaterial; speed: number; baseY: number }[] = [];
  /** quaternion de la cámara activa, para billboards en onBeforeRender */
  private cameraQuat = new THREE.Quaternion();

  /* ---- entornos HDRI (IBL) ---- */
  private envDay: THREE.Texture | null = null;
  private envDusk: THREE.Texture | null = null;
  private envBucket = '';
  private rendererRef: THREE.WebGLRenderer | null = null;

  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.scene = scene;
    this.rendererRef = renderer ?? null;
    this.smoke = new Particles(scene, 420, 'alpha');
    this.fx = new Particles(scene, 500, 'additive');
    this.buildSky();
    this.buildLights();
    this.buildClouds();
    this.buildSunBeams();
    this.buildTerrain();
    this.buildDecorations();
    this.buildLunarBasin();
    this.buildBonfire();
    this.buildShrines();
    this.buildArena();
    this.buildRoost();
    this.buildRain();
    if (renderer) this.buildEnvironmentMap(renderer);
  }

  height(x: number, z: number): number { return terrainHeight(x, z); }

  resolve(pos: THREE.Vector3, radius: number) {
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d2 = dx * dx + dz * dz;
      const minD = c.r + radius;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  /* ---------- Cielo: aurora, estrellas titilantes, luna ---------- */

  private makeAuroraMat(colA: number, colB: number, phase: number): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      uniforms: {
        uTime: this.skyTime,
        uPhase: { value: phase },
        uGlobalA: this.dn.auroraA,
        uColA: { value: new THREE.Color(colA) },
        uColB: { value: new THREE.Color(colB) },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.auroraMats.push(m);
    return m;
  }

  private buildSky() {
    // cúpula con degradado dinámico + dispersión atmosférica hacia el sol
    const skyGeo = new THREE.SphereGeometry(420, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x040711) },
        mid: { value: new THREE.Color(0x0a1322) },
        bottom: { value: new THREE.Color(0x101a28) },
        uSunDir: this.dn.sunDir,
        uSunTint: this.dn.sunTint,
        uSunGlow: this.dn.sunGlow,
        uFlash: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        uniform vec3 uSunDir; uniform vec3 uSunTint; uniform float uSunGlow; uniform float uFlash;
        void main(){
          vec3 n = normalize(vP);
          float h = n.y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bottom, pow(-h, 0.5));
          // banda de horizonte
          c += vec3(0.02, 0.05, 0.06) * exp(-abs(h) * 9.0);
          // dispersión atmosférica: resplandor alrededor del sol
          float sd = max(dot(n, normalize(uSunDir)), 0.0);
          c += uSunTint * (pow(sd, 5.0) * 0.32 + pow(sd, 42.0) * 0.55) * uSunGlow;
          // FLASH DE RELÁMPAGO: ilumina la bóveda desde arriba
          c += vec3(0.85, 0.9, 1.0) * uFlash * (0.35 + 0.65 * smoothstep(-0.1, 1.0, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.skyMat = skyMat;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10;
    this.scene.add(sky);

    // estrellas con parpadeo y color variado
    const rng = mulberry32(777);
    const starCount = 1400;
    const pos = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phase = new Float32Array(starCount);
    const col = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const th = rng() * Math.PI * 2;
      const ph = Math.acos(rng() * 0.88);
      const r = 400;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r + 20;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      sizes[i] = 0.8 + rng() * 2.4;
      phase[i] = rng() * Math.PI * 2;
      // blanco azulado, blanco cálido o dorado
      const k = rng();
      const c = k < 0.6 ? [0.85, 0.9, 1.0] : k < 0.85 ? [1.0, 0.98, 0.92] : [1.0, 0.85, 0.6];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.skyTime, uGlobalA: this.dn.starsA },
      vertexShader: `attribute float aSize; attribute float aPhase; attribute vec3 aColor;
        uniform float uTime; uniform float uGlobalA; varying float vA; varying vec3 vC;
        void main(){ vC = aColor;
          vA = (0.55 + 0.45 * sin(uTime * 1.9 + aPhase)) * uGlobalA;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * (620.0 / -mv.z), 1.0, 7.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
          float a = smoothstep(0.5, 0.08, d) * vA;
          gl_FragColor = vec4(vC, a); }`,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.renderOrder = -9;
    this.scene.add(stars);

    // VÍA LÁCTEA: cúpula interior con la banda estelar (visible de noche)
    const mwMat = new THREE.MeshBasicMaterial({
      map: milkyWayTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      fog: false, side: THREE.BackSide,
    });
    const mw = new THREE.Mesh(new THREE.SphereGeometry(405, 32, 20), mwMat);
    // la banda cruza el cielo en diagonal: rotamos para que atraviese el cenit
    mw.rotation.z = 0.9;
    mw.rotation.y = 0.6;
    mw.renderOrder = -9;
    this.scene.add(mw);
    this.milkyWayMat = mwMat;

    // auroras boreales (3 cintas)
    const auroraGeo = new THREE.PlaneGeometry(560, 130, 1, 1);
    const ribbons: [number, number, number, number, number, number][] = [
      // [y, z, rotY, phase, colA, colB]
      [158, -240, 0.0, 0.0, 0x2bd8a4, 0x3affc8],
      [172, -230, -0.55, 2.2, 0x36e07a, 0x7ae0ff],
      [150, -250, 0.5, 4.4, 0x8a5cff, 0x2bd8a4],
    ];
    for (const [y, z, ry, ph, ca, cb] of ribbons) {
      const m = new THREE.Mesh(auroraGeo, this.makeAuroraMat(ca, cb, ph));
      m.position.set(0, y, z);
      m.rotation.y = ry;
      m.rotation.x = -0.12;
      m.renderOrder = -7;
      this.scene.add(m);
    }

    // luna con textura + halos (grupo para el ciclo día/noche)
    const moonGroup = new THREE.Group();
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, transparent: true });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18), moonMat);
    moon.position.set(-185, 168, -150);
    moon.renderOrder = -8;
    moonGroup.add(moon);
    this.moonMat = moonMat;
    this.moonDir.copy(moon.position).normalize();

    const mkHalo = (scale: number, opacity: number, color: number) => {
      const sm = new THREE.SpriteMaterial({
        map: glowSprite(), color, opacity,
        transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(sm);
      s.position.copy(moon.position);
      s.scale.setScalar(scale);
      s.renderOrder = -8;
      moonGroup.add(s);
      this.moonHaloMats.push(sm);
      return s;
    };
    mkHalo(58, 0.5, 0x9fb4e8);
    mkHalo(150, 0.16, 0x6d84c8);
    this.moonGroup = moonGroup;
    this.scene.add(moonGroup);

    // SOL: disco cálido + glorias aditivas (visible de día)
    const mkSunSprite = (scale: number, opacity: number, color: number) => {
      const sm = new THREE.SpriteMaterial({
        map: glowSprite(), color, opacity,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(sm);
      s.scale.setScalar(scale);
      s.renderOrder = -8;
      this.scene.add(s);
      this.sunSprites.push(s);
      return sm;
    };
    this.sunGlowMat = mkSunSprite(210, 0.34, 0xffd9a0);
    this.sunMat = mkSunSprite(64, 0.8, 0xfff3d0);
  }

  /* ---------- Nubes: billboards suaves con luz del sol ---------- */

  private buildClouds() {
    const rng = mulberry32(3141);
    const tex = cloudPuffTexture();
    // shader propio: cada nube se ilumina según su lado respecto al sol
    // (lado solar cálido+dorado · lado opuesto azulado) con normal falsa 2D
    const mkCloudMat = () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        map: { value: tex },
        uTint: { value: new THREE.Color(0xffffff) },
        uSunDir: this.dn.sunDir,
        uSunTint: this.dn.sunTint,
        uSunGlow: this.dn.sunGlow,
        uNight: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 uTint; uniform vec3 uSunDir;
        uniform vec3 uSunTint; uniform float uSunGlow; uniform float uNight;
        varying vec2 vUv;
        void main(){
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.02) discard;
          // dirección de pantalla hacia el sol (proyección)
          vec3 sd = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          // gradiente a lo ancho del sprite: iluminación direccional
          float g = clamp((vUv.x - 0.5) * -sd.x * 2.2 + (vUv.y - 0.22) * sd.y * 1.4 + 0.5, 0.0, 1.0);
          vec3 lit = mix(uTint * vec3(0.72, 0.78, 0.98), uTint * 1.06, g);
          lit += uSunTint * pow(g, 3.0) * uSunGlow * 0.34;   // borde dorado lado solar
          lit = mix(lit, lit * vec3(0.32, 0.4, 0.62), uNight); // tinte nocturno azulado
          gl_FragColor = vec4(lit, t.a * (1.0 - uNight * 0.35));
        }`,
    });
    for (let i = 0; i < 12; i++) {
      const mat = mkCloudMat();
      const group = new THREE.Group();
      const puffs = 5 + ((rng() * 4) | 0);
      const w = 26 + rng() * 30;
      for (let p = 0; p < puffs; p++) {
        // plano billboard manual: siempre mira a cámara pero se ilumina por UV
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        const sz = w * (0.42 + rng() * 0.4);
        s.scale.set(sz, sz * (0.52 + rng() * 0.2), 1);
        s.position.set(
          (p / (puffs - 1) - 0.5) * w + (rng() - 0.5) * 6,
          (rng() - 0.3) * w * 0.16,
          (rng() - 0.5) * w * 0.22,
        );
        s.onBeforeRender = () => { s.quaternion.copy(this.cameraQuat); };
        group.add(s);
      }
      const a = rng() * Math.PI * 2;
      const r = 175 + rng() * 150;
      const baseY = 78 + rng() * 34;
      group.position.set(Math.cos(a) * r, baseY, Math.sin(a) * r);
      this.scene.add(group);
      this.clouds.push({ mat, speed: 0.5 + rng() * 0.9, baseY });
      this.cloudGroups.push(group);
    }
  }
  private cloudGroups: THREE.Object3D[] = [];

  /* ---------- God rays: haces volumétricos al alba/atardecer ---------- */

  private sunBeams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private beamGroup: THREE.Group | null = null;

  private buildSunBeams() {
    // 8 haces cilíndricos aditivos alrededor del sol: solo se ven cuando
    // el sol está bajo (alba/ocaso) — coste ~8 draw calls con blending
    this.beamGroup = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.9, 4.2, 130, 6, 1, true);
    geo.translate(0, -35, 0);
    const tex = mistTexture();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffd9a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.beamGroup.add(mesh);
      this.sunBeams.push({ mesh, mat });
    }
    this.beamGroup.visible = false;
    this.scene.add(this.beamGroup);
  }

  /** Orienta los haces hacia el sol y ajusta su opacidad por franja horaria */
  private updateSunBeams(sunDir: THREE.Vector3, sunGlow: number, tint: THREE.Color, sunA: number) {
    if (!this.beamGroup) return;
    // visibles solo con el sol bajo y brillante (alba/atardecer)
    const k = clamp(sunGlow * sunA, 0, 1) * clamp(1 - Math.abs(sunDir.y) * 1.6, 0, 1);
    this.beamGroup.visible = k > 0.02;
    if (!this.beamGroup.visible) return;
    this.beamGroup.position.set(0, 0, 0);
    for (let i = 0; i < this.sunBeams.length; i++) {
      const b = this.sunBeams[i];
      // distribuye los haces en un cono abierto alrededor del eje solar
      const offA = (i / this.sunBeams.length) * Math.PI * 2;
      const offR = 14 + (i % 3) * 9;
      b.mesh.position.set(
        sunDir.x * 210 + Math.cos(offA) * offR,
        sunDir.y * 210 - 20,
        sunDir.z * 210 + Math.sin(offA) * offR,
      );
      // el haz apunta hacia el sol (eje Y del cilindro)
      b.mesh.lookAt(sunDir.x * 420, sunDir.y * 420, sunDir.z * 420);
      b.mesh.rotateX(Math.PI / 2);
      b.mat.color.copy(tint);
      b.mat.opacity = k * (i % 2 === 0 ? 0.05 : 0.032);
    }
  }

  /* ---------- Luces ---------- */

  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0x2e4070, 0x1a1512, 0.5);
    this.scene.add(this.hemi);

    // luz con sombras compartida: SOL de día, LUNA de noche
    this.moonLight = new THREE.DirectionalLight(0xaec6ff, 1.22);
    this.moonLight.position.set(-40, 55, -30);
    this.moonLight.castShadow = true;
    // Alta resolución + PCF Soft: sombras nítidas cerca del jugador (AAA)
    this.moonLight.shadow.mapSize.set(3072, 3072);
    this.moonLight.shadow.camera.near = 2;
    this.moonLight.shadow.camera.far = 190;
    this.moonLight.shadow.radius = 2.6;
    this.moonLight.shadow.blurSamples = 12;
    const S = 34;
    this.moonLight.shadow.camera.left = -S;
    this.moonLight.shadow.camera.right = S;
    this.moonLight.shadow.camera.top = S;
    this.moonLight.shadow.camera.bottom = -S;
    this.moonLight.shadow.bias = -0.0004;
    this.moonLight.shadow.normalBias = 0.022;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // relleno frío suave desde el lado opuesto (levanta negros)
    this.fill = new THREE.DirectionalLight(0x36426a, 0.3);
    this.fill.position.set(34, 40, 28);
    this.scene.add(this.fill);
  }

  /**
   * Aplica el estado del ciclo día/noche a cielo, luces, niebla,
   * sol/luna, estrellas, aurora, luciérnagas y ambiente nocturno.
   */
  applyDayNight(s: DayNightSample, renderer: THREE.WebGLRenderer) {
    this.nightK = s.night;
    this.mistMul = s.mistMul;

    // cielo
    const su = this.skyMat.uniforms;
    (su.top.value as THREE.Color).copy(s.skyTop);
    (su.mid.value as THREE.Color).copy(s.skyMid);
    (su.bottom.value as THREE.Color).copy(s.skyBottom);
    // LLUVIA: cielo gris plomizo, dispersión atenuada
    const rk = this.rainK;
    if (rk > 0.01) {
      const gray = this._c1.set(0x5a636e);   // gris tormenta (reutilizado)
      const grayLo = this._c2.set(0x707a84); // gris horizonte
      (su.top.value as THREE.Color).lerp(gray, rk * 0.55);
      (su.mid.value as THREE.Color).lerp(gray, rk * 0.7);
      (su.bottom.value as THREE.Color).lerp(this._c3.copy(gray).lerp(grayLo, 0.4), rk * 0.75);
      this.dn.sunGlow.value = s.sunGlow * (1 - rk * 0.6);
    } else {
      this.dn.sunGlow.value = s.sunGlow;
    }
    this.dn.sunDir.value.copy(s.lightDir);
    this.dn.sunTint.value.copy(s.sunTint);
    // destello de relámpago en la bóveda (calculado en updateWeather)
    su.uFlash.value = this.skyFlash;

    // estrellas, aurora, luciérnagas (ocultas bajo la lluvia)
    this.dn.starsA.value = s.stars * (1 - rk);
    this.dn.auroraA.value = s.aurora * (1 - rk);
    this.dn.ffA.value = s.fireflies * (1 - rk * 0.7);
    // polen diurno: opuesto a luciérnagas (pleno día 0.8, anochecer 0)
    this.dn.pollenA.value = clamp(1 - s.night * 1.4, 0, 0.85);
    // Vía Láctea: solo de noche, con arranque suave (evita bandas fantasma de día)
    if (this.milkyWayMat) this.milkyWayMat.opacity = Math.max(0, s.stars - 0.25) * 0.62;

    // sol y luna visibles
    this.sunSprites.forEach((sp) => { sp.position.copy(s.lightDir).multiplyScalar(385); });
    if (this.sunMat) this.sunMat.opacity = 0.85 * s.sunA * (1 - rk * 0.85);
    if (this.sunGlowMat) this.sunGlowMat.opacity = 0.34 * s.sunA * (1 - rk * 0.85);
    // god rays volumétricos (alba/ocaso, apagados por la lluvia)
    this.updateSunBeams(s.lightDir, s.sunGlow * (1 - rk), s.sunTint, s.sunA * (1 - rk));
    if (this.moonGroup) {
      this.moonGroup.visible = s.moonA > 0.02;
      this.moonGroup.position.set(0, 0, 0);
    }
    if (this.moonMat) this.moonMat.opacity = s.moonA;
    this.moonHaloMats.forEach((m, i) => { m.opacity = (i === 0 ? 0.5 : 0.16) * s.moonA; });

    // luz direccional con sombras (sol de día / luna de noche; atenuada por lluvia)
    this.moonLight.color.copy(s.lightColor);
    this.moonLight.intensity = s.lightIntensity * (1 - rk * 0.55);

    // hemisférica + relleno
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.fill.color.copy(s.fillColor);
    this.fill.intensity = s.fillIntensity;

    // niebla volumétrica global
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(s.fogColor);
      this.rageFogTint(this.scene.fog.color);
      this.scene.fog.density = s.fogDensity;
    }

    // nubes billboard: tinte según hora + factor nocturno para el shader
    for (const c of this.clouds) {
      (c.mat.uniforms.uTint.value as THREE.Color).copy(s.cloudTint);
      c.mat.uniforms.uNight.value = s.night;
    }

    // agua de la Fuente Lunar
    if (this.waterMat) {
      (this.waterMat.uniforms.uSky.value as THREE.Color).copy(s.waterTint);
      (this.waterMat.uniforms.uMoonDir.value as THREE.Vector3).copy(s.lightDir);
    }

    // exposición y reflejos de entorno
    renderer.toneMappingExposure = s.exposure;
    this.envIntensityTarget = s.envIntensity;
    const sc = this.scene as THREE.Scene & { environmentIntensity?: number };
    if (sc.environmentIntensity !== undefined) sc.environmentIntensity = s.envIntensity;
    // IBL fotográfico por franja horaria (no-op si el HDRI no llegó)
    this.pickEnvBucket(s.t, s.night);
    // rotación del entorno para casar el sol del HDRI con el cielo
    const envRot = this.scene as THREE.Scene & { environmentRotation?: THREE.Euler };
    if (envRot.environmentRotation) envRot.environmentRotation.set(0, 2.4, 0);
  }

  /* ---------- Terreno con splat y senderos ---------- */

  private buildTerrain() {
    const seg = 150;
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // sombreado por pendiente + variación (contraste suave: evita facetas bajo luz rasante)
      const n = fbm(x * 0.11, z * 0.11, 3) * 0.5 + 0.5;
      const slope = 1 - Math.min(1, Math.abs(fbm(x * 0.05 + 31, z * 0.05 - 12, 2)) * 1.4);
      const shade = (0.93 + n * 0.12) * lerp(0.9, 1, slope);
      // MACRO-VARIACIÓN por zona: pradera cálida cerca del campamento,
      // musgo frío hacia el nido del dragón, neutro en el resto
      let r = shade, g = shade, b = shade;
      const dRoost = Math.hypot(x - WORLD.roost.x, z - WORLD.roost.z);
      const dCamp = Math.hypot(x - WORLD.bonfire.x, z - WORLD.bonfire.z);
      if (dRoost < 42) {
        // transición a musgo azulado cerca del cráter helado
        const k = (1 - dRoost / 42) * 0.5;
        r = shade * (1 - k * 0.16);
        g = shade * (1 - k * 0.04);
        b = shade * (1 + k * 0.12);
      } else if (dCamp < 38) {
        // pradera ligeramente dorada alrededor de la hoguera
        const k = (1 - dCamp / 38) * 0.4;
        r = shade * (1 + k * 0.1);
        g = shade * (1 + k * 0.04);
        b = shade * (1 - k * 0.1);
      }
      // VARIACIÓN POR ALTITUD: cumbres rocosas frías y desaturadas,
      // valles verdes fértiles (vende la escala del relieve)
      if (h > 4.5) {
        const k = Math.min(1, (h - 4.5) / 3.5) * 0.55;
        r = r * (1 - k * 0.06) + k * 0.06;
        g = g * (1 - k * 0.1);
        b = b * (1 + k * 0.05);
      } else if (h < 0.6) {
        // hondonadas umbrías con verdor profundo
        const k = (1 - h / 0.6) * 0.3;
        g = g * (1 + k * 0.06);
        b = b * (1 + k * 0.03);
      }
      c.setRGB(r, g, b);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // Terreno PBR moderno: splat con base fotográfica CC0 + normal + roughness
    const mat = new THREE.MeshStandardMaterial({
      map: terrainSplat(),
      normalMap: pbrTex('grass_normal.jpg', { srgb: false, repeat: 46 }),
      roughnessMap: pbrTex('grass_rough.jpg', { srgb: false, repeat: 46 }),
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 1.0,
      metalness: 0,
      vertexColors: true,
    });
    this.terrainMat = mat;
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    this.scene.add(terrain);
  }

  /* ---------- Decoración instanciada ---------- */

  private buildDecorations() {
    const rng = mulberry32(1337);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const treeSpots: [number, number, number][] = []; // x, z, escala

    // ==== ROBLES reales: tronco PBR + copa de tarjetas de follaje ====
    const oak = buildOakGeos();
    const OAKS = 52;
    const oakTrunks = new THREE.InstancedMesh(oak.trunk, barkMat(), OAKS);
    const oakCanopy = new THREE.InstancedMesh(oak.canopy, canopyMat(0xffffff), OAKS);
    oakTrunks.castShadow = oakCanopy.castShadow = true;
    oakTrunks.receiveShadow = oakCanopy.receiveShadow = true;

    // ==== PINOS reales: acículas por pisos cónicos ====
    const pine = buildPineGeos();
    const PINES = 82;
    const pineTrunks = new THREE.InstancedMesh(pine.trunk, barkMat(), PINES);
    const pineCanopy = new THREE.InstancedMesh(pine.canopy, pineCanopyMat(0xffffff), PINES);
    pineTrunks.castShadow = pineCanopy.castShadow = true;
    pineTrunks.receiveShadow = pineCanopy.receiveShadow = true;

    let oakPlaced = 0, pinePlaced = 0, guard = 0;
    while ((oakPlaced < OAKS || pinePlaced < PINES) && guard++ < 9000) {
      const a = rng() * Math.PI * 2;
      const r = 18 + rng() * (WORLD.radius - 24);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 14)) continue;
      const h = terrainHeight(x, z);
      if (h > 7.5) continue;
      const s = 0.85 + rng() * 0.55;
      // los pinos toleran altura y pendientes; robles prefieren valle
      const wantPine = h > 4.2 || rng() < 0.55;
      if (wantPine && pinePlaced < PINES) {
        dummy.position.set(x, h - 0.12, z);
        dummy.scale.set(s, s * (0.95 + rng() * 0.35), s);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.updateMatrix();
        pineTrunks.setMatrixAt(pinePlaced, dummy.matrix);
        pineCanopy.setMatrixAt(pinePlaced, dummy.matrix);
        // verde de acícula con variación natural
        tint.setRGB(0.95 + rng() * 0.35, 1.05 + rng() * 0.3, 0.9 + rng() * 0.28);
        pineCanopy.setColorAt(pinePlaced, tint);
        pinePlaced++;
      } else if (oakPlaced < OAKS) {
        dummy.position.set(x, h - 0.1, z);
        dummy.scale.set(s, s * (0.92 + rng() * 0.22), s);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.updateMatrix();
        oakTrunks.setMatrixAt(oakPlaced, dummy.matrix);
        oakCanopy.setMatrixAt(oakPlaced, dummy.matrix);
        // verde de hoja caduca, variación amarillenta
        const warm = rng();
        tint.setRGB(1.05 + warm * 0.35, 1.12 + rng() * 0.28, 0.85 + rng() * 0.3);
        oakCanopy.setColorAt(oakPlaced, tint);
        oakPlaced++;
      }
      treeSpots.push([x, z, s]);
      this.colliders.push({ x, z, r: 0.55 * s });
    }
    oakTrunks.count = oakPlaced; oakCanopy.count = oakPlaced;
    pineTrunks.count = pinePlaced; pineCanopy.count = pinePlaced;
    if (oakCanopy.instanceColor) oakCanopy.instanceColor.needsUpdate = true;
    if (pineCanopy.instanceColor) pineCanopy.instanceColor.needsUpdate = true;
    this.scene.add(oakTrunks, oakCanopy, pineTrunks, pineCanopy);

    // ==== ARBUSTOS cerca de árboles ====
    const BUSHES = 74;
    const bushMesh = new THREE.InstancedMesh(bushGeo(), canopyMat(0xffffff), BUSHES);
    bushMesh.castShadow = true; bushMesh.receiveShadow = true;
    let b = 0; guard = 0;
    while (b < BUSHES && guard++ < 4000) {
      const spot = treeSpots[(rng() * treeSpots.length) | 0];
      if (!spot) break;
      const x = spot[0] + (rng() - 0.5) * 9, z = spot[1] + (rng() - 0.5) * 9;
      if (this.nearCamp(x, z, 9)) continue;
      const h = terrainHeight(x, z);
      if (h > 7) continue;
      const s = 0.6 + rng() * 0.85;
      dummy.position.set(x, h - 0.03, z);
      dummy.scale.set(s * (0.9 + rng() * 0.3), s, s * (0.9 + rng() * 0.3));
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.updateMatrix();
      bushMesh.setMatrixAt(b, dummy.matrix);
      tint.setRGB(1.0 + rng() * 0.3, 1.08 + rng() * 0.22, 0.88 + rng() * 0.26);
      bushMesh.setColorAt(b, tint);
      b++;
    }
    bushMesh.count = b;
    if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
    this.scene.add(bushMesh);

    // ==== TRONCOS CAÍDOS ====
    const LOGS = 14;
    const logs = new THREE.InstancedMesh(logGeo(), barkMat(), LOGS);
    logs.castShadow = logs.receiveShadow = true;
    let l = 0; guard = 0;
    while (l < LOGS && guard++ < 2000) {
      const a = rng() * Math.PI * 2;
      const r = 16 + rng() * (WORLD.radius - 22);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 12)) continue;
      const h = terrainHeight(x, z);
      if (h > 6.5) continue;
      dummy.position.set(x, h, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.16);
      dummy.scale.setScalar(0.8 + rng() * 0.7);
      dummy.updateMatrix();
      logs.setMatrixAt(l, dummy.matrix);
      l++;
    }
    logs.count = l;
    this.scene.add(logs);

    // ==== Rocas PBR irregulares ====
    const rockCount = 92;
    const rocks = new THREE.InstancedMesh(rockRealGeo(), stoneMat(), rockCount);
    rocks.castShadow = rocks.receiveShadow = true;
    let rocksPlaced = 0; guard = 0;
    while (rocksPlaced < rockCount && guard++ < 4000) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * (WORLD.radius - 14);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 10)) continue;
      const s = 0.4 + rng() * 1.7;
      dummy.position.set(x, terrainHeight(x, z) + s * 0.2, z);
      dummy.scale.set(s * (0.9 + rng() * 0.4), s * 0.72, s * (0.9 + rng() * 0.4));
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.updateMatrix();
      rocks.setMatrixAt(rocksPlaced, dummy.matrix);
      const tone = 1.05 + rng() * 0.32;
      tint.setRGB(tone, tone * 0.99, tone * 1.05);
      rocks.setColorAt(rocksPlaced, tint);
      if (s > 0.9) this.colliders.push({ x, z, r: s * 0.9 });
      rocksPlaced++;
    }
    rocks.count = rocksPlaced;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.scene.add(rocks);

    // ==== MONOLITOS HEROICOS: hitos de piedra con líquenes ====
    // material propio (stoneMat es compartido y sin vertexColors)
    const { map: smMap, normalMap: smNorm } = stoneMaps();
    const monoMat = toonMat(0x9b948c, {
      map: smMap, normalMap: smNorm,
      roughness: 0.95, metalness: 0, vertexColors: true,
    });
    const monoCount = 9;
    for (let i = 0; i < monoCount; i++) {
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const a = rng() * Math.PI * 2;
        const r = 22 + rng() * (WORLD.radius - 30);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        ok = !this.nearCamp(x, z, 13)
          && Math.hypot(x - WORLD.roost.x, z - WORLD.roost.z) > WORLD.roost.r + 14
          && Math.hypot(x, z - 60) > 26; // fuera de la arena del jefe 1
      }
      if (!ok) continue;
      const h = terrainHeight(x, z);
      const s = 0.7 + rng() * 0.9;
      const m = new THREE.Mesh(monolithGeo(i * 13 + 7), monoMat);
      m.position.set(x, h + s * 2.2, z);
      m.scale.setScalar(s);
      m.rotation.set((rng() - 0.5) * 0.1, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      this.colliders.push({ x, z, r: s * 0.85 });
    }

    // ==== Hierba instanciada con viento + variación de tono ====
    const grassCount = 16000;
    const grass = new THREE.InstancedMesh(grassGeometry(), grassMaterial(), grassCount);
    let gPlaced = 0; guard = 0;
    while (gPlaced < grassCount && guard++ < 90000) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (WORLD.radius - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h > 6.5) continue;
      if (this.nearCamp(x, z, 4.5)) continue;
      dummy.position.set(x, h - 0.02, z);
      dummy.scale.set(0.85 + rng() * 0.95, 0.9 + rng() * 1.05, 0.85 + rng() * 0.95);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.updateMatrix();
      grass.setMatrixAt(gPlaced, dummy.matrix);
      const dry = rng();
      tint.setRGB(0.85 + dry * 0.3, 0.95 + rng() * 0.12, 0.7 + dry * 0.28);
      grass.setColorAt(gPlaced, tint);
      gPlaced++;
    }
    grass.count = gPlaced;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.scene.add(grass);

    // ==== FLORES SILVESTRES (amapolas, margaritas, lavanda) ====
    // dispersas en praderas (h<4), con manchas agrupadas como en la naturaleza
    const flowerCfg: [0 | 1 | 2, number][] = [[0, 300], [1, 340], [2, 260]];
    for (const [kind, count] of flowerCfg) {
      const fm = new THREE.InstancedMesh(flowerGeometry(kind), flowerMaterial(kind), count);
      let placed = 0; guard = 0;
      // centro de la mancha actual: las flores nacen en racimos
      let patchX = 0, patchZ = 0, patchLeft = 0;
      while (placed < count && guard++ < count * 12) {
        if (patchLeft <= 0) {
          // nueva mancha (evita campamentos y el cráter del dragón)
          const a = rng() * Math.PI * 2;
          const r = 10 + rng() * (WORLD.radius - 16);
          patchX = Math.cos(a) * r; patchZ = Math.sin(a) * r;
          if (this.nearCamp(patchX, patchZ, 8) || Math.hypot(patchX - WORLD.roost.x, patchZ - WORLD.roost.z) < WORLD.roost.r + 4) {
            patchLeft = 0; continue;
          }
          patchLeft = 6 + (rng() * 22 | 0);
        }
        const x = patchX + (rng() - 0.5) * 6.5;
        const z = patchZ + (rng() - 0.5) * 6.5;
        const h = terrainHeight(x, z);
        if (h > 4.2) { patchLeft--; continue; }
        dummy.position.set(x, h - 0.02, z);
        const s = 0.75 + rng() * 0.7;
        dummy.scale.set(s, s * (0.85 + rng() * 0.45), s);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.updateMatrix();
        fm.setMatrixAt(placed, dummy.matrix);
        placed++;
        patchLeft--;
      }
      fm.count = placed;
      this.scene.add(fm);
    }

    // ==== MARIPOSAS DIURNAS (dos alas que baten, rutas flotantes) ====
    this.buildButterflies(rng);

    // ==== Árboles muertos (silueta gótica cerca de ruinas) ====
    const deadGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.14, 0.3, 3.6, 7);
      trunk.translate(0, 1.8, 0);
      parts.push(trunk.toNonIndexed());
      for (let i = 0; i < 4; i++) {
        const b = new THREE.CylinderGeometry(0.05, 0.09, 1.5 + (i % 2) * 0.5, 5);
        b.translate(0, 0.7, 0);
        b.rotateZ(0.7 + (i % 2) * 0.5);
        b.rotateY(i * 1.65);
        b.translate(0, 2.2 + (i % 3) * 0.45, 0);
        parts.push(b.toNonIndexed());
      }
      return mergeGeometries(parts)!;
    })();
    const deadMat = toonMat(0x584a3c, { roughness: 0.95 });
    const deadCount = 22;
    const dead = new THREE.InstancedMesh(deadGeo, deadMat, deadCount);
    dead.castShadow = true; dead.receiveShadow = true;
    let deadPlaced = 0; guard = 0;
    while (deadPlaced < deadCount && guard++ < 3000) {
      const a = rng() * Math.PI * 2;
      const r = 22 + rng() * (WORLD.radius - 30);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 12)) continue;
      const dh = terrainHeight(x, z);
      if (dh > 8) continue;
      dummy.position.set(x, dh - 0.05, z);
      dummy.scale.setScalar(0.8 + rng() * 0.9);
      dummy.rotation.set((rng() - 0.5) * 0.14, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
      dummy.updateMatrix();
      dead.setMatrixAt(deadPlaced, dummy.matrix);
      deadPlaced++;
    }
    dead.count = deadPlaced;
    this.scene.add(dead);

    // ==== Setas luminosas ====
    const { stem, cap } = mushroomGeos();
    const stemMat = stdMat(0xe8dcc4);
    const capPurple = stdMat(0x8a4ac8, { emissive: 0xb06aff, emissiveIntensity: 1.1 });
    const capTeal = stdMat(0x1a8a7c, { emissive: 0x2af0d8, emissiveIntensity: 1.2 });
    const musStem = new THREE.InstancedMesh(stem, stemMat, 120);
    const musP = new THREE.InstancedMesh(cap, capPurple, 60);
    const musT = new THREE.InstancedMesh(cap, capTeal, 60);
    let ms = 0, mp = 0, mt = 0; guard = 0;
    while ((mp < 60 || mt < 60) && guard++ < 5000) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * (WORLD.radius - 20);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 14)) continue;
      const h = terrainHeight(x, z);
      if (h > 6.5) continue;
      const n = 2 + ((rng() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const mx = x + (rng() - 0.5) * 1.6, mz = z + (rng() - 0.5) * 1.6;
        const s = 0.7 + rng() * 1.1;
        dummy.position.set(mx, terrainHeight(mx, mz) - 0.02, mz);
        dummy.scale.setScalar(s);
        dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
        dummy.updateMatrix();
        if (ms < 120) musStem.setMatrixAt(ms++, dummy.matrix);
        const purple = rng() < 0.55;
        if (purple && mp < 60) musP.setMatrixAt(mp++, dummy.matrix);
        else if (!purple && mt < 60) musT.setMatrixAt(mt++, dummy.matrix);
      }
    }
    musStem.count = ms; musP.count = mp; musT.count = mt;
    this.scene.add(musStem, musP, musT);

    // ==== Ruinas dispersas ====
    const ruinSpots: [number, number][] = [[28, -28], [-30, -8], [12, 40], [-16, 58], [44, 52], [-44, -40], [64, -12], [20, -60]];
    for (const [x, z] of ruinSpots) {
      const g = new THREE.Group();
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const px = x + (rng() - 0.5) * 6;
        const pz = z + (rng() - 0.5) * 6;
        const ph = 1.2 + rng() * 2.2;
        const p = buildRuinedPillar(ph);
        p.position.set(px, terrainHeight(px, pz), pz);
        p.rotation.y = rng() * Math.PI;
        g.add(p);
        this.colliders.push({ x: px, z: pz, r: 0.55 });
      }
      if (rng() < 0.4) {
        const arch = buildBrokenArch();
        arch.position.set(x + 3, terrainHeight(x + 3, z), z + 2);
        arch.rotation.y = rng() * Math.PI * 2;
        g.add(arch);
      }
      // columna caída
      if (rng() < 0.6) {
        const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 2.2, 8), stoneMat());
        fall.rotation.z = Math.PI / 2;
        fall.rotation.y = rng() * Math.PI;
        const fx = x + (rng() - 0.5) * 5, fz = z + (rng() - 0.5) * 5;
        fall.position.set(fx, terrainHeight(fx, fz) + 0.3, fz);
        fall.castShadow = fall.receiveShadow = true;
        g.add(fall);
        this.colliders.push({ x: fx, z: fz, r: 0.8 });
      }
      this.scene.add(g);
    }

    // ==== Niebla rasante ====
    this.buildMist(rng);

    // ==== Luciérnagas ====
    this.buildFireflies();

    // ==== Polen diurno (deriva dorada al sol) ====
    this.buildPollen();

    // Antorchas alrededor de cada santuario y en la arena
    for (const s of WORLD.shrines) this.addTorchRing(s.x, s.z, s.r - 2, 4, rng, false);
    this.addTorchRing(WORLD.arena.x, WORLD.arena.z, WORLD.arena.r - 3, 6, rng, true);
    this.addTorch(WORLD.bonfire.x + 3.4, WORLD.bonfire.z - 2.4, terrainHeight(WORLD.bonfire.x + 3.4, WORLD.bonfire.z - 2.4), false);
    this.addTorch(WORLD.bonfire.x - 3.2, WORLD.bonfire.z - 2.8, terrainHeight(WORLD.bonfire.x - 3.2, WORLD.bonfire.z - 2.8), false);
  }

  private nearCamp(x: number, z: number, margin: number): boolean {
    if (Math.hypot(x - WORLD.bonfire.x, z - WORLD.bonfire.z) < margin + 3) return true;
    for (const s of WORLD.shrines) if (Math.hypot(x - s.x, z - s.z) < margin + 3) return true;
    if (Math.hypot(x - WORLD.arena.x, z - WORLD.arena.z) < WORLD.arena.r + margin - 4) return true;
    return false;
  }

  /* ---------- Niebla rasante ---------- */

  private buildMist(rng: ReturnType<typeof mulberry32>) {
    const tex = mistTexture();
    const spots: [number, number, number][] = [
      // [x, z, opacidad]
      [20, 18, 0.1], [-24, 30, 0.12], [10, -30, 0.09], [-38, -22, 0.11],
      [52, 34, 0.1], [-8, 52, 0.1], [36, -8, 0.08], [-52, 8, 0.1],
      [WORLD.arena.x - 12, WORLD.arena.z + 10, 0.13], [WORLD.shrines[2].x + 8, WORLD.shrines[2].z + 6, 0.12],
    ];
    for (const [x, z, o] of spots) {
      const geo = new THREE.PlaneGeometry(30, 30);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: o, depthWrite: false,
        color: 0xcfe2f2,
      });
      const m = new THREE.Mesh(geo, mat);
      const y = terrainHeight(x, z);
      m.position.set(x, y + 0.55 + rng() * 0.5, z);
      m.rotation.y = rng() * Math.PI * 2;
      m.renderOrder = 4;
      this.scene.add(m);
      this.mist.push({ mesh: m, mat, baseO: o, spin: (rng() - 0.5) * 0.02 });
    }
  }

  /* ---------- Luciérnagas ---------- */

  private buildFireflies() {
    const rng = mulberry32(555);
    const N = 130;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const speed = new Float32Array(N);
    const size = new Float32Array(N);
    let i = 0, guard = 0;
    while (i < N && guard++ < 3000) {
      const a = rng() * Math.PI * 2;
      const r = 8 + rng() * (WORLD.radius - 16);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h > 6) continue;
      pos[i * 3] = x; pos[i * 3 + 1] = h + 0.4 + rng() * 1.4; pos[i * 3 + 2] = z;
      phase[i] = rng() * Math.PI * 2;
      speed[i] = 0.5 + rng() * 0.9;
      size[i] = 3 + rng() * 4;
      i++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.skyTime, uGlobalA: this.dn.ffA },
      vertexShader: `attribute float aPhase; attribute float aSpeed; attribute float aSize;
        uniform float uTime; uniform float uGlobalA; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * aSpeed + aPhase) * 1.3;
          p.y += sin(uTime * aSpeed * 0.7 + aPhase * 2.0) * 0.55;
          p.z += cos(uTime * aSpeed * 0.85 + aPhase) * 1.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(aSize * (150.0 / max(0.1, -mv.z)), 1.0, 26.0);
          float nearFade = smoothstep(2.2, 6.0, -mv.z);
          vA = (pow(0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 3.0), 2.2) * 0.9 + 0.06) * nearFade * uGlobalA;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
          float a = smoothstep(0.5, 0.06, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.82, 1.0, 0.55) * 1.6, a); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.scene.add(pts);
  }

  /* ---------- Polen diurno: motas doradas a la deriva ---------- */

  private buildPollen() {
    const rng = mulberry32(9090);
    const N = 220;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const speed = new Float32Array(N);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r = 6 + rng() * (WORLD.radius - 10);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      pos[i * 3] = x; pos[i * 3 + 1] = h + 0.5 + rng() * 3.2; pos[i * 3 + 2] = z;
      phase[i] = rng() * Math.PI * 2;
      speed[i] = 0.25 + rng() * 0.6;
      size[i] = 1.6 + rng() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.skyTime, uGlobalA: this.dn.pollenA },
      vertexShader: `attribute float aPhase; attribute float aSpeed; attribute float aSize;
        uniform float uTime; uniform float uGlobalA; varying float vA;
        void main(){
          vec3 p = position;
          // deriva lenta de brisa: círculos amplios + caída/flotación
          p.x += sin(uTime * aSpeed * 0.5 + aPhase) * 2.6;
          p.y += sin(uTime * aSpeed * 0.31 + aPhase * 1.7) * 0.8;
          p.z += cos(uTime * aSpeed * 0.42 + aPhase * 0.7) * 2.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(aSize * (140.0 / max(0.1, -mv.z)), 1.0, 14.0);
          // parpadeo suave al girar (destello de polen al sol)
          vA = (0.5 + 0.5 * sin(uTime * aSpeed * 2.3 + aPhase * 5.0)) * uGlobalA;
          vA = 0.1 + vA * 0.9;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
          float a = smoothstep(0.5, 0.05, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.68) * 1.35, a); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.scene.add(pts);
  }

  /* ---------- Mariposas diurnas: alas que baten con rutas flotantes ---------- */

  private butterflies: {
    root: THREE.Group;
    wingL: THREE.Mesh;
    wingR: THREE.Mesh;
    cx: number; cy: number; cz: number;   // centro de deriva
    rad: number;                           // radio de la ruta
    spd: number; phase: number; beat: number;
  }[] = [];

  private buildButterflies(rng: () => number) {
    const wingTex = butterflyWingTexture();
    const mkWing = (mirror: number) => {
      const mat = new THREE.MeshBasicMaterial({
        map: wingTex, transparent: true, side: THREE.DoubleSide,
        depthWrite: false, fog: true, alphaTest: 0.06,
      });
      const geo = new THREE.PlaneGeometry(0.16, 0.2);
      geo.translate(0, 0.1, 0); // pivote en la base del ala (junto al cuerpo)
      if (mirror < 0) geo.scale(-1, 1, 1);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 4;
      return m;
    };
    const N = 14;
    for (let i = 0; i < N; i++) {
      const root = new THREE.Group();
      // alas: la Z local del quad es el eje de batido
      const wingL = mkWing(1);
      const wingR = mkWing(-1);
      wingL.rotation.y = 0.55;
      wingR.rotation.y = -0.55;
      root.add(wingL, wingR);
      // posición de la ruta flotante
      let x = 0, z = 0;
      for (let t = 0; t < 20; t++) {
        const a = rng() * Math.PI * 2;
        const r = 8 + rng() * (WORLD.radius - 14);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        if (!this.nearCamp(x, z, 6) && terrainHeight(x, z) < 4.5) break;
      }
      const cy = terrainHeight(x, z) + 1 + rng() * 1.4;
      this.butterflies.push({
        root, wingL, wingR,
        cx: x, cy, cz: z,
        rad: 1.6 + rng() * 2.6,
        spd: 0.3 + rng() * 0.5,
        phase: rng() * Math.PI * 2,
        beat: 11 + rng() * 7,
      });
      this.scene.add(root);
    }
    // visible solo de día (uniform compartido vía pollenA)
    for (const b of this.butterflies) b.root.visible = true;
  }

  /** mueve las mariposas (llamado en update; dayK = visibilidad diurna) */
  private updateButterflies(dt: number, dayK: number) {
    for (const b of this.butterflies) {
      b.phase += dt * b.spd;
      // deriva orbital suave alrededor del centro + vaivén vertical
      const px = b.cx + Math.sin(b.phase) * b.rad;
      const pz = b.cz + Math.cos(b.phase * 0.83 + 1.7) * b.rad;
      const py = b.cy + Math.sin(b.phase * 2.1) * 0.32;
      const nx = px - b.root.position.x;
      const nz = pz - b.root.position.z;
      b.root.position.set(px, py, pz);
      if (nx * nx + nz * nz > 1e-6) b.root.rotation.y = Math.atan2(nx, nz);
      // batido: rotación en Z de cada ala alrededor del cuerpo
      const flap = Math.sin(this.time * b.beat + b.phase * 3) * 0.9;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
      // desvanecer de noche
      const v = dayK > 0.05;
      if (b.root.visible !== v) b.root.visible = v;
    }
  }

  /* ---------- CLIMA: lluvia ocasional con charcos ---------- */

  /** 0 = despejado · 1 = diluvio (transiciones suaves) */
  private rainK = 0;
  private rainTarget = 0;
  private rainNextT = 55; // s hasta el próximo cambio de clima
  private rainPoints: THREE.Points | null = null;
  private rainMat: THREE.ShaderMaterial | null = null;
  private puddles: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; baseY: number }[] = [];

  private buildRain() {
    // cortina de gotas: 900 puntos en un cilindro alrededor de la cámara
    const N = 900;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    const rng = mulberry32(2024);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rng() - 0.5) * 46;
      pos[i * 3 + 1] = rng() * 26;
      pos[i * 3 + 2] = (rng() - 0.5) * 46;
      speed[i] = 22 + rng() * 14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: this.skyTime, uA: { value: 0 } },
      vertexShader: `attribute float aSpeed;
        uniform float uTime; uniform float uA; varying float vA;
        void main(){
          vec3 p = position;
          // caída en bucle dentro del volumen (26 de alto)
          p.y = mod(p.y - uTime * aSpeed, 26.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // trazos verticales (línea) — el tamaño en X es mínimo
          gl_PointSize = clamp(160.0 / max(0.1, -mv.z), 1.0, 7.0);
          vA = uA * smoothstep(30.0, 8.0, -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){
          // gota: punto estirado verticalmente (sub-pixel, gris azulado)
          vec2 uv = gl_PointCoord - 0.5;
          float a = (1.0 - smoothstep(0.08, 0.5, length(uv * vec2(3.2, 0.7)))) * vA;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.62, 0.72, 0.88), a * 0.5); }`,
    });
    const pts = new THREE.Points(geo, this.rainMat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.renderOrder = 7;
    this.scene.add(pts);
    this.rainPoints = pts;

    // charcos: 6 discos espejo cerca del campamento (la lluvia los revela)
    const puddleTex = waterNormal();
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const r = 5 + rng() * 12;
      const x = WORLD.bonfire.x + Math.cos(a) * r;
      const z = WORLD.bonfire.z + Math.sin(a) * r;
      const h = terrainHeight(x, z);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          uTime: this.waterTime, uNormals: { value: puddleTex },
          uA: { value: 0 },
          uSky: { value: new THREE.Color(0x8aa8c0) },
        },
        vertexShader: `varying vec2 vUv;
          void main(){ vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float uTime; uniform sampler2D uNormals;
          uniform float uA; uniform vec3 uSky;
          void main(){
            // espejo ondulante del cielo (aprox. cúpula superior)
            vec3 n = texture2D(uNormals, vUv * 2.6 + vec2(uTime * 0.014, uTime * 0.01)).xyz * 2.0 - 1.0;
            float fres = 1.0 - length(vUv - 0.5) * 1.9; // más reflejo al borde
            float ripple = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 26.0 + uTime * 2.2 + n.x * 3.0);
            vec3 col = uSky * (0.55 + 0.3 * fres + 0.15 * ripple);
            float a = uA * smoothstep(0.5, 0.32, length(vUv - 0.5));
            gl_FragColor = vec4(col, a * 0.85); }`,
      });
      const geoP = new THREE.CircleGeometry(0.7 + rng() * 1.3, 20);
      geoP.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geoP, mat);
      m.position.set(x, h + 0.04, z);
      m.scale.set(1 + rng() * 0.5, 1, 0.65 + rng() * 0.45);
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      this.puddles.push({ mesh: m, mat, baseY: h });
    }

    // luz de relámpago: direccional cenital blanca (sin sombras, barata)
    const fl = new THREE.DirectionalLight(0xcfd8ff, 0);
    fl.position.set(30, 120, -20);
    this.scene.add(fl);
    this.flashLight = fl;
  }

  /** avanza la máquina de clima (llamado desde update) */
  private updateWeather(dt: number, camera: THREE.Camera) {
    this.rainNextT -= dt;
    if (this.rainNextT <= 0) {
      // alterna despejado ↔ lluvia; la lluvia es menos frecuente
      this.rainTarget = this.rainTarget > 0.5 ? 0 : (Math.random() < 0.65 ? 0.85 + Math.random() * 0.15 : 0);
      this.rainNextT = this.rainTarget > 0.5 ? 40 + Math.random() * 30 : 55 + Math.random() * 90;
    }
    // transición suave hacia el objetivo
    this.rainK += (this.rainTarget - this.rainK) * Math.min(1, dt * 0.22);
    const raining = this.rainK > 0.04;
    // RELÁMPAGOS: solo con tormenta fuerte; flash doble + trueno retardado
    if (this.lightning > 0) {
      this.lightning -= dt * 3.6;
      this.flashLight!.intensity = Math.max(0, this.lightning) * 260;
      this.skyFlash = Math.max(0, this.lightning) * 0.55;
      if (this.lightning <= 0) { this.flashLight!.intensity = 0; this.skyFlash = 0; }
    } else if (raining && this.rainK > 0.72 && Math.random() < dt * 0.11) {
      // disparo: doble pulsación (a golpe real)
      this.lightning = 1 + Math.random() * 0.5;
      this.onLightning?.();
    }
    // la cortina sigue a la cámara (siempre alrededor del jugador)
    if (this.rainPoints) {
      this.rainPoints.visible = raining;
      this.rainPoints.position.set(camera.position.x, camera.position.y - 8, camera.position.z);
      if (this.rainMat) this.rainMat.uniforms.uA.value = this.rainK;
    }
    for (const p of this.puddles) {
      p.mesh.visible = this.rainK > 0.12;
      p.mat.uniforms.uA.value = Math.max(0, (this.rainK - 0.15)) * 1.2;
    }
  }

  /** factor de lluvia actual (para oscurecer cielo/sol en applyDayNight) */
  get rainFactor() { return this.rainK; }

  private lightning = 0;            // intensidad del flash en curso
  private skyFlash = 0;            // parte del flash que va al cielo
  private flashLight: THREE.DirectionalLight | null = null;
  /** callback de trueno (lo engancha Game con su AudioEngine) */
  onLightning: (() => void) | null = null;

  /* ---------- Fuente Lunar (agua estilizada) ---------- */

  private buildLunarBasin() {
    const x = WORLD.bonfire.x - 3.4, z = WORLD.bonfire.z - 3.6;
    const h = terrainHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, h, z);

    // pie de piedra
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 0.5, 10), stoneMat());
    pedestal.position.y = 0.25;
    pedestal.castShadow = pedestal.receiveShadow = true;
    g.add(pedestal);
    // brocal
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.17, 8, 18), stoneMat());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.52;
    rim.castShadow = true;
    g.add(rim);

    // agua
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: this.waterTime,
        uNormals: { value: waterNormal() },
        uMoonDir: { value: this.moonDir },
        uDeep: { value: new THREE.Color(0x145a78) },
        uSky: { value: new THREE.Color(0x3f86b0) },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vW;
        uniform float uTime; uniform sampler2D uNormals; uniform vec3 uMoonDir; uniform vec3 uDeep; uniform vec3 uSky;
        void main(){
          // tres capas de olas cruzadas (dominante + dos ripples de distinta escala)
          vec3 n1 = texture2D(uNormals, vUv * 2.2 + vec2(uTime * 0.016, uTime * 0.012)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormals, vUv * 3.4 - vec2(uTime * 0.02, -uTime * 0.009)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uNormals, vUv * 6.5 + vec2(uTime * 0.031, uTime * 0.024)).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3(
            n1.x * 0.5 + n2.x * 0.3 + n3.x * 0.2,
            7.0,
            n1.y * 0.5 + n2.y * 0.3 + n3.y * 0.2));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          // profundidad falsa: más oscuro hacia el centro (sima)
          float r = length(vUv - 0.5) * 2.0;
          vec3 deep = mix(uDeep, uDeep * 0.55, smoothstep(0.9, 0.3, r));
          vec3 col = mix(deep, uSky, fres * 0.85);
          vec3 L = normalize(uMoonDir);
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(n, H), 0.0), 90.0);
          // doble especular: núcleo blanco + halo cálido
          col += vec3(0.85, 0.92, 1.0) * spec * 2.2;
          col += uSky * pow(max(dot(n, H), 0.0), 18.0) * 0.35;
          // caustics: retícula luminosa ondulante en el fondo
          float ca = sin(n.x * 9.0 + uTime * 1.3) * sin(n.z * 9.0 - uTime * 1.1);
          col += vec3(0.4, 0.65, 0.7) * max(ca, 0.0) * 0.05 * (1.0 - fres * 0.5);
          // ondas concéntricas suaves
          col += vec3(0.3, 0.55, 0.6) * sin(r * 22.0 - uTime * 2.0) * 0.02 * (1.0 - r);
          // espuma en la orilla: banda rompiente contra el brocal
          float shore = smoothstep(0.82, 0.97, r);
          float foam = shore * (0.55 + 0.45 * sin(r * 60.0 - uTime * 3.2 + n.x * 4.0));
          col = mix(col, vec3(0.85, 0.93, 0.96), foam * 0.5);
          gl_FragColor = vec4(col, 0.93);
        }`,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.3, 26), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.44;
    g.add(water);
    this.waterMat = waterMat;

    this.scene.add(g);
    this.colliders.push({ x, z, r: 1.55 });
  }

  /* ---------- Hoguera ---------- */

  private torches: { group: THREE.Group; light: THREE.PointLight; flame: THREE.Mesh; pos: THREE.Vector3 }[] = [];

  private buildBonfire() {
    const { group, light, logs } = buildBonfire();
    const h = terrainHeight(WORLD.bonfire.x, WORLD.bonfire.z);
    group.position.set(WORLD.bonfire.x, h, WORLD.bonfire.z);
    this.scene.add(group);
    this.bonfireLight = light;
    this.bonfireFlame = (group.getObjectByName('flame') as THREE.Mesh) ?? null;
    this.colliders.push({ x: WORLD.bonfire.x, z: WORLD.bonfire.z, r: 1.1 });
    const rng = mulberry32(99);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const x = WORLD.bonfire.x + Math.cos(a) * 2.4;
      const z = WORLD.bonfire.z + Math.sin(a) * 2.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), stoneMat());
      rock.position.set(x, terrainHeight(x, z) + 0.2, z);
      rock.scale.y = 0.7;
      rock.rotation.y = rng() * Math.PI;
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
    }
    void logs;
  }

  private addTorchRing(cx: number, cz: number, radius: number, count: number, rng: () => number, soul: boolean) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.4;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      this.addTorch(x, z, terrainHeight(x, z), soul);
    }
  }

  private addTorch(x: number, z: number, h: number, soul: boolean) {
    const { group, light, flame } = buildTorch(soul);
    group.position.set(x, h, z);
    if (soul) group.scale.setScalar(1.35);
    this.scene.add(group);
    this.colliders.push({ x, z, r: 0.3 });
    this.torches.push({ group, light, flame, pos: new THREE.Vector3(x, h + (soul ? 3.8 : 2.9), z) });
  }

  /* ---------- Santuarios ---------- */

  private buildShrines() {
    WORLD.shrines.forEach((s, idx) => {
      const { group, crystal, runes, shards } = buildObelisk(false);
      const h = terrainHeight(s.x, s.z);
      group.position.set(s.x, h, s.z);
      this.scene.add(group);
      this.colliders.push({ x: s.x, z: s.z, r: 1.35 });
      const crystalMat = crystal.material as ToonMat;
      const runeMats = runes.map(r => r.material as ToonMat);
      const light = new THREE.PointLight(0xd8323c, 5, 17, 1.8);
      light.position.set(s.x, h + 4.1, s.z);
      this.scene.add(light);

      // losa circular de piedra
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 0.28, 22), stoneMat());
      slab.position.set(s.x, h + 0.1, s.z);
      slab.receiveShadow = true;
      this.scene.add(slab);
      // anillo rúnico
      const runeRing = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.06, 6, 40), emisMat(0xb02832, 0.55));
      runeRing.rotation.x = Math.PI / 2;
      runeRing.position.set(s.x, h + 0.26, s.z);
      this.scene.add(runeRing);

      // aura corrupta pulsante
      const auraMat = new THREE.MeshBasicMaterial({
        color: 0x9a1826, transparent: true, opacity: 0.13,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const auraGeo = new THREE.RingGeometry(3.0, 5.0, 40);
      auraGeo.rotateX(-Math.PI / 2);
      const aura = new THREE.Mesh(auraGeo, auraMat);
      aura.position.set(s.x, h + 0.3, s.z);
      aura.renderOrder = 3;
      this.scene.add(aura);

      // haz de purificación (visible al limpiar)
      const beamMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uOpacity: { value: 0 }, uTime: this.waterTime },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float uOpacity; uniform float uTime;
          void main(){
            float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y);
            float pulse = 0.8 + 0.2 * sin(uTime * 3.0 + vUv.y * 8.0);
            gl_FragColor = vec4(vec3(0.35, 1.0, 0.9) * fade * pulse, fade * uOpacity * 0.5);
          }`,
      });
      const beamGeo = new THREE.CylinderGeometry(0.5, 0.95, 36, 14, 1, true);
      beamGeo.translate(0, 18, 0);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(s.x, h + 0.4, s.z);
      beam.visible = false;
      beam.renderOrder = 5;
      this.scene.add(beam);

      // pilares en círculo
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const px = s.x + Math.cos(a) * 8.2;
        const pz = s.z + Math.sin(a) * 8.2;
        const p = buildRuinedPillar(2.2 + (i % 2) * 0.8);
        p.position.set(px, terrainHeight(px, pz), pz);
        p.rotation.y = a;
        this.scene.add(p);
        this.colliders.push({ x: px, z: pz, r: 0.55 });
      }

      this.shrines.push({
        idx, name: s.name, pos: new THREE.Vector3(s.x, h, s.z),
        cleansed: false, group, crystal, runes, crystalMat, runeMats, light,
        shards, aura, runeRing, beam, beamMat, beamTarget: 0,
      });
    });
  }

  cleanseShrine(idx: number) {
    const sh = this.shrines[idx];
    if (!sh || sh.cleansed) return;
    sh.cleansed = true;
    sh.crystalMat.color.set(0x37d8c8);
    sh.crystalMat.emissive.set(0x37d8c8);
    sh.crystalMat.emissiveIntensity = 2.6;
    for (const rm of sh.runeMats) { rm.color.set(0x37d8c8); rm.emissive.set(0x37d8c8); }
    sh.light.color.set(0x37d8c8);
    sh.light.intensity = 8;
    sh.aura.visible = false;
    sh.beam.visible = true;
    sh.beamTarget = 1;
    const rrMat = sh.runeRing.material as ToonMat;
    rrMat.color.set(0x37d8c8);
    rrMat.emissive.set(0x37d8c8);
    const shardMat = sh.shards[0]?.material as ToonMat | undefined;
    if (shardMat) { shardMat.color.set(0x37d8c8); shardMat.emissive.set(0x37d8c8); }
    for (let i = 0; i < 30; i++) {
      this.fx.spawn({
        x: sh.pos.x + (Math.random() - 0.5) * 3, y: sh.pos.y + 0.3, z: sh.pos.z + (Math.random() - 0.5) * 3,
        vy: 3 + Math.random() * 4, color: 0x37d8c8, size: 0.22, life: 1.8, glow: 2.2, drag: 0.4,
      });
    }
  }

  /* ---------- Arena del jefe ---------- */

  arenaRage = false;

  private buildArena() {
    const A = WORLD.arena;
    const h = terrainHeight(A.x, A.z);
    // suelo con textura rúnica
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(A.r - 0.3, 44),
      toonMat(0xffffff, { map: arenaFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(A.x, h + 0.32, A.z);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // murete perimetral
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(A.r, A.r + 1.3, 0.62, 40, 1, true), stoneMat());
    wall.position.set(A.x, h + 0.3, A.z);
    wall.receiveShadow = true;
    this.scene.add(wall);
    // pilares perimetrales
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const px = A.x + Math.cos(a) * (A.r - 1.5);
      const pz = A.z + Math.sin(a) * (A.r - 1.5);
      const p = buildRuinedPillar(3.4 + (i % 3));
      p.position.set(px, h + 0.3, pz);
      p.rotation.y = a;
      this.scene.add(p);
      this.colliders.push({ x: px, z: pz, r: 0.6 });
    }
    // estandartes raídos
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTexture(), transparent: true, alphaTest: 0.3,
      side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
    });
    registerWind(bannerMat, 0.09, 'bottom');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const px = A.x + Math.cos(a) * (A.r - 4.2);
      const pz = A.z + Math.sin(a) * (A.r - 4.2);
      const py = terrainHeight(px, pz);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 7), woodMat());
      pole.position.y = 2.2;
      pole.castShadow = true;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), woodMat());
      arm.rotation.z = Math.PI / 2;
      arm.position.y = 4.2;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.5), bannerMat);
      cloth.position.set(0.42, 3.0, 0);
      cloth.castShadow = true;
      g.add(pole, arm, cloth);
      g.position.set(px, py, pz);
      g.rotation.y = -a + Math.PI / 2;
      this.scene.add(g);
      this.colliders.push({ x: px, z: pz, r: 0.35 });
    }
    // arcos de entrada (sur)
    const arch = buildBrokenArch();
    arch.position.set(A.x, h + 0.3, A.z - A.r + 0.5);
    arch.scale.setScalar(1.4);
    this.scene.add(arch);
    // sigilo de invocación (inactivo hasta victoria)
    const sg = buildSigil();
    sg.group.position.set(A.x, h + 0.25, A.z);
    sg.group.visible = false;
    this.scene.add(sg.group);
    this.sigil = { group: sg.group, ring: sg.ring, ringMat: sg.ring.material as ToonMat };
  }

  setArenaRage(on: boolean) { this.arenaRage = on; }

  /* ---------- Nido del dragón (jefe 2 — cráter de escarcha) ---------- */

  /** Portal sellado hacia el nido: se abre con los Núcleos de Brasa */
  gate!: { group: THREE.Group; mat: THREE.MeshStandardMaterial; opened: boolean };
  /** luz fría del cráter */
  private roostLight!: THREE.PointLight;
  private roostTime = 0;

  private buildRoost() {
    const R = WORLD.roost;
    const h = terrainHeight(R.x, R.z);
    const rng = mulberry32(0xD2A60);
    // suelo del cráter: losa de escarcha azulada
    const frostMat = toonMat(0x9fc4d8, {
      map: stoneMaps().map, normalMap: stoneMaps().normalMap,
      roughness: 0.55, metalness: 0.08,
    });
    frostMat.color.lerp(new THREE.Color(0x8fd8ff), 0.45);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R.r - 1.5, 40), frostMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(R.x, h + 0.28, R.z);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // agujas de hielo perimetrales (colisionables, proyectan sombra)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.22;
      const rr = R.r - rand(2.5, 4);
      const px = R.x + Math.cos(a) * rr, pz = R.z + Math.sin(a) * rr;
      const hh = 2.6 + rng() * 3.4;
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.5 + rng() * 0.55, hh, 6),
        toonMat(0xbfe8ff, { roughness: 0.22, metalness: 0.05, emissive: 0x2a6a8a, emissiveIntensity: 0.35 }),
      );
      spike.position.set(px, terrainHeight(px, pz) + hh / 2 - 0.3, pz);
      spike.rotation.y = rng() * Math.PI;
      spike.rotation.z = (rng() - 0.5) * 0.22;
      spike.castShadow = true;
      this.scene.add(spike);
      this.colliders.push({ x: px, z: pz, r: 0.75 });
    }
    // costillas gigantes (restos de presas del dragón)
    const boneMat = toonMat(0xd8d2c0, { roughness: 0.7, metalness: 0 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.8;
      const rr = R.r * 0.55;
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(1.6 + rng() * 0.7, 0.14, 5, 12, Math.PI * 1.1),
        boneMat,
      );
      rib.position.set(R.x + Math.cos(a) * rr, h + 0.4, R.z + Math.sin(a) * rr);
      rib.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * Math.PI * 2, 0);
      rib.castShadow = true;
      this.scene.add(rib);
    }
    // columna vertebral central (tronco de hueso sobre el que vuela el dragón)
    const spineLen = 9;
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Mesh(
        new THREE.SphereGeometry(0.42 - i * 0.035, 7, 6),
        boneMat,
      );
      seg.position.set(R.x - 4 + (i / 6) * spineLen, h + 0.35 + Math.sin(i * 0.8) * 0.14, R.z + Math.sin(i * 1.7) * 0.5);
      seg.scale.set(1, 0.7, 1.25);
      seg.castShadow = true;
      this.scene.add(seg);
    }
    // luz fría del nido (pulsa)
    this.roostLight = new THREE.PointLight(0x66d8ff, 14, 34, 1.8);
    this.roostLight.position.set(R.x, h + 4, R.z);
    this.scene.add(this.roostLight);
    // PORTAL SELLADO: anillo rúnico vertical en el borde del cráter.
    // Inactivo (apagado) hasta que la misión del acto II lo abre.
    const gate = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(2.6, 0.34, 8, 40);
    const gateMat = toonMat(0x24303e, { emissive: 0x0a141c, emissiveIntensity: 0.2, roughness: 0.5, metalness: 0.3 });
    const ring = new THREE.Mesh(ringGeo, gateMat);
    ring.castShadow = true;
    gate.add(ring);
    // velos de escarcha interior (planos cruzados, opacidad baja)
    const veilMat = new THREE.MeshBasicMaterial({
      color: 0x7ad8ff, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const veil = new THREE.Mesh(new THREE.CircleGeometry(2.35, 28), veilMat);
      veil.position.z = (i - 1) * 0.24;
      gate.add(veil);
    }
    // sitúa el portal en el borde sur del cráter, mirando al centro
    const gx = R.x, gz = R.z + R.r - 2.2;
    gate.position.set(gx, terrainHeight(gx, gz) + 2.7, gz);
    gate.lookAt(R.x, terrainHeight(R.x, R.z) + 2, R.z);
    this.scene.add(gate);
    this.colliders.push({ x: gx, z: gz, r: 0.9 });
    this.gate = { group: gate, mat: gateMat, opened: false };
  }

  /** Abre el portal del nido (al completar la misión de las brasas) */
  openGate() {
    if (!this.gate || this.gate.opened) return;
    this.gate.opened = true;
    this.gate.mat.emissive.set(0x37d8ff);
    this.gate.mat.emissiveIntensity = 2.2;
  }

  /** Modo "pelea del dragón": el cráter se congela (niebla azulada) */
  setDragonRage(on: boolean) {
    if (!on) { this.dragonRage = false; return; }
    this.dragonRage = true;
  }
  private dragonRage = false;

  /** tinte frío aplicado sobre la niebla del ciclo durante la pelea */
  rageFogTint(fogColor: THREE.Color) {
    if (this.dragonRage) fogColor.lerp(new THREE.Color(0x2a4a66), 0.45);
  }

  private updateRoost(dt: number) {
    // pulso de la luz fría + escarcha de partículas del nido
    this.roostTime += dt;
    if (this.roostLight) {
      this.roostLight.intensity = 12 + Math.sin(this.roostTime * 1.7) * 3.5;
    }
    const R = WORLD.roost;
    if (this.fx && Math.random() < dt * 5) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * R.r;
      this.fx.spawn({
        x: R.x + Math.cos(a) * rr, y: terrainHeight(R.x, R.z) + 0.3, z: R.z + Math.sin(a) * rr,
        vy: 0.5 + Math.random() * 0.9, color: 0x8fe8ff, size: rand(0.16, 0.3),
        life: rand(1.2, 2.4), glow: 1.4, drag: 0.4, fadePow: 1.6,
      });
    }
  }

  activateSigil() {
    if (this.sigil) {
      this.sigil.group.visible = true;
      this.sigil.ringMat.color.set(0xd8323c);
      this.sigil.ringMat.emissive.set(0xd8323c);
      this.sigil.ringMat.emissiveIntensity = 1.8;
    }
  }
  sigilReady() {
    if (this.sigil) {
      this.sigil.ringMat.color.set(0x37d8c8);
      this.sigil.ringMat.emissive.set(0x37d8c8);
    }
  }

  /* ---------- Environment map para reflejos PBR ---------- */

  /** Carga HDRIs (día = amanecer Blouberg, atardecer = Venice Sunset)
   *  y genera PMREM para IBL fotorrealista. Fallback: cúpula procedural. */
  async loadHDRI(): Promise<void> {
    if (!this.rendererRef) return;
    const loader = new RGBELoader();
    const pmrem = new THREE.PMREMGenerator(this.rendererRef);
    const grab = async (file: string): Promise<THREE.Texture | null> => {
      try {
        const tex = await new Promise<THREE.Texture>((res, rej) =>
          loader.load(`/assets/env/${file}`, res, undefined, rej));
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const rt = pmrem.fromEquirectangular(tex);
        tex.dispose();
        return rt.texture;
      } catch {
        return null;
      }
    };
    this.envDay = await grab('blouberg_sunrise_2_1k.hdr');
    this.envDusk = await grab('venice_sunset_1k.hdr');
    pmrem.dispose();
    this.envBucket = ''; // fuerza re-selección en el próximo applyDayNight
    if (!this.envDay) {
      console.warn('[AETHERIA] HDRI no disponible — se usa la cúpula procedural');
    }
  }

  /** Selecciona el entorno IBL según hora del día (buckets: día/atardecer/noche) */
  private pickEnvBucket(t: number, night: number) {
    const bucket = night > 0.62 ? 'noche' : (t > 0.66 && t < 0.82) || (t > 0.22 && t < 0.33) ? 'atardecer' : 'día';
    if (bucket === this.envBucket) return;
    this.envBucket = bucket;
    const env = bucket === 'noche' ? null : bucket === 'atardecer' ? (this.envDusk ?? this.envDay) : (this.envDay ?? this.envDusk);
    if (env) this.scene.environment = env;
    // de noche la cúpula procedural (ya asignada en buildEnvironmentMap) gobierna
  }

  private buildEnvironmentMap(renderer: THREE.WebGLRenderer) {
    try {
      const env = new THREE.Scene();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(100, 16, 12),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            top: { value: new THREE.Color(0x0a1326) },
            mid: { value: new THREE.Color(0x16264a) },
            bottom: { value: new THREE.Color(0x1e2c40) },
          },
          vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
          fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
            void main(){ float h = normalize(vP).y;
              vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bottom, pow(-h, 0.5));
              gl_FragColor = vec4(c, 1.0); }`,
        }),
      );
      env.add(dome);
      const moonBall = new THREE.Mesh(
        new THREE.SphereGeometry(7, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xcfe0ff }),
      );
      moonBall.position.copy(this.moonDir).multiplyScalar(60);
      env.add(moonBall);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(env, 0.04, 1, 200);
      this.scene.environment = rt.texture;
      (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.5;
      pmrem.dispose();
    } catch {
      /* environment map opcional */
    }
  }

  /* ---------- Actualización por frame ---------- */

  update(dt: number, camera: THREE.Camera, spawnEmber: (x: number, y: number, z: number) => void) {
    this.time += dt;
    this.skyTime.value = this.time;
    this.waterTime.value = this.time;
    this.cameraQuat.copy(camera.quaternion);
    updateWindAndFlames(this.time);
    this.updateRoost(dt);

    // mariposas diurnas (mismo factor de visibilidad que el polen)
    this.updateButterflies(dt, this.dn.pollenA.value / 0.85);

    // clima: lluvia ocasional con charcos
    this.updateWeather(dt, camera);

    // deriva lenta de las nubes billboard
    for (let i = 0; i < this.cloudGroups.length; i++) {
      const g = this.cloudGroups[i];
      const spd = this.clouds[i].speed;
      g.position.x += spd * dt;
      g.position.y = this.clouds[i].baseY + Math.sin(this.time * 0.11 + this.clouds[i].baseY) * 1.6;
      if (g.position.x > 340) g.position.x = -340;
    }

    // la luz activa (sol de día / luna de noche) sigue al jugador
    if (camera instanceof THREE.PerspectiveCamera) {
      const t = camera.position;
      const dir = this.dn.sunDir.value;
      this.moonLight.position.set(t.x + dir.x * 75, dir.y * 75 + 12, t.z + dir.z * 75);
      this.moonLight.target.position.set(t.x, 0, t.z);
    }

    // parpadeo de la hoguera + humo (realzadas de noche)
    const torchK = this.nightK;
    if (this.bonfireLight) {
      this.bonfireLight.intensity = (15 + Math.sin(this.time * 9) * 1.8 + Math.sin(this.time * 23.7) * 1.0) * (0.55 + 0.45 * torchK);
    }
    if (this.bonfireFlame) {
      const s = 1 + Math.sin(this.time * 11) * 0.12;
      this.bonfireFlame.scale.set(s, 1 + Math.sin(this.time * 17) * 0.18, s);
    }
    if (Math.random() < dt * 7) {
      this.smoke.spawn({
        x: WORLD.bonfire.x + (Math.random() - 0.5) * 0.5,
        y: terrainHeight(WORLD.bonfire.x, WORLD.bonfire.z) + 1.6,
        z: WORLD.bonfire.z + (Math.random() - 0.5) * 0.5,
        vy: 0.8 + Math.random() * 0.7, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3,
        color: 0x1c2026, size: 0.5, life: 3.2, grow: 2.6, spin: 0.6,
        glow: 0.55, fadePow: 1.6,
      });
    }

    // antorchas: parpadeo + brasas (realzadas de noche)
    for (const t of this.torches) {
      t.light.intensity = (5.6 + Math.sin(this.time * 8 + t.pos.x) * 1.0 + Math.sin(this.time * 19 + t.pos.z) * 0.55) * (0.5 + 0.5 * torchK);
      const fs = 1 + Math.sin(this.time * 13 + t.pos.z) * 0.16;
      t.flame.scale.set(fs, 1 + Math.sin(this.time * 15 + t.pos.x) * 0.2, fs);
      if (Math.random() < 0.12) {
        spawnEmber(t.pos.x + (Math.random() - 0.5) * 0.2, t.pos.y, t.pos.z + (Math.random() - 0.5) * 0.2);
      }
    }

    // santuarios: cristal, fragmentos, wisps y haz
    for (const sh of this.shrines) {
      sh.crystal.rotation.y += dt * (sh.cleansed ? 0.8 : 0.5);
      sh.crystal.position.y = 4.15 + Math.sin(this.time * 1.6 + sh.idx) * 0.12;
      sh.light.intensity = (sh.cleansed ? 8 : 5) + Math.sin(this.time * 5 + sh.idx * 2) * 0.9;
      sh.shards.forEach((sd, i) => {
        const a = this.time * 0.9 + i * 2.09 + sh.idx;
        sd.position.set(
          sh.pos.x + Math.cos(a) * 0.85,
          sh.pos.y + 4.15 + Math.sin(this.time * 1.3 + i) * 0.22,
          sh.pos.z + Math.sin(a) * 0.85,
        );
        sd.rotation.x += dt * 2; sd.rotation.y += dt * 2.6;
      });
      if (!sh.cleansed) {
        this.shrineWispT -= dt;
        if (this.shrineWispT <= 0) {
          this.shrineWispT = 0.6;
          for (const s2 of this.shrines) {
            if (s2.cleansed) continue;
            this.smoke.spawn({
              x: s2.pos.x + (Math.random() - 0.5) * 0.7, y: s2.pos.y + 4.3, z: s2.pos.z + (Math.random() - 0.5) * 0.7,
              vy: 1.0 + Math.random() * 0.8, color: 0x30101c, size: 0.4, life: 2.4, grow: 2.2, glow: 0.5,
            });
          }
        }
        const am = sh.aura.material as THREE.MeshBasicMaterial;
        am.opacity = 0.10 + Math.sin(this.time * 2.3 + sh.idx) * 0.045;
      }
      if (sh.beam.visible) {
        const cur = sh.beamMat.uniforms.uOpacity.value as number;
        sh.beamMat.uniforms.uOpacity.value = cur + (sh.beamTarget - cur) * Math.min(1, dt * 2.4);
      }
    }

    // niebla rasante: deriva y pulso (más densa al alba y de noche)
    for (const m of this.mist) {
      m.mesh.rotation.y += m.spin * dt;
      m.mat.opacity = Math.min(0.9, m.baseO * this.mistMul * (0.8 + 0.2 * Math.sin(this.time * 0.35 + m.mesh.position.x)));
    }

    // meteorito fugaz ocasional
    this.meteorT -= dt;
    if (this.meteorT <= 0) {
      this.meteorT = 11 + Math.random() * 16;
      const a = Math.random() * Math.PI * 2;
      const sy = 150 + Math.random() * 80;
      const sx = Math.cos(a) * 260, sz = Math.sin(a) * 260;
      const dir = new THREE.Vector3(-Math.cos(a) * 0.5 - 0.4, -0.32, -Math.sin(a) * 0.5).normalize();
      for (let i = 0; i < 12; i++) {
        this.fx.spawn({
          x: sx - dir.x * i * 3.2, y: sy - dir.y * i * 3.2, z: sz - dir.z * i * 3.2,
          vx: dir.x * 26, vy: dir.y * 26, vz: dir.z * 26,
          color: 0xcfe4ff, size: 2.6, life: 0.85, glow: 3.2, drag: 0.12, spin: 0,
        });
      }
    }

    // sistemas de partículas propios del mundo
    this.smoke.update(dt, camera.position);
    this.fx.update(dt, camera.position);

    // sigilo
    if (this.sigil && this.sigil.group.visible) {
      this.sigil.ring.rotation.z += dt * 0.8;
    }
  }
}
