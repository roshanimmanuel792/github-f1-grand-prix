import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config.js';
import { COUNTDOWN_SECONDS, Race, STATES } from '../src/game/race.js';
import { CONFIG, advance, datasetFrom, randomCounts } from './helpers.js';

describe('race lifecycle', () => {
  it('ready → racing (countdown) → finished, and finishes only after the last day', () => {
    const events = [];
    const data = datasetFrom(randomCounts(30, 5));
    const race = new Race(data, CONFIG, { onEvent: (t) => events.push(t) });
    expect(race.state).toBe(STATES.READY);
    const startZ = race.z;
    race.update(1);
    expect(race.z).toBe(startZ); // ready: nothing moves
    race.start();
    expect(race.state).toBe(STATES.RACING);
    advance(race, COUNTDOWN_SECONDS / 2);
    expect(race.speed).toBe(0);
    expect(race.lightsOn).toBeGreaterThan(0);
    while (race.state === STATES.RACING) {
      expect(race.completedDays).toBeLessThan(race.totalDays);
      race.update(1 / 60);
    }
    expect(race.state).toBe(STATES.FINISHED);
    expect(race.completedDays).toBe(race.totalDays);
    expect(events.filter((e) => e === 'finish')).toHaveLength(1);
    expect(events.indexOf('go')).toBeGreaterThan(events.indexOf('start'));
  });

  it('pause freezes the simulation and resume continues', () => {
    const race = new Race(datasetFrom([1, 2, 3]), CONFIG);
    race.start();
    advance(race, COUNTDOWN_SECONDS + 1);
    race.togglePause();
    expect(race.state).toBe(STATES.PAUSED);
    const z = race.z;
    race.update(1);
    expect(race.z).toBe(z);
    race.togglePause();
    advance(race, 0.5);
    expect(race.z).toBeGreaterThan(z);
  });

  it('car coasts to a stop after the finish line', () => {
    const race = new Race(datasetFrom([1, 1]), CONFIG);
    race.start();
    while (race.state !== STATES.FINISHED) race.update(1 / 60);
    for (let i = 0; i < 600; i++) race.update(1 / 60);
    expect(race.speed).toBe(0);
    expect(race.z).toBeLessThan(race.track.count * 200);
  });

  it('race duration follows the config, with a minimum pace per day', () => {
    expect(new Race(datasetFrom(Array(300).fill(0)), { ...CONFIG, raceDurationSeconds: 150 }).secondsPerDay).toBeCloseTo(0.5);
    expect(new Race(datasetFrom(Array(300).fill(0)), { ...CONFIG, raceDurationSeconds: 10 }).secondsPerDay).toBe(0.25);
  });

  it('nitro is visual only and scales with contributions', () => {
    const race = new Race(datasetFrom([35, 35]), CONFIG);
    race.start();
    advance(race, COUNTDOWN_SECONDS + 0.1);
    expect(race.nitroLevel).toBe(3);
    while (race.state !== STATES.FINISHED) race.update(1 / 60);
    expect(race.score).toBe(70);
  });
});

describe('config validation', () => {
  it('accepts the shipped config shape', () => {
    expect(() => validateConfig({ ...CONFIG })).not.toThrow();
  });
  it.each([
    ['unknown mode', { raceMode: 'weekly' }],
    ['unordered thresholds', { obstacleThresholds: { small: 1, medium: 5, hard: 3, extreme: 10 } }],
    ['short lookahead', { aiLookaheadDays: 0.5 }],
    ['bad year', { selectedYear: 'soon' }],
  ])('rejects %s', (_, patch) => {
    expect(() => validateConfig({ ...CONFIG, ...patch })).toThrow();
  });
});
