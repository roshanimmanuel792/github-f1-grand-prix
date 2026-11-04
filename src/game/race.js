import { hashString } from '../data/dataset.js';
import { AutonomousDriver } from './driver.js';
import { LANES, generateObstacleRows } from './obstacles.js';
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

export const STEP = 1 / 120; // fixed simulation step: identical results at any refresh rate
export const COUNTDOWN_SECONDS = 3.2;
export const CAR_HALF_WIDTH = 0.18; // road half-width units
export const OBSTACLE_HALF_WIDTH = 0.26;
export const ROW_MARGIN = SEGMENT_LENGTH * 1.5;

export const dayStartZ = (day) => (LEAD_IN_SEGMENTS + day * SEGMENTS_PER_DAY) * SEGMENT_LENGTH;

/**
 * Deterministic race simulation (no DOM). Each calendar day is one stretch of track; the
 * official score only ever grows by a day's exact contribution count when the car
 * finishes that day's stretch.
 */
export class Race {
  constructor(dataset, config, { onEvent, log } = {}) {
    this.dataset = dataset;
    this.days = dataset.days;
    this.totalDays = this.days.length;
    this.totalContributions = dataset.totalContributions;
    this.nitroThresholds = config.nitroThresholds;
    this.secondsPerDay = Math.max(config.minSecondsPerDay, config.raceDurationSeconds / this.totalDays);
    this.cruiseSpeed = DAY_LENGTH / this.secondsPerDay;
    this.onEvent = onEvent ?? (() => {});
    this.track = buildTrack(this.totalDays, hashString(`${dataset.username}:${dataset.year}`));
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
    this.reset();
  }

  reset() {
    this.state = STATES.READY;
    this.z = START_SEGMENT * SEGMENT_LENGTH;
    this.speed = 0;
    this.score = 0;
    this.completedDays = 0;
    this.nextRow = 0;
    this.collisions = 0;
    this.passed = 0;
    this.countdown = 0;
    this.time = 0;
    this.finishedAt = null;
    this.acc = 0;
    this.driver.reset();
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

  /** Advance by real elapsed time; long frames (tab switches) are capped. */
  update(dt) {
    if (this.state !== STATES.RACING && this.state !== STATES.FINISHED) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
  }

  step(h) {
    this.time += h;
    if (this.countdown > 0) {
      this.countdown -= h;
      if (this.countdown <= 0) this.onEvent('go');
      return;
    }
    const racing = this.state === STATES.RACING;
    this.speed = racing
      ? Math.min(this.cruiseSpeed, this.speed + (this.cruiseSpeed / 1.5) * h)
      : Math.max(0, this.speed - (this.cruiseSpeed / 2.5) * h);
    this.z += this.speed * h;
    this.driver.update(h, this.z);

    while (this.nextRow < this.rows.length && this.rowZ[this.nextRow] <= this.z) {
      const row = this.rows[this.nextRow];
      const hit = row.blocked.some((l) => Math.abs(this.driver.x - LANES[l]) < CAR_HALF_WIDTH + OBSTACLE_HALF_WIDTH);
      if (hit) {
        this.collisions++;
        this.onEvent('collision', row);
      } else this.passed++;
      this.onEvent('pass', row);
      this.nextRow++;
    }

    while (this.completedDays < this.totalDays && this.z >= dayStartZ(this.completedDays + 1)) {
      const day = this.days[this.completedDays];
      this.score += day.contributions;
      this.completedDays++;
      this.onEvent('day', day);
    }

    if (racing && this.completedDays === this.totalDays) {
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

  /** 0-3 visual nitro intensity for the day being driven. Never affects the score. */
  get nitroLevel() {
    if (this.state !== STATES.RACING || this.countdown > 0) return 0;
    const c = this.currentDay.contributions;
    return this.nitroThresholds.filter((t) => c >= t).length;
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
    this.speed = this.cruiseSpeed;
    this.completedDays = day;
    for (let i = 0; i < day; i++) this.score += this.days[i].contributions;
    while (this.nextRow < this.rows.length && this.rowZ[this.nextRow] <= this.z) this.nextRow++;
    this.passed = this.nextRow;
    this.driver.reset(this.nextRow, this.nextRow ? this.plan[this.nextRow - 1] : 1);
  }
}
