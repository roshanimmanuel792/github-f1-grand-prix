// Procedural Formula-style car (original design and livery). Forward is +Z, up is +Y, metres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { liveryTexture } from './textures.js';

const FRONT_R = 0.33;
const REAR_R = 0.36;
const AXLE_F = 1.75;
const AXLE_R = -1.55;
const TRACK_F = 0.82;
const TRACK_R = 0.78;

function materials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0x1b2027, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    accent: new THREE.MeshPhysicalMaterial({ color: 0x2ea043, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x0c0e11, metalness: 0.2, roughness: 0.55 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.9, roughness: 0.3 }),
    compound: new THREE.MeshStandardMaterial({ color: 0xf2c40c, roughness: 0.6 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, metalness: 0.1, roughness: 0.25, clearcoat: 1 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.1 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x30363d, metalness: 0.8, roughness: 0.35 }),
    light: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 1.5 }),
    decal: new THREE.MeshPhysicalMaterial({ map: liveryTexture(), metalness: 0.4, roughness: 0.35, clearcoat: 1 }),
    flame: new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Thin rod between two points (suspension arms, pillars). */
function rod(a, b, radius, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function wheel(radius, width, M) {
  const g = new THREE.Group();
  const tyre = mesh(new THREE.CylinderGeometry(radius, radius, width, 28, 1), M.tyre);
  tyre.rotation.z = Math.PI / 2;
  const band = mesh(new THREE.TorusGeometry(radius * 0.86, 0.012, 6, 32), M.compound);
  band.rotation.y = Math.PI / 2;
  band.position.x = width / 2 + 0.001;
  const band2 = band.clone();
  band2.position.x = -band.position.x;
  const rim = mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.01, 20), M.rim);
  rim.rotation.z = Math.PI / 2;
  // spokes make rotation visible
  for (let i = 0; i < 5; i++) {
    const spoke = mesh(new THREE.BoxGeometry(width + 0.02, radius * 0.08, radius * 1.1), M.carbon);
    spoke.rotation.x = (i / 5) * Math.PI;
    g.add(spoke);
  }
  g.add(tyre, band, band2, rim);
  return g;
}

export function createCar() {
  const M = materials();
  const root = new THREE.Group(); // positioned on the track
  const body = new THREE.Group(); // pitches/rolls on the suspension
  root.add(body);

  // floor, plank and diffuser
  body.add(mesh(new THREE.BoxGeometry(1.5, 0.04, 3.9), M.carbon, 0, 0.09, 0.05));
  const diffuser = mesh(new THREE.BoxGeometry(1.0, 0.04, 0.6), M.carbon, 0, 0.2, -2.15);
  diffuser.rotation.x = -0.35;
  body.add(diffuser);
  for (let i = -2; i <= 2; i++) body.add(mesh(new THREE.BoxGeometry(0.012, 0.18, 0.5), M.carbon, i * 0.2, 0.22, -2.1));

  // monocoque tub, nose and cockpit
  body.add(mesh(new RoundedBoxGeometry(0.82, 0.5, 1.9, 4, 0.18), M.paint, 0, 0.42, 0.35));
  const nose = mesh(new THREE.CylinderGeometry(0.09, 0.25, 1.7, 20), M.paint, 0, 0.36, 2.0);
  nose.rotation.x = Math.PI / 2 + 0.08;
  nose.scale.set(1.25, 1, 0.65);
  body.add(nose);
  body.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), M.accent, 0, 0.3, 2.85));
  body.add(mesh(new THREE.BoxGeometry(0.52, 0.06, 0.8), M.carbon, 0, 0.68, 0.15)); // cockpit opening

  // sidepods with green intakes
  for (const s of [-1, 1]) {
    body.add(mesh(new RoundedBoxGeometry(0.5, 0.42, 1.7, 4, 0.16), M.paint, s * 0.62, 0.36, -0.25));
    body.add(mesh(new RoundedBoxGeometry(0.46, 0.06, 1.2, 2, 0.03), M.accent, s * 0.64, 0.58, -0.1));
    body.add(mesh(new THREE.BoxGeometry(0.4, 0.26, 0.04), M.carbon, s * 0.62, 0.38, 0.62));
    const decal = mesh(new THREE.PlaneGeometry(1.15, 0.29), M.decal, s * 0.874, 0.38, -0.3);
    decal.rotation.y = (s * Math.PI) / 2;
    body.add(decal);
  }

  // engine cover tapering to the rear, airbox and shark fin
  const cover = mesh(new THREE.CylinderGeometry(0.12, 0.38, 1.9, 20), M.paint, 0, 0.55, -1.0);
  cover.rotation.x = -Math.PI / 2 + 0.06;
  cover.scale.set(1, 1, 0.75);
  body.add(cover);
  body.add(mesh(new RoundedBoxGeometry(0.3, 0.32, 0.5, 3, 0.1), M.paint, 0, 0.92, -0.35));
  body.add(mesh(new THREE.BoxGeometry(0.2, 0.16, 0.06), M.carbon, 0, 0.9, -0.08));
  const fin = mesh(new THREE.BoxGeometry(0.02, 0.3, 1.3), M.accent, 0, 0.88, -1.15);
  body.add(fin);

  // driver, halo
  const helmet = mesh(new THREE.SphereGeometry(0.15, 24, 16), M.helmet, 0, 0.8, 0.1);
  body.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(0.152, 24, 8, 0, Math.PI * 2, 1.15, 0.45), M.visor, 0, 0.8, 0.1);
  visor.rotation.x = -0.25;
  body.add(visor);
  const stripe = mesh(new THREE.TorusGeometry(0.152, 0.012, 6, 24), M.accent, 0, 0.82, 0.1);
  stripe.rotation.x = Math.PI / 2;
  body.add(stripe);
  const halo = mesh(new THREE.TorusGeometry(0.34, 0.028, 8, 24, Math.PI), M.halo, 0, 0.92, 0.12);
  halo.rotation.x = -Math.PI / 2;
  halo.rotation.z = Math.PI;
  body.add(halo);
  body.add(rod(new THREE.Vector3(0, 0.7, 0.62), new THREE.Vector3(0, 0.93, 0.44), 0.025, M.halo));

  // front wing: three elements + endplates
  for (let i = 0; i < 3; i++) {
    const el = mesh(new THREE.BoxGeometry(1.85 - i * 0.12, 0.022, 0.26 - i * 0.04), i === 0 ? M.carbon : M.accent, 0, 0.12 + i * 0.05, 2.75 - i * 0.14);
    el.rotation.x = -0.12 - i * 0.12;
    body.add(el);
  }
  for (const s of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.02, 0.22, 0.55), M.carbon, s * 0.94, 0.18, 2.65));

  // rear wing: main plane, DRS flap, endplates, swan-neck pillar
  const main = mesh(new THREE.BoxGeometry(1.0, 0.03, 0.32), M.carbon, 0, 0.95, -2.2);
  main.rotation.x = 0.18;
  const flap = mesh(new THREE.BoxGeometry(1.0, 0.025, 0.2), M.accent, 0, 1.06, -2.32);
  flap.rotation.x = 0.55;
  body.add(main, flap);
  for (const s of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.02, 0.5, 0.62), M.paint, s * 0.51, 0.88, -2.22));
  body.add(rod(new THREE.Vector3(0, 0.55, -1.75), new THREE.Vector3(0, 0.98, -2.15), 0.03, M.carbon));
  body.add(mesh(new THREE.BoxGeometry(0.9, 0.02, 0.12), M.carbon, 0, 0.32, -2.3)); // beam wing

  // rain light + brake lights, exhaust, nitro flame
  const rain = mesh(new THREE.BoxGeometry(0.16, 0.08, 0.03), M.light.clone(), 0, 0.42, -2.42);
  const brakeL = mesh(new THREE.BoxGeometry(0.04, 0.12, 0.02), M.light.clone(), -0.52, 0.72, -2.54);
  const brakeR = brakeL.clone();
  brakeR.position.x = 0.52;
  brakeR.material = brakeL.material;
  body.add(rain, brakeL, brakeR);
  const exhaust = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 12), M.rim, 0, 0.55, -2.0);
  exhaust.rotation.x = Math.PI / 2;
  body.add(exhaust);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 12, 1, true), M.flame);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.55, -2.5);
  flame.visible = false;
  body.add(flame);

  // wheels + suspension (wheels live on `root`, so the body can move on its springs)
  const wheels = [];
  const steerPivots = [];
  for (const [z, track, r, w, front] of [
    [AXLE_F, TRACK_F, FRONT_R, 0.3, true],
    [AXLE_R, TRACK_R, REAR_R, 0.4, false],
  ]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (track + w / 2), r, z);
      const wh = wheel(r, w, M);
      pivot.add(wh);
      root.add(pivot);
      wheels.push(wh);
      if (front) steerPivots.push(pivot);
      for (const dy of [0.08, -0.06]) {
        body.add(rod(new THREE.Vector3(s * 0.4, r + dy + 0.05, z + 0.18), new THREE.Vector3(s * (track + 0.02), r + dy, z), 0.018, M.carbon));
        body.add(rod(new THREE.Vector3(s * 0.4, r + dy + 0.05, z - 0.18), new THREE.Vector3(s * (track + 0.02), r + dy, z), 0.018, M.carbon));
      }
    }
  }

  let spin = 0;
  return {
    object: root,
    body,
    /** Local positions of the rear contact patches (tyre smoke) and floor (sparks). */
    rearWheels: [new THREE.Vector3(-TRACK_R - 0.2, 0.05, AXLE_R), new THREE.Vector3(TRACK_R + 0.2, 0.05, AXLE_R)],
    /**
     * @param {number} dt frame seconds
     * @param {{speedMs:number, steer:number, braking:boolean, accel:number, lateral:number, nitro:number, time:number, rainOn:boolean}} s
     */
    animate(dt, s) {
      spin += (s.speedMs * dt) / REAR_R;
      for (const w of wheels) w.rotation.x = spin;
      for (const p of steerPivots) p.rotation.y = -s.steer * 0.32;
      // suspension: dive under braking, squat on throttle, roll in corners, road buzz
      const buzz = Math.sin(s.time * 47) * 0.004 * Math.min(1, s.speedMs / 40);
      body.rotation.x += (-s.accel * 0.0012 - body.rotation.x) * Math.min(1, dt * 8);
      body.rotation.z += (s.lateral * 0.02 - body.rotation.z) * Math.min(1, dt * 8);
      body.position.y = buzz;
      const brake = s.braking ? 4 : 1.2;
      brakeL.material.emissiveIntensity = brake;
      rain.material.emissiveIntensity = s.rainOn ? 3 : 0.4;
      flame.visible = s.nitro > 0;
      if (s.nitro > 0) {
        const f = 0.8 + 0.35 * Math.sin(s.time * 90) + s.nitro * 0.35;
        flame.scale.set(1, f, 1);
        flame.position.z = -2.4 - f * 0.4;
        M.flame.color.setHex(s.nitro >= 3 ? 0x3fb950 : 0x66ccff).multiplyScalar(4); // HDR so it blooms
      }
    },
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) o.material.map?.dispose?.(), o.material.dispose?.();
      });
    },
  };
}
