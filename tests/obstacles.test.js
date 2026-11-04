import { describe, expect, it } from 'vitest';
import { generateObstacleRows, obstacleKindFor } from '../src/game/obstacles.js';
import { CONFIG, datasetFrom, randomCounts } from './helpers.js';

const T = CONFIG.obstacleThresholds;

describe('obstacle thresholds', () => {
  it.each([
    [0, [null]],
    [1, ['block']],
    [2, ['block']],
    [3, ['cone', 'tyres']],
    [4, ['cone', 'tyres']],
    [5, ['tyreBarrier']],
    [9, ['tyreBarrier']],
    [10, ['barrier']],
    [57, ['barrier']],
  ])('%i contributions → %j', (count, kinds) => {
    expect(kinds).toContain(obstacleKindFor(count, T, '2026-03-01'));
  });

  it('respects custom thresholds', () => {
    const custom = { small: 2, medium: 4, hard: 8, extreme: 20 };
    expect(obstacleKindFor(1, custom)).toBeNull();
    expect(obstacleKindFor(19, custom)).toBe('tyreBarrier');
    expect(obstacleKindFor(20, custom)).toBe('barrier');
  });
});

describe('obstacle generation', () => {
  const days = datasetFrom(randomCounts(366, 11), 2024).days;
  const rows = generateObstacleRows(days, T);

  it('creates one row per non-zero day, in chronological order', () => {
    expect(rows).toHaveLength(days.filter((d) => d.contributions >= T.small).length);
    rows.forEach((r, i) => i && expect(r.dayIndex).toBeGreaterThan(rows[i - 1].dayIndex));
  });

  it('is deterministic', () => {
    expect(generateObstacleRows(days, T)).toEqual(rows);
  });

  it('always leaves a gap, and barriers leave exactly one', () => {
    for (const r of rows) {
      expect(r.blocked).not.toContain(r.safeLane);
      expect(r.blocked.length).toBeLessThan(3);
      if (r.kind === 'barrier' || r.kind === 'tyreBarrier') expect(r.blocked).toHaveLength(2);
      else expect(r.blocked).toHaveLength(1);
      if (r.kind === 'tyreBarrier') expect(r.safeLane).not.toBe(1);
    }
  });

  it('never produces an impossible sequence (safe lane moves ≤ 1 lane per day)', () => {
    let prev = { dayIndex: -2, safeLane: 1 };
    for (const r of rows) {
      expect(Math.abs(r.safeLane - prev.safeLane)).toBeLessThanOrEqual(Math.min(2, r.dayIndex - prev.dayIndex));
      prev = r;
    }
  });

  it('places barriers somewhere in every lane over a year', () => {
    const gaps = new Set(rows.filter((r) => r.kind === 'barrier').map((r) => r.safeLane));
    expect(gaps.size).toBe(3);
  });
});
