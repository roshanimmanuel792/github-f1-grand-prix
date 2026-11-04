import { buildDataset, isoDate, mulberry32, parseDate, DAY_MS } from '../../src/data/dataset.js';

/** Deterministic "public API" dataset for browser tests (never shown as real data). */
export function fixtureDataset(username, year, days, seed) {
  const rand = mulberry32(seed);
  const start = parseDate(`${year}-01-01`);
  const list = Array.from({ length: days }, (_, i) => {
    const r = rand();
    return { date: isoDate(start + i * DAY_MS), contributions: r < 0.3 ? 0 : r < 0.7 ? 1 + Math.floor(rand() * 4) : 5 + Math.floor(rand() * 12) };
  });
  return buildDataset({ username, year, days: list, source: 'public', now: new Date(`${year}-12-31T12:00:00Z`) });
}
