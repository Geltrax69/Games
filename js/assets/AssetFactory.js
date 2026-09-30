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
};

export default AssetFactory;
