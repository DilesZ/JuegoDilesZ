import * as THREE from 'three';
import { mulberry32, terrainHeight, WORLD, fbm } from './core';
import {
  buildObelisk, buildBonfire, buildTorch, buildRuinedPillar, buildBrokenArch,
  buildSigil, grassGeometry, stdMat, emisMat,
} from './models';

/* ============================================================
   MUNDO: terreno, cielo, decoración instanciada, colisionadores,
   santuarios, hoguera y arena del jefe.
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
  crystalMat: THREE.MeshStandardMaterial;
  runeMats: THREE.MeshStandardMaterial[];
  light: THREE.PointLight;
}

export class World {
  scene: THREE.Scene;
  colliders: Collider[] = [];
  shrines: ShrineState[] = [];
  bonfirePos = new THREE.Vector3(WORLD.bonfire.x, 0, WORLD.bonfire.z);
  bonfireLight!: THREE.PointLight;
  bonfireFlame: THREE.Mesh | null = null;
  private torches: { group: THREE.Group; light: THREE.PointLight; flame: THREE.Mesh; pos: THREE.Vector3 }[] = [];
  private moonLight!: THREE.DirectionalLight;
  private time = 0;
  sigil: { group: THREE.Group; ring: THREE.Mesh; ringMat: THREE.MeshStandardMaterial } | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildDecorations();
    this.buildBonfire();
    this.buildShrines();
    this.buildArena();
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

  /* ---------- Cielo ---------- */

  private buildSky() {
    // cúpula con degradado nocturno
    const skyGeo = new THREE.SphereGeometry(400, 16, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x070b18) },
        mid: { value: new THREE.Color(0x101a30) },
        bottom: { value: new THREE.Color(0x1a1626) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main(){
          float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.5));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10;
    this.scene.add(sky);

    // estrellas
    const rng = mulberry32(777);
    const starCount = 900;
    const pos = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const th = rng() * Math.PI * 2;
      const ph = Math.acos(rng() * 0.85); // hemisferio superior
      const r = 380;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r + 20;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      sizes[i] = 1 + rng() * 2.2;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSize; varying float vS;
        void main(){ vS = aSize; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * (600.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vS; void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        float a = smoothstep(0.5, 0.1, d) * 0.85;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a); }`,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.renderOrder = -9;
    this.scene.add(stars);

    // luna
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    moon.position.set(-160, 130, -220);
    moon.renderOrder = -8;
    this.scene.add(moon);
    const moonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(24, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fb2e8, transparent: true, opacity: 0.16, fog: false, blending: THREE.AdditiveBlending })
    );
    moonGlow.position.copy(moon.position);
    this.scene.add(moonGlow);
  }

  /* ---------- Luces ---------- */

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0x35426a, 0x1a1410, 0.55);
    this.scene.add(hemi);

    this.moonLight = new THREE.DirectionalLight(0x9fb4e8, 1.05);
    this.moonLight.position.set(-40, 55, -30);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.near = 5;
    this.moonLight.shadow.camera.far = 160;
    const S = 42;
    this.moonLight.shadow.camera.left = -S;
    this.moonLight.shadow.camera.right = S;
    this.moonLight.shadow.camera.top = S;
    this.moonLight.shadow.camera.bottom = -S;
    this.moonLight.shadow.bias = -0.0006;
    this.moonLight.shadow.normalBias = 0.02;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);
  }

  /* ---------- Terreno ---------- */

  private buildTerrain() {
    const seg = 130;
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x2d4020);
    const cGrass2 = new THREE.Color(0x3a4c26);
    const cDirt = new THREE.Color(0x4a3b28);
    const cRock = new THREE.Color(0x4c4c55);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // color por altura + variación por ruido
      const n = fbm(x * 0.11, z * 0.11, 3) * 0.5 + 0.5;
      if (h > 8) c.copy(cRock).lerp(cDirt, Math.max(0, 1 - (h - 8) / 8));
      else c.copy(cGrass).lerp(cGrass2, n);
      if (n > 0.72 && h < 6) c.lerp(cDirt, 0.55); // parches de tierra
      const shade = 0.82 + n * 0.36;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    this.scene.add(terrain);
  }

  /* ---------- Decoración instanciada ---------- */

  private buildDecorations() {
    const rng = mulberry32(1337);
    const dummy = new THREE.Object3D();

    // Árboles (pinos estilizados): tronco + 2 copas
    const treeCount = 130;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
    const trunkMat = stdMat(0x4a3520);
    const canopy1 = new THREE.ConeGeometry(1.9, 3.2, 7);
    const canopy2 = new THREE.ConeGeometry(1.35, 2.6, 7);
    const canopyMat = stdMat(0x1e3a22);
    const canopyMat2 = stdMat(0x26492b);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const c1 = new THREE.InstancedMesh(canopy1, canopyMat, treeCount);
    const c2 = new THREE.InstancedMesh(canopy2, canopyMat2, treeCount);
    trunks.castShadow = c1.castShadow = c2.castShadow = true;
    trunks.receiveShadow = c1.receiveShadow = true;
    let placed = 0, guard = 0;
    while (placed < treeCount && guard++ < 4000) {
      const a = rng() * Math.PI * 2;
      const r = 18 + rng() * (WORLD.radius - 24);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 14)) continue;
      const h = terrainHeight(x, z);
      if (h > 7.5) continue;
      const s = 0.8 + rng() * 1.1;
      dummy.position.set(x, h + 1.1 * s, z);
      dummy.scale.setScalar(s);
      dummy.rotation.y = rng() * Math.PI * 2;
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = h + 3.1 * s;
      dummy.updateMatrix();
      c1.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = h + 5.0 * s;
      dummy.updateMatrix();
      c2.setMatrixAt(placed, dummy.matrix);
      this.colliders.push({ x, z, r: 0.55 * s });
      placed++;
    }
    trunks.count = c1.count = c2.count = placed;
    this.scene.add(trunks, c1, c2);

    // Rocas
    const rockCount = 90;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = stdMat(0x55555e);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rocks.castShadow = rocks.receiveShadow = true;
    placed = 0; guard = 0;
    while (placed < rockCount && guard++ < 3000) {
      const a = rng() * Math.PI * 2;
      const r = 14 + rng() * (WORLD.radius - 14);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearCamp(x, z, 10)) continue;
      const s = 0.4 + rng() * 1.6;
      dummy.position.set(x, terrainHeight(x, z) + s * 0.3, z);
      dummy.scale.set(s, s * 0.75, s);
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.updateMatrix();
      rocks.setMatrixAt(placed, dummy.matrix);
      if (s > 0.9) this.colliders.push({ x, z, r: s * 0.9 });
      placed++;
    }
    rocks.count = placed;
    this.scene.add(rocks);

    // Hierba
    const grassCount = 2600;
    const gGeo = grassGeometry();
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x46602e, roughness: 1, side: THREE.DoubleSide, flatShading: true,
    });
    const grass = new THREE.InstancedMesh(gGeo, grassMat, grassCount);
    placed = 0; guard = 0;
    while (placed < grassCount && guard++ < 12000) {
      const a = rng() * Math.PI * 2;
      const r = rng() * (WORLD.radius - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h > 7) continue;
      dummy.position.set(x, h, z);
      dummy.scale.setScalar(0.7 + rng() * 0.9);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    grass.count = placed;
    this.scene.add(grass);

    // Ruinas dispersas: pilares y arcos
    const ruinSpots: [number, number][] = [[28, -28], [-30, -8], [12, 40], [-16, 58], [44, 52], [-44, -40], [64, -12], [20, -60]];
    const pillarMat = stdMat(0x5c5c66);
    for (const [x, z] of ruinSpots) {
      const h = terrainHeight(x, z);
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
      g.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; if (o.material === undefined) o.material = pillarMat; } });
      this.scene.add(g);
    }

    // Antorchas alrededor de cada santuario y en la arena
    for (const s of WORLD.shrines) this.addTorchRing(s.x, s.z, s.r - 2, 4, rng);
    this.addTorchRing(WORLD.arena.x, WORLD.arena.z, WORLD.arena.r - 3, 6, rng);
    // un par de antorchas cerca de la hoguera
    this.addTorch(WORLD.bonfire.x + 3.4, WORLD.bonfire.z - 2.4, terrainHeight(WORLD.bonfire.x + 3.4, WORLD.bonfire.z - 2.4));
    this.addTorch(WORLD.bonfire.x - 3.2, WORLD.bonfire.z - 2.8, terrainHeight(WORLD.bonfire.x - 3.2, WORLD.bonfire.z - 2.8));
  }

  private nearCamp(x: number, z: number, margin: number): boolean {
    if (Math.hypot(x - WORLD.bonfire.x, z - WORLD.bonfire.z) < margin + 3) return true;
    for (const s of WORLD.shrines) if (Math.hypot(x - s.x, z - s.z) < margin + 3) return true;
    if (Math.hypot(x - WORLD.arena.x, z - WORLD.arena.z) < WORLD.arena.r + margin - 4) return true;
    return false;
  }

  private addTorchRing(cx: number, cz: number, radius: number, count: number, rng: () => number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.4;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      this.addTorch(x, z, terrainHeight(x, z));
    }
  }

  private addTorch(x: number, z: number, h: number) {
    const { group, light, flame } = buildTorch();
    group.position.set(x, h, z);
    this.scene.add(group);
    this.colliders.push({ x, z, r: 0.3 });
    this.torches.push({ group, light, flame, pos: new THREE.Vector3(x, h + 2.9, z) });
  }

  /* ---------- Hoguera (sanctuario) ---------- */

  private buildBonfire() {
    const { group, light, logs } = buildBonfire();
    const h = terrainHeight(WORLD.bonfire.x, WORLD.bonfire.z);
    group.position.set(WORLD.bonfire.x, h, WORLD.bonfire.z);
    this.scene.add(group);
    this.bonfireLight = light;
    this.bonfireFlame = (group.getObjectByName('flame') as THREE.Mesh) ?? null;
    this.colliders.push({ x: WORLD.bonfire.x, z: WORLD.bonfire.z, r: 1.1 });
    // asientos de piedra
    const rng = mulberry32(99);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const x = WORLD.bonfire.x + Math.cos(a) * 2.4;
      const z = WORLD.bonfire.z + Math.sin(a) * 2.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), stdMat(0x4c4c55));
      rock.position.set(x, terrainHeight(x, z) + 0.22, z);
      rock.scale.y = 0.7;
      rock.rotation.y = rng() * Math.PI;
      rock.castShadow = true;
      this.scene.add(rock);
    }
    void logs;
  }

  /* ---------- Santuarios ---------- */

  private buildShrines() {
    WORLD.shrines.forEach((s, idx) => {
      const { group, crystal, runes } = buildObelisk(false);
      const h = terrainHeight(s.x, s.z);
      group.position.set(s.x, h, s.z);
      this.scene.add(group);
      this.colliders.push({ x: s.x, z: s.z, r: 1.35 });
      const crystalMat = crystal.material as THREE.MeshStandardMaterial;
      const runeMats = runes.map(r => r.material as THREE.MeshStandardMaterial);
      const light = new THREE.PointLight(0xd8323c, 5, 16, 1.8);
      light.position.set(s.x, h + 4.1, s.z);
      this.scene.add(light);
      // losa circular
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 0.25, 18), stdMat(0x45454f));
      slab.position.set(s.x, h + 0.1, s.z);
      slab.receiveShadow = true;
      this.scene.add(slab);
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
    sh.light.intensity = 7;
  }

  /* ---------- Arena del jefe ---------- */

  private buildArena() {
    const A = WORLD.arena;
    const h = terrainHeight(A.x, A.z);
    // suelo circular de piedra
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(A.r, A.r + 1.5, 0.5, 28), stdMat(0x3c3c46));
    floor.position.set(A.x, h + 0.05, A.z);
    floor.receiveShadow = true;
    this.scene.add(floor);
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
    this.sigil = { group: sg.group, ring: sg.ring, ringMat: sg.ring.material as THREE.MeshStandardMaterial };
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

  /* ---------- Actualización por frame ---------- */

  update(dt: number, camera: THREE.Camera, spawnEmber: (x: number, y: number, z: number) => void) {
    this.time += dt;
    // la luz lunar sigue al jugador para mantener sombras nítidas
    if (camera instanceof THREE.PerspectiveCamera) {
      const t = camera.position;
      this.moonLight.position.set(t.x - 40, 55, t.z - 30);
      this.moonLight.target.position.set(t.x, 0, t.z);
    }
    // parpadeo de la hoguera
    if (this.bonfireLight) {
      this.bonfireLight.intensity = 13 + Math.sin(this.time * 9) * 1.6 + Math.sin(this.time * 23.7) * 0.9;
    }
    if (this.bonfireFlame) {
      const s = 1 + Math.sin(this.time * 11) * 0.12;
      this.bonfireFlame.scale.set(s, 1 + Math.sin(this.time * 17) * 0.18, s);
    }
    // antorchas: parpadeo + brasas
    for (const t of this.torches) {
      t.light.intensity = 5.2 + Math.sin(this.time * 8 + t.pos.x) * 0.9 + Math.sin(this.time * 19 + t.pos.z) * 0.5;
      const fs = 1 + Math.sin(this.time * 13 + t.pos.z) * 0.16;
      t.flame.scale.set(fs, 1 + Math.sin(this.time * 15 + t.pos.x) * 0.2, fs);
      if (Math.random() < 0.1) {
        spawnEmber(t.pos.x + (Math.random() - 0.5) * 0.2, t.pos.y, t.pos.z + (Math.random() - 0.5) * 0.2);
      }
    }
    // cristales de santuarios flotan
    for (const sh of this.shrines) {
      sh.crystal.rotation.y += dt * (sh.cleansed ? 0.8 : 0.5);
      sh.crystal.position.y = 4.1 + Math.sin(this.time * 1.6 + sh.idx) * 0.12;
      sh.light.intensity = (sh.cleansed ? 7 : 5) + Math.sin(this.time * 5 + sh.idx * 2) * 0.8;
    }
    // sigilo
    if (this.sigil && this.sigil.group.visible) {
      this.sigil.ring.rotation.z += dt * 0.8;
    }
  }
}
