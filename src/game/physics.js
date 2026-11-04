// Arcade car physics in track coordinates (distance along the centreline + lateral offset in
// road half-widths). Shared by manual and autonomous driving; deterministic per fixed step.

export const PHYSICS = Object.freeze({
  accelTime: 1.6, // s from standstill to cruise at full throttle
  brakeTime: 1.0, // s from cruise to standstill at full brake
  coastDecel: 0.12, // fraction of cruise lost per second off the throttle
  nitroBoost: 1.22, // top-speed multiplier while nitro is active (manual)
  maxLatRate: 9, // lateral authority at cruise (road half-widths / s)
  grip: 30, // lateral response rate (1/s); lower = more slide
  centrifugal: 1.1, // outward drift per unit curvature at cruise (half-widths / s)
  kerb: 1.0, // lateral position where the kerb starts
  grass: 1.08, // beyond this the car is on grass
  wall: 1.32, // barrier position
  grassSpeed: 0.55, // top-speed multiplier on grass
  collisionSpeed: 0.45, // speed multiplier after hitting an obstacle
});

export const createCar = (x = 0) => ({ x, vLat: 0, speed: 0, slip: 0, steer: 0, onGrass: false, atWall: false });

/**
 * Advance the car one step.
 * @param {object} car mutable car state
 * @param {{throttle:number, brake:number, steer:number, nitro:boolean}} input analog controls
 * @param {number} h step (s)
 * @param {number} cruise cruise speed (world units / s)
 * @param {number} curve normalised road curvature under the car (-1..1, + = right-hand bend)
 * @returns {boolean} true if the car hit the barrier this step
 */
export function stepCar(car, input, h, cruise, curve) {
  const P = PHYSICS;
  car.onGrass = Math.abs(car.x) > P.grass;
  const top = cruise * (input.nitro ? P.nitroBoost : 1) * (car.onGrass ? P.grassSpeed : 1);
  if (input.throttle > 0 && car.speed < top) car.speed = Math.min(top, car.speed + ((input.throttle * cruise) / P.accelTime) * h);
  else if (car.speed > top) car.speed -= (car.speed - top) * 2 * h;
  else if (input.throttle <= 0) car.speed -= P.coastDecel * cruise * h;
  car.speed = Math.max(0, car.speed - ((input.brake * cruise) / P.brakeTime) * h);

  const v01 = car.speed / cruise;
  const authority = P.maxLatRate * Math.min(1.1, v01); // no sideways motion when stopped
  const desired = input.steer * authority - P.centrifugal * curve * v01 * v01;
  const grip = P.grip * (1 - 0.5 * Math.max(0, Math.abs(input.steer) * v01 - 0.7)); // hard steering at speed slides
  car.vLat += (desired - car.vLat) * Math.min(1, grip * h);
  car.x += car.vLat * h;
  car.steer = input.steer;
  car.slip = Math.abs(desired - car.vLat) / P.maxLatRate + (input.brake > 0.5 && v01 > 0.5 ? 0.5 : 0) + (car.onGrass ? 0.3 * v01 : 0);

  const hit = Math.abs(car.x) > P.wall;
  if (hit) {
    const side = Math.sign(car.x);
    car.x = side * P.wall;
    car.vLat = -side * Math.abs(car.vLat) * 0.25;
    if (!car.atWall) car.speed *= 0.8;
  }
  const firstContact = hit && !car.atWall;
  car.atWall = hit;
  return firstContact;
}

/** Lateral authority available at the current speed (used by the AI's steering controller). */
export const steeringAuthority = (car, cruise) => PHYSICS.maxLatRate * Math.min(1.1, car.speed / cruise);
