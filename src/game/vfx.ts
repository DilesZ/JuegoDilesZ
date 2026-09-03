import * as THREE from 'three';

/* ============================================================
   VFX DE COMBATE AAA — pools reutilizables, cero allocations
   en el bucle caliente:
   - SlashArc: media luna curvada que sigue el tajo (DMC/Souls)
   - ImpactDecal: decal radial de impacto (suelo/enemigo)
   - HitFlare: destello breve en el punto de impacto
   ============================================================ */

/* ---------- Arco de tajo (media luna que barre) ---------- */

const ARC_VERT = /* glsl */`
  attribute float aSide;      // 0 = filo interior, 1 = borde exterior
  attribute float aAge;       // 0..1 a lo largo del barrido
  uniform float uProgress;    // 0..1 progreso del ataque
  uniform float uWidth;       // grosor angular
  uniform float uSweep;      // ángulo total barrido
  varying float vA;
  void main() {
    // alpha: ventana de vida alrededor del frente del barrido
    float d = uProgress - aAge;
    float alive = smoothstep(-0.5, -0.12, d) * (1.0 - smoothstep(0.1, 0.42, d));
    vA = aSide > 0.5 ? alive * 0.55 : alive;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ARC_FRAG = /* glsl */`
  uniform vec3 uColor; uniform vec3 uCore;
  varying float vA;
  void main() {
    if (vA <= 0.004) discard;
    // núcleo blanco fusionado, borde coloreado (estilo DMC)
    vec3 col = mix(uColor, uCore, pow(vA, 1.4));
    gl_FragColor = vec4(col * (0.65 + vA * 1.35), vA * 0.92);
  }`;

interface ArcSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  active: boolean;
  dur: number;
  delay: number;
}

/** Pool de arcos de tajo orientados a yaw; el barrido es local */
export class SlashArcPool {
  private slots: ArcSlot[] = [];
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, count = 5) {
    // geometría media-luna: 24 gajos × 2 lados (interior/exterior)
    const G = 24;
    const pos = new Float32Array((G + 1) * 2 * 3);
    const side = new Float32Array((G + 1) * 2);
    const age = new Float32Array((G + 1) * 2);
    const idx: number[] = [];
    const R_OUT = 1.0, R_IN = 0.42;
    for (let i = 0; i <= G; i++) {
      const k = i / G;
      // curva cóncava: el filo se retraza hacia el centro
      const bow = Math.sin(k * Math.PI) * 0.14;
      const ax = Math.cos(k * Math.PI - Math.PI / 2) * 1;
      const az = Math.sin(k * Math.PI - Math.PI / 2) * 1;
      const o = i * 6;
      pos[o] = ax * R_OUT; pos[o + 1] = bow; pos[o + 2] = az * R_OUT;
      pos[o + 3] = ax * R_IN; pos[o + 4] = bow * 0.4; pos[o + 5] = az * R_IN;
      side[i * 2] = 1; side[i * 2 + 1] = 0;
      age[i * 2] = k; age[i * 2 + 1] = k;
      if (i < G) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    this.geo.setIndex(idx);

    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
        uniforms: {
          uProgress: { value: 1 }, uWidth: { value: 0.22 },
          uSweep: { value: 1 },
          uColor: { value: new THREE.Color(0xffd9a0) },
          uCore: { value: new THREE.Color(0xfff6e0) },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      scene.add(mesh);
      this.slots.push({ mesh, mat, t: 0, active: false, dur: 0.3, delay: 0 });
    }
  }

  /** Emite un arco en la posición/yaw del héroe (dist = radio de alcance) */
  spawn(pos: THREE.Vector3, yaw: number, opts: { color?: number; radius?: number; dur?: number; delay?: number } = {}) {
    const s = this.slots.find(x => !x.active) ?? this.slots[0];
    s.active = true;
    s.t = -(opts.delay ?? 0);
    s.dur = opts.dur ?? 0.26;
    s.mat.uniforms.uColor.value.setHex(opts.color ?? 0xffd9a0);
    s.mat.uniforms.uProgress.value = 0;
    const r = opts.radius ?? 2.6;
    s.mesh.position.set(pos.x, pos.y + 1.05, pos.z);
    // el casquete del arco (+X local) debe apuntar al frente (sin(yaw), cos(yaw))
    s.mesh.rotation.set(0, yaw - Math.PI / 2, 0);
    s.mesh.scale.setScalar(r);
    s.mesh.visible = true;
  }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t < 0) continue;           // en retardo (anticipación)
      const k = s.t / s.dur;
      if (k >= 1) { s.active = false; s.mesh.visible = false; continue; }
      // frente del barrido con easing out (arranca rápido, frena)
      s.mat.uniforms.uProgress.value = 1 - Math.pow(1 - k, 2.6);
    }
  }
}

/* ---------- Decal radial de impacto (suelo) ---------- */

interface DecalSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  active: boolean;
  dur: number;
  r0: number;
}

/** Anillo + destello interior con textura procedural suave (pool) */
export class ImpactDecalPool {
  private slots: DecalSlot[] = [];
  private tex: THREE.Texture;

  constructor(scene: THREE.Scene, count = 8) {
    this.tex = radialImpactTexture();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex, color: 0xffc87d, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      geoXZ(mesh.geometry);
      mesh.visible = false;
      mesh.renderOrder = 9;
      scene.add(mesh);
      this.slots.push({ mesh, mat, t: 0, active: false, dur: 0.4, r0: 1 });
    }
  }

  spawn(pos: THREE.Vector3, opts: { color?: number; radius?: number; dur?: number } = {}) {
    const s = this.slots.find(x => !x.active) ?? this.slots[0];
    s.active = true; s.t = 0;
    s.dur = opts.dur ?? 0.45;
    s.mat.color.setHex(opts.color ?? 0xffc87d);
    s.r0 = (opts.radius ?? 1.6) * 2;
    s.mesh.position.set(pos.x, pos.y + 0.06, pos.z);
    s.mesh.scale.setScalar(s.r0 * 0.6);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.visible = true;
  }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) { s.active = false; s.mesh.visible = false; continue; }
      // crece rápido al 40% y funde
      const grow = 0.6 + 0.4 * Math.min(1, k / 0.4);
      s.mesh.scale.setScalar(s.r0 * grow);
      s.mat.opacity = (1 - k) * (1 - k);
    }
  }
}

/** rota un plano XZ (para decal horizontal) */
function geoXZ(g: THREE.BufferGeometry) { g.rotateX(-Math.PI / 2); }

/** Textura radial procedural: núcleo + falloff granulado */
function radialImpactTexture(): THREE.Texture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- Destello de impacto (billboard breve) ---------- */

interface FlareSlot {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  t: number;
  active: boolean;
  dur: number;
  size0: number;
}

/** Flash luminoso en el punto de contacto (1-2 frames de vida) */
export class HitFlarePool {
  private slots: FlareSlot[] = [];

  constructor(scene: THREE.Scene, count = 10, private tex: THREE.Texture) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.slots.push({ sprite, mat, t: 0, active: false, dur: 0.12, size0: 1 });
    }
  }

  spawn(pos: THREE.Vector3, opts: { color?: number; size?: number; dur?: number } = {}) {
    const s = this.slots.find(x => !x.active) ?? this.slots[0];
    s.active = true; s.t = 0;
    s.dur = opts.dur ?? 0.11;
    s.size0 = opts.size ?? 1.1;
    s.mat.color.setHex(opts.color ?? 0xfff2d8);
    s.sprite.position.copy(pos);
    s.sprite.visible = true;
  }

  update(dt: number) {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) { s.active = false; s.sprite.visible = false; continue; }
      // expande y funde muy rápido (impacto)
      s.sprite.scale.setScalar(s.size0 * (0.7 + k * 1.6));
      s.mat.opacity = (1 - k) * (1 - k);
    }
  }
}

/* ============================================================
   SOMBRAS DE CONTACTO (blob shadows)
   Óvalo suave bajo cada personaje: ancla visual al suelo,
   vende altura en saltos/picados y coste casi nulo.
   ============================================================ */

interface BlobSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  owner: object | null;
}

export class BlobShadowPool {
  private slots: BlobSlot[] = [];

  /** tex: sprite radial suave (softSprite) · count: nº de personajes simultáneos */
  constructor(scene: THREE.Scene, count: number, tex: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0x000000, transparent: true, opacity: 0.34,
        depthWrite: false, fog: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1; // sobre el terreno, bajo el personaje
      scene.add(mesh);
      this.slots.push({ mesh, mat, owner: null });
    }
  }

  /**
   * Coloca/asigna la sombra de `owner` en (x, groundY, z) con radio `r`.
   * height: altura del personaje sobre el suelo (0 = en tierra).
   */
  track(owner: object, x: number, groundY: number, z: number, r: number, height: number) {
    let s = this.slots.find(o => o.owner === owner);
    if (!s) {
      s = this.slots.find(o => o.owner === null);
      if (!s) return; // pool agotado: personaje sin sombra este frame
      s.owner = owner;
      s.mesh.visible = true;
    }
    // encoge y aclara con la altura (vende saltos y picados del dragón)
    const k = Math.max(0, 1 - height * 0.55);
    s.mesh.position.set(x, groundY + 0.05, z);
    s.mesh.scale.set(r * (1 + (1 - k) * 0.5), 1, r * (0.7 + (1 - k) * 0.5));
    s.mat.opacity = 0.12 + 0.26 * k;
  }

  /** Libera las sombras de personajes muertos/desaparecidos */
  release(owner: object) {
    const s = this.slots.find(o => o.owner === owner);
    if (s) { s.owner = null; s.mesh.visible = false; }
  }

  /** Limpia todos los dueños (fin de partida / reset) */
  clearAll() {
    for (const s of this.slots) { s.owner = null; s.mesh.visible = false; }
  }
}
