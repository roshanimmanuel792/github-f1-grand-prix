import { CENTER_LANE, LANES, isBlocked } from './obstacles.js';

const MAX_MANEUVER_S = 0.9;
const MIN_COMFORT_S = 0.12;
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Autonomous driver. Watches the next obstacle row inside its detection distance, steers
 * to the planner's lane for that row with a smooth, time-boxed manoeuvre that always
 * finishes before the row, holds its line while alongside an obstacle, and drifts back
 * to the centre racing line when nothing is in range.
 */
export class AutonomousDriver {
  /**
   * @param {object} o
   * @param {object[]} o.rows obstacle rows
   * @param {number[]} o.plan planned lane per row
   * @param {Float64Array} o.rowZ world z of each row
   * @param {number} o.lookahead detection distance (world units)
   * @param {number} o.margin half-length of the car/obstacle overlap zone (world units)
   * @param {number} o.planningSpeed upper bound on car speed, so time-to-go is never overestimated
   * @param {(d: object) => void} [o.log] debug decision log
   */
  constructor(o) {
    Object.assign(this, o);
    this.reset();
  }

  reset(rowIndex = 0, lane = CENTER_LANE) {
    this.next = rowIndex;
    this.targetLane = lane;
    this.x = LANES[lane];
    this.steer = 0;
    this.from = this.x;
    this.to = this.x;
    this.t = 0;
    this.duration = 0;
    this.emergencies = 0;
    this.rate = 0;
    this.brakeFor = 0;
  }

  get maneuvering() {
    return this.t < this.duration;
  }

  update(dt, carZ) {
    const { rows, rowZ, margin } = this;
    while (this.next < rows.length && rowZ[this.next] + margin < carZ) this.next++;

    let target = CENTER_LANE;
    let distance = Infinity;
    if (this.next < rows.length) {
      distance = rowZ[this.next] - carZ;
      if (distance < margin) target = this.targetLane; // alongside the obstacle: hold the line
      else if (distance <= this.lookahead) target = this.safeLane(this.next, this.plan[this.next]);
    }
    if (target !== this.targetLane) this.beginManeuver(target, distance);

    const prevX = this.x;
    if (this.t < this.duration) {
      this.t = Math.min(this.duration, this.t + dt);
      this.x = this.from + (this.to - this.from) * smoothstep(this.t / this.duration);
    }
    this.rate = dt > 0 ? (this.x - prevX) / dt : 0;
    this.steer += (Math.max(-1, Math.min(1, this.rate / 2.2)) - this.steer) * Math.min(1, dt * 12);
    this.brakeFor = Math.max(0, this.brakeFor - dt);
  }

  /**
   * Steering command that makes the shared car physics follow this driver's reference line:
   * feedforward of the line's rate + curvature compensation + position feedback, looking one
   * grip time-constant ahead to cancel the physics' response lag.
   */
  steerFor(car, authority, curve, centrifugal, grip, v01) {
    if (authority <= 0) return 0;
    const lag = 1 / grip;
    const xAhead = this.x + this.rate * lag;
    const desired = this.rate + 14 * (xAhead - car.x - car.vLat * lag * 0.5) + centrifugal * curve * v01 * v01;
    return Math.max(-1, Math.min(1, desired / authority));
  }

  beginManeuver(lane, distance) {
    const timeToGo = (distance - this.margin) / this.planningSpeed;
    let duration = Math.min(MAX_MANEUVER_S, timeToGo * 0.75);
    if (duration < MIN_COMFORT_S) {
      duration = Math.max(0.05, timeToGo * 0.9);
      this.emergencies++;
      this.brakeFor = 0.25; // tight manoeuvre: scrub speed while turning in
    }
    this.log?.({
      type: 'lane-change',
      row: this.next,
      date: this.rows[this.next]?.date,
      from: this.targetLane,
      to: lane,
      reason: distance === Infinity || distance > this.lookahead ? 'return to racing line' : `obstacle in ${Math.round(distance)}u`,
      duration: +duration.toFixed(3),
    });
    this.targetLane = lane;
    this.from = this.x;
    this.to = LANES[lane];
    this.t = 0;
    this.duration = duration;
  }

  /** Safety controller: never target a blocked lane, even if the plan says so. */
  safeLane(rowIndex, lane) {
    const row = this.rows[rowIndex];
    if (!isBlocked(row, lane)) return lane;
    const free = [0, 1, 2].filter((l) => !isBlocked(row, l));
    const nearest = free.reduce((b, l) => (Math.abs(LANES[l] - this.x) < Math.abs(LANES[b] - this.x) ? l : b), free[0]);
    this.log?.({ type: 'safety-override', row: rowIndex, planned: lane, chosen: nearest });
    return nearest;
  }
}
