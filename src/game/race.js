import { hashString } from '../data/dataset.js';
import { AutonomousDriver } from './driver.js';
import { LANES, generateObstacleRows } from './obstacles.js';
import { PHYSICS, createCar, steeringAuthority, stepCar } from './physics.js';
import { planRoute } from './planner.js';
import { DAY_LENGTH, LEAD_IN_SEGMENTS, SEGMENT_LENGTH, SEGMENTS_PER_DAY, START_SEGMENT, buildTrack } from './track.js';

export const STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  RACING: 'racing',
  PAUSED: 'paused',
  FINISHED: 'finished',
  ERROR: 'error',
});

export const MODES = Object.freeze({ AI: 'ai', MANUAL: 'manual' });

/** Digital control bits (keyboard / touch); recorded per step for manual replays. */
export const INPUT = Object.freeze({ THROTTLE: 1, BRAKE: 2, LEFT: 4, RIGHT: 8, NITRO: 16 });

export const STEP = 1 / 120; // fixed simulation step: identical results at any refresh rate
export const STEPS_PER_SECOND = 120;
export const COUNTDOWN_SECONDS = 3.2;
export const CAR_HALF_WIDTH = 0.18; // road half-width units
export const OBSTACLE_HALF_WIDTH = 0.26;
export const ROW_MARGIN = SEGMENT_LENGTH * 1.5;
const MANUAL_STEER_SCALE = 0.6;
const CURVE_NORM = 1 / 5;

export const dayStartZ = (day) => (LEAD_IN_SEGMENTS + day * SEGMENTS_PER_DAY) * SEGMENT_LENGTH;

/**
 * Deterministic race simulation (no DOM). Each calendar day is one stretch of track; the
 * official score only ever grows by a day's exact contribution count when the car
 * finishes that day's stretch. Manual and autonomous driving share the same physics,
 * obstacles, collision checks and scoring.
 */
export class Race {
  constructor(dataset, config, { onEvent, log, mode = MODES.AI, inputs = null } = {}) {
    this.dataset = dataset;
    this.config = config;
    this.mode = mode;
    this.replayInputs = inputs; // [[step, bits], ...] → replays a recorded manual race
    this.days = dataset.days;
    this.totalDays = this.days.length;
    this.totalContributions = dataset.totalContributions;
    this.nitroThresholds = config.nitroThresholds;
    this.secondsPerDay = Math.max(config.minSecondsPerDay, config.raceDurationSeconds / this.totalDays);
    this.cruiseSpeed = DAY_LENGTH / this.secondsPerDay;
    this.onEvent = onEvent ?? (() => {});
    this.seed = hashString(`${dataset.username.toLowerCase()}:${dataset.year}`);
    this.track = buildTrack(this.totalDays, this.seed);
    this.rows = generateObstacleRows(this.days, config.obstacleThresholds);
    this.rowZ = Float64Array.from(this.rows, (r) => dayStartZ(r.dayIndex) + DAY_LENGTH / 2);
    this.rowBySegment = new Int32Array(this.track.count).fill(-1);
    this.rows.forEach((_, i) => (this.rowBySegment[Math.floor(this.rowZ[i] / SEGMENT_LENGTH)] = i));
    this.plan = planRoute(this.rows, log);
    this.driver = new AutonomousDriver({
      rows: this.rows,
      plan: this.plan,
      rowZ: this.rowZ,
      lookahead: config.aiLookaheadDays * DAY_LENGTH,
      margin: ROW_MARGIN,
      planningSpeed: this.cruiseSpeed,
      log,
    });
    this.finishZ = dayStartZ(this.totalDays);
    this.rowHit = new Uint8Array(this.rows.length);
    this.input = { throttle: 0, brake: 0, steer: 0, nitro: false };
    this.reset();
  }

  reset() {
    this.state = STATES.READY;
    this.z = START_SEGMENT * SEGMENT_LENGTH;
    this.car = createCar();
    this.score = 0;
    this.completedDays = 0;
    this.nextRow = 0;
    this.collisions = 0;
    this.wallHits = 0;
    this.passed = 0;
    this.countdown = 0;
    this.time = 0;
    this.finishedAt = null;
    this.acc = 0;
    this.stepCount = 0;
    this.liveBits = 0;
    this.lastBits = -1;
    this.inputLog = [];
    this.replayCursor = 0;
    this.manualSteer = 0;
    this.nitroTank = 1;
    this.nitroActive = false;
    this.rowHit.fill(0);
    this.driver.reset();
  }

  get speed() {
    return this.car.speed;
  }

  start() {
    if (this.state !== STATES.READY) return;
    this.state = STATES.RACING;
    this.countdown = COUNTDOWN_SECONDS;
    this.onEvent('start');
  }

  togglePause() {
    if (this.state === STATES.RACING) this.state = STATES.PAUSED;
    else if (this.state === STATES.PAUSED) this.state = STATES.RACING;
  }

  /** Live manual controls (ignored for AI races and recorded replays). */
  setInput(bits) {
    this.liveBits = bits;
  }

  /** Advance by real elapsed time; long frames (tab switches) are capped. */
  update(dt) {
    if (this.state !== STATES.RACING && this.state !== STATES.FINISHED) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
  }

  /** Advance an exact number of fixed steps (replay / export). */
  advanceSteps(n) {
    for (let i = 0; i < n && (this.state === STATES.RACING || this.state === STATES.FINISHED); i++) this.step(STEP);
  }

  currentBits() {
    if (!this.replayInputs) return this.liveBits;
    const log = this.replayInputs;
    while (this.replayCursor < log.length && log[this.replayCursor][0] <= this.stepCount) this.replayCursor++;
    return this.replayCursor ? log[this.replayCursor - 1][1] : 0;
  }

  /** Controls for this step, from the player (manual) or the autonomous driver (AI). */
  controls(h, curve) {
    const racing = this.state === STATES.RACING;
    const input = this.input;
    if (this.mode === MODES.MANUAL) {
      const bits = this.currentBits();
      if (!this.replayInputs && bits !== this.lastBits) this.inputLog.push([this.stepCount, bits]);
      this.lastBits = bits;
      const target = (bits & INPUT.LEFT ? -1 : 0) + (bits & INPUT.RIGHT ? 1 : 0);
      const rate = target === 0 ? 9 : 6;
      this.manualSteer += Math.max(-rate * h, Math.min(rate * h, target - this.manualSteer));
      this.nitroActive = racing && Boolean(bits & INPUT.NITRO) && this.nitroTank > 0;
      this.nitroTank = Math.min(1, Math.max(0, this.nitroTank + (this.nitroActive ? -0.3 : 0.05) * h));
      input.throttle = racing && bits & INPUT.THROTTLE ? 1 : 0;
      input.brake = !racing ? 1 : bits & INPUT.BRAKE ? 1 : 0;
      input.steer = this.manualSteer * MANUAL_STEER_SCALE;
      input.nitro = this.nitroActive;
      return input;
    }
    this.driver.update(h, this.z);
    const v01 = this.car.speed / this.cruiseSpeed;
    input.throttle = racing && this.driver.brakeFor <= 0 ? 1 : 0;
    input.brake = !racing ? 1 : this.driver.brakeFor > 0 ? 0.5 : 0;
    input.steer = this.driver.steerFor(this.car, steeringAuthority(this.car, this.cruiseSpeed), curve, PHYSICS.centrifugal, PHYSICS.grip, v01);
    input.nitro = false; // AI nitro is visual only (nitroLevel)
    return input;
  }

  step(h) {
    this.time += h;
    if (this.countdown > 0) {
      this.countdown -= h;
      this.stepCount++;
      if (this.mode === MODES.MANUAL) this.controls(h, 0); // record inputs held on the grid
      if (this.countdown <= 0) this.onEvent('go');
      return;
    }
    const seg = Math.min(this.track.count - 1, Math.floor(this.z / SEGMENT_LENGTH));
    const curve = this.track.curve[seg] * CURVE_NORM;
    const input = this.controls(h, curve);
    if (stepCar(this.car, input, h, this.cruiseSpeed, curve)) {
      this.wallHits++;
      this.onEvent('wall', this.car.x);
    }
    this.z += this.car.speed * h;
    this.stepCount++;

    while (this.nextRow < this.rows.length && this.rowZ[this.nextRow] <= this.z) {
      const row = this.rows[this.nextRow];
      const hitLane = row.blocked.find((l) => Math.abs(this.car.x - LANES[l]) < CAR_HALF_WIDTH + OBSTACLE_HALF_WIDTH);
      if (hitLane !== undefined) {
        this.collisions++;
        this.rowHit[this.nextRow] = 1;
        this.car.speed *= PHYSICS.collisionSpeed;
        this.car.vLat += Math.sign(this.car.x - LANES[hitLane] || 1) * 2; // knocked aside, keeps going
        this.onEvent('collision', row);
      } else this.passed++;
      this.onEvent('pass', row);
      this.nextRow++;
    }

    while (this.completedDays < this.totalDays && this.z >= dayStartZ(this.completedDays + 1)) {
      const day = this.days[this.completedDays];
      this.score += day.contributions;
      this.completedDays++;
      if (day.contributions >= this.nitroThresholds[0]) this.nitroTank = Math.min(1, this.nitroTank + 0.35);
      this.onEvent('day', day);
    }

    if (this.state === STATES.RACING && this.completedDays === this.totalDays) {
      this.state = STATES.FINISHED;
      this.finishedAt = this.time;
      this.onEvent('finish');
    }
  }

  get currentDayIndex() {
    return Math.min(this.completedDays, this.totalDays - 1);
  }

  get currentDay() {
    return this.days[this.currentDayIndex];
  }

  get progress() {
    return this.completedDays / this.totalDays;
  }

  /** 0-3 visual nitro intensity. Never affects the score. */
  get nitroLevel() {
    if (this.state !== STATES.RACING || this.countdown > 0) return 0;
    const level = this.nitroThresholds.filter((t) => this.currentDay.contributions >= t).length;
    return this.mode === MODES.MANUAL ? (this.nitroActive ? Math.max(1, level) : 0) : level;
  }

  get lightsOn() {
    if (this.countdown <= 0) return 0;
    return Math.min(5, Math.floor((COUNTDOWN_SECONDS - this.countdown) / 0.5));
  }

  /** Jump to the start of a day mid-race (used by preview capture). Score stays exact. */
  seekDay(day) {
    day = Math.max(0, Math.min(this.totalDays - 1, day));
    this.reset();
    this.state = STATES.RACING;
    this.z = dayStartZ(day);
    this.car.speed = this.cruiseSpeed;
    this.completedDays = day;
    for (let i = 0; i < day; i++) this.score += this.days[i].contributions;
    while (this.nextRow < this.rows.length && this.rowZ[this.nextRow] <= this.z) this.nextRow++;
    this.passed = this.nextRow;
    const lane = this.nextRow ? this.plan[this.nextRow - 1] : 1;
    this.driver.reset(this.nextRow, lane);
    this.car.x = LANES[lane];
  }
}
