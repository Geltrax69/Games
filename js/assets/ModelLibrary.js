// Local character-model preload and registry.
//
// Both GLBs are bundled with the static site. Loading happens once, before Game
// construction, so AssetFactory can keep its synchronous API. A failed model is
// recorded and callers transparently use the procedural fallback.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MANIFEST = Object.freeze([
  {
    key: 'zombie',
    label: 'infected response worker',
    url: new URL('../../assets/models/zombie-hazmat.glb', import.meta.url),
    rootBone: 'mixamorig:Hips_01',
  },
  {
    key: 'human',
    label: 'CC0 survivor base mesh',
    url: new URL('../../assets/models/male-base-mesh.glb', import.meta.url),
    rootBone: 'metarig',
  },
]);

const _assets = new Map();
let _preloadPromise = null;

function normalizedNodeName(name) {
  return String(name || '').replace(/[\[\] .:/\\]/g, '');
}

function findRuntimeNode(scene, sourceName) {
  const exact = scene.getObjectByName(sourceName);
  if (exact) return exact;
  const wanted = normalizedNodeName(sourceName);
  let match = null;
  scene.traverse((object) => {
    if (!match && normalizedNodeName(object.name) === wanted) match = object;
  });
  return match;
}

/**
 * Remove horizontal translation from a rig's hip track while retaining vertical
 * weight shift. GLTFLoader sanitizes reserved characters such as colons in node
 * and track names, so source metadata names are resolved by normalized form.
 */
function neutralizeRootMotion(clip, scene, rootBoneName) {
  const rootBone = findRuntimeNode(scene, rootBoneName);
  if (!rootBone) return clip;

  const suffix = `${rootBone.name}.position`;
  const tracks = clip.tracks.map((sourceTrack) => {
    if (!sourceTrack.name.endsWith(suffix) || sourceTrack.ValueTypeName !== 'vector') {
      return sourceTrack;
    }
    const track = sourceTrack.clone();
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = rootBone.position.x;
      track.values[i + 2] = rootBone.position.z;
    }
    return track;
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/** Load both bundled character assets. Resolves even if one or both fail. */
export function preloadCharacterAssets(onProgress = () => {}) {
  if (_preloadPromise) return _preloadPromise;

  _preloadPromise = (async () => {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);

    let settledCount = 0;
    const results = await Promise.all(MANIFEST.map(async (entry) => {
      onProgress({
        phase: 'loading',
        key: entry.key,
        label: entry.label,
        loaded: settledCount,
        total: MANIFEST.length,
      });

      try {
        const gltf = await loader.loadAsync(entry.url.href);
        const clips = gltf.animations.map((clip) => (
          neutralizeRootMotion(clip, gltf.scene, entry.rootBone)
        ));
        const asset = {
          key: entry.key,
          scene: gltf.scene,
          animations: clips,
          sourceUrl: entry.url.href,
        };
        _assets.set(entry.key, asset);
        settledCount += 1;
        onProgress({
          phase: 'loaded',
          key: entry.key,
          label: entry.label,
          loaded: settledCount,
          total: MANIFEST.length,
        });
        return { key: entry.key, loaded: true };
      } catch (error) {
        settledCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        onProgress({
          phase: 'fallback',
          key: entry.key,
          label: entry.label,
          loaded: settledCount,
          total: MANIFEST.length,
          error: message,
        });
        return { key: entry.key, loaded: false, error: message };
      }
    }));

    return {
      loaded: results.filter((result) => result.loaded).map((result) => result.key),
      fallbacks: results.filter((result) => !result.loaded).map((result) => result.key),
      results,
    };
  })();

  return _preloadPromise;
}

/** Return a preloaded template record, or null when its fallback should be used. */
export function getCharacterAsset(key) {
  return _assets.get(key) || null;
}

/** Lightweight diagnostics for the bootstrap/debug harness. */
export function characterAssetStatus() {
  return Object.fromEntries(MANIFEST.map(({ key }) => [key, _assets.has(key) ? 'loaded' : 'fallback']));
}

/** Source-aware diagnostics make the human replacement visible to verification. */
export function characterAssetDetails() {
  return Object.fromEntries(MANIFEST.map(({ key, url }) => [key, {
    status: _assets.has(key) ? 'loaded' : 'fallback',
    source: decodeURIComponent(url.pathname.split('/').pop()),
  }]));
}

export const CHARACTER_ASSET_MANIFEST = MANIFEST.map(({ key, label, url }) => ({
  key,
  label,
  source: decodeURIComponent(url.pathname.split('/').pop()),
  url: url.href,
}));
