import { describe, expect, it } from 'vitest';
import { Race, STEP, dayStartZ } from '../src/game/race.js';
import { CONFIG, datasetFrom, randomCounts, runToEnd } from './helpers.js';

describe('scoring', () => {
  it('adds each day exactly once, only after the day is completed', () => {
    const race = new Race(datasetFrom([0, 2, 4, 8]), CONFIG);
    const scores = [];
    race.onEvent = (type) => type === 'day' && scores.push(race.score);
    race.start();
    // still inside day 0's stretch: nothing scored yet
    while (race.z < dayStartZ(0) + 100) race.update(1 / 60);
    expect(race.score).toBe(0);
    runToEnd(race);
    expect(scores).toEqual([0, 2, 6, 14]);
    expect(race.score).toBe(14);
    expect(race.completedDays).toBe(4);
  });

  it('zero-contribution days still advance progress', () => {
    const race = new Race(datasetFrom([0, 0, 0, 0, 0]), CONFIG);
    runToEnd(race);
    expect(race.score).toBe(0);
    expect(race.completedDays).toBe(5);
    expect(race.progress).toBe(1);
    expect(race.rows).toHaveLength(0);
  });

  it('final score equals the dataset total for a full year', () => {
    const data = datasetFrom(randomCounts(366, 7), 2024);
    const race = new Race(data, { ...CONFIG, raceDurationSeconds: 60 });
    runToEnd(race);
    expect(race.score).toBe(data.totalContributions);
    expect(race.completedDays).toBe(366);
  });

  it('is identical at different frame rates (fixed-step simulation)', () => {
    const data = datasetFrom(randomCounts(40, 3));
    const a = new Race(data, CONFIG);
    const b = new Race(data, CONFIG);
    a.start();
    b.start();
    for (let i = 0; i < 600; i++) a.update(1 / 60);
    for (let i = 0; i < 1440; i++) b.update(1 / 144);
    // Float accumulators may differ by at most one fixed step.
    expect(Math.abs(b.z - a.z)).toBeLessThanOrEqual(a.cruiseSpeed * STEP);
    expect(b.score).toBe(a.score);
    expect(b.driver.x).toBeCloseTo(a.driver.x, 1);
  });

  it('restart resets score and progress', () => {
    const race = new Race(datasetFrom([5, 5, 5]), CONFIG);
    runToEnd(race);
    expect(race.score).toBe(15);
    race.reset();
    expect(race).toMatchObject({ state: 'ready', score: 0, completedDays: 0, nextRow: 0, collisions: 0 });
    runToEnd(race);
    expect(race.score).toBe(15);
  });

  it('seekDay keeps the score exact', () => {
    const data = datasetFrom([1, 2, 3, 4, 5, 6]);
    const race = new Race(data, CONFIG);
    race.seekDay(3);
    expect(race.score).toBe(6);
    while (race.state !== 'finished') race.update(1 / 60);
    expect(race.score).toBe(21);
  });
});
