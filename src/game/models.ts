import * as THREE from 'three';

/* ============================================================
   MODELOS PROCEDURALES: humanoides, armas, props del mundo
   Estilo low-poly estilizado con flat shading.
   ============================================================ */

export function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...opts });
}
export function metalMat(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.8, flatShading: true });
}
export function emisMat(color: number, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.6, metalness: 0, flatShading: true,
  });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}

/* ---------- Armas ---------- */

export function buildSword(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const blade = mesh(new THREE.BoxGeometry(0.055 * scale, 0.85 * scale, 0.018 * scale),
    metalMat(0xb8c4d0), 0, 0.52 * scale, 0);
  const tip = mesh(new THREE.ConeGeometry(0.032 * scale, 0.14 * scale, 4), metalMat(0xb8c4d0), 0, 1.0 * scale, 0);
  tip.rotation.y = Math.PI / 4;
  const guard = mesh(new THREE.BoxGeometry(0.22 * scale, 0.04 * scale, 0.05 * scale), metalMat(0x8a6a2f), 0, 0.1 * scale, 0);
  const grip = mesh(new THREE.CylinderGeometry(0.026 * scale, 0.03 * scale, 0.2 * scale, 6), stdMat(0x3a2a1c), 0, -0.02 * scale, 0);
  const pommel = mesh(new THREE.SphereGeometry(0.035 * scale, 6, 5), metalMat(0x8a6a2f), 0, -0.13 * scale, 0);
  g.add(blade, tip, guard, grip, pommel);
  return g;
}

export function buildGreatsword(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const blade = mesh(new THREE.BoxGeometry(0.12 * scale, 1.7 * scale, 0.035 * scale),
    new THREE.MeshStandardMaterial({ color: 0x3a3a46, roughness: 0.4, metalness: 0.85, flatShading: true, emissive: 0x882222, emissiveIntensity: 0.25 }), 0, 1.0 * scale, 0);
  const guard = mesh(new THREE.BoxGeometry(0.42 * scale, 0.07 * scale, 0.09 * scale), metalMat(0x1d1d24), 0, 0.1 * scale, 0);
  const grip = mesh(new THREE.CylinderGeometry(0.04 * scale, 0.05 * scale, 0.34 * scale, 6), stdMat(0x241414), 0, -0.1 * scale, 0);
  const skull = mesh(new THREE.SphereGeometry(0.07 * scale, 6, 5), emisMat(0xff2a1a, 1.4), 0, -0.3 * scale, 0);
  g.add(blade, guard, grip, skull);
  return g;
}

export function buildClub(): THREE.Group {
  const g = new THREE.Group();
  const stick = mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.75, 6), stdMat(0x5b4226), 0, 0.3, 0);
  const head = mesh(new THREE.DodecahedronGeometry(0.16), stdMat(0x4a3520), 0, 0.72, 0);
  const spike1 = mesh(new THREE.ConeGeometry(0.05, 0.14, 4), stdMat(0x6b6b70), 0, 0.86, 0);
  g.add(stick, head, spike1);
  return g;
}

export function buildAxe(): THREE.Group {
  const g = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.15, 6), stdMat(0x4a3520), 0, 0.45, 0);
  const headGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 3);
  const head = mesh(headGeo, metalMat(0x777780), 0.13, 0.95, 0);
  head.rotation.x = Math.PI / 2;
  head.rotation.z = Math.PI;
  g.add(handle, head);
  return g;
}

export function buildBow(): THREE.Group {
  const g = new THREE.Group();
  const arc = mesh(new THREE.TorusGeometry(0.42, 0.028, 5, 12, Math.PI * 1.15), stdMat(0x5b4226), 0, 0.35, 0);
  arc.rotation.z = Math.PI * 0.42;
  const strMat = new THREE.LineBasicMaterial({ color: 0xd8d3c0 });
  const pts = [new THREE.Vector3(-0.38, 0.05, 0), new THREE.Vector3(0.06, 0.35, 0), new THREE.Vector3(-0.38, 0.65, 0)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strMat);
  g.add(arc, line);
  return g;
}

/* ---------- Humanoide paramétrico ---------- */

export interface HumanoidOpts {
  scale?: number;
  skin: number;
  torso: number;
  legs: number;
  arms?: number;
  eyes?: number | null;
  eyeIntensity?: number;
  weapon?: 'sword' | 'greatsword' | 'club' | 'axe' | 'bow' | 'none';
  helmet?: 'none' | 'knight' | 'horns' | 'hood';
  helmetColor?: number;
  shoulder?: number | null;   // hombreras
  chest?: number | null;      // peto
  bigHead?: boolean;
  hunched?: boolean;
}

export interface HumanoidRig {
  root: THREE.Group;   // pies en y=0
  body: THREE.Group;   // cadera
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handR: THREE.Group;
  weapon: THREE.Group | null;
  weaponMat: THREE.MeshStandardMaterial | null;
  height: number;
}

export function buildHumanoid(o: HumanoidOpts): HumanoidRig {
  const s = o.scale ?? 1;
  const root = new THREE.Group();
  const skin = stdMat(o.skin);
  const torsoMat = stdMat(o.torso);
  const legMat = stdMat(o.legs);
  const armMat = stdMat(o.arms ?? o.skin);

  const legLen = 0.52, torsoH = 0.55, headR = o.bigHead ? 0.21 : 0.155;

  const body = new THREE.Group();
  body.position.y = legLen;
  root.add(body);

  // Cadera
  const pelvis = mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), legMat, 0, 0.04, 0);
  body.add(pelvis);

  // Torso (pivot en la cadera)
  const torso = new THREE.Group();
  body.add(torso);
  const chest = mesh(new THREE.BoxGeometry(0.34, torsoH, 0.22), torsoMat, 0, torsoH / 2, 0);
  torso.add(chest);
  if (o.chest !== null && o.chest !== undefined) {
    torso.add(mesh(new THREE.BoxGeometry(0.37, torsoH * 0.55, 0.25), metalMat(o.chest), 0, torsoH * 0.62, 0));
  }
  if (o.hunched) torso.rotation.x = 0.35;

  // Cabeza
  const head = new THREE.Group();
  head.position.y = torsoH + 0.06;
  torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(headR, 7, 6), skin, 0, headR * 0.8, 0));
  if (o.eyes !== null && o.eyes !== undefined) {
    const eyeMat = emisMat(o.eyes, o.eyeIntensity ?? 2.2);
    const eL = mesh(new THREE.SphereGeometry(0.028, 5, 4), eyeMat, -0.06, headR * 0.85, headR * 0.78, false);
    const eR = mesh(new THREE.SphereGeometry(0.028, 5, 4), eyeMat, 0.06, headR * 0.85, headR * 0.78, false);
    head.add(eL, eR);
  }
  if (o.helmet === 'knight') {
    const hm = metalMat(o.helmetColor ?? 0x9aa2ad);
    head.add(mesh(new THREE.SphereGeometry(headR + 0.035, 7, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), hm, 0, headR * 0.82, 0));
    head.add(mesh(new THREE.BoxGeometry(headR * 1.7, 0.05, 0.03), hm, 0, headR * 0.72, headR * 0.82));
  } else if (o.helmet === 'horns') {
    const hm = metalMat(o.helmetColor ?? 0x22222a);
    head.add(mesh(new THREE.SphereGeometry(headR + 0.03, 7, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), hm, 0, headR * 0.84, 0));
    const hornGeo = new THREE.ConeGeometry(0.05, 0.28, 5);
    const h1 = mesh(hornGeo, stdMat(0x6b5a4a), -0.16, headR * 1.25, -0.02);
    h1.rotation.z = 0.7;
    const h2 = mesh(hornGeo, stdMat(0x6b5a4a), 0.16, headR * 1.25, -0.02);
    h2.rotation.z = -0.7;
    head.add(h1, h2);
  } else if (o.helmet === 'hood') {
    const hm = stdMat(o.helmetColor ?? 0x2d2a33);
    const hood = mesh(new THREE.ConeGeometry(headR + 0.06, 0.3, 6), hm, 0, headR * 1.0, -0.02);
    hood.rotation.x = 0.22;
    head.add(hood);
  }

  // Brazos (pivot en hombro)
  const makeArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.225, torsoH * 0.88, 0);
    torso.add(arm);
    arm.add(mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.5, 6), armMat, 0, -0.25, 0));
    if (o.shoulder !== null && o.shoulder !== undefined && side === 1) {
      arm.add(mesh(new THREE.SphereGeometry(0.1, 6, 5), metalMat(o.shoulder), 0, 0.02, 0));
    }
    if (o.shoulder !== null && o.shoulder !== undefined && side === -1) {
      arm.add(mesh(new THREE.SphereGeometry(0.1, 6, 5), metalMat(o.shoulder), 0, 0.02, 0));
    }
    const hand = new THREE.Group();
    hand.position.y = -0.5;
    arm.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(0.055, 5, 4), skin, 0, 0, 0));
    return { arm, hand };
  };
  const aL = makeArm(-1), aR = makeArm(1);
  aL.arm.rotation.x = -0.12; aR.arm.rotation.x = -0.12;
  aL.arm.rotation.z = 0.1; aR.arm.rotation.z = -0.1;

  // Piernas (pivot en cadera)
  const makeLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.11, 0.02, 0);
    body.add(leg);
    leg.add(mesh(new THREE.CylinderGeometry(0.065, 0.05, legLen, 6), legMat, 0, -legLen / 2 + 0.02, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), stdMat(0x2a2018), 0, -legLen + 0.02, 0.04));
    return leg;
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  // Arma en mano derecha
  let weapon: THREE.Group | null = null;
  let weaponMat: THREE.MeshStandardMaterial | null = null;
  if (o.weapon && o.weapon !== 'none') {
    weapon = new THREE.Group();
    weapon.position.y = -0.06;
    let w: THREE.Group;
    switch (o.weapon) {
      case 'sword': w = buildSword(1); break;
      case 'greatsword': w = buildGreatsword(1); break;
      case 'club': w = buildClub(); break;
      case 'axe': w = buildAxe(); break;
      case 'bow': w = buildBow(); break;
      default: w = buildSword(1);
    }
    weapon.add(w);
    weapon.traverse(m => {
      if (m instanceof THREE.Mesh) {
        const mm = m.material as THREE.MeshStandardMaterial;
        if (mm && mm.emissive && mm.emissiveIntensity > 0) weaponMat = mm;
      }
    });
    aR.hand.add(weapon);
  }

  root.scale.setScalar(s);
  return {
    root, body, torso, head,
    armL: aL.arm, armR: aR.arm, legL, legR,
    handR: aR.hand, weapon, weaponMat: weaponMat ?? null,
    height: (legLen + torsoH + headR * 2.4) * s,
  };
}

/* ---------- Creadores de enemigos ---------- */

export function buildPlayerRig(): HumanoidRig {
  return buildHumanoid({
    skin: 0xd9b08c, torso: 0x5a6472, legs: 0x3c4450, arms: 0x5a6472,
    eyes: null, weapon: 'sword', helmet: 'knight', helmetColor: 0x9aa2ad,
    chest: 0x8a93a1, shoulder: 0x8a93a1,
  });
}
export function buildGoblinRig(): HumanoidRig {
  return buildHumanoid({
    scale: 0.72, skin: 0x7ba33e, torso: 0x5d4022, legs: 0x4a331c,
    eyes: 0xffd23e, weapon: 'club', bigHead: true, hunched: true,
  });
}
export function buildArcherRig(): HumanoidRig {
  return buildHumanoid({
    scale: 0.95, skin: 0xd8d3c0, torso: 0x37332e, legs: 0x2e2a26,
    eyes: 0x9df2ff, weapon: 'bow', helmet: 'hood', helmetColor: 0x37332e,
  });
}
export function buildOrcRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.42, skin: 0x9a5641, torso: 0x4a3a30, legs: 0x3a2d24,
    eyes: 0xff7a2a, weapon: 'axe', shoulder: 0x6b6b70, hunched: true,
  });
}
export function buildBossRig(): HumanoidRig {
  return buildHumanoid({
    scale: 1.95, skin: 0x3a3a46, torso: 0x2a2a35, legs: 0x22222c,
    eyes: 0xff2211, eyeIntensity: 3, weapon: 'greatsword',
    helmet: 'horns', helmetColor: 0x1c1c26, chest: 0x1c1c26, shoulder: 0x1c1c26,
  });
}

/* ---------- Props del mundo ---------- */

export function buildObelisk(cleansed: boolean): { group: THREE.Group; crystal: THREE.Mesh; runes: THREE.Mesh[] } {
  const g = new THREE.Group();
  const stoneMat = stdMat(0x4a4a55);
  const base = mesh(new THREE.CylinderGeometry(1.1, 1.4, 0.5, 7), stoneMat, 0, 0.25, 0);
  const shaft = mesh(new THREE.CylinderGeometry(0.35, 0.62, 3.4, 6), stoneMat, 0, 2.0, 0);
  const crystalMat = cleansed ? emisMat(0x37d8c8, 2.4) : emisMat(0xd8323c, 1.8);
  const crystal = mesh(new THREE.OctahedronGeometry(0.42), crystalMat, 0, 4.1, 0);
  g.add(base, shaft, crystal);
  const runes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const r = mesh(new THREE.BoxGeometry(0.1, 0.28, 0.03),
      cleansed ? emisMat(0x37d8c8, 1.6) : emisMat(0xd8323c, 1.2),
      Math.sin((i / 4) * Math.PI * 2) * 0.55, 1.2 + (i % 2) * 0.8, Math.cos((i / 4) * Math.PI * 2) * 0.55, false);
    r.lookAt(0, r.position.y, 0);
    g.add(r);
    runes.push(r);
  }
  return { group: g, crystal, runes };
}

export function buildBonfire(): { group: THREE.Group; light: THREE.PointLight; logs: THREE.Mesh[] } {
  const g = new THREE.Group();
  const logs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 5), stdMat(0x3a2a18),
      Math.sin((i / 5) * Math.PI * 2) * 0.35, 0.22, Math.cos((i / 5) * Math.PI * 2) * 0.35);
    log.rotation.z = Math.PI / 2.4;
    log.rotation.y = (i / 5) * Math.PI * 2;
    g.add(log); logs.push(log);
  }
  const flame = mesh(new THREE.ConeGeometry(0.5, 1.3, 7), emisMat(0xff8c2a, 2.6), 0, 0.85, 0, false);
  flame.name = 'flame';
  g.add(flame);
  const inner = mesh(new THREE.ConeGeometry(0.28, 0.8, 6), emisMat(0xffd23e, 3), 0, 0.7, 0, false);
  g.add(inner);
  const light = new THREE.PointLight(0xff9040, 14, 20, 1.6);
  light.position.set(0, 1.6, 0);
  light.castShadow = false;
  g.add(light);
  const glow = mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.08, 12), stdMat(0x1c1c22), 0, 0.04, 0, false);
  g.add(glow);
  return { group: g, light, logs };
}

export function buildTorch(): { group: THREE.Group; light: THREE.PointLight; flame: THREE.Mesh } {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 5), stdMat(0x3a2a1c), 0, 1.2, 0);
  const bowl = mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.22, 7), metalMat(0x4a4a52), 0, 2.45, 0);
  const flame = mesh(new THREE.ConeGeometry(0.2, 0.55, 6), emisMat(0xff8c2a, 2.8), 0, 2.8, 0, false);
  const light = new THREE.PointLight(0xff8030, 6, 13, 1.8);
  light.position.set(0, 2.9, 0);
  g.add(pole, bowl, flame, light);
  return { group: g, light, flame };
}

export function buildRuinedPillar(h = 2.4): THREE.Group {
  const g = new THREE.Group();
  const mat = stdMat(0x5c5c66);
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), mat, 0, 0.12, 0));
  const col = mesh(new THREE.CylinderGeometry(0.26, 0.3, h, 7), mat, 0, h / 2 + 0.2, 0);
  col.rotation.z = 0.03;
  g.add(col);
  g.add(mesh(new THREE.BoxGeometry(0.75, 0.22, 0.75), mat, 0, h + 0.3, 0));
  return g;
}

export function buildBrokenArch(): THREE.Group {
  const g = new THREE.Group();
  const mat = stdMat(0x55555f);
  const l = mesh(new THREE.BoxGeometry(0.55, 3.4, 0.55), mat, -1.5, 1.7, 0);
  const r = mesh(new THREE.BoxGeometry(0.55, 2.6, 0.55), mat, 1.5, 1.3, 0.1);
  r.rotation.z = 0.08;
  const top = mesh(new THREE.BoxGeometry(3.8, 0.5, 0.6), mat, -0.2, 3.55, 0);
  top.rotation.z = -0.1;
  g.add(l, r, top);
  return g;
}

export function buildArrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4), stdMat(0x8a6a3f), 0, 0, 0, false);
  shaft.rotation.x = Math.PI / 2;
  const tip = mesh(new THREE.ConeGeometry(0.045, 0.14, 4), metalMat(0x9aa2ad), 0, 0, 0.4, false);
  tip.rotation.x = Math.PI / 2;
  g.add(shaft, tip);
  return g;
}

export function buildPickupOrb(color: number): { group: THREE.Group; core: THREE.Mesh } {
  const g = new THREE.Group();
  const core = mesh(new THREE.IcosahedronGeometry(0.16, 0), emisMat(color, 2.4), 0, 0, 0, false);
  const halo = mesh(new THREE.SphereGeometry(0.24, 8, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 }), 0, 0, 0, false);
  g.add(core, halo);
  return { group: g, core };
}

export function buildSigil(): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const mat = stdMat(0x3c3c46);
  g.add(mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.3, 24), mat, 0, 0.15, 0));
  const ring = mesh(new THREE.TorusGeometry(1.5, 0.09, 6, 28), emisMat(0xd8323c, 1.6), 0, 0.4, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return { group: g, ring };
}

/** Crea geometría de hierba (dos planos cruzados) */
export function grassGeometry(): THREE.BufferGeometry {
  const geos: THREE.PlaneGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const p = new THREE.PlaneGeometry(0.5, 0.55, 1, 2);
    p.translate(0, 0.22, 0);
    p.rotateY((i / 2) * Math.PI);
    geos.push(p);
  }
  // merge manual
  const posArrs: number[] = [], normArrs: number[] = [], uvArrs: number[] = [], idxArr: number[] = [];
  let vertOffset = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const norm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      posArrs.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normArrs.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      uvArrs.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) idxArr.push(idx.getX(i) + vertOffset);
    vertOffset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(posArrs, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normArrs, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvArrs, 2));
  merged.setIndex(idxArr);
  return merged;
}
