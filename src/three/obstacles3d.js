// 3D obstacles generated from the race's contribution rows (same rows the simulation uses).
import * as THREE from 'three';
import { LANES } from '../game/obstacles.js';
import { newPose, poseAt } from './world.js';
import { chevronTexture, hazardTexture, labelTexture } from './textures.js';

const P = newPose();
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const HIT = new THREE.Matrix4();
const LABELS = 4;

function torusFlat() {
  return new THREE.TorusGeometry(0.34, 0.15, 10, 20).rotateX(Math.PI / 2);
}

/** Part catalogue: geometry + material + local placements per blocked lane, by obstacle kind. */
function catalogue() {
  const rubber = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const parts = {
    block: new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.95, 0.75).translate(0, 0.475, 0), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 })),
    coneBody: new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 18).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.5 })),
    coneBand: new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.13, 18).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.4, emissive: 0x333333 })),
    coneBase: new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.62).translate(0, 0.03, 0), new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.8 })),
    tyre: new THREE.Mesh(torusFlat(), rubber),
    belt: new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.95, 0.12).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x1f6feb, roughness: 0.5 })),
    panelL: new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.2, 0.9).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ map: chevronTexture(-1), roughness: 0.5 })),
    panelR: new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.2, 0.9).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ map: chevronTexture(1), roughness: 0.5 })),
    lamp: new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8).translate(0, 2.35, 0), new THREE.MeshStandardMaterial({ color: 0x331d00, emissive: 0xffa000, emissiveIntensity: 6 })),
    arrow: new THREE.Mesh(arrowGeometry(), new THREE.MeshStandardMaterial({ color: 0x2ea043, emissive: 0x2ea043, emissiveIntensity: 5 })),
  };
  return parts;
}

function arrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.35, 1.2);
  s.lineTo(0.35, 1.2);
  s.lineTo(0.35, 0.5);
  s.lineTo(0.8, 0.5);
  s.lineTo(0, -0.4);
  s.lineTo(-0.8, 0.5);
  s.lineTo(-0.35, 0.5);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }).translate(0, 3.6, -0.1);
}

/** Local (lane-frame) placements for one blocked lane of a given kind: [part, dx, dy, dz, tint?]. */
function layout(kind, lane, row) {
  const out = [];
  if (kind === 'block') out.push(['block', 0, 0, 0]);
  else if (kind === 'cone') for (const dx of [-1.3, 0, 1.3]) out.push(['coneBody', dx, 0, 0], ['coneBand', dx, 0, 0], ['coneBase', dx, 0, 0]);
  else if (kind === 'tyres') {
    for (const dx of [-0.85, 0.85]) for (let h = 0; h < 4; h++) out.push(['tyre', dx, 0.15 + h * 0.3, 0, h === 3 ? (lane % 2 ? 0xc8202b : 0xf0f0f0) : 0x161616]);
  } else if (kind === 'tyreBarrier') {
    for (let i = 0; i < 6; i++) for (let h = 0; h < 2; h++) out.push(['tyre', -1.9 + i * 0.76, 0.15 + h * 0.3, 0.2, (i + h) % 2 ? 0xc8202b : 0xf0f0f0]);
    out.push(['belt', 0, 0, -0.35]);
  } else if (kind === 'barrier') {
    out.push([lane < row.safeLane ? 'panelR' : 'panelL', 0, 0, 0], ['lamp', -1.6, 0, 0], ['lamp', 1.6, 0, 0]);
  }
  return out;
}

export function buildObstacles(line, race) {
  const parts = catalogue();
  const placements = Object.fromEntries(Object.keys(parts).map((k) => [k, []]));
  const rowInstances = race.rows.map(() => []);
  race.rows.forEach((row, r) => {
    for (const lane of row.blocked) {
      for (const [part, dx, dy, dz, tint] of layout(row.kind, lane, row)) placements[part].push({ r, lane, dx, dy, dz, tint });
    }
    if (row.kind === 'barrier') placements.arrow.push({ r, lane: row.safeLane, dx: 0, dy: 0, dz: 0, arrow: true });
  });

  const group = new THREE.Group();
  const meshes = {};
  for (const [name, proto] of Object.entries(parts)) {
    const list = placements[name];
    const m = new THREE.InstancedMesh(proto.geometry, proto.material, Math.max(1, list.length));
    m.count = list.length;
    m.castShadow = name !== 'arrow';
    m.receiveShadow = true;
    m.frustumCulled = false;
    list.forEach((p, i) => {
      p.mesh = m;
      p.index = i;
      p.base = baseMatrix(line, race, p, new THREE.Matrix4());
      m.setMatrixAt(i, p.base);
      if (p.tint !== undefined) m.setColorAt(i, new THREE.Color(p.tint));
      if (!p.arrow) rowInstances[p.r].push(p);
    });
    meshes[name] = m;
    group.add(m);
  }
  const arrows = placements.arrow;

  const labels = Array.from({ length: LABELS }, () => {
    const t = labelTexture();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.texture, depthWrite: false, transparent: true }));
    sprite.scale.set(3.2, 1.4, 1);
    sprite.visible = false;
    sprite.userData = { draw: t.draw, row: -1 };
    group.add(sprite);
    return sprite;
  });

  const hitState = new Uint8Array(race.rows.length);
  let sim = race; // replays of the same season reuse this geometry
  return {
    group,
    attach(next) {
      sim = next;
      hitState.fill(255); // force a resync of every row
      for (const sp of labels) sp.userData.row = -1;
    },
    /** Sync with the simulation: knocked-over obstacles, bobbing gap arrows, upcoming labels. */
    update(time, reducedMotion) {
      const race = sim;
      for (let r = 0; r < hitState.length; r++) {
        if (hitState[r] === race.rowHit[r]) continue;
        hitState[r] = race.rowHit[r];
        for (const p of rowInstances[r]) {
          if (hitState[r]) {
            // knocked over and shoved down the track by the impact
            E.set(-0.9 + p.dx * 0.1, p.dx * 0.3, p.dx > 0 ? -0.5 : 0.5);
            M4.multiplyMatrices(p.base, HIT.compose(V.set(p.dx * 0.4, 0, 2.5), Q.setFromEuler(E), ONE));
            p.mesh.setMatrixAt(p.index, M4);
          } else p.mesh.setMatrixAt(p.index, p.base);
          p.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      if (!reducedMotion && arrows.length) {
        const bob = Math.sin(time * 4) * 0.25;
        const from = race.nextRow;
        for (const a of arrows) {
          if (a.r < from - 1 || a.r > from + 12) continue;
          M4.makeTranslation(0, bob, 0).premultiply(a.base);
          meshes.arrow.setMatrixAt(a.index, M4);
        }
        meshes.arrow.instanceMatrix.needsUpdate = true;
      }
      for (let k = 0; k < LABELS; k++) {
        const r = race.nextRow + k;
        const sp = labels[k];
        if (r >= race.rows.length) {
          sp.visible = false;
          continue;
        }
        const row = race.rows[r];
        if (sp.userData.row !== r) {
          sp.userData.row = r;
          sp.userData.draw(row.count, row.date.slice(5).replace('-', '/'));
          poseAt(line, race.rowZ[r], LANES[row.blocked[0]], P);
          sp.position.set(P.x, P.y + (row.kind === 'barrier' ? 4.2 : 2.6), P.z);
        }
        sp.visible = true;
      }
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    },
  };
}

function baseMatrix(line, race, p, out) {
  poseAt(line, race.rowZ[p.r], LANES[p.lane], P);
  Q.setFromEuler(E.set(0, P.yaw, 0));
  out.compose(V.set(P.x, P.y, P.z), Q, ONE);
  // lane-local offset (x across the lane, z along the track); local +X is left of travel
  return out.multiply(new THREE.Matrix4().makeTranslation(-p.dx, p.dy, p.dz));
}
