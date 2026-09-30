// AssetFactory: synchronous visual builders backed by preloaded local character
// models plus procedural environment materials and geometry.
//
// The public factory signatures remain stable. Character GLBs are preloaded by
// main.js; if either model cannot load, these builders return a detailed,
// recognizably humanoid procedural fallback instead.

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getCharacterAsset } from './ModelLibrary.js';

const _textureCache = new Map();
const _disposedGeometries = new WeakSet();
const _disposedMaterials = new WeakSet();
const _disposedTextures = new WeakSet();
const _disposedSkeletons = new WeakSet();
let _textureAnisotropy = 1;
let _humanVariantSerial = 0;

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seedText) {
  let state = hashString(seedText) || 1;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function configureTexture(texture, isColor = true) {
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = _textureAnisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Let generated and imported textures use a conservative anisotropy level. */
export function configureRenderer(renderer) {
  if (renderer && renderer.capabilities) {
    _textureAnisotropy = Math.max(
      1,
      Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1)
    );
  }
  for (const texture of _textureCache.values()) {
    texture.anisotropy = _textureAnisotropy;
    texture.needsUpdate = true;
  }
}

/**
 * Draw into an offscreen canvas and return a color CanvasTexture.
 * @param {(ctx:CanvasRenderingContext2D, size:number)=>void} drawFn
 * @param {number} size square texture size in pixels
 * @param {string} [cacheKey] optional key to reuse an identical source texture
 */
export function makeCanvasTexture(drawFn, size = 128, cacheKey) {
  if (cacheKey && _textureCache.has(cacheKey)) return _textureCache.get(cacheKey);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const texture = configureTexture(new THREE.CanvasTexture(canvas), true);
  if (cacheKey) _textureCache.set(cacheKey, texture);
  return texture;
}

function makeDataCanvasTexture(drawFn, size = 128, cacheKey) {
  if (cacheKey && _textureCache.has(cacheKey)) return _textureCache.get(cacheKey);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, size);
  const texture = configureTexture(new THREE.CanvasTexture(canvas), false);
  if (cacheKey) _textureCache.set(cacheKey, texture);
  return texture;
}

function cloneTiledTexture(source, repeatX = 1, repeatY = repeatX) {
  const texture = source.clone();
  texture.repeat.set(Math.max(0.01, repeatX), Math.max(0.01, repeatY));
  texture.anisotropy = _textureAnisotropy;
  texture.userData.disposeWithAsset = true;
  texture.needsUpdate = true;
  return texture;
}

function drawCracks(ctx, size, random, count, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = random() * size;
    let y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 3 + Math.floor(random() * 5);
    for (let j = 0; j < segments; j++) {
      x += (random() - 0.5) * size * 0.1;
      y += (random() - 0.5) * size * 0.1;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawMottle(ctx, size, random, colors, count, minRadius, maxRadius, alpha = 0.2) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const radius = minRadius + random() * (maxRadius - minRadius);
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.beginPath();
    ctx.ellipse(random() * size, random() * size, radius, radius * (0.4 + random()), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function getSoilSurface() {
  const albedo = makeCanvasTexture((ctx, size) => {
    const random = makeRandom('soil-albedo');
    ctx.fillStyle = '#4b4d3e';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#60604b', '#343a32', '#6b6250', '#3d463c'], 420, 2, 24, 0.18);
    drawMottle(ctx, size, random, ['#86755d', '#242b27'], 850, 0.3, 2.2, 0.28);
    drawCracks(ctx, size, random, 22, 'rgba(24,27,23,.42)', 1.2);
    drawMottle(ctx, size, random, ['#27392b', '#72714f'], 38, 8, 34, 0.13);
  }, 512, 'surface-soil-albedo');
  const bump = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom('soil-bump');
    ctx.fillStyle = '#858585';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#737373', '#a3a3a3', '#666666'], 1200, 0.4, 2.4, 0.5);
    drawCracks(ctx, size, random, 26, '#4c4c4c', 1.4);
  }, 512, 'surface-soil-bump');
  const roughness = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom('soil-roughness');
    ctx.fillStyle = '#e5e5e5';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#bbbbbb', '#f2f2f2', '#999999'], 180, 3, 28, 0.35);
  }, 512, 'surface-soil-roughness');
  return { albedo, bump, roughness };
}

function getAsphaltSurface() {
  const albedo = makeCanvasTexture((ctx, size) => {
    const random = makeRandom('asphalt-albedo');
    ctx.fillStyle = '#30343a';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#474a4d', '#20252a', '#595652'], 520, 1, 16, 0.16);
    drawMottle(ctx, size, random, ['#8c877d', '#13171b'], 1350, 0.25, 1.4, 0.24);
    drawCracks(ctx, size, random, 28, 'rgba(10,12,14,.65)', 1.3);
    drawMottle(ctx, size, random, ['#15191d', '#5b5147'], 24, 12, 48, 0.12);
  }, 512, 'surface-asphalt-albedo');
  const bump = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom('asphalt-bump');
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#727272', '#a0a0a0', '#b0b0b0'], 1800, 0.2, 1.4, 0.5);
    drawCracks(ctx, size, random, 30, '#484848', 1.5);
  }, 512, 'surface-asphalt-bump');
  const roughness = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom('asphalt-roughness');
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#8f8f8f', '#f2f2f2'], 90, 6, 34, 0.22);
  }, 512, 'surface-asphalt-roughness');
  return { albedo, bump, roughness };
}

function getConcreteSurface() {
  const albedo = makeCanvasTexture((ctx, size) => {
    const random = makeRandom('concrete-albedo');
    ctx.fillStyle = '#85857f';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#a09d94', '#696c69', '#b3ada1'], 300, 2, 22, 0.16);
    drawMottle(ctx, size, random, ['#343a38', '#d0c8b8'], 600, 0.2, 1.2, 0.18);
    drawCracks(ctx, size, random, 12, 'rgba(47,49,46,.5)', 1);
  }, 384, 'surface-concrete-albedo');
  const bump = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom('concrete-bump');
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#777777', '#999999'], 700, 0.2, 1.8, 0.42);
    drawCracks(ctx, size, random, 12, '#555555', 1);
  }, 384, 'surface-concrete-bump');
  const roughness = makeDataCanvasTexture((ctx, size) => {
    ctx.fillStyle = '#dadada';
    ctx.fillRect(0, 0, size, size);
  }, 128, 'surface-concrete-roughness');
  return { albedo, bump, roughness };
}

function getWallSurface(style) {
  const palette = {
    concrete: ['#88877f', '#a29e92', '#686a67'],
    brick: ['#75473b', '#8f5b48', '#563832'],
    slum: ['#8a7d63', '#a49270', '#615c4e'],
  };
  const colors = palette[style] || palette.concrete;
  const albedo = makeCanvasTexture((ctx, size) => {
    const random = makeRandom(`wall-${style}`);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, colors.slice(1), 130, 2, 18, 0.2);
    if (style === 'brick') {
      ctx.strokeStyle = 'rgba(45,31,27,.55)';
      ctx.lineWidth = 2;
      const rowH = size / 10;
      const brickW = size / 5;
      for (let row = 0; row <= 10; row++) {
        const y = row * rowH;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
        const offset = row % 2 ? brickW / 2 : 0;
        for (let x = offset; x < size; x += brickW) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
        }
      }
    } else {
      drawCracks(ctx, size, random, 8, 'rgba(52,52,48,.45)', 0.8);
    }
    const grime = ctx.createLinearGradient(0, 0, 0, size);
    grime.addColorStop(0, 'rgba(255,255,255,.08)');
    grime.addColorStop(0.7, 'rgba(35,36,31,0)');
    grime.addColorStop(1, 'rgba(30,31,27,.38)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 0, size, size);
  }, 256, `wall-${style}-albedo`);
  const bump = makeDataCanvasTexture((ctx, size) => {
    const random = makeRandom(`wall-${style}-bump`);
    ctx.fillStyle = '#898989';
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#777777', '#a2a2a2'], 420, 0.2, 2, 0.4);
    if (style === 'brick') {
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 2;
      const rowH = size / 10;
      const brickW = size / 5;
      for (let row = 0; row <= 10; row++) {
        const y = row * rowH;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
        for (let x = (row % 2 ? brickW / 2 : 0); x < size; x += brickW) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
        }
      }
    }
  }, 256, `wall-${style}-bump`);
  return { albedo, bump };
}

function getFacadeTexture(style) {
  return makeCanvasTexture((ctx, size) => {
    const palette = {
      concrete: '#89877f',
      brick: '#70463c',
      slum: '#897c62',
    };
    const random = makeRandom(`facade-${style}`);
    ctx.fillStyle = palette[style] || palette.concrete;
    ctx.fillRect(0, 0, size, size);
    drawMottle(ctx, size, random, ['#aaa49a', '#565b57'], 90, 2, 15, 0.16);
    const cols = 4;
    const rows = 5;
    const xPad = 12;
    const yPad = 10;
    const cellW = size / cols;
    const cellH = size / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cellW + xPad;
        const y = row * cellH + yPad;
        const w = cellW - xPad * 2;
        const h = cellH - yPad * 1.7;
        ctx.fillStyle = '#343a3f';
        ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
        ctx.fillStyle = random() > 0.77 ? '#b7a978' : '#263846';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(172,205,222,.2)';
        ctx.fillRect(x + 2, y + 2, w * 0.42, h - 4);
      }
    }
    const grime = ctx.createLinearGradient(0, size * 0.55, 0, size);
    grime.addColorStop(0, 'rgba(30,30,28,0)');
    grime.addColorStop(1, 'rgba(25,27,23,.42)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 0, size, size);
  }, 256, `facade-${style}`);
}

function makeSurfaceMaterial(surface, repeatX, repeatY, options = {}) {
  return new THREE.MeshStandardMaterial({
    map: cloneTiledTexture(surface.albedo, repeatX, repeatY),
    bumpMap: surface.bump ? cloneTiledTexture(surface.bump, repeatX, repeatY) : null,
    roughnessMap: surface.roughness ? cloneTiledTexture(surface.roughness, repeatX, repeatY) : null,
    bumpScale: options.bumpScale == null ? 0.05 : options.bumpScale,
    color: options.color == null ? 0xffffff : options.color,
    roughness: options.roughness == null ? 0.9 : options.roughness,
    metalness: options.metalness || 0,
  });
}

/** Dispose an asset subtree without disposing shared GLB/cache textures. */
export function disposeObject3D(root) {
  if (!root || !root.traverse) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();

  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item && materials.add(item));
    else if (material) materials.add(material);
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && value.isTexture && value.userData.disposeWithAsset) textures.add(value);
    }
  }
  for (const skeleton of skeletons) {
    if (!_disposedSkeletons.has(skeleton)) {
      skeleton.dispose();
      _disposedSkeletons.add(skeleton);
    }
  }
  for (const geometry of geometries) {
    if (!_disposedGeometries.has(geometry)) {
      geometry.dispose();
      _disposedGeometries.add(geometry);
    }
  }
  for (const material of materials) {
    if (!_disposedMaterials.has(material)) {
      material.dispose();
      _disposedMaterials.add(material);
    }
  }
  for (const texture of textures) {
    if (!_disposedTextures.has(texture)) {
      texture.dispose();
      _disposedTextures.add(texture);
    }
  }
}

function setMeshQuality(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.geometry) object.geometry = object.geometry.clone();
    const cloneMaterial = (material) => {
      const copy = material.clone();
      for (const value of Object.values(copy)) {
        if (value && value.isTexture) {
          value.anisotropy = _textureAnisotropy;
          value.needsUpdate = true;
        }
      }
      return copy;
    };
    if (Array.isArray(object.material)) object.material = object.material.map(cloneMaterial);
    else if (object.material) object.material = cloneMaterial(object.material);
  });
}

function cloneCharacter(key, targetHeight, sourceRotationY = 0) {
  const asset = getCharacterAsset(key);
  if (!asset) return null;

  const model = cloneSkeleton(asset.scene);
  model.rotation.y = sourceRotationY;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height < 0.01) return null;

  model.scale.multiplyScalar(targetHeight / height);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
  setMeshQuality(model);

  return { model, animations: asset.animations };
}

/** Refit after bone-attached hair, clothing, footwear, and gear are present. */
function fitFinishedCharacter(model, targetHeight) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height < 0.01) return false;

  model.scale.multiplyScalar(targetHeight / height);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
  return true;
}

function normalizedNodeName(name) {
  return String(name || '').replace(/[\[\] .:/\\]/g, '');
}

function findPart(root, ...names) {
  for (const name of names) {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
    const wanted = normalizedNodeName(name);
    let match = null;
    root.traverse((object) => {
      if (!match && normalizedNodeName(object.name) === wanted) match = object;
    });
    if (match) return match;
  }
  return root;
}

function materialList(root) {
  const materials = [];
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    if (Array.isArray(object.material)) materials.push(...object.material);
    else materials.push(object.material);
  });
  return materials;
}

function applyZombieVariation(model, variation) {
  const suitTint = new THREE.Color().setHSL(0.15 + variation * 0.025, 0.18, 0.82 + variation * 0.04);
  const skinTint = new THREE.Color().setHSL(0.21 + variation * 0.03, 0.2, 0.72);
  for (const material of materialList(model)) {
    const name = (material.name || '').toLowerCase();
    if (name.includes('head')) {
      material.color.multiply(skinTint);
      material.roughness = Math.max(material.roughness, 0.7);
    } else {
      material.color.multiply(suitTint);
      material.roughness = Math.max(material.roughness, 0.65);
    }
    material.needsUpdate = true;
  }
}

const HUMAN_LOOKS = Object.freeze([
  { name: 'warm', skin: 0xc98d68, hair: 0x241914, eye: 0x3d2c24 },
  { name: 'deep', skin: 0x754833, hair: 0x161313, eye: 0x241b17 },
  { name: 'tan', skin: 0xb97855, hair: 0x3a271c, eye: 0x30433c },
  { name: 'light', skin: 0xe0ad86, hair: 0x5a3924, eye: 0x355260 },
]);

const HUMAN_OUTFITS = Object.freeze({
  friendly: [
    { outer: 0x36566a, shirt: 0xb5aa8e, trousers: 0x273139, accent: 0x71806a },
    { outer: 0x526044, shirt: 0xc0ad86, trousers: 0x292d2d, accent: 0x8b6b45 },
    { outer: 0x71483b, shirt: 0x9ea8a1, trousers: 0x26343b, accent: 0x596b58 },
  ],
  hostile: [
    { outer: 0x24272a, shirt: 0x17191b, trousers: 0x171a1d, accent: 0x8f2928 },
    { outer: 0x34282a, shirt: 0x202326, trousers: 0x191b1f, accent: 0xa13a32 },
  ],
  scientist: [
    { outer: 0xe2e3dc, shirt: 0x3e686a, trousers: 0x26343a, accent: 0x188f89 },
    { outer: 0xd8ddd9, shirt: 0x315c62, trousers: 0x29363d, accent: 0x1a9a92 },
  ],
});

function makeHumanMaterial(color, roughness = 0.82, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: options.metalness || 0,
    emissive: options.emissive || 0x000000,
    emissiveIntensity: options.emissiveIntensity || 0,
  });
}

function capsuleGeometry(radius, totalLength, radialSegments = 12) {
  return new THREE.CapsuleGeometry(
    radius,
    Math.max(0.01, totalLength - radius * 2),
    5,
    radialSegments
  );
}

function detailMesh(geometry, material, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function findHumanBone(model, ...names) {
  for (const name of names) {
    const exact = model.getObjectByName(name);
    if (exact && exact.isBone) return exact;
    const wanted = normalizedNodeName(name);
    let match = null;
    model.traverse((object) => {
      if (!match && object.isBone && normalizedNodeName(object.name) === wanted) match = object;
    });
    if (match) return match;
  }
  return null;
}

function attachCapsule(bone, name, radius, length, material, options = {}) {
  if (!bone) return null;
  const mesh = detailMesh(capsuleGeometry(radius, length), material, name);
  mesh.position.set(options.x || 0, options.y == null ? length * 0.5 : options.y, options.z || 0);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  bone.add(mesh);
  return mesh;
}

function attachTapered(bone, name, topRadius, bottomRadius, height, material, options = {}) {
  if (!bone) return null;
  const mesh = detailMesh(
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, 16, 2),
    material,
    name
  );
  mesh.position.set(options.x || 0, options.y == null ? height * 0.5 : options.y, options.z || 0);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.scale) mesh.scale.set(...options.scale);
  bone.add(mesh);
  return mesh;
}

function attachEllipsoid(bone, name, material, position, scale) {
  if (!bone) return null;
  const mesh = detailMesh(new THREE.SphereGeometry(0.5, 20, 14), material, name);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  bone.add(mesh);
  return mesh;
}

function attachRing(bone, name, radius, tube, material, y) {
  if (!bone) return null;
  const ring = detailMesh(new THREE.TorusGeometry(radius, tube, 6, 18), material, name);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  bone.add(ring);
  return ring;
}

function addHeadDetails(head, look, variantIndex) {
  if (!head) return;
  const hair = makeHumanMaterial(look.hair, 0.94);
  const eyeWhite = makeHumanMaterial(0xd9d3c5, 0.6);
  const iris = makeHumanMaterial(look.eye, 0.52);
  const brow = makeHumanMaterial(look.hair, 0.9);
  const skin = makeHumanMaterial(look.skin, 0.76);

  const cap = detailMesh(
    new THREE.SphereGeometry(0.136, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.48),
    hair,
    'human-hair-cap'
  );
  cap.position.set(0, 0.12, -0.025);
  cap.scale.set(0.9, 1.02, 0.9);
  head.add(cap);

  // Small side/back sections turn the cap into a restrained cropped hairstyle.
  const hairLength = variantIndex % 3 === 1 ? 0.105 : 0.075;
  for (const side of [-1, 1]) {
    const temple = detailMesh(capsuleGeometry(0.016, hairLength, 9), hair, `human-hair-side-${side}`);
    temple.position.set(side * 0.092, 0.07, -0.018);
    head.add(temple);
  }
  const backHair = detailMesh(capsuleGeometry(0.035, hairLength + 0.03, 10), hair, 'human-hair-back');
  backHair.position.set(0, 0.07, -0.09);
  head.add(backHair);

  for (const side of [-1, 1]) {
    const white = detailMesh(new THREE.SphereGeometry(0.014, 10, 8), eyeWhite, `human-eye-white-${side}`);
    white.scale.set(1.05, 0.72, 0.42);
    white.position.set(side * 0.039, 0.095, 0.105);
    const pupil = detailMesh(new THREE.SphereGeometry(0.0065, 9, 7), iris, `human-eye-${side}`);
    pupil.scale.z = 0.55;
    pupil.position.set(side * 0.039, 0.095, 0.112);
    const eyebrow = detailMesh(capsuleGeometry(0.0055, 0.054, 8), brow, `human-brow-${side}`);
    eyebrow.rotation.z = Math.PI / 2 + side * 0.05;
    eyebrow.position.set(side * 0.041, 0.125, 0.109);
    head.add(white, pupil, eyebrow);
  }

  // The base mesh supplies the anatomical nose and ears; this subtle tip helps
  // the face retain depth under the game's strong directional lighting.
  const noseTip = detailMesh(new THREE.SphereGeometry(0.012, 9, 7), skin, 'human-nose-tip');
  noseTip.scale.set(0.75, 0.9, 1.25);
  noseTip.position.set(0, 0.078, 0.122);
  head.add(noseTip);

  const mouth = detailMesh(capsuleGeometry(0.004, 0.04, 8), makeHumanMaterial(0x70423a, 0.68), 'human-mouth');
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, 0.038, 0.113);
  head.add(mouth);
}

/**
 * Dress and finish the untextured CC0 anatomical mesh. Clothing is attached to
 * its real armature so sleeves/trousers move with the same bones as the skin.
 */
function applyHumanRole(model, kind, variantIndex) {
  const look = HUMAN_LOOKS[variantIndex % HUMAN_LOOKS.length];
  const outfits = HUMAN_OUTFITS[kind] || HUMAN_OUTFITS.friendly;
  const outfit = outfits[variantIndex % outfits.length];

  for (const material of materialList(model)) {
    material.color.setHex(look.skin);
    material.roughness = 0.76;
    material.metalness = 0;
    material.needsUpdate = true;
  }

  const bones = {
    root: findHumanBone(model, 'spine'),
    lowerSpine: findHumanBone(model, 'spine.001', 'spine001'),
    midSpine: findHumanBone(model, 'spine.002', 'spine002'),
    chest: findHumanBone(model, 'spine.003', 'spine003'),
    neck: findHumanBone(model, 'spine.004', 'spine004'),
    head: findHumanBone(model, 'spine.005', 'spine005'),
    upperArmL: findHumanBone(model, 'upper_arm.L', 'upper_armL'),
    forearmL: findHumanBone(model, 'forearm.L', 'forearmL'),
    handL: findHumanBone(model, 'hand.L', 'handL'),
    upperArmR: findHumanBone(model, 'upper_arm.R', 'upper_armR'),
    forearmR: findHumanBone(model, 'forearm.R', 'forearmR'),
    handR: findHumanBone(model, 'hand.R', 'handR'),
    thighL: findHumanBone(model, 'thigh.L', 'thighL'),
    shinL: findHumanBone(model, 'shin.L', 'shinL'),
    footL: findHumanBone(model, 'foot.L', 'footL'),
    thighR: findHumanBone(model, 'thigh.R', 'thighR'),
    shinR: findHumanBone(model, 'shin.R', 'shinR'),
    footR: findHumanBone(model, 'foot.R', 'footR'),
  };

  const outer = makeHumanMaterial(outfit.outer, kind === 'scientist' ? 0.72 : 0.84);
  const shirt = makeHumanMaterial(outfit.shirt, 0.82);
  const trousers = makeHumanMaterial(outfit.trousers, 0.9);
  const accent = makeHumanMaterial(outfit.accent, 0.76, {
    emissive: kind === 'scientist' ? 0x082b29 : 0x000000,
    emissiveIntensity: kind === 'scientist' ? 0.14 : 0,
  });
  const boots = makeHumanMaterial(0x171b1e, 0.9);
  const hardware = makeHumanMaterial(0x252b2d, 0.68, { metalness: 0.18 });

  const torsoLength = kind === 'scientist' ? 0.64 : 0.58;
  const torsoWidth = kind === 'scientist' ? 0.47 : 0.45;
  attachEllipsoid(bones.root, `${kind}-jacket-chest`, outer, [0, 0.37, 0], [torsoWidth, torsoLength, 0.31]);
  attachEllipsoid(bones.root, `${kind}-jacket-yoke`, outer, [0, 0.49, 0], [0.47, 0.25, 0.3]);
  attachEllipsoid(bones.root, `${kind}-upper-chest`, outer, [0, 0.575, 0], [0.32, 0.18, 0.27]);
  attachEllipsoid(bones.root, `${kind}-jacket-waist`, outer, [0, 0.115, 0], [0.38, 0.29, 0.27]);
  attachCapsule(bones.root, `${kind}-jacket-zipper`, 0.007, 0.25, shirt, {
    y: 0.44,
    z: 0.174,
    scale: [1, 1, 0.55],
  });
  attachRing(bones.root, `${kind}-collar`, 0.12, 0.015, kind === 'scientist' ? accent : shirt, 0.59);
  attachEllipsoid(bones.root, `${kind}-trouser-waist`, trousers, [0, 0.005, 0], [0.39, 0.22, 0.29]);

  const shortSleeves = kind === 'hostile';
  for (const [side, upperArm, forearm] of [
    ['L', bones.upperArmL, bones.forearmL],
    ['R', bones.upperArmR, bones.forearmR],
  ]) {
    attachTapered(upperArm, `${kind}-upper-sleeve-${side}`, 0.076, 0.105, shortSleeves ? 0.22 : 0.36, outer, {
      y: shortSleeves ? 0.085 : 0.145,
      scale: [1, 1, 0.92],
    });
    if (!shortSleeves) {
      attachTapered(forearm, `${kind}-forearm-sleeve-${side}`, 0.061, 0.083, 0.28, outer, {
        y: 0.12,
        scale: [1, 1, 0.92],
      });
    }
  }

  for (const [side, thigh, shin, foot] of [
    ['L', bones.thighL, bones.shinL, bones.footL],
    ['R', bones.thighR, bones.shinR, bones.footR],
  ]) {
    attachTapered(thigh, `${kind}-trouser-thigh-${side}`, 0.118, 0.145, 0.46, trousers, {
      y: 0.205,
      scale: [1, 1, 0.94],
    });
    attachTapered(shin, `${kind}-trouser-shin-${side}`, 0.086, 0.119, 0.54, trousers, {
      y: 0.25,
      scale: [1, 1, 0.94],
    });
    attachEllipsoid(foot, `${kind}-boot-${side}`, boots, [0, 0.075, 0.012], [0.23, 0.31, 0.18]);
  }

  if (kind === 'friendly') {
    const pack = detailMesh(capsuleGeometry(0.145, 0.49), hardware, 'survivor-small-pack');
    pack.position.set(0, 0.31, -0.205);
    pack.scale.set(1.05, 1, 0.58);
    bones.root.add(pack);
    const bedroll = detailMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 12), accent, 'survivor-bedroll');
    bedroll.rotation.z = Math.PI / 2;
    bedroll.position.set(0, 0.07, -0.245);
    bones.root.add(bedroll);
    for (const side of [-1, 1]) {
      attachCapsule(bones.root, `survivor-pack-strap-${side}`, 0.0075, 0.35, hardware, {
        x: side * 0.15,
        y: 0.37,
        z: 0.17,
      });
    }
  } else if (kind === 'hostile') {
    attachEllipsoid(bones.root, 'hostile-tactical-vest', outer, [0, 0.39, 0.01], [0.48, 0.45, 0.34]);
    attachRing(bones.upperArmL, 'hostile-red-armband', 0.088, 0.014, accent, 0.11);
    attachCapsule(bones.root, 'hostile-chest-marking', 0.018, 0.34, accent, {
      y: 0.4,
      z: 0.195,
      rotation: [0, 0, Math.PI / 2],
    });
    for (const x of [-0.085, 0.085]) {
      attachCapsule(bones.root, `hostile-vest-pouch-${x}`, 0.032, 0.13, hardware, {
        x,
        y: 0.225,
        z: 0.18,
        scale: [1.1, 1, 0.35],
      });
    }
  } else {
    for (const side of [-1, 1]) {
      attachCapsule(bones.root, `scientist-coat-tail-${side}`, 0.1, 0.35, outer, {
        x: side * 0.105,
        y: -0.08,
        z: -0.01,
        scale: [1, 1, 0.58],
      });
    }
    const badge = detailMesh(capsuleGeometry(0.052, 0.17), makeHumanMaterial(0xf3f1e8, 0.58), 'scientist-medical-badge');
    badge.position.set(0.135, 0.41, 0.205);
    badge.scale.set(0.9, 1, 0.22);
    bones.root.add(badge);
    attachCapsule(bones.root, 'scientist-cross-v', 0.011, 0.09, accent, {
      x: 0.135,
      y: 0.41,
      z: 0.219,
      scale: [1, 1, 0.6],
    });
    attachCapsule(bones.root, 'scientist-cross-h', 0.011, 0.075, accent, {
      x: 0.135,
      y: 0.41,
      z: 0.22,
      rotation: [0, 0, Math.PI / 2],
      scale: [1, 1, 0.6],
    });
  }

  addHeadDetails(bones.head, look, variantIndex);
  model.userData.humanAppearance = {
    skin: look.name,
    role: kind,
    variant: variantIndex,
  };
  return bones;
}

function makeRoleDetails(kind) {
  const details = new THREE.Group();
  details.name = `role-details-${kind}`;
  const dark = makeHumanMaterial(0x242a2d, 0.86);

  if (kind === 'friendly') {
    const pack = detailMesh(capsuleGeometry(0.15, 0.53), dark, 'fallback-survivor-pack');
    pack.position.set(0, 1.2, -0.21);
    pack.scale.z = 0.58;
    const roll = detailMesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.38, 12),
      makeHumanMaterial(0x65715d, 0.9),
      'fallback-survivor-bedroll'
    );
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.47, -0.25);
    details.add(pack, roll);
  } else if (kind === 'hostile') {
    const vest = detailMesh(capsuleGeometry(0.22, 0.5), makeHumanMaterial(0x351c1e, 0.82), 'fallback-hostile-vest');
    vest.position.set(0, 1.25, 0.08);
    vest.scale.set(1.05, 1, 0.55);
    const band = detailMesh(new THREE.TorusGeometry(0.11, 0.025, 7, 18), makeHumanMaterial(0x9a302c, 0.72), 'fallback-hostile-band');
    band.rotation.x = Math.PI / 2;
    band.position.set(-0.36, 1.34, 0);
    details.add(vest, band);
  } else {
    const badgeBase = detailMesh(capsuleGeometry(0.055, 0.18), makeHumanMaterial(0xf2f2ed, 0.55), 'fallback-scientist-badge');
    badgeBase.position.set(0.16, 1.42, 0.24);
    badgeBase.scale.z = 0.25;
    const crossMat = makeHumanMaterial(0x1a928d, 0.55, { emissive: 0x0b3735, emissiveIntensity: 0.22 });
    const crossV = detailMesh(capsuleGeometry(0.012, 0.1), crossMat, 'fallback-scientist-cross-v');
    const crossH = detailMesh(capsuleGeometry(0.012, 0.08), crossMat, 'fallback-scientist-cross-h');
    crossV.position.set(0.16, 1.42, 0.258);
    crossH.position.copy(crossV.position);
    crossH.rotation.z = Math.PI / 2;
    details.add(badgeBase, crossV, crossH);
  }

  return details;
}

function makeFallbackHuman(kind = 'friendly') {
  const group = new THREE.Group();
  const colors = {
    friendly: 0x426783,
    hostile: 0x55272a,
    scientist: 0xe1e5e2,
  };
  const cloth = makeHumanMaterial(colors[kind] || colors.friendly, 0.85);
  const skin = makeHumanMaterial(0xb77f5d, 0.78);
  const trouser = makeHumanMaterial(kind === 'scientist' ? 0x385f63 : 0x252c32, 0.9);
  const hair = makeHumanMaterial(0x241b17, 0.9);
  const eye = makeHumanMaterial(0x29201b, 0.6);

  const torso = detailMesh(capsuleGeometry(0.27, 0.85), cloth, 'fallback-human-torso');
  torso.position.y = 1.22;
  const head = detailMesh(new THREE.SphereGeometry(0.21, 18, 14), skin, 'fallback-human-head');
  head.scale.set(0.88, 1.12, 0.92);
  head.position.y = 1.78;
  const hairCap = detailMesh(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 'fallback-human-hair');
  hairCap.position.y = 1.84;
  const nose = detailMesh(new THREE.ConeGeometry(0.032, 0.085, 9), skin, 'fallback-human-nose');
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.77, 0.205);

  const limbGeo = capsuleGeometry(0.075, 0.67, 10);
  const armL = detailMesh(limbGeo, cloth, 'fallback-human-arm-L');
  armL.position.set(-0.36, 1.22, 0);
  armL.rotation.z = -0.08;
  const armR = detailMesh(limbGeo.clone(), cloth.clone(), 'fallback-human-arm-R');
  armR.position.set(0.36, 1.22, 0);
  armR.rotation.z = 0.08;
  const legGeo = capsuleGeometry(0.095, 0.78, 10);
  const legL = detailMesh(legGeo, trouser, 'fallback-human-leg-L');
  legL.position.set(-0.14, 0.48, 0);
  const legR = detailMesh(legGeo.clone(), trouser.clone(), 'fallback-human-leg-R');
  legR.position.set(0.14, 0.48, 0);

  for (const side of [-1, 1]) {
    const eyeMesh = detailMesh(new THREE.SphereGeometry(0.016, 9, 7), eye, `fallback-human-eye-${side}`);
    eyeMesh.position.set(side * 0.065, 1.8, 0.19);
    group.add(eyeMesh);
  }

  group.add(torso, head, hairCap, nose, armL, armR, legL, legR, makeRoleDetails(kind));
  group.userData.parts = { torso, head, armL, armR, legL, legR };
  return group;
}

function makeFallbackZombie() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x7b8664, roughness: 0.92 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x5d5839, roughness: 0.96 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x282b27, roughness: 0.92 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 12), cloth);
  torso.position.set(0, 1.18, 0.02);
  torso.rotation.x = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 12), skin);
  head.scale.set(0.9, 1.08, 0.9);
  head.position.set(0.03, 1.73, 0.14);
  head.rotation.z = -0.16;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), skin.clone());
  jaw.position.set(0.02, 1.62, 0.2);
  jaw.rotation.z = -0.12;
  const wound = new THREE.Mesh(
    new THREE.CircleGeometry(0.09, 10),
    new THREE.MeshStandardMaterial({ color: 0x571c18, roughness: 0.8 })
  );
  wound.position.set(-0.12, 1.3, 0.305);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.56, 4, 8);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.37, 1.3, 0.22);
  armL.rotation.x = -1.02;
  armL.rotation.z = -0.15;
  const armR = new THREE.Mesh(armGeo.clone(), skin.clone());
  armR.position.set(0.37, 1.26, 0.22);
  armR.rotation.x = -0.88;
  armR.rotation.z = 0.15;
  const legGeo = new THREE.CapsuleGeometry(0.105, 0.57, 4, 8);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.15, 0.49, 0);
  legL.rotation.z = 0.05;
  const legR = new THREE.Mesh(legGeo.clone(), dark.clone());
  legR.position.set(0.16, 0.49, 0.02);
  legR.rotation.z = -0.09;

  group.add(torso, head, jaw, wound, armL, armR, legL, legR);
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  group.userData.parts = { torso, head, armL, armR, legL, legR };
  return group;
}

/** Ground plane with generated soil albedo, bump, roughness, stains, and cracks. */
export function makeGround(size = 200) {
  const material = makeSurfaceMaterial(getSoilSurface(), size / 6, size / 6, {
    bumpScale: 0.07,
    roughness: 0.96,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** Road segment centered at the origin, extending along local Z. */
export function makeRoad(width = 8, length = 24, options = {}) {
  const group = new THREE.Group();
  group.name = 'road';
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    makeSurfaceMaterial(getAsphaltSurface(), width / 3.5, length / 3.5, {
      bumpScale: 0.035,
      roughness: 0.92,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.025;
  road.receiveShadow = true;
  group.add(road);

  const markingMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6c98f,
    emissive: 0x17150d,
    emissiveIntensity: 0.08,
    roughness: 0.86,
  });
  if (options.markings !== false) {
    for (let z = -length / 2 + 2; z < length / 2 - 1; z += 5) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 2.35), markingMaterial);
      dash.position.set(0, 0.048, z);
      dash.receiveShadow = true;
      group.add(dash);
    }
    for (const x of [-width / 2 + 0.28, width / 2 - 0.28]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.016, length - 0.4), markingMaterial);
      edge.position.set(x, 0.047, 0);
      group.add(edge);
    }
  }

  if (options.sidewalks !== false) {
    const concrete = getConcreteSurface();
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x777872, roughness: 0.94 });
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.065, length),
        makeSurfaceMaterial(concrete, 1, length / 3, { bumpScale: 0.025, roughness: 0.94 })
      );
      walk.position.set(side * (width / 2 + 0.56), 0.038, 0);
      walk.receiveShadow = true;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, length), curbMaterial);
      curb.position.set(side * (width / 2 + 0.08), 0.06, 0);
      curb.receiveShadow = true;
      group.add(walk, curb);
    }
  }
  return group;
}

/** Large weathered hardstanding with parking bays for the medical compound. */
export function makeCompound(width = 60, depth = 62) {
  const group = new THREE.Group();
  group.name = 'medical-compound';
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    makeSurfaceMaterial(getAsphaltSurface(), width / 4, depth / 4, {
      bumpScale: 0.028,
      roughness: 0.9,
      color: 0xd7d9d8,
    })
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = 0.022;
  slab.receiveShadow = true;
  group.add(slab);

  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xc4c8bb, roughness: 0.82 });
  for (const x of [-24, -19, -14, 14, 19, 24]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 8), lineMaterial);
    line.position.set(x, 0.045, 8);
    group.add(line);
  }
  for (const x of [-19, 19]) {
    const stop = new THREE.Mesh(new THREE.BoxGeometry(10, 0.016, 0.1), lineMaterial);
    stop.position.set(x, 0.045, 4);
    group.add(stop);
  }
  return group;
}

/** Concrete helipad disc with inset perimeter ring and readable H marking. */
export function makeHelipad(radius = 4) {
  const group = new THREE.Group();
  group.name = 'helipad';
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    makeSurfaceMaterial(getConcreteSurface(), 2.5, 2.5, { bumpScale: 0.02, roughness: 0.9 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.04;
  disc.receiveShadow = true;
  group.add(disc);

  const paint = new THREE.MeshStandardMaterial({ color: 0xd8c95e, roughness: 0.76 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, 0.1, 8, 48), paint);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.07;
  const stemL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 2.2), paint);
  stemL.position.set(-0.72, 0.075, 0);
  const stemR = stemL.clone();
  stemR.position.x = 0.72;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.025, 0.24), paint);
  cross.position.y = 0.075;
  group.add(ring, stemL, stemR, cross);
  return group;
}

/** Center-origin building with distinct walls, facades, roof, trim, and doors. */
export function makeBuilding(w = 8, h = 12, d = 8, style = 'concrete') {
  const group = new THREE.Group();
  group.name = 'building';
  const surface = getWallSurface(style);
  const sideMaterial = new THREE.MeshStandardMaterial({
    map: cloneTiledTexture(surface.albedo, Math.max(1, d / 5), Math.max(1, h / 4)),
    bumpMap: cloneTiledTexture(surface.bump, Math.max(1, d / 5), Math.max(1, h / 4)),
    bumpScale: 0.055,
    roughness: 0.9,
  });
  const facadeMaterial = new THREE.MeshStandardMaterial({
    map: cloneTiledTexture(getFacadeTexture(style), 1, 1),
    bumpMap: cloneTiledTexture(surface.bump, Math.max(1, w / 5), Math.max(1, h / 4)),
    bumpScale: 0.04,
    roughness: 0.83,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x444a49, roughness: 0.94 });
  const foundationMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a43, roughness: 0.96 });
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [sideMaterial, sideMaterial, roofMaterial, foundationMaterial, facadeMaterial, facadeMaterial]
  );
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 0.22, d + 0.35), roofMaterial);
  roof.position.y = h / 2 + 0.1;
  roof.castShadow = true;
  roof.receiveShadow = true;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.55, d + 0.12), foundationMaterial);
  plinth.position.y = -h / 2 + 0.27;
  plinth.receiveShadow = true;
  group.add(roof, plinth);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x242a2d, metalness: 0.25, roughness: 0.55 });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x416274,
    emissive: 0x111b21,
    emissiveIntensity: 0.22,
    metalness: 0.2,
    roughness: 0.2,
  });
  const floors = Math.max(2, Math.min(4, Math.floor(h / 3)));
  for (let floor = 0; floor < floors; floor++) {
    const y = -h / 2 + 1.55 + floor * ((h - 2.2) / floors);
    for (const x of [-w * 0.25, w * 0.25]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.15, w * 0.18), 0.72, 0.1), frameMaterial);
      frame.position.set(x, y, d / 2 + 0.055);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.98, w * 0.16), 0.58, 0.02), glassMaterial);
      glass.position.set(x, y, d / 2 + 0.112);
      group.add(frame, glass);
    }
  }

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(1.5, w * 0.24), 2.15, 0.14),
    new THREE.MeshStandardMaterial({ color: style === 'slum' ? 0x564536 : 0x26343a, metalness: 0.18, roughness: 0.58 })
  );
  door.position.set(0, -h / 2 + 1.08, d / 2 + 0.08);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.2, w * 0.36), 0.16, 0.42), foundationMaterial);
  lintel.position.set(0, -h / 2 + 2.22, d / 2 + 0.18);
  group.add(door, lintel);

  if ((Math.round(w + h + d) & 1) === 0) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.7, 1.25, 16),
      new THREE.MeshStandardMaterial({ color: 0x6c7270, metalness: 0.28, roughness: 0.75 })
    );
    tank.position.set(w * 0.22, h / 2 + 0.82, 0);
    tank.castShadow = true;
    group.add(tank);
  } else {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), frameMaterial);
    vent.position.set(-w * 0.2, h / 2 + 0.45, 0);
    vent.castShadow = true;
    group.add(vent);
  }
  return group;
}

/** Animated textured zombie or a detailed procedural fallback. */
export function makeZombie() {
  const group = new THREE.Group();
  group.name = 'zombie';
  const variation = Math.random() - 0.5;
  const instance = cloneCharacter('zombie', 1.82 + variation * 0.13, 0);

  if (instance) {
    group.add(instance.model);
    applyZombieVariation(instance.model, variation);
    group.userData.animationRoot = instance.model;
    group.userData.animationClips = instance.animations;
    group.userData.usesMixer = true;
    group.userData.parts = {
      torso: findPart(instance.model, 'mixamorig:Spine2_04', 'mixamorig:Spine1_03'),
      head: findPart(instance.model, 'mixamorig:Head_06', 'Object_63'),
      armL: findPart(instance.model, 'mixamorig:LeftArm_07'),
      armR: findPart(instance.model, 'mixamorig:RightArm_026'),
      legL: findPart(instance.model, 'mixamorig:LeftUpLeg_044'),
      legR: findPart(instance.model, 'mixamorig:RightUpLeg_048'),
    };
    group.userData.assetSource = 'zombie-hazmat.glb';
  } else {
    const fallback = makeFallbackZombie();
    while (fallback.children.length) group.add(fallback.children[0]);
    group.userData.parts = fallback.userData.parts;
    group.userData.assetSource = 'procedural-fallback';
  }
  return group;
}

/** First-person view model; the outer identity wrapper is animated by Player. */
export function makePlayerViewmodel(weaponType = 'knife') {
  const group = new THREE.Group();
  group.name = 'viewmodel';
  const rig = new THREE.Group();
  rig.name = 'viewmodel-detail';
  rig.position.set(0.34, -0.4, -0.78);
  rig.scale.setScalar(0.8);

  const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0x334550, roughness: 0.86 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xb77f5d, roughness: 0.72 });
  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 5, 10), sleeveMaterial);
  forearm.rotation.x = -0.86;
  forearm.position.set(0.08, -0.17, 0.25);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), skinMaterial);
  hand.scale.set(0.8, 1.15, 0.78);
  hand.position.set(0.05, -0.01, 0.03);
  rig.add(forearm, hand);

  const weapon = weaponType === 'gun' ? makeGunMesh() : makeKnifeMesh();
  if (weaponType === 'gun') {
    weapon.position.set(0.02, 0.055, -0.14);
    const supportArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 5, 10), sleeveMaterial.clone());
    supportArm.rotation.x = -0.96;
    supportArm.rotation.z = 0.18;
    supportArm.position.set(-0.2, -0.16, 0.14);
    const supportHand = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 10), skinMaterial.clone());
    supportHand.scale.set(0.85, 1.05, 0.8);
    supportHand.position.set(-0.11, 0.02, -0.15);
    rig.add(supportArm, supportHand);
  } else {
    weapon.position.set(0.02, 0.1, -0.04);
    weapon.rotation.z = -0.18;
  }
  rig.add(weapon);
  rig.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = false;
      object.receiveShadow = false;
      object.renderOrder = 10;
    }
  });
  group.add(rig);
  return group;
}

/** Beveled survival knife with tang, guard, grip, and pommel. */
export function makeKnifeMesh() {
  const group = new THREE.Group();
  group.name = 'knife';
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.055, 0);
  bladeShape.lineTo(-0.04, 0.58);
  bladeShape.lineTo(0.01, 0.72);
  bladeShape.lineTo(0.06, 0.56);
  bladeShape.lineTo(0.055, 0);
  bladeShape.closePath();
  const blade = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bladeShape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.009, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: 0xc8ced0, metalness: 0.88, roughness: 0.22 })
  );
  blade.position.set(0, 0.08, -0.012);
  const fuller = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.43, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x697175, metalness: 0.92, roughness: 0.28 })
  );
  fuller.position.set(0, 0.38, 0.008);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.19, 0.045, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x313538, metalness: 0.75, roughness: 0.35 })
  );
  guard.position.y = 0.07;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.06, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: 0x2d241d, roughness: 0.88 })
  );
  handle.position.y = -0.09;
  const pommel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.05, 0.055, 12),
    new THREE.MeshStandardMaterial({ color: 0x3c4144, metalness: 0.7, roughness: 0.4 })
  );
  pommel.position.y = -0.255;
  group.add(blade, fuller, guard, handle, pommel);
  return group;
}

/** Layered semi-automatic pistol with slide, frame, barrel, sights, and grip. */
export function makeGunMesh() {
  const group = new THREE.Group();
  group.name = 'gun';
  const steel = new THREE.MeshStandardMaterial({ color: 0x343b40, metalness: 0.78, roughness: 0.28 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x171b1e, metalness: 0.24, roughness: 0.62 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x737b7e, metalness: 0.82, roughness: 0.24 });

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.48, 2, 2, 3), steel);
  slide.position.set(0, 0.07, -0.13);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.36), frameMaterial);
  frame.position.set(0, -0.035, -0.06);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.43, 14), accent);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.065, -0.27);
  const muzzle = new THREE.Mesh(
    new THREE.TorusGeometry(0.032, 0.009, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x090b0c, metalness: 0.72, roughness: 0.45 })
  );
  muzzle.position.set(0, 0.065, -0.495);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.27, 0.14, 2, 3, 2), frameMaterial);
  grip.position.set(0, -0.18, 0.035);
  grip.rotation.x = -0.15;
  const gripPanel = new THREE.Mesh(new THREE.BoxGeometry(0.116, 0.18, 0.09), new THREE.MeshStandardMaterial({ color: 0x252a2c, roughness: 0.9 }));
  gripPanel.position.set(0, -0.19, 0.05);
  gripPanel.rotation.x = -0.15;
  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 18, Math.PI), frameMaterial);
  triggerGuard.rotation.x = Math.PI / 2;
  triggerGuard.rotation.z = Math.PI;
  triggerGuard.position.set(0, -0.095, -0.105);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.045), accent);
  rearSight.position.set(0, 0.155, 0.045);
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 0.035), accent);
  frontSight.position.set(0, 0.155, -0.34);
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.015, 0.11), new THREE.MeshStandardMaterial({ color: 0x101315, metalness: 0.65, roughness: 0.4 }));
  port.position.set(0, 0.139, -0.12);
  group.add(slide, frame, barrel, muzzle, grip, gripPanel, triggerGuard, rearSight, frontSight, port);
  return group;
}

/** Collectible pickup rendered as the actual type rather than a glowing cube. */
export function makePickup(type = 'ammo') {
  const group = new THREE.Group();
  group.name = `pickup-${type}`;
  group.userData.pickupType = type;

  if (type === 'weapon') {
    const gun = makeGunMesh();
    gun.scale.setScalar(1.25);
    gun.rotation.y = -0.35;
    gun.position.y = 0.72;
    group.add(gun);
  } else if (type === 'medkit') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.42, 0.38),
      new THREE.MeshStandardMaterial({ color: 0xede8df, roughness: 0.74 })
    );
    box.position.y = 0.45;
    const crossMaterial = new THREE.MeshStandardMaterial({ color: 0xc73632, emissive: 0x4b0808, emissiveIntensity: 0.25 });
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.27, 0.025), crossMaterial);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.025), crossMaterial);
    v.position.set(0, 0.47, 0.205);
    h.position.copy(v.position);
    group.add(box, v, h);
  } else if (type === 'cure') {
    const vial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.5, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x86e5d1, emissive: 0x2a8c78, emissiveIntensity: 0.65, roughness: 0.18, transmission: 0.15 })
    );
    vial.position.y = 0.5;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0x45335e, metalness: 0.45, roughness: 0.4 }));
    cap.position.y = 0.79;
    group.add(vial, cap);
  } else {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.32, 0.42),
      new THREE.MeshStandardMaterial({ color: type === 'ammo' ? 0x86734e : 0x56734e, metalness: 0.2, roughness: 0.72 })
    );
    box.position.y = 0.42;
    group.add(box);
    if (type === 'ammo') {
      const brass = new THREE.MeshStandardMaterial({ color: 0xb48b42, metalness: 0.72, roughness: 0.32 });
      for (let i = -1; i <= 1; i++) {
        const round = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10), brass);
        round.position.set(i * 0.11, 0.68, 0);
        group.add(round);
      }
    }
  }
  group.traverse((object) => { if (object.isMesh) object.castShadow = true; });
  return group;
}

/** Anatomical, clothed human NPC driven by the CC0 armature, or detailed fallback. */
export function makeNPC(kind = 'friendly') {
  const group = new THREE.Group();
  group.name = `npc-${kind}`;
  group.userData.kind = kind;
  const variantIndex = _humanVariantSerial++;
  const targetHeight = 1.78 + (Math.random() - 0.5) * 0.06;
  // The authored Blender scene faces +X; rotate it so the factory contract is +Z.
  const instance = cloneCharacter('human', targetHeight, -Math.PI / 2);

  if (instance) {
    group.add(instance.model);
    const bones = applyHumanRole(instance.model, kind, variantIndex);
    fitFinishedCharacter(instance.model, targetHeight);
    group.userData.animationRoot = instance.model;
    group.userData.animationClips = instance.animations;
    group.userData.manualRig = { kind, bones };
    group.userData.usesMixer = false;
    group.userData.usesManualRig = true;
    group.userData.animationMode = 'manual-rig';
    group.userData.assetSource = 'male-base-mesh.glb';
    group.userData.appearanceVariant = instance.model.userData.humanAppearance;
  } else {
    const fallback = makeFallbackHuman(kind);
    while (fallback.children.length) group.add(fallback.children[0]);
    group.userData.parts = fallback.userData.parts;
    group.userData.assetSource = 'procedural-fallback';
    group.userData.animationMode = 'procedural-static';
  }
  return group;
}

function makeCar() {
  const group = new THREE.Group();
  const colors = [0x30485c, 0x5b3430, 0x3f4d3d, 0x68665d];
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colors[Math.floor(Math.random() * colors.length)],
    metalness: 0.5,
    roughness: 0.38,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x161a1d, metalness: 0.45, roughness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x243d4b, metalness: 0.15, roughness: 0.12, transparent: true, opacity: 0.83 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.94 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x7b8181, metalness: 0.72, roughness: 0.38 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 4.15, 2, 2, 4), bodyMaterial);
  chassis.position.y = 0.66;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 1.2), bodyMaterial);
  hood.position.set(0, 0.95, -1.35);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.68, 1.95), glass);
  cabin.position.set(0, 1.2, 0.15);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.12, 1.45), bodyMaterial);
  roof.position.set(0, 1.58, 0.18);
  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.16, 0.16), trim);
  bumperFront.position.set(0, 0.58, -2.12);
  const bumperRear = bumperFront.clone();
  bumperRear.position.z = 2.12;
  group.add(chassis, hood, cabin, roof, bumperFront, bumperRear);

  const wheelGeometry = new THREE.CylinderGeometry(0.39, 0.39, 0.23, 18);
  for (const x of [-1.02, 1.02]) {
    for (const z of [-1.28, 1.3]) {
      const wheel = new THREE.Mesh(wheelGeometry.clone(), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.43, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.245, 14), hub);
      cap.rotation.z = Math.PI / 2;
      cap.position.copy(wheel.position);
      group.add(wheel, cap);
    }
  }
  const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xe5ddb8, emissive: 0x8d7741, emissiveIntensity: 0.7, roughness: 0.3 });
  const taillightMaterial = new THREE.MeshStandardMaterial({ color: 0xa62420, emissive: 0x52100e, emissiveIntensity: 0.55 });
  for (const x of [-0.68, 0.68]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), headlightMaterial);
    light.position.set(x, 0.78, -2.1);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), taillightMaterial);
    rear.position.set(x, 0.78, 2.1);
    group.add(light, rear);
  }
  return group;
}

function makeTree() {
  const group = new THREE.Group();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x59402d, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 2.7, 12), trunkMaterial);
  trunk.position.y = 1.35;
  group.add(trunk);
  for (const [x, y, z, scale, color] of [
    [0, 3.1, 0, 1.25, 0x315e35],
    [-0.65, 2.85, 0.15, 0.9, 0x3d6c39],
    [0.62, 2.92, -0.15, 0.88, 0x2b5731],
    [0.05, 3.65, 0.05, 0.82, 0x416f3d],
  ]) {
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(scale, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    );
    crown.position.set(x, y, z);
    crown.scale.y = 0.82;
    group.add(crown);
  }
  return group;
}

function makeStreetlight() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x30383d, metalness: 0.66, roughness: 0.42 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.13, 4.6, 12), metal);
  pole.position.y = 2.3;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.08), metal);
  arm.position.set(0.37, 4.48, 0);
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.17, 0.3), metal);
  fixture.position.set(0.75, 4.37, 0);
  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.035, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffe7b2, emissive: 0xffc56e, emissiveIntensity: 2.0, roughness: 0.35 })
  );
  bulb.position.set(0.75, 4.27, 0);
  const light = new THREE.PointLight(0xffd494, 0.9, 10, 2);
  light.position.set(0.75, 4.18, 0);
  group.add(pole, arm, fixture, bulb, light);
  return group;
}

function makeCrate() {
  const group = new THREE.Group();
  const texture = makeCanvasTexture((ctx, size) => {
    const random = makeRandom('crate');
    ctx.fillStyle = '#82552e';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 12) {
      ctx.fillStyle = y % 24 ? '#77502e' : '#8d6036';
      ctx.fillRect(0, y, size, 10);
    }
    drawMottle(ctx, size, random, ['#4e311e', '#a17448'], 35, 0.5, 3, 0.25);
  }, 128, 'crate-albedo');
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: cloneTiledTexture(texture), roughness: 0.91 })
  );
  box.position.y = 0.5;
  group.add(box);
  const braceMaterial = new THREE.MeshStandardMaterial({ color: 0x50351f, roughness: 0.95 });
  for (const y of [0.12, 0.88]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.09, 1.06), braceMaterial);
    brace.position.y = y;
    group.add(brace);
  }
  return group;
}

/** Environmental prop. Preserves a ground-pivot Group for every kind. */
export function makeProp(kind = 'crate') {
  const group = new THREE.Group();
  group.name = `prop-${kind}`;
  if (kind === 'car') {
    group.add(makeCar());
  } else if (kind === 'tree') {
    group.add(makeTree());
  } else if (kind === 'streetlight') {
    group.add(makeStreetlight());
  } else if (kind === 'barrel') {
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x56634a, metalness: 0.38, roughness: 0.7 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 18), barrelMaterial);
    barrel.position.y = 0.55;
    group.add(barrel);
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x242b2c, metalness: 0.72, roughness: 0.45 });
    for (const y of [0.12, 0.52, 0.98]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.405, 0.035, 8, 18), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      group.add(ring);
    }
  } else if (kind === 'rubble') {
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x67645e, roughness: 0.98 });
    const brickMaterial = new THREE.MeshStandardMaterial({ color: 0x694239, roughness: 0.96 });
    const random = makeRandom('rubble');
    for (let i = 0; i < 9; i++) {
      const rock = new THREE.Mesh(
        i % 3 ? new THREE.DodecahedronGeometry(0.12 + random() * 0.18, 0) : new THREE.BoxGeometry(0.25, 0.13, 0.42),
        i % 3 ? stoneMaterial : brickMaterial
      );
      rock.position.set((random() - 0.5) * 1.25, 0.08 + random() * 0.12, (random() - 0.5) * 1.1);
      rock.rotation.set(random(), random() * Math.PI, random());
      group.add(rock);
    }
  } else {
    group.add(makeCrate());
  }
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

/** A glowing floor disc that marks a travel exit or landmark trigger. */
export function makeExitMarker(color = 0x66ccff) {
  const group = new THREE.Group();
  group.name = 'exit-marker';
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.25, 0.12, 8, 32),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.36 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.52, 3.8, 18, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 1.9;
  group.add(ring, beam);
  return group;
}

/** A small floor marker for interactable landmarks. */
export function makeInteractableMarker(color = 0x9fe07f) {
  const group = new THREE.Group();
  group.name = 'interactable-marker';
  const disc = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1.18, 28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.75, roughness: 0.4, side: THREE.DoubleSide })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.09;
  group.add(disc);
  return group;
}

/** Starting room. Returns the unchanged { group, colliders, doorway } contract. */
export function makeRoom(size = 12) {
  const group = new THREE.Group();
  group.name = 'room';
  const half = size / 2;
  const wallHeight = 4;
  const wallThickness = 0.4;
  const concrete = getConcreteSurface();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    makeSurfaceMaterial(concrete, 4, 4, { color: 0x8c7967, bumpScale: 0.035, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  floor.receiveShadow = true;
  group.add(floor);

  const wallSurface = getWallSurface('concrete');
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: cloneTiledTexture(wallSurface.albedo, 2, 1),
    bumpMap: cloneTiledTexture(wallSurface.bump, 2, 1),
    bumpScale: 0.035,
    color: 0xc6bdb0,
    roughness: 0.91,
  });
  const colliders = [];
  const addWall = (w, d, x, z) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMaterial);
    wall.position.set(x, wallHeight / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    const long = Math.max(w, d);
    const steps = Math.max(2, Math.round(long / 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      colliders.push({
        x: w > d ? x - w / 2 + t * w : x,
        z: w > d ? z : z - d / 2 + t * d,
        radius: 0.8,
      });
    }
  };

  addWall(size, wallThickness, 0, half);
  addWall(wallThickness, size, -half, 0);
  addWall(wallThickness, size, half, 0);
  const doorWidth = 2.4;
  const segmentWidth = (size - doorWidth) / 2;
  addWall(segmentWidth, wallThickness, -(doorWidth / 2 + segmentWidth / 2), -half);
  addWall(segmentWidth, wallThickness, doorWidth / 2 + segmentWidth / 2, -half);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(size - wallThickness, size - wallThickness),
    new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.93, side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = wallHeight;
  ceiling.receiveShadow = true;
  group.add(ceiling);

  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x51483f, roughness: 0.86 });
  for (const x of [-doorWidth / 2 - 0.08, doorWidth / 2 + 0.08]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.65, 0.5), trimMaterial);
    jamb.position.set(x, 1.325, -half + 0.02);
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorWidth + 0.3, 0.16, 0.5), trimMaterial);
  lintel.position.set(0, 2.62, -half + 0.02);
  group.add(lintel);

  const bed = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3525, roughness: 0.9 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 3.2), frameMaterial);
  frame.position.y = 0.3;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.28, 3.0), new THREE.MeshStandardMaterial({ color: 0xc5bcae, roughness: 0.88 }));
  mattress.position.y = 0.58;
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.08, 1.65), new THREE.MeshStandardMaterial({ color: 0x5b6c75, roughness: 0.92 }));
  blanket.position.set(0, 0.76, 0.52);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.58, 4, 2, 3), new THREE.MeshStandardMaterial({ color: 0xdfd8cd, roughness: 0.95 }));
  pillow.position.set(0, 0.77, -1.02);
  bed.add(frame, mattress, blanket, pillow);
  bed.position.set(-half + 1.8, 0, half - 2.2);
  group.add(bed);

  const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.78, 0.72), new THREE.MeshStandardMaterial({ color: 0x59422f, roughness: 0.9 }));
  table.position.set(half - 1.2, 0.39, half - 1.1);
  group.add(table);
  const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.1, 18), new THREE.MeshStandardMaterial({ color: 0xf3ddb0, emissive: 0xffc46c, emissiveIntensity: 1.4 }));
  fixture.position.set(0, wallHeight - 0.08, 0);
  const roomLight = new THREE.PointLight(0xffd7a1, 1.25, 12, 2);
  roomLight.position.set(0, wallHeight - 0.38, 0);
  group.add(fixture, roomLight);
  group.traverse((object) => { if (object.isMesh) object.castShadow = object !== ceiling; });

  return { group, colliders, doorway: { x: 0, z: -half } };
}

/** Odisha temple landmark with stepped stone, columns, entry, and tower. */
export function makeTemple() {
  const group = new THREE.Group();
  group.name = 'temple';
  const stone = makeSurfaceMaterial(getConcreteSurface(), 2, 2, { color: 0xc4a97c, bumpScale: 0.05, roughness: 0.92 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x705f48, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(9 - i * 0.7, 0.45, 9 - i * 0.7), darkStone);
    step.position.y = 0.225 + i * 0.42;
    group.add(step);
  }
  const sanctuary = new THREE.Mesh(new THREE.BoxGeometry(7, 3.8, 7), stone);
  sanctuary.position.y = 3.05;
  group.add(sanctuary);
  for (const x of [-2.7, 2.7]) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 3.5, 14), stone);
    column.position.set(x, 2.85, 3.65);
    group.add(column);
  }
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.7, 0.18), new THREE.MeshStandardMaterial({ color: 0x31251f, roughness: 0.86 }));
  entrance.position.set(0, 2.35, 3.56);
  group.add(entrance);
  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.55, 2.0, 16), stone);
  towerBase.position.y = 5.9;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8.8, 20), stone);
  spire.position.y = 11.0;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb58a36, metalness: 0.5, roughness: 0.4 }));
  cap.position.y = 15.6;
  group.add(towerBase, spire, cap);
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

function makeSignTexture(accent) {
  const color = new THREE.Color(accent).getStyle();
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = '#16272c';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    ctx.fillStyle = '#edf4ef';
    ctx.font = 'bold 34px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EMERGENCY RESPONSE', size / 2, size / 2);
  }, 512, `facility-sign-${accent.toString(16)}`);
}

/** Ground-origin facility with separate wall/roof materials and rich facade. */
export function makeFacility(w = 14, h = 8, d = 12, accent = 0x4aa3d0) {
  const group = new THREE.Group();
  group.name = 'facility';
  const wallSurface = getWallSurface('concrete');
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: cloneTiledTexture(wallSurface.albedo, 3, 2),
    bumpMap: cloneTiledTexture(wallSurface.bump, 3, 2),
    bumpScale: 0.035,
    color: 0xd6dad7,
    roughness: 0.85,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x4d5658, roughness: 0.9 });
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    [wallMaterial, wallMaterial, roofMaterial, roofMaterial, wallMaterial, wallMaterial]
  );
  shell.position.y = h / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), roofMaterial);
  roof.position.y = h + 0.15;
  roof.castShadow = true;
  group.add(roof);
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.13, roughness: 0.6 });
  const frontBand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.82, 0.14), accentMaterial);
  frontBand.position.set(0, h - 1.25, d / 2 + 0.07);
  group.add(frontBand);

  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x315567, emissive: 0x10222a, emissiveIntensity: 0.32, metalness: 0.18, roughness: 0.22 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x303b3f, metalness: 0.45, roughness: 0.46 });
  for (const x of [-w * 0.34, -w * 0.18, w * 0.18, w * 0.34]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.9, w * 0.11), 1.28, 0.12), frameMaterial);
    frame.position.set(x, h * 0.5, d / 2 + 0.08);
    const window = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.76, w * 0.095), 1.1, 0.025), windowMaterial);
    window.position.set(x, h * 0.5, d / 2 + 0.15);
    group.add(frame, window);
  }

  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.25, 3.55, 0.34), frameMaterial);
  doorFrame.position.set(0, 1.78, d / 2 + 0.12);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.65, 3.18, 0.08), windowMaterial);
  door.position.set(0, 1.59, d / 2 + 0.32);
  const doorSplit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.05, 0.04), frameMaterial);
  doorSplit.position.set(0, 1.59, d / 2 + 0.38);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.18, 1.35), roofMaterial);
  canopy.position.set(0, 3.55, d / 2 + 0.65);
  group.add(doorFrame, door, doorSplit, canopy);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(w * 0.55, 8), Math.min(w * 0.55, 8) / 3),
    new THREE.MeshBasicMaterial({ map: cloneTiledTexture(makeSignTexture(accent), 1, 1), transparent: true })
  );
  sign.position.set(0, h - 0.9, d / 2 + 0.18);
  group.add(sign);

  for (const x of [-w * 0.24, w * 0.24]) {
    const hvac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.5), frameMaterial);
    hvac.position.set(x, h + 0.68, 0);
    hvac.castShadow = true;
    group.add(hvac);
  }
  const steps = new THREE.Mesh(new THREE.BoxGeometry(4, 0.14, 1.5), makeSurfaceMaterial(getConcreteSurface(), 2, 1, { bumpScale: 0.02 }));
  steps.position.set(0, 0.07, d / 2 + 0.75);
  steps.receiveShadow = true;
  group.add(steps);
  return group;
}

/** Detailed finale helicopter. userData.rotor remains the rotating main hub. */
export function makeHelicopter() {
  const group = new THREE.Group();
  group.name = 'helicopter';
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x3d5042, metalness: 0.38, roughness: 0.48 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x171c1e, metalness: 0.55, roughness: 0.42 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x254450, metalness: 0.15, roughness: 0.12, transparent: true, opacity: 0.84 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.35, 28, 18), bodyMaterial);
  body.scale.set(1.15, 0.92, 1.68);
  body.position.y = 1.72;
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.16, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), glassMaterial);
  cockpit.scale.set(0.92, 0.72, 0.8);
  cockpit.rotation.x = -0.42;
  cockpit.position.set(0, 1.85, -1.16);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.42, 3.7, 12), bodyMaterial);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 1.95, 3.05);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.25, 0.82), bodyMaterial);
  tailFin.position.set(0, 2.48, 4.72);
  group.add(body, cockpit, tail, tailFin);

  const doorOutline = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.22, 0.05), darkMaterial);
  doorOutline.position.set(1.18, 1.68, 0.3);
  doorOutline.rotation.y = Math.PI / 2;
  const doorInset = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, 0.035), glassMaterial);
  doorInset.position.set(1.215, 1.68, 0.3);
  doorInset.rotation.y = Math.PI / 2;
  group.add(doorOutline, doorInset);

  const railGeometry = new THREE.CylinderGeometry(0.055, 0.055, 3.45, 10);
  for (const x of [-1.02, 1.02]) {
    const rail = new THREE.Mesh(railGeometry.clone(), darkMaterial);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(x, 0.42, 0.15);
    group.add(rail);
    for (const z of [-0.85, 0.9]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 8), darkMaterial);
      strut.rotation.z = x < 0 ? -0.35 : 0.35;
      strut.position.set(x * 0.78, 0.78, z);
      group.add(strut);
    }
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.55, 12), darkMaterial);
  mast.position.set(0, 3.05, 0);
  const rotor = new THREE.Group();
  rotor.name = 'main-rotor';
  rotor.position.set(0, 3.34, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 14), darkMaterial);
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x202426, metalness: 0.25, roughness: 0.5 });
  const bladeA = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.055, 0.22), bladeMaterial);
  const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 7.4), bladeMaterial);
  rotor.add(hub, bladeA, bladeB);
  group.add(mast, rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.16, 2.45, 4.75);
  tailRotor.rotation.y = Math.PI / 2;
  const tailBladeA = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.13), bladeMaterial);
  const tailBladeB = tailBladeA.clone();
  tailBladeB.rotation.y = Math.PI / 2;
  tailRotor.add(tailBladeA, tailBladeB);
  group.add(tailRotor);

  const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3028, emissive: 0xff2018, emissiveIntensity: 1.5 }));
  navRed.position.set(-1.18, 1.85, 0);
  const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x42ff7b, emissive: 0x20d95b, emissiveIntensity: 1.5 }));
  navGreen.position.set(1.18, 1.85, 0);
  group.add(navRed, navGreen);

  group.userData.rotor = rotor;
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

export const AssetFactory = {
  configureRenderer,
  disposeObject3D,
  makeCanvasTexture,
  makeGround,
  makeRoad,
  makeCompound,
  makeHelipad,
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
