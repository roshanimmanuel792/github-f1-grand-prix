// Roadside scenery, instanced so thousands of objects cost a handful of draw calls.
import * as THREE from 'three';
import { mulberry32 } from '../data/dataset.js';
import { SCENERY, SEGMENT_LENGTH, START_SEGMENT } from '../game/track.js';
import { bannerTexture, glassTexture } from './textures.js';
import { newPose, poseAt, terrainY } from './world.js';

const P = newPose();
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geo, mat, transforms, { colors, shadow = false } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, transforms.length));
  m.count = transforms.length;
  transforms.forEach((t, i) => {
    Q.setFromAxisAngle(UP, t.yaw ?? 0);
    m.setMatrixAt(i, M4.compose(V.set(t.x, t.y, t.z), Q, S.setScalar(t.s ?? 1)));
    if (colors) m.setColorAt(i, colors[i]);
  });
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false; // instances span the whole circuit
  return m;
}

/** @param {number} density 0.35 (low) .. 1.4 (ultra) */
export function buildScenery(line, track, { year, density = 1, treeShadows = false, seed = 1 }) {
  const group = new THREE.Group();
  const rand = mulberry32(seed);
  const at = (seg, x, extra = {}) => {
    poseAt(line, seg * SEGMENT_LENGTH, x, P);
    return { x: P.x, y: terrainY(line, P.y, x), z: P.z, yaw: P.yaw, ...extra };
  };

  const pines = [];
  const trees = [];
  const bushes = [];
  const rocks = [];
  const boards = [[], [], [], []];
  // shortcut: no road-overlap test for trees; fine unless the procedural circuit loops back on itself.
  for (let i = 0; i < track.count; i++) {
    for (const [type, off] of [[track.sceneryL[i], track.offsetL[i]], [track.sceneryR[i], track.offsetR[i]]]) {
      const x = Math.sign(off) * Math.max(1.6, Math.abs(off)); // keep clear of the barrier
      if (type === SCENERY.pine) pines.push(at(i, x, { s: 0.8 + rand() * 0.6 }));
      else if (type === SCENERY.tree) trees.push(at(i, x, { s: 0.8 + rand() * 0.5 }));
      else if (type === SCENERY.bush) bushes.push(at(i, x, { s: 0.7 + rand() * 0.8 }));
      else if (type === SCENERY.rock) rocks.push(at(i, x, { s: 0.6 + rand() * 0.9, yaw: rand() * 6 }));
      else if (type === SCENERY.billboard) boards[track.variant[i]].push(at(i, Math.sign(off) * 1.75));
    }
    if (i % 3 === 0) {
      for (const side of [-1, 1]) {
        if (rand() > density * 0.8) continue;
        (rand() < 0.6 ? pines : trees).push(at(i, side * (4 + rand() * 26), { s: 0.9 + rand() * 0.9 }));
      }
    }
  }

  const bark = new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 0.9 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const greens = (n, base) => Array.from({ length: n }, () => new THREE.Color(base).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.12));
  group.add(
    instanced(new THREE.ConeGeometry(2.3, 7.5, 9).translate(0, 6.2, 0), foliage, pines, { colors: greens(pines.length, 0x1f5a2e), shadow: treeShadows }),
    instanced(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 6).translate(0, 1.3, 0), bark, pines),
    instanced(new THREE.IcosahedronGeometry(2.9, 1).translate(0, 5.4, 0), foliage, trees, { colors: greens(trees.length, 0x3d7a34), shadow: treeShadows }),
    instanced(new THREE.CylinderGeometry(0.25, 0.35, 3.4, 6).translate(0, 1.7, 0), bark, trees),
    instanced(new THREE.IcosahedronGeometry(1.1, 0).translate(0, 0.5, 0), foliage, bushes, { colors: greens(bushes.length, 0x356b2c) }),
    instanced(new THREE.DodecahedronGeometry(0.9, 0).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x7d8590, roughness: 0.9, flatShading: true }), rocks),
  );

  // billboards angled toward oncoming traffic
  const texts = ['GITHUB GRAND PRIX', 'KEEP COMMITTING', `SEASON ${year}`, 'SHIP IT'];
  const colors = ['#0d1117', '#1f6feb', '#8957e5', '#c8202b'];
  const boardGeo = new THREE.PlaneGeometry(9, 3).translate(0, 3.6, 0);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.35 });
  const posts = [];
  boards.forEach((list, k) => {
    for (const b of list) {
      b.yaw += Math.PI + (b.x > 0 ? 0.35 : -0.35);
      posts.push(b);
    }
    group.add(instanced(boardGeo, new THREE.MeshStandardMaterial({ map: bannerTexture(texts[k], colors[k]), roughness: 0.6, side: THREE.DoubleSide }), list));
  });
  group.add(instanced(new THREE.BoxGeometry(8, 0.25, 0.25).translate(0, 2.1, 0), steel, posts));

  // floodlight towers every ~120 m, alternating sides
  const towers = [];
  for (let i = START_SEGMENT; i < track.count - 60; i += 60) towers.push(at(i, (i / 60) % 2 ? 1.7 : -1.7));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 0.2 });
  group.add(
    instanced(new THREE.CylinderGeometry(0.18, 0.3, 14, 8).translate(0, 7, 0), steel, towers, { shadow: true }),
    instanced(new THREE.BoxGeometry(2.4, 1, 0.5).translate(0, 14.2, 0), lampMat, towers),
  );

  // pit building on the left of the start straight
  const pit = new THREE.Group();
  poseAt(line, (START_SEGMENT + 10) * SEGMENT_LENGTH, -2.9, P);
  pit.position.set(P.x, P.y, P.z);
  pit.rotation.y = P.yaw;
  const glass = new THREE.MeshStandardMaterial({ map: glassTexture(), metalness: 0.6, roughness: 0.2 });
  glass.map.wrapS = THREE.RepeatWrapping;
  glass.map.repeat.set(8, 1);
  // box face order: +x, -x, +y, -y, +z, -z; local -X faces the track for a building on the left
  const building = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 80), [steel, glass, steel, steel, steel, steel]);
  building.position.y = 3.5;
  building.castShadow = building.receiveShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 82), new THREE.MeshStandardMaterial({ color: 0x2ea043, roughness: 0.5 }));
  roof.position.y = 7.25;
  pit.add(building, roof);
  group.add(pit);

  // grandstands on the right of the start straight, tiers rising away from the track (local -X)
  const crowd = [];
  const crowdColors = [];
  const palette = [0xf2c40c, 0xff5a1f, 0x2ea043, 0x58a6ff, 0xeef2f6, 0xc8202b, 0xbc8cff].map((c) => new THREE.Color(c));
  const standMat = new THREE.MeshStandardMaterial({ color: 0x6e7681, roughness: 0.8 });
  const standRoof = new THREE.MeshStandardMaterial({ color: 0x21262d, roughness: 0.6 });
  for (let i = 0; i < track.count; i++) {
    if (track.sceneryR[i] !== SCENERY.stand) continue;
    const st = new THREE.Group();
    poseAt(line, i * SEGMENT_LENGTH, 2.6, P);
    st.position.set(P.x, P.y, P.z);
    st.rotation.y = P.yaw;
    st.updateMatrixWorld();
    for (let t = 0; t < 6; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 11), standMat);
      tier.position.set(-(1 + t * 1.6), 0.3 + t * 0.9, 0);
      tier.receiveShadow = tier.castShadow = true;
      st.add(tier);
      for (let p = 0; p < 18 * density; p++) {
        V.set(tier.position.x + (rand() - 0.5) * 1.2, tier.position.y + 0.75, (rand() - 0.5) * 10.5).applyMatrix4(st.matrixWorld);
        crowd.push({ x: V.x, y: V.y, z: V.z, yaw: P.yaw });
        crowdColors.push(palette[Math.floor(rand() * palette.length)]);
      }
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 12), standRoof);
    top.position.set(-5.5, 7.4, 0);
    st.add(top);
    group.add(st);
  }
  group.add(instanced(new THREE.BoxGeometry(0.4, 0.9, 0.4), new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowd, { colors: crowdColors }));

  return { group, lampMat };
}
