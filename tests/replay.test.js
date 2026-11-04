import { describe, expect, it } from 'vitest';
import { INPUT, MODES, Race, STATES, STEPS_PER_SECOND } from '../src/game/race.js';
import { ReplayClock, createReplay, datasetDigest, raceFromReplay, validateReplay } from '../src/game/replay.js';
import { CONFIG, datasetFrom, randomCounts, runToEnd } from './helpers.js';

/** Drive a manual race with a scripted, frame-rate-independent "player". */
function playManual(data) {
  const race = atFinish(new Race(data, CONFIG, { mode: MODES.MANUAL }));
  race.start();
  let frame = 0;
  while (race.state !== STATES.FINISHED && frame < 60 * 600) {
    const weave = Math.floor(frame / 40) % 4;
    race.setInput(INPUT.THROTTLE | (weave === 1 ? INPUT.LEFT : weave === 3 ? INPUT.RIGHT : 0) | (frame % 300 < 30 ? INPUT.NITRO : 0));
    race.update(1 / 60);
    frame++;
  }
  return race;
}

const fingerprint = (race) => ({ score: race.score, completedDays: race.completedDays, collisions: race.collisions, passed: race.passed, z: race.z, x: race.car.x, steps: race.stepCount });

/** Capture the race state at the exact step the chequered flag falls. */
const atFinish = (race) => {
  const prev = race.onEvent;
  race.onEvent = (t, p) => {
    if (t === 'finish') race.finishPrint = fingerprint(race);
    prev(t, p);
  };
  return race;
};

describe('deterministic replay', () => {
  const data = datasetFrom(randomCounts(60, 21));

  it('re-simulates an autonomous race exactly', () => {
    const live = atFinish(new Race(data, CONFIG));
    runToEnd(live);
    const replay = JSON.parse(JSON.stringify(createReplay(live))); // survives serialization
    const again = atFinish(raceFromReplay(replay, data, CONFIG));
    while (again.state !== STATES.FINISHED) again.advanceSteps(1);
    expect(again.finishPrint).toEqual(live.finishPrint);
    expect(replay.result.score).toBe(data.totalContributions);
  });

  it('re-simulates a manual race exactly from its recorded inputs', () => {
    const live = playManual(data);
    expect(live.state).toBe(STATES.FINISHED);
    const replay = JSON.parse(JSON.stringify(createReplay(live)));
    expect(replay.inputs.length).toBeGreaterThan(10);
    const again = atFinish(raceFromReplay(replay, data, CONFIG));
    again.setInput(0); // live input must be ignored during replay
    while (again.state !== STATES.FINISHED) again.advanceSteps(1);
    expect(again.finishPrint).toEqual(live.finishPrint);
    expect(again.score).toBe(data.totalContributions);
  });

  it('rejects replays for a different dataset or with a corrupt timeline', () => {
    const live = new Race(data, CONFIG);
    runToEnd(live);
    const replay = createReplay(live);
    const other = datasetFrom(randomCounts(60, 22));
    expect(() => validateReplay(replay, other)).toThrow(/does not match/);
    expect(() => validateReplay({ ...replay, inputs: [[5, 1], [3, 0]] }, data)).toThrow(/Corrupt/);
    expect(datasetDigest(data)).not.toBe(datasetDigest(other));
  });

  it('2x clock advances twice the race time per frame with exact, monotonic timestamps', () => {
    const live = new Race(data, CONFIG);
    runToEnd(live);
    const race = raceFromReplay(createReplay(live), data, CONFIG);
    const clock = new ReplayClock(race, { fps: 30, speed: 2 });
    const stamps = [];
    while (!clock.done) stamps.push(clock.next());
    stamps.forEach((t, i) => expect(t).toBeCloseTo(i / 30, 9));
    // 2x: each second of output covers two seconds of simulation
    expect(race.stepCount).toBeGreaterThanOrEqual(clock.stepsAt(stamps.length) - 1);
    expect(clock.stepsAt(30)).toBe(2 * STEPS_PER_SECOND);
    const outputSeconds = stamps.length / 30;
    expect(outputSeconds).toBeCloseTo(race.time / 2, 0);
    expect(race.score).toBe(data.totalContributions); // whole season covered
    expect(stamps.length).toBeLessThanOrEqual(clock.estimateFrames());
  });
});
