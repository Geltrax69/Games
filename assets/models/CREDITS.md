# Bundled model credits

The game makes no runtime network requests outside its own origin. These model files are committed locally so the static site continues to work offline.

## Zombie Hazmat

- **Local file:** `zombie-hazmat.glb`
- **Title:** *Zombie Hazmat*
- **Creator:** [LxNazarov](https://sketchfab.com/LxNazarov)
- **Original source:** [Sketchfab model page](https://sketchfab.com/3d-models/zombie-hazmat-49b3b4307f6a4d2386fdb02354158d04)
- **Repository copy:** [`public/zombie_hazmat.glb`](https://github.com/RohanVashisht1234/threejs-zombieshooter-game/blob/main/public/zombie_hazmat.glb)
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

The embedded glTF metadata records the title, creator, original source, and license. The runtime preserves the authored textures and animations, removes horizontal root motion to keep the render aligned with the gameplay entity, and applies small per-instance material/scale variation.

## Male Base Mesh

- **Local file:** `male-base-mesh.glb`
- **Creator:** [orange-juice-games](https://orange-juice-games.itch.io/)
- **Original source:** [Male Base Mesh](https://orange-juice-games.itch.io/male-base-mesh)
- **Repository copy:** [`Original/male_base_mesh.glb`](https://github.com/BoQsc/Godot-3D-Male-Base-Mesh/blob/main/Original/male_base_mesh.glb)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

The source provides an anatomical skinned humanoid and armature without embedded animation clips or materials. The runtime normalizes each clone to about 1.78 m with a ground pivot and +Z forward, gives each instance unique geometry/material ownership, applies varied skin/hair/eye treatments, layers modern role-specific survival clothing and gear, and drives additive idle, walk, and hostile attack poses directly through the armature.

## Runtime support

`GLTFLoader.js`, `SkeletonUtils.js`, `BufferGeometryUtils.js`, and `meshopt_decoder.module.js` are vendored from [three.js r160](https://github.com/mrdoob/three.js/tree/r160/examples/jsm). three.js is distributed under the MIT License; the repository copy is at [`vendor/three/LICENSE`](../../vendor/three/LICENSE).

The decoder module is generated from [meshoptimizer](https://github.com/zeux/meshoptimizer), Copyright (C) 2016-2022 Arseny Kapoulkine, and carries its MIT license notice directly in the vendored source file.
