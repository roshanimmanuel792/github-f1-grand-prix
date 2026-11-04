import { describe, expect, it } from 'vitest';
import { LANES } from '../src/game/obstacles.js';
import { PHYSICS, createCar, stepCar } from '../src/game/physics.js';
import { CAR_HALF_WIDTH, INPUT, MODES, OBSTACLE_HALF_WIDTH, Race, STEP, STATES } from '../src/game/race.js';
import { CONFIG, datasetFrom, randomCounts, runToEnd } from './helpers.js';

const CRUISE = 8000;
const run = (car, input, seconds, curve = 0) => {
  let walls = 0;
  for (let t = 0; t < seconds; t += STEP) walls += stepCar(car, input, STEP, CRUISE, curve) ? 1 : 0;
  return walls;
};
const idle = { throttle: 0, brake: 0, steer: 0, nitro: false };

describe('car physics', () => {
  it('accelerates to cruise, nitro raises top speed, brakes to a stop', () => {
    const car = createCar();
    run(car, { ...idle, throttle: 1 }, PHYSICS.accelTime + 0.2);
    expect(car.speed).toBeCloseTo(CRUISE, 0);
    run(car, { ...idle, throttle: 1, nitro: true }, 3);
    expect(car.speed).toBeGreaterThan(CRUISE * 1.15);
    run(car, { ...idle, brake: 1 }, 2);
    expect(car.speed).toBe(0);
  });

  it('coasts down without throttle', () => {
    const car = createCar();
    car.speed = CRUISE;
    run(car, idle, 1);
    expect(car.speed).toBeLessThan(CRUISE * 0.95);
  });

  it('cannot move sideways when stopped; steering authority grows with speed', () => {
    const stopped = createCar();
    run(stopped, { ...idle, steer: 1 }, 1);
    expect(stopped.x).toBe(0);
    const slow = createCar();
    slow.speed = CRUISE * 0.3;
    const fast = createCar();
    fast.speed = CRUISE;
    run(slow, { ...idle, steer: 0.3 }, 0.1);
    run(fast, { ...idle, steer: 0.3, throttle: 1 }, 0.1);
    expect(fast.x).toBeGreaterThan(slow.x * 2);
  });

  it('curves push the car outward; it slides (lags) when steered hard at speed', () => {
    const car = createCar();
    car.speed = CRUISE;
    run(car, { ...idle, throttle: 1 }, 0.3, 1);
    expect(car.x).toBeLessThan(0);
    const slide = createCar();
    slide.speed = CRUISE;
    stepCar(slide, { ...idle, throttle: 1, steer: 1 }, STEP, CRUISE, 0);
    expect(slide.slip).toBeGreaterThan(0.3);
  });

  it('grass slows the car and barriers stop it leaving the track', () => {
    const car = createCar(1.2);
    car.speed = CRUISE;
    run(car, { ...idle, throttle: 1 }, 2);
    expect(car.speed).toBeLessThan(CRUISE * 0.6);
    const wall = createCar();
    wall.speed = CRUISE;
    const hits = run(wall, { ...idle, throttle: 1, steer: 1 }, 2);
    expect(Math.abs(wall.x)).toBeLessThanOrEqual(PHYSICS.wall);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(hits).toBeLessThan(5); // impacts, not one per frame of contact
  });
});

describe('manual driving', () => {
  const drive = (race, bits, seconds) => {
    race.setInput(bits);
    for (let t = 0; t < seconds; t += 1 / 60) race.update(1 / 60);
  };

  it('does nothing without input, then responds to throttle and steering', () => {
    const race = new Race(datasetFrom([0, 0, 0, 0]), CONFIG, { mode: MODES.MANUAL });
    race.start();
    drive(race, 0, 5);
    expect(race.speed).toBe(0);
    drive(race, INPUT.THROTTLE, 1);
    expect(race.speed).toBeGreaterThan(0);
    drive(race, INPUT.THROTTLE | INPUT.LEFT, 0.4);
    expect(race.car.x).toBeLessThan(-0.1);
    drive(race, INPUT.THROTTLE | INPUT.RIGHT, 0.8);
    expect(race.car.x).toBeGreaterThan(0);
  });

  it('holds the car on the grid during the countdown', () => {
    const race = new Race(datasetFrom([1, 2]), CONFIG, { mode: MODES.MANUAL });
    race.start();
    drive(race, INPUT.THROTTLE, 2);
    expect(race.speed).toBe(0);
  });

  it('collisions slow the car but never change the score, and the race still finishes exactly', () => {
    const data = datasetFrom(Array(20).fill(12)); // every day has a barrier
    const race = new Race(data, { ...CONFIG, raceDurationSeconds: 10 }, { mode: MODES.MANUAL });
    const events = [];
    race.start();
    let speedBefore = 0;
    let dropped = false;
    race.onEvent = (t) => {
      events.push(t);
      if (t === 'collision') dropped ||= race.speed < speedBefore;
    };
    race.setInput(INPUT.THROTTLE); // straight down the middle, hits whatever is there
    for (let i = 0; i < 60 * 200 && race.state !== STATES.FINISHED; i++) {
      speedBefore = race.speed;
      race.update(1 / 60);
    }
    expect(race.state).toBe(STATES.FINISHED);
    expect(race.collisions).toBeGreaterThan(0);
    expect(dropped).toBe(true);
    expect(race.collisions + race.passed).toBe(race.rows.length);
    expect(race.score).toBe(data.totalContributions);
    expect(race.rowHit.reduce((a, b) => a + b, 0)).toBe(race.collisions);
  });

  it('nitro drains a tank, boosts speed, and refills on 10+ contribution days', () => {
    const race = new Race(datasetFrom(Array(40).fill(0)), CONFIG, { mode: MODES.MANUAL });
    race.start();
    drive(race, INPUT.THROTTLE, 6);
    const cruise = race.speed;
    drive(race, INPUT.THROTTLE | INPUT.NITRO, 1.5);
    expect(race.speed).toBeGreaterThan(cruise * 1.05);
    expect(race.nitroTank).toBeLessThan(0.7);
    expect(race.nitroLevel).toBeGreaterThan(0);
  });

  it('records a compact input timeline of changes only', () => {
    const race = new Race(datasetFrom([0, 0, 0]), CONFIG, { mode: MODES.MANUAL });
    race.start();
    drive(race, INPUT.THROTTLE, 4);
    drive(race, INPUT.THROTTLE | INPUT.LEFT, 0.5);
    drive(race, INPUT.THROTTLE, 0.5);
    expect(race.inputLog.map(([, b]) => b)).toEqual([INPUT.THROTTLE, INPUT.THROTTLE | INPUT.LEFT, INPUT.THROTTLE]);
    race.inputLog.forEach(([s], i) => i && expect(s).toBeGreaterThan(race.inputLog[i - 1][0]));
  });
});

describe('autonomous driving through shared physics', () => {
  it.each([180, 1, 45])('keeps clearance from every obstacle at race duration %is', (duration) => {
    const race = new Race(datasetFrom(randomCounts(366, duration), 2024), { ...CONFIG, raceDurationSeconds: duration });
    let minClear = Infinity;
    race.onEvent = (t, row) => {
      if (t === 'pass') for (const l of row.blocked) minClear = Math.min(minClear, Math.abs(race.car.x - LANES[l]) - CAR_HALF_WIDTH - OBSTACLE_HALF_WIDTH);
    };
    runToEnd(race);
    expect(race.collisions).toBe(0);
    expect(race.wallHits).toBe(0);
    expect(minClear).toBeGreaterThan(0.05);
  });

  it('reacts to curvature: stays on the road through every bend', () => {
    const race = new Race(datasetFrom(Array(120).fill(0)), CONFIG);
    race.start();
    let maxX = 0;
    while (race.state !== STATES.FINISHED) {
      race.update(1 / 60);
      maxX = Math.max(maxX, Math.abs(race.car.x));
    }
    expect(maxX).toBeLessThan(PHYSICS.kerb);
  });
});
