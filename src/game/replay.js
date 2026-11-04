import { hashString } from '../data/dataset.js';
import { MODES, Race, STATES, STEPS_PER_SECOND } from './race.js';

export const REPLAY_VERSION = 1;
export const DEFAULT_REPLAY_SPEED = 2;
const SIM_KEYS = ['raceDurationSeconds', 'minSecondsPerDay', 'aiLookaheadDays', 'obstacleThresholds', 'nitroThresholds'];
// Seconds of coasting/celebration recorded after the chequered flag.
export const FINISH_TAIL_SECONDS = 4;

export const datasetDigest = (dataset) => hashString(`${dataset.username.toLowerCase()}|${dataset.year}|${dataset.days.map((d) => d.contributions).join(',')}`);

/**
 * A replay is everything needed to re-simulate a race exactly: dataset identity, the
 * simulation config, the driving mode and (for manual races) the recorded input timeline.
 * The simulation is fixed-step, so the same replay always reproduces the same race.
 */
export function createReplay(race) {
  return {
    version: REPLAY_VERSION,
    username: race.dataset.username,
    year: race.dataset.year,
    digest: datasetDigest(race.dataset),
    mode: race.mode,
    config: Object.fromEntries(SIM_KEYS.map((k) => [k, race.config[k]])),
    inputs: race.mode === MODES.MANUAL ? race.inputLog.map(([s, b]) => [s, b]) : [],
    result: { score: race.score, completedDays: race.completedDays, collisions: race.collisions, steps: race.stepCount },
  };
}

export function validateReplay(replay, dataset) {
  if (!replay || replay.version !== REPLAY_VERSION) throw new Error('Unsupported replay version.');
  if (replay.digest !== datasetDigest(dataset)) throw new Error('Replay does not match this contribution dataset.');
  if (!Object.values(MODES).includes(replay.mode)) throw new Error('Unknown replay mode.');
  let last = -1;
  for (const entry of replay.inputs) {
    if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < last || !Number.isInteger(entry[1])) throw new Error('Corrupt input timeline.');
    last = entry[0];
  }
  return replay;
}

/** Fresh race that will re-play `replay` deterministically. */
export function raceFromReplay(replay, dataset, baseConfig, opts = {}) {
  validateReplay(replay, dataset);
  const race = new Race(dataset, { ...baseConfig, ...replay.config }, { ...opts, mode: replay.mode, inputs: replay.mode === MODES.MANUAL ? replay.inputs : null });
  race.start();
  return race;
}

/**
 * Frame clock for playback/export: each output frame advances `speed / fps` seconds of
 * simulation (2x = twice as much race time per frame, not skipped frames). Steps are
 * accumulated in integers so frame timing never drifts.
 */
export class ReplayClock {
  constructor(race, { fps = 30, speed = DEFAULT_REPLAY_SPEED, tailSeconds = FINISH_TAIL_SECONDS } = {}) {
    this.race = race;
    this.fps = fps;
    this.speed = speed;
    this.tailSteps = Math.round(tailSeconds * STEPS_PER_SECOND);
    this.frame = 0;
    this.stepsDone = 0;
  }

  /** Steps the simulation must have taken by output frame n. */
  stepsAt(frame) {
    return Math.round((frame * this.speed * STEPS_PER_SECOND) / this.fps);
  }

  get done() {
    const r = this.race;
    return r.state === STATES.FINISHED && r.time - r.finishedAt >= this.tailSteps / STEPS_PER_SECOND;
  }

  /** Advance to the next output frame. Returns its timestamp in seconds of output video. */
  next() {
    this.frame++;
    const target = this.stepsAt(this.frame);
    this.race.advanceSteps(target - this.stepsDone);
    this.stepsDone = target;
    return (this.frame - 1) / this.fps;
  }

  /** Upper bound on total frames (for progress bars), from the race's planned duration. */
  estimateFrames() {
    const r = this.race;
    // countdown + launch + lead-in + season + coast-down tail, with headroom for slow manual laps
    const simSeconds = 3.2 + 3 + r.secondsPerDay * (r.totalDays + 4) + this.tailSteps / STEPS_PER_SECOND;
    return Math.ceil((simSeconds * this.fps) / this.speed);
  }
}
