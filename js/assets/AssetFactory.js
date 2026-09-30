// AssetFactory: pure procedural asset builders.
//
// Everything the game renders is generated here from three.js primitives and
// CanvasTexture, so the game runs fully offline. The API is intentionally
// stable (makeGround, makeBuilding, makeZombie, ...) so real downloaded models
// / textures can be swapped in later behind the same functions without touching
// the rest of the codebase.

import * as THREE from 'three';

const _textureCache = new Map();

/**
 * Draw into an offscreen canvas and return a THREE.CanvasTexture.
 * @param {(ctx:CanvasRenderingContext2D, size:number)=>void} drawFn
 * @param {number} size square texture size in pixels (power of two recommended)
 * @param {string} [cacheKey] optional key to reuse an identical texture
 */
export function makeCanvasTexture(drawFn, size = 128, cacheKey) {
  if (cacheKey && _textureCache.has(cacheKey)) {
    return _textureCache.get(cacheKey);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  if (cacheKey) _textureCache.set(cacheKey, tex);
  return tex;
}

/** Ground plane with a subtle procedural asphalt/dirt texture. */
export function makeGround(size = 200) {
  const tex = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#3a3d33';
    ctx.fillRect(0, 0, s, s);
    // speckle
    for (let i = 0; i < s * 6; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const g = 40 + Math.floor(Math.random() * 50);
      ctx.fillStyle = `rgb(${g},${g - 4},${g - 12})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }, 128, 'ground');
  tex.repeat.set(size / 8, size / 8);

  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** A simple box building with windowed facade texture. */
export function makeBuilding(w = 8, h = 12, d = 8, style = 'concrete') {
  const palette = {
    concrete: { base: '#8a8579', win: '#5a6a7a' },
    brick: { base: '#7a4a3a', win: '#3a4652' },
    slum: { base: '#9a8a6a', win: '#403830' },
  };
  const c = palette[style] || palette.concrete;
  const tex = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = c.base;
    ctx.fillRect(0, 0, s, s);
    const cols = 4;
    const rows = 5;
    const pad = s * 0.06;
    const cw = (s - pad * (cols + 1)) / cols;
    const ch = (s - pad * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        ctx.fillStyle = Math.random() > 0.35 ? c.win : '#20242a';
        ctx.fillRect(pad + col * (cw + pad), pad + r * (ch + pad), cw, ch);
      }
    }
  }, 128, 'building-' + style);

  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'building';
  return mesh;
}

/** Humanoid zombie assembled from primitives. Returns a THREE.Group. */
export function makeZombie() {
  const group = new THREE.Group();
  group.name = 'zombie';

  const skin = new THREE.MeshStandardMaterial({ color: 0x5a7a4a, roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), cloth);
  torso.position.y = 1.2;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 1.95;
  group.add(head);

  const armGeo = new THREE.BoxGeometry(0.18, 0.9, 0.18);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.5, 1.35, 0.25);
  armL.rotation.x = -1.1; // reaching forward
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.5, 1.35, 0.25);
  armR.rotation.x = -1.1;
  group.add(armR);

  const legGeo = new THREE.BoxGeometry(0.22, 0.95, 0.22);
  const legL = new THREE.Mesh(legGeo, cloth);
  legL.position.set(-0.2, 0.48, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, cloth);
  legR.position.set(0.2, 0.48, 0);
  group.add(legR);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // Expose limbs for later animation.
  group.userData.parts = { torso, head, armL, armR, legL, legR };
  return group;
}

/** First-person view model group for the given weapon type. */
export function makePlayerViewmodel(weaponType = 'knife') {
  const group = new THREE.Group();
  group.name = 'viewmodel';
  const mesh = weaponType === 'gun' ? makeGunMesh() : makeKnifeMesh();
  // Position toward lower-right of the view.
  mesh.position.set(0.35, -0.35, -0.7);
  group.add(mesh);
  return group;
}

/** Knife mesh (blade + handle). */
export function makeKnifeMesh() {
  const group = new THREE.Group();
  group.name = 'knife';
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.5, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.8, roughness: 0.3 })
  );
  blade.position.y = 0.25;
  group.add(blade);
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 })
  );
  handle.position.y = -0.08;
  group.add(handle);
  return group;
}

/** Gun mesh (body + barrel + grip). */
export function makeGunMesh() {
  const group = new THREE.Group();
  group.name = 'gun';
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.4), metal);
  group.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.32);
  group.add(barrel);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 })
  );
  grip.position.set(0, -0.16, 0.1);
  grip.rotation.x = 0.2;
  group.add(grip);
  return group;
}

/** Collectible pickup marker (ammo, medkit, weapon, supply). */
export function makePickup(type = 'ammo') {
  const colors = { ammo: 0xffd27f, medkit: 0xe84c4c, weapon: 0x7fd0ff, supply: 0x9fe07f, cure: 0xc07fff };
  const color = colors[type] || 0xffffff;
  const group = new THREE.Group();
  group.name = 'pickup-' + type;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 })
  );
  box.position.y = 0.5;
  box.castShadow = true;
  group.add(box);
  group.userData.pickupType = type;
  return group;
}

/** NPC humanoid. kind: 'friendly' | 'hostile' | 'scientist'. */
export function makeNPC(kind = 'friendly') {
  const group = new THREE.Group();
  group.name = 'npc-' + kind;
  const clothColor = kind === 'hostile' ? 0x883333 : kind === 'scientist' ? 0xdddddd : 0x3355aa;
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99b6e, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), cloth);
  torso.position.y = 1.2;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 1.95;
  group.add(head);
  const legGeo = new THREE.BoxGeometry(0.22, 0.95, 0.22);
  const legL = new THREE.Mesh(legGeo, cloth);
  legL.position.set(-0.2, 0.48, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, cloth);
  legR.position.set(0.2, 0.48, 0);
  group.add(legR);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.userData.kind = kind;
  return group;
}

/** Environmental prop. kind: 'crate' | 'barrel' | 'car' | 'tree' | 'streetlight'. */
export function makeProp(kind = 'crate') {
  const group = new THREE.Group();
  group.name = 'prop-' + kind;
  switch (kind) {
    case 'barrel': {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12),
        new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.8 })
      );
      m.position.y = 0.55;
      m.castShadow = true;
      group.add(m);
      break;
    }
    case 'car': {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.4, roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), bodyMat);
      body.position.y = 0.7;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.2), bodyMat);
      cabin.position.y = 1.25;
      body.castShadow = true;
      cabin.castShadow = true;
      group.add(body, cabin);
      break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.28, 2.0, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.95 })
      );
      trunk.position.y = 1.0;
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 2.6, 10),
        new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.9 })
      );
      leaves.position.y = 2.8;
      trunk.castShadow = true;
      leaves.castShadow = true;
      group.add(trunk, leaves);
      break;
    }
    case 'streetlight': {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 4.0, 8),
        new THREE.MeshStandardMaterial({ color: 0x33383f, metalness: 0.6, roughness: 0.5 })
      );
      pole.position.y = 2.0;
      pole.castShadow = true;
      group.add(pole);
      break;
    }
    case 'crate':
    default: {
      const tex = makeCanvasTexture((ctx, s) => {
        ctx.fillStyle = '#8a5a2a';
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#5a3a18';
        ctx.lineWidth = s * 0.06;
        ctx.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(s, s);
        ctx.moveTo(s, 0); ctx.lineTo(0, s);
        ctx.stroke();
      }, 64, 'crate');
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
      );
      m.position.y = 0.5;
      m.castShadow = true;
      group.add(m);
      break;
    }
  }
  return group;
}

/** A glowing floor disc that marks a travel exit or landmark trigger. */
export function makeExitMarker(color = 0x66ccff) {
  const group = new THREE.Group();
  group.name = 'exit-marker';
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.08, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 })
  );
  ring.position.y = 0.04;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 4, 12),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.28, roughness: 0.5,
    })
  );
  beam.position.y = 2;
  group.add(beam);
  return group;
}

/** A small floor marker for interactable landmarks (research desk, heli pad). */
export function makeInteractableMarker(color = 0x9fe07f) {
  const group = new THREE.Group();
  group.name = 'interactable-marker';
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 0.06, 20),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.5 })
  );
  disc.position.y = 0.03;
  group.add(disc);
  return group;
}

/**
 * An enclosed starting room: floor, four walls with a doorway gap on the -Z
 * side, and a bed. Returns { group, colliders, doorway:{x,z} }. Walls are thin
 * boxes; colliders are added as short segments of small circles so the player
 * is contained but can leave through the doorway.
 */
export function makeRoom(size = 12) {
  const group = new THREE.Group();
  group.name = 'room';
  const half = size / 2;
  const wallH = 4;
  const wallT = 0.4;

  const floorTex = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#5a4636';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#4a382a';
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += s / 6) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
  }, 128, 'room-floor');
  floorTex.repeat.set(2, 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 });
  const colliders = [];
  const addWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    // Approximate the wall with a row of circular colliders.
    const long = Math.max(w, d);
    const steps = Math.max(2, Math.round(long / 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0.5 : i / steps;
      const cx = w > d ? (x - w / 2 + t * w) : x;
      const cz = w > d ? z : (z - d / 2 + t * d);
      colliders.push({ x: cx, z: cz, radius: 0.8 });
    }
  };

  // Back (+Z), left (-X), right (+X) full walls.
  addWall(size, wallT, 0, half);
  addWall(wallT, size, -half, 0);
  addWall(wallT, size, half, 0);
  // Front (-Z) wall split into two segments leaving a doorway in the middle.
  const doorWidth = 2.4;
  const segW = (size - doorWidth) / 2;
  addWall(segW, wallT, -(doorWidth / 2 + segW / 2), -half);
  addWall(segW, wallT, (doorWidth / 2 + segW / 2), -half);

  // Bed in a corner.
  const bed = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.4, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 })
  );
  frame.position.y = 0.2;
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.3, 3.0),
    new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.9 })
  );
  mattress.position.y = 0.55;
  bed.add(frame, mattress);
  bed.position.set(-half + 1.8, 0, half - 2.2);
  bed.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(bed);

  return { group, colliders, doorway: { x: 0, z: -half } };
}

/** A temple-like Odisha landmark (stepped base + curved spire). */
export function makeTemple() {
  const group = new THREE.Group();
  group.name = 'temple';
  const stone = new THREE.MeshStandardMaterial({ color: 0xb7a07a, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 8), stone);
  base.position.y = 1.5;
  group.add(base);
  const mid = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), stone);
  mid.position.y = 4.5;
  group.add(mid);
  // Rekha-deul style curved tower approximated with a tall cone.
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.2, 9, 12), stone);
  spire.position.y = 10.5;
  group.add(spire);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b45a, metalness: 0.4, roughness: 0.5 })
  );
  cap.position.y = 15.4;
  group.add(cap);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

/** A labelled facility building (research center / medical facility). */
export function makeFacility(w = 14, h = 8, d = 12, accent = 0x4aa3d0) {
  const group = new THREE.Group();
  group.name = 'facility';
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.85 })
  );
  wall.position.y = h / 2;
  group.add(wall);
  // Accent stripe + entrance.
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.1, 1.2, d + 0.1),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25, roughness: 0.6 })
  );
  stripe.position.y = h - 1.4;
  group.add(stripe);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.7 })
  );
  door.position.set(0, 1.5, d / 2 + 0.05);
  group.add(door);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

/** A helicopter for the finale (body, tail, rotor). */
export function makeHelicopter() {
  const group = new THREE.Group();
  group.name = 'helicopter';
  const green = new THREE.MeshStandardMaterial({ color: 0x3b4a35, metalness: 0.3, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), green);
  body.scale.set(1.2, 1.0, 1.8);
  body.position.y = 1.6;
  group.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.2), green);
  tail.position.set(0, 1.9, 2.6);
  group.add(tail);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.6), green);
  tailFin.position.set(0, 2.3, 4.0);
  group.add(tailFin);
  // Skids.
  const skidMat = new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.5, roughness: 0.5 });
  const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3), skidMat);
  skidL.position.set(-1.0, 0.5, 0);
  const skidR = skidL.clone();
  skidR.position.x = 1.0;
  group.add(skidL, skidR);
  // Main rotor (spins in the finale via userData.rotor).
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(6.5, 0.08, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.6 })
  );
  rotor.position.y = 3.0;
  group.add(rotor);
  group.userData.rotor = rotor;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

export const AssetFactory = {
  makeCanvasTexture,
  makeGround,
  makeBuilding,
  makeZombie,
  makePlayerViewmodel,
  makeKnifeMesh,
  makeGunMesh,
  makePickup,
  makeNPC,
  makeProp,
  makeExitMarker,
  makeInteractableMarker,
  makeRoom,
  makeTemple,
  makeFacility,
  makeHelicopter,
};

export default AssetFactory;
