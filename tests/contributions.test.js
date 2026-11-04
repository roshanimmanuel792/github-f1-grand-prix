import { describe, expect, it } from 'vitest';
import {
  computeStats,
  daysInYear,
  makeDemoDataset,
  normalizeCalendarDays,
  parseDate,
  runningStreaks,
  validateDataset,
} from '../src/data/dataset.js';
import { fetchGraphQL, fetchYearDataset, parseContributionsHtml, resolveYears } from '../scripts/fetch-contributions.js';
import { datasetFrom } from './helpers.js';

const raw = (year, n, count = () => 1) =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10), count: count(i) }));

describe('dates', () => {
  it('parses strict ISO dates only', () => {
    expect(parseDate('2026-02-28')).toBe(Date.UTC(2026, 1, 28));
    expect(parseDate('2026-02-30')).toBeNaN();
    expect(parseDate('2026-2-3')).toBeNaN();
  });
  it('handles leap years', () => {
    expect(daysInYear(2024)).toBe(366);
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
    expect(daysInYear(1900)).toBe(365);
  });
});

describe('normalizeCalendarDays', () => {
  it('orders days chronologically and keeps zero days', () => {
    const input = raw(2026, 10, (i) => (i % 2 ? 0 : 3)).reverse();
    const days = normalizeCalendarDays(input, 2026, new Date('2026-01-10T12:00:00Z'));
    expect(days.map((d) => d.date)).toEqual(raw(2026, 10).map((d) => d.date));
    expect(days.filter((d) => d.contributions === 0)).toHaveLength(5);
  });

  it('never includes future dates as zero days', () => {
    const input = raw(2026, 365, (i) => (i < 300 ? 2 : 0));
    const days = normalizeCalendarDays(input, 2026, new Date('2026-11-04T07:00:00Z'));
    expect(days.at(-1).date).toBe('2026-11-04');
    expect(days).toHaveLength(308);
  });

  it('keeps a "tomorrow" day only if GitHub recorded contributions on it (timezone ahead of UTC)', () => {
    const input = raw(2026, 40, (i) => (i === 31 ? 4 : 1));
    const days = normalizeCalendarDays(input, 2026, new Date('2026-01-31T20:00:00Z'));
    expect(days.at(-1)).toEqual({ date: '2026-02-01', contributions: 4 });
  });

  it('covers a full leap year', () => {
    const days = normalizeCalendarDays(raw(2024, 370), 2024, new Date('2025-03-01T00:00:00Z'));
    expect(days).toHaveLength(366);
    expect(days.at(-1).date).toBe('2024-12-31');
    expect(days.some((d) => d.date === '2024-02-29')).toBe(true);
  });

  it('rejects gaps instead of inventing data', () => {
    const input = raw(2026, 10).filter((d) => d.date !== '2026-01-05');
    expect(() => normalizeCalendarDays(input, 2026, new Date('2026-01-10T12:00:00Z'))).toThrow(/missing 2026-01-05/);
  });

  it('rejects negative counts', () => {
    const input = raw(2026, 3, (i) => (i === 1 ? -1 : 1));
    expect(() => normalizeCalendarDays(input, 2026, new Date('2026-01-03T12:00:00Z'))).toThrow(/Invalid count/);
  });
});

describe('validateDataset', () => {
  const good = () => datasetFrom([0, 2, 4, 8]);

  it('accepts a correct dataset and totals match', () => {
    const d = validateDataset(good());
    expect(d.totalContributions).toBe(14);
    expect(d.totalDays).toBe(4);
  });

  it.each([
    ['wrong total', (d) => (d.totalContributions = 15)],
    ['non-contiguous', (d) => (d.days[2].date = '2026-01-09')],
    ['negative count', (d) => (d.days[1].contributions = -2)],
    ['fractional count', (d) => (d.days[1].contributions = 1.5)],
    ['future date', (d) => (d.generatedAt = '2025-12-31T00:00:00Z')],
    ['wrong first date', (d) => (d.firstDate = '2026-01-02')],
    ['missing days', (d) => (d.days = [])],
  ])('rejects %s', (_, mutate) => {
    const d = good();
    mutate(d);
    expect(() => validateDataset(d)).toThrow(/Invalid contribution data/);
  });

  it('rejects non-objects (invalid JSON payloads)', () => {
    expect(() => validateDataset(null)).toThrow();
    expect(() => validateDataset('[]')).toThrow();
  });

  it('labels demo data and keeps it valid', () => {
    const d = makeDemoDataset(2024, new Date('2024-06-01T00:00:00Z'));
    expect(d.demo).toBe(true);
    expect(d.source).toBe('demo');
    expect(validateDataset(d).lastDate).toBe('2024-06-01');
  });
});

describe('stats', () => {
  it('computes streaks and highs from the dataset', () => {
    const days = datasetFrom([1, 2, 0, 3, 4, 5, 0]).days;
    const s = computeStats(days);
    expect(s).toMatchObject({ total: 15, activeDays: 5, zeroDays: 2, longestStreak: 3, currentStreak: 3 });
    expect(s.bestDay).toEqual({ date: '2026-01-06', contributions: 5 });
    expect(s.avgPerActiveDay).toBe(3);
    expect(runningStreaks(days)).toEqual([1, 2, 0, 1, 2, 3, 0]);
  });
  it('handles an empty year', () => {
    const s = computeStats(datasetFrom([0, 0, 0]).days);
    expect(s).toMatchObject({ total: 0, activeDays: 0, longestStreak: 0, bestDay: null, avgPerActiveDay: 0 });
  });
});

describe('GitHub fetching', () => {
  const now = new Date('2026-01-05T12:00:00Z');
  const response = (status, body, headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
    text: async () => body,
  });
  const calendar = (days, total) => ({
    data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: total, weeks: [{ contributionDays: days }] } } } },
  });
  const days5 = raw(2026, 5, (i) => i).map((d) => ({ date: d.date, contributionCount: d.count }));

  it('builds a validated dataset from GraphQL', async () => {
    const fetchImpl = async (url, init) => {
      expect(init.headers.Authorization).toBe('bearer secret');
      return response(200, calendar(days5, 10));
    };
    const d = await fetchYearDataset({ username: 'u', year: 2026, token: 'secret', now, fetchImpl });
    expect(d).toMatchObject({ totalContributions: 10, totalDays: 5, source: 'graphql', lastDate: '2026-01-05' });
    expect(JSON.stringify(d)).not.toContain('secret');
  });

  it('refuses to write when the day sum disagrees with GitHub total', async () => {
    const fetchImpl = async () => response(200, calendar(days5, 99));
    await expect(fetchYearDataset({ username: 'u', year: 2026, token: 't', now, fetchImpl })).rejects.toThrow(/refusing/);
  });

  it('reports auth failures without retrying', async () => {
    let calls = 0;
    const fetchImpl = async () => (calls++, response(401, {}));
    await expect(fetchGraphQL('u', 2026, 't', { fetchImpl, now })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it('reports exhausted rate limits', async () => {
    const fetchImpl = async () => response(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' });
    await expect(fetchGraphQL('u', 2026, 't', { fetchImpl, now })).rejects.toThrow(/rate limit/);
  });

  it('retries server errors then succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => (++calls < 3 ? response(502, {}) : response(200, calendar(days5, 10)));
    const r = await fetchGraphQL('u', 2026, 't', { fetchImpl, now, sleep: async () => {} });
    expect(calls).toBe(3);
    expect(r.total).toBe(10);
  });

  it('surfaces GraphQL errors and unknown users', async () => {
    await expect(fetchGraphQL('u', 2026, 't', { fetchImpl: async () => response(200, { errors: [{ message: 'boom' }] }), now })).rejects.toThrow(/boom/);
    await expect(fetchGraphQL('u', 2026, 't', { fetchImpl: async () => response(200, { data: { user: null } }), now })).rejects.toThrow(/not found/);
  });

  it('parses the public calendar HTML', () => {
    const html = `
      <td data-date="2026-01-01" id="d-0" class="x"></td><td id="d-1" data-date="2026-01-02"></td>
      <tool-tip for="d-0" class="sr-only">No contributions on January 1st.</tool-tip>
      <tool-tip class="sr-only" for="d-1">1,204 contributions on January 2nd.</tool-tip>
      <h2> 1,204
        contributions
          in 2026 </h2>`;
    expect(parseContributionsHtml(html)).toEqual({
      raw: [{ date: '2026-01-01', count: 0 }, { date: '2026-01-02', count: 1204 }],
      total: 1204,
    });
  });

  it('resolves auto years, refreshing last year during the first week of January', () => {
    expect(resolveYears('auto', new Date('2026-11-04T00:00:00Z'))).toEqual([2026]);
    expect(resolveYears('auto', new Date('2027-01-03T00:00:00Z'))).toEqual([2026, 2027]);
    expect(resolveYears('2024', now)).toEqual([2024]);
    expect(() => resolveYears('2030', now)).toThrow();
  });
});
