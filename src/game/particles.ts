import * as THREE from 'three';
import { softSprite } from './textures';

/* ============================================================
   SISTEMA DE PARTÍCULAS: pool único con shader de puntos y
   sprite suave. Soporta gravedad, arrastre, rotación, búsqueda
   de objetivo (almas), crecimiento (humo) y fade.
   mode 'additive' = chispas/magia · 'alpha' = humo/polvo
   ============================================================ */

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute float aAngle;
attribute vec3 aColor;
varying float vAlpha;
varying float vAngle;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vAngle = aAngle;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (170.0 / max(0.1, -mv.z)), 1.0, 90.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vAlpha;
varying float vAngle;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vAngle), s = sin(vAngle);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
  vec4 tex = texture2D(uMap, uv);
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export type ParticleMode = 'additive' | 'alpha';

interface SpawnOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  color?: THREE.Color | number;
  size?: number;
  life?: number;
  gravity?: number;      // aceleración Y
  drag?: number;         // 0..1 por segundo
  seek?: { getPos: () => THREE.Vector3; speed: number } | null;
  glow?: number;         // multiplicador de color (>1 para bloom)
  fadePow?: number;      // curva de fade
  shrink?: boolean;
  grow?: number;         // crecimiento de tamaño por vida (humo)
  spin?: number;         // velocidad de rotación (rad/s)
}

export class Particles {
  private cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private angle: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private size0: Float32Array;
  private glow: Float32Array;
  private fadePow: Float32Array;
  private shrink: Float32Array;
  private grow: Float32Array;
  private spin: Float32Array;
  private seek: ({ getPos: () => THREE.Vector3; speed: number } | null)[];
  private cursor = 0;
  private alive = 0;
  points: THREE.Points;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, cap = 1600, mode: ParticleMode = 'additive') {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.angle = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.glow = new Float32Array(cap);
    this.fadePow = new Float32Array(cap);
    this.shrink = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.seek = new Array(cap).fill(null);

    for (let i = 0; i < cap; i++) { this.pos[i * 3 + 1] = -9999; this.alpha[i] = 0; }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute('aAngle', new THREE.BufferAttribute(this.angle, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uMap: { value: softSprite() } },
      transparent: true, depthWrite: false,
      blending: mode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /** Escribe el color sin allocations (hex o THREE.Color) */
  private writeColor(c: THREE.Color | number, g: number, i3: number) {
    if (typeof c === 'number') {
      this.col[i3] = ((c >> 16) & 255) / 255 * g;
      this.col[i3 + 1] = ((c >> 8) & 255) / 255 * g;
      this.col[i3 + 2] = (c & 255) / 255 * g;
    } else {
      this.col[i3] = c.r * g;
      this.col[i3 + 1] = c.g * g;
      this.col[i3 + 2] = c.b * g;
    }
  }

  spawn(o: SpawnOpts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx ?? 0; this.vel[i3 + 1] = o.vy ?? 0; this.vel[i3 + 2] = o.vz ?? 0;
    const c = o.color ?? 0xffffff;
    const g = o.glow ?? 1;
    this.writeColor(c, g, i3);
    const s = o.size ?? 0.3;
    this.size[i] = s; this.size0[i] = s;
    this.life[i] = 0; this.maxLife[i] = o.life ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.glow[i] = g;
    this.fadePow[i] = o.fadePow ?? 1;
    this.shrink[i] = o.shrink === false ? 0 : 1;
    this.grow[i] = o.grow ?? 0;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 4;
    this.angle[i] = Math.random() * Math.PI * 2;
    this.seek[i] = o.seek ?? null;
    this.alpha[i] = 1;
    this.alive++;
  }

  /** Ráfaga esférica (sin spreads ni allocations por partícula) */
  burst(o: SpawnOpts & { count: number; speed: number; speedVar?: number; spread?: number }) {
    const n = o.count;
    const spread = o.spread ?? 1;
    const gravPositive = !!o.gravity && o.gravity > 0;
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = o.speed * (1 - (o.speedVar ?? 0.5) * Math.random());
      const vx = Math.sin(ph) * Math.cos(th) * sp * spread;
      const vy = Math.abs(Math.cos(ph)) * sp * (gravPositive ? 0.9 : 1) * spread;
      const vz = Math.sin(ph) * Math.sin(th) * sp * spread;
      this.spawn2(o, vx, vy, vz);
    }
  }

  /** spawn con velocidad explícita (evita el spread {...o}) */
  private spawn2(o: SpawnOpts & { count?: number; speed?: number; speedVar?: number; spread?: number }, vx: number, vy: number, vz: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const c = o.color ?? 0xffffff;
    const g = o.glow ?? 1;
    this.writeColor(c, g, i3);
    const s = o.size ?? 0.3;
    this.size[i] = s; this.size0[i] = s;
    this.life[i] = 0; this.maxLife[i] = o.life ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.glow[i] = g;
    this.fadePow[i] = o.fadePow ?? 1;
    this.shrink[i] = o.shrink === false ? 0 : 1;
    this.grow[i] = o.grow ?? 0;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 4;
    this.angle[i] = Math.random() * Math.PI * 2;
    this.seek[i] = o.seek ?? null;
    this.alpha[i] = 1;
    this.alive++;
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    void cameraPos;
    let aliveCount = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.alpha[i] <= 0 && this.life[i] >= this.maxLife[i]) continue;
      if (this.life[i] >= this.maxLife[i]) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999; continue; }
      const i3 = i * 3;
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999; continue; }

      const sk = this.seek[i];
      if (sk) {
        const p = sk.getPos();
        const dx = p.x - this.pos[i3], dy = p.y + 1 - this.pos[i3 + 1], dz = p.z - this.pos[i3 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.9) { this.life[i] = this.maxLife[i]; this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999; continue; }
        const sp = sk.speed * (0.5 + t);
        this.vel[i3] += (dx / d) * sp * dt * 6;
        this.vel[i3 + 1] += (dy / d) * sp * dt * 6;
        this.vel[i3 + 2] += (dz / d) * sp * dt * 6;
      }
      this.vel[i3 + 1] -= this.grav[i] * dt;
      if (this.drag[i] > 0) {
        const dr = Math.max(0, 1 - this.drag[i] * dt);
        this.vel[i3] *= dr; this.vel[i3 + 1] *= dr; this.vel[i3 + 2] *= dr;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const fade = 1 - Math.pow(t, this.fadePow[i]);
      this.alpha[i] = fade;
      let s = this.size0[i];
      if (this.grow[i] > 0) s *= 1 + t * this.grow[i];
      else if (this.shrink[i]) s *= 0.35 + 0.65 * fade;
      this.size[i] = s;
      this.angle[i] += this.spin[i] * dt;
      aliveCount++;
    }
    this.alive = aliveCount;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAngle') as THREE.BufferAttribute).needsUpdate = true;
  }

  get count() { return this.alive; }
}
