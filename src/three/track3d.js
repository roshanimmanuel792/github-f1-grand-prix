// Circuit geometry: built once per race as a handful of long ribbon meshes.
import * as THREE from 'three';
import { SEGMENT_LENGTH, START_LINE_SEGMENT } from '../game/track.js';
import { ROAD_HALF_M, SEG_M, newPose, poseAt, terrainY } from './world.js';
import { bannerTexture, barrierTexture, checkerTexture, grassTexture, roadTexture } from './textures.js';

const P = newPose();

/**
 * Ribbon along the centreline. profile = [[xNorm, yOffsetMeters, u], ...] across the strip.
 * v runs along the track (metres / vScale). step = segments between rings.
 */
function ribbon(line, { profile, from = 0, to = line.n - 1, step = 1, vScale = 10, swapUV = false, yFn }) {
  const rings = Math.floor((to - from) / step) + 1;
  const cols = profile.length;
  const pos = new Float32Array(rings * cols * 3);
  const uv = new Float32Array(rings * cols * 2);
  let k = 0;
  let q = 0;
  for (let r = 0; r < rings; r++) {
    const seg = Math.min(to, from + r * step);
    for (const [x, y, u] of profile) {
      poseAt(line, seg * SEGMENT_LENGTH, x, P);
      pos[k++] = P.x;
      pos[k++] = (yFn ? yFn(P.y, x, seg) : P.y) + y;
      pos[k++] = P.z;
      const v = (seg * SEG_M) / vScale;
      uv[q++] = swapUV ? v : u;
      uv[q++] = swapUV ? u : v;
    }
  }
  const index = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + cols;
      index.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise from above (normals up)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Alternating red/white kerb blocks (flat-shaded colours, one quad per segment). */
function kerb(line, side) {
  const n = line.n - 1;
  const pos = new Float32Array(n * 18);
  const col = new Float32Array(n * 18);
  const red = new THREE.Color(0xc8202b).convertSRGBToLinear();
  const white = new THREE.Color(0xeef1f4).convertSRGBToLinear();
  const pts = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    pts.length = 0;
    for (const [seg, x, y] of [
      [i, 1.0, 0.012],
      [i, 1.13, 0.05],
      [i + 1, 1.0, 0.012],
      [i + 1, 1.13, 0.05],
    ]) {
      poseAt(line, seg * SEGMENT_LENGTH, x * side, P);
      pts.push([P.x, P.y + y, P.z]);
    }
    const c = Math.floor(i / 2) % 2 ? red : white;
    const tri = side > 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3]; // normals up on both sides
    for (const t of tri) {
      pos.set(pts[t], k);
      col.set([c.r, c.g, c.b], k);
      k += 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function gantry(line, seg, banner, withLights) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b949e, metalness: 0.8, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161b22, metalness: 0.4, roughness: 0.5 });
  poseAt(line, seg * SEGMENT_LENGTH, 0, P);
  g.position.set(P.x, P.y, P.z);
  g.rotation.y = P.yaw;
  const span = ROAD_HALF_M * 1.42;
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
    pillar.position.set(s * span, 4, 0);
    pillar.castShadow = true;
    g.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.8, 0.7), dark);
  beam.position.y = 7.6;
  beam.castShadow = true;
  g.add(beam);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 1.6), new THREE.MeshBasicMaterial({ map: banner }));
  face.position.set(0, 7.6, -0.36);
  face.rotation.y = Math.PI; // faces oncoming cars
  g.add(face);
  const lights = [];
  if (withLights) {
    for (let i = 0; i < 5; i++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.4), dark);
      pod.position.set((i - 2) * 1.4, 5.9, -0.2);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 0 }));
      lamp.position.set((i - 2) * 1.4, 5.9, -0.42);
      lamp.rotation.y = Math.PI;
      g.add(pod, lamp);
      lights.push(lamp.material);
    }
  }
  return { group: g, lights };
}

export function buildTrack3D(line, track, { year }) {
  const group = new THREE.Group();
  const road = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: road, roughness: 0.88, metalness: 0.02 });
  const roadMesh = new THREE.Mesh(ribbon(line, { profile: [[-1, 0, 0], [1, 0, 1]], vScale: 12 }), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const k = new THREE.Mesh(kerb(line, side), kerbMat);
    k.receiveShadow = true;
    group.add(k);
  }

  // verge + terrain falling away to the valley floor
  const floor = line.minY - 6;
  const grass = grassTexture();
  grass.repeat.set(1, 1);
  const grassMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, color: 0xb8d8a8 });
  const fall = (y, x) => terrainY(line, y, x);
  for (const side of [-1, 1]) {
    const xs = side > 0 ? [1.13, 1.6, 2, 6, 14, 26, 40] : [-40, -26, -14, -6, -2, -1.6, -1.13];
    const profile = xs.map((x) => [x, -0.03, (x * ROAD_HALF_M) / 8]);
    const terrain = new THREE.Mesh(ribbon(line, { profile, step: 2, vScale: 8, yFn: fall }), grassMat);
    terrain.receiveShadow = true;
    group.add(terrain);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0x5d8a4a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(line.px[Math.floor(line.n / 2)], floor - 0.2, line.pz[Math.floor(line.n / 2)]);
  ground.receiveShadow = true;
  group.add(ground);

  // tecpro barriers along both sides
  const barrier = barrierTexture();
  const barrierMat = new THREE.MeshStandardMaterial({ map: barrier, roughness: 0.7, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const x = 1.36 * side;
    const b = new THREE.Mesh(ribbon(line, { profile: [[x, 0, 0], [x, 1.05, 1]], step: 2, vScale: 8, swapUV: true }), barrierMat);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    const top = new THREE.Mesh(ribbon(line, { profile: [[x - 0.05, 1.05, 0], [x + 0.05, 1.05, 1]], step: 2 }), new THREE.MeshStandardMaterial({ color: 0x30363d }));
    group.add(top);
  }

  // chequered start and finish lines
  const checker = checkerTexture();
  const lineMat = new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const seg of [START_LINE_SEGMENT, track.finishSegment]) {
    group.add(new THREE.Mesh(ribbon(line, { profile: [[-1, 0.015, 0], [1, 0.015, 4]], from: seg, to: seg + 1, vScale: SEG_M }), lineMat));
  }

  const start = gantry(line, START_LINE_SEGMENT, bannerTexture(`GITHUB GRAND PRIX ${year}`), true);
  const finish = gantry(line, track.finishSegment, bannerTexture('FINISH', '#f5f5f5', '#111', '#c8202b'), false);
  group.add(start.group, finish.group);

  return { group, startLights: start.lights };
}
