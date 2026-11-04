// Camera rig: player cameras (chase / close / cockpit) and a deterministic TV director used
// for the landing attract loop and replay export. All motion is exponentially smoothed.
import * as THREE from 'three';
import { STATES } from '../game/race.js';
import { METERS_PER_UNIT, newPose, poseAt } from './world.js';

export const CAMERA_MODES = ['chase', 'close', 'cockpit', 'tv'];
const P = newPose();
const Q = newPose();

const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.desiredPos = new THREE.Vector3();
    this.desiredLook = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.lookWorld = new THREE.Vector3();
    this.shake = 0;
    this.shot = 'chase';
    this.shotSince = 0;
    this.initialised = false;
  }

  cut() {
    this.initialised = false;
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Offset from the car in its own frame (right, up, back) → world, at distance zUnits. */
  carFrame(line, race, right, up, back, out) {
    const zBack = race.z - back / METERS_PER_UNIT;
    poseAt(line, zBack, race.car.x + right / 7, P);
    return out.set(P.x, P.y + up, P.z);
  }

  lookAhead(line, race, ahead, height, lateral, out) {
    poseAt(line, race.z + ahead / METERS_PER_UNIT, race.car.x * 0.6 + lateral, Q);
    return out.set(Q.x, Q.y + height, Q.z);
  }

  /** Deterministic shot selection from simulation state (same replay → same camera). */
  directorShot(race) {
    const t = race.time;
    if (race.state === STATES.READY || race.countdown > 0) return 'grid';
    if (race.state === STATES.FINISHED) return t - race.finishedAt < 2.5 ? 'finishLine' : 'orbit';
    const toFinish = (race.finishZ - race.z) * METERS_PER_UNIT;
    if (toFinish < 70) return 'finishLine';
    const near = race.nextRow < race.rows.length && (race.rowZ[race.nextRow] - race.z) * METERS_PER_UNIT < 45;
    if (near && Math.abs(race.car.vLat) > 0.5) return 'avoid'; // steering round an obstacle
    const phase = Math.floor(t / 9) % 4;
    if (phase === 2) return 'wide';
    if (phase === 3) return 'corner';
    return 'chase';
  }

  update(dt, line, race, { speed01, steer, curve, nitro, reducedMotion, mode = this.mode }) {
    const cam = this.camera;
    let lambda = 9;
    let fov = 62 + 10 * Math.min(1.3, speed01) + nitro * 3;
    let shot = mode;
    if (mode === 'tv') {
      shot = this.directorShot(race);
      if (shot !== this.shot) {
        this.shot = shot;
        this.shotSince = race.time;
      }
      lambda = 3.2;
    }
    const since = race.time - this.shotSince;
    switch (shot) {
      case 'close':
        this.carFrame(line, race, 0, 1.35, 4.2, this.desiredPos);
        this.lookAhead(line, race, 14, 0.9, steer * 0.08, this.desiredLook);
        break;
      case 'cockpit':
        this.carFrame(line, race, 0, 1.08, -0.45, this.desiredPos);
        this.lookAhead(line, race, 30, 0.9, steer * 0.05, this.desiredLook);
        lambda = 40;
        fov += 8;
        break;
      case 'grid':
        this.carFrame(line, race, -5 + since * 0.4, 2.2, -9 - since * 0.6, this.desiredPos);
        this.carFrame(line, race, 0, 0.8, 0.5, this.desiredLook);
        fov = 50;
        break;
      case 'avoid':
        this.carFrame(line, race, -race.car.vLat * 0.35, 1.1, 3.6, this.desiredPos);
        this.lookAhead(line, race, 22, 0.6, 0, this.desiredLook);
        break;
      case 'wide':
        this.carFrame(line, race, 6, 13, 26, this.desiredPos);
        this.lookAhead(line, race, 30, 0, 0, this.desiredLook);
        fov = 55;
        break;
      case 'corner':
        this.carFrame(line, race, -curve * 6, 2.6, 7.5, this.desiredPos);
        this.lookAhead(line, race, 16, 0.8, curve * 0.3, this.desiredLook);
        break;
      case 'finishLine': {
        poseAt(line, race.finishZ + 25 / METERS_PER_UNIT, 1.25, P);
        this.desiredPos.set(P.x, P.y + 2.2, P.z);
        this.carFrame(line, race, 0, 0.8, 0, this.desiredLook);
        fov = 48;
        break;
      }
      case 'orbit': {
        const a = since * 0.35;
        this.carFrame(line, race, Math.sin(a) * 9, 3 + Math.sin(a * 0.5), Math.cos(a) * 9, this.desiredPos);
        this.carFrame(line, race, 0, 0.7, 0, this.desiredLook);
        fov = 45;
        break;
      }
      default: // chase
        this.carFrame(line, race, 0, 2.2, 6.8, this.desiredPos);
        this.lookAhead(line, race, 16, 1.0, steer * 0.12, this.desiredLook);
    }

    // Smooth the camera's offset from the car (not its world position), so it never falls
    // behind at speed but still glides between shots.
    this.carFrame(line, race, 0, 0, 0, this.anchor);
    this.desiredPos.sub(this.anchor);
    this.desiredLook.sub(this.anchor);
    if (!this.initialised) {
      this.pos.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.initialised = true;
    }
    for (const k of ['x', 'y', 'z']) {
      this.pos[k] = damp(this.pos[k], this.desiredPos[k], lambda, dt);
      this.look[k] = damp(this.look[k], this.desiredLook[k], lambda * 1.4, dt);
    }
    cam.position.copy(this.pos).add(this.anchor);
    this.lookWorld.copy(this.look).add(this.anchor);
    if (!reducedMotion && this.shake > 0.001) {
      const s = this.shake * 0.12;
      cam.position.x += Math.sin(race.time * 91) * s;
      cam.position.y += Math.cos(race.time * 77) * s;
    }
    this.shake *= Math.exp(-6 * dt);
    cam.lookAt(this.lookWorld);
    cam.fov = damp(cam.fov, reducedMotion ? Math.min(fov, 66) : fov, 4, dt);
    cam.updateProjectionMatrix();
  }
}
