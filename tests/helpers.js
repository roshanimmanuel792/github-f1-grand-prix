import { buildDataset, isoDate, mulberry32, parseDate, DAY_MS } from '../src/data/dataset.js';

export const CONFIG = {
  githubUsername: 'tester',
  raceMode: 'yearly',
  selectedYear: 'auto',
  autoPlay: true,
  autoPlayDelaySeconds: 4,
  showControls: true,
  targetFPS: 60,
  raceDurationSeconds: 180,
  minSecondsPerDay: 0.25,
  aiLookaheadDays: 1.5,
  obstacleThresholds: { small: 1, medium: 3, hard: 5, extreme: 10 },
  nitroThresholds: [10, 20, 30],
};

export function datasetFrom(counts, year = 2026, generatedAt = `${year}-12-31T12:00:00Z`) {
  const start = parseDate(`${year}-01-01`);
  const days = counts.map((c, i) => ({ date: isoDate(start + i * DAY_MS), contributions: c }));
  return buildDataset({ username: 'tester', year, days, source: 'test', now: new Date(generatedAt) });
}

/** Random contribution counts with realistic bursts of 10+ days. */
export function randomCounts(n, seed) {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const r = rand();
    return r < 0.3 ? 0 : r < 0.6 ? 1 + Math.floor(rand() * 4) : r < 0.85 ? 5 + Math.floor(rand() * 5) : 10 + Math.floor(rand() * 40);
  });
}

/** Advance in 60 FPS frames (single update() calls are capped at 0.25 s by design). */
export function advance(race, seconds) {
  for (let t = 0; t < seconds; t += 1 / 60) race.update(1 / 60);
}

/** Run a race to completion with the fixed simulation step. */
export function runToEnd(race, maxSeconds = 2000) {
  race.start();
  let t = 0;
  while (race.state !== 'finished' && t < maxSeconds) {
    race.update(1 / 60);
    t += 1 / 60;
  }
  return t;
}
