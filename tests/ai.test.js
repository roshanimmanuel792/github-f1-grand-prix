import { describe, expect, it } from 'vitest';
import { AutonomousDriver } from '../src/game/driver.js';
import { LANES, generateObstacleRows } from '../src/game/obstacles.js';
import { greedyLanes, planLanes, planRoute } from '../src/game/planner.js';
import { Race } from '../src/game/race.js';
import { CONFIG, datasetFrom, randomCounts, runToEnd } from './helpers.js';

const row = (dayIndex, blocked) => ({ dayIndex, blocked, kind: 'block' });

describe('lane planner', () => {
  it('stays in the current lane when it is already safe', () => {
    expect(planLanes([row(0, [0]), row(1, [2])])).toEqual([1, 1]);
  });

  it('avoids occupied lanes with minimal steering', () => {
    expect(planLanes([row(0, [1])])[0]).not.toBe(1);
    expect(planLanes([row(0, [0, 1]), row(1, [0, 1])])).toEqual([2, 2]);
  });

  it('anticipates future obstacles (picks the side that stays open)', () => {
    // Day 0 centre blocked; day 1 left+centre blocked: going left first would need 2 lanes in one day.
    expect(planLanes([row(0, [1]), row(1, [0, 1])])).toEqual([2, 2]);
  });

  it('returns null when no route exists and the fallback still picks free lanes', () => {
    const impossible = [row(0, [1, 2]), row(1, [0, 1])];
    expect(planLanes(impossible)).toBeNull();
    const fallback = planRoute(impossible);
    expect(fallback).toEqual(greedyLanes(impossible));
    fallback.forEach((lane, i) => expect(impossible[i].blocked).not.toContain(lane));
  });

  it('finds a route for every generated year', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rows = generateObstacleRows(datasetFrom(randomCounts(365, seed), 2025).days, CONFIG.obstacleThresholds);
      const plan = planLanes(rows);
      expect(plan).not.toBeNull();
      plan.forEach((lane, i) => expect(rows[i].blocked).not.toContain(lane));
    }
  });
});

describe('autonomous driver', () => {
  const make = (rows, plan) =>
    new AutonomousDriver({ rows, plan, rowZ: Float64Array.from(rows, (_, i) => 4000 * (i + 1)), lookahead: 6000, margin: 300, planningSpeed: 8000 });

  it('detects an obstacle in range and changes lane smoothly before reaching it', () => {
    const d = make([row(0, [1])], [2]);
    const xs = [];
    let z = 0;
    while (z < 4000) {
      z += 8000 / 120;
      d.update(1 / 120, z);
      xs.push(d.x);
    }
    expect(d.x).toBeCloseTo(LANES[2], 5);
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    expect(Math.max(...steps)).toBeLessThan(0.05); // no teleporting
    expect(steps.every((s) => s >= -1e-9)).toBe(true); // no oscillation
  });

  it('does not steer when nothing is in detection range', () => {
    const d = make([row(0, [1])], [2]);
    d.update(1 / 120, -10000);
    expect(d.maneuvering).toBe(false);
    expect(d.x).toBe(0);
  });

  it('safety controller overrides a plan that targets a blocked lane', () => {
    const logs = [];
    const d = make([row(0, [1])], [1]);
    d.log = (e) => logs.push(e);
    d.update(1 / 120, 0);
    expect(d.targetLane).not.toBe(1);
    expect(logs.some((e) => e.type === 'safety-override')).toBe(true);
  });
});

describe('full autonomous races', () => {
  it.each([
    ['default pace', 180, 1],
    ['fastest allowed pace', 1, 2],
    ['short race', 45, 3],
    ['dense year', 120, 4],
  ])('%s: zero collisions and exact score', (_, duration, seed) => {
    const counts = seed === 4 ? randomCounts(366, seed).map((c) => c + 3) : randomCounts(366, seed);
    const data = datasetFrom(counts, 2024);
    const race = new Race(data, { ...CONFIG, raceDurationSeconds: duration });
    runToEnd(race);
    expect(race.collisions).toBe(0);
    expect(race.passed).toBe(race.rows.length);
    expect(race.score).toBe(data.totalContributions);
  });

  it('handles consecutive extreme barriers', () => {
    const data = datasetFrom(Array(60).fill(25));
    const race = new Race(data, CONFIG);
    runToEnd(race);
    expect(race.rows.every((r) => r.kind === 'barrier')).toBe(true);
    expect(race.collisions).toBe(0);
  });
});
