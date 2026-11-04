// Pure dataset helpers shared by the browser game and the Node data scripts.

export const DAY_MS = 86_400_000;
// GitHub renders calendars in the user's timezone, which can be up to UTC+14.
export const MAX_TZ_AHEAD_MS = 14 * 3_600_000;

export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Parses a strict YYYY-MM-DD string to UTC ms, or NaN (rejects e.g. 2026-02-30). */
export function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && isoDate(ms) === s ? ms : NaN;
}

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y) => (isLeapYear(y) ? 366 : 365);

/**
 * Turns raw calendar days ({date, count}) into the race's day list: Jan 1 through the
 * latest available date, chronological, contiguous. Days after "today" (UTC) are only
 * kept if GitHub already recorded contributions on them (user timezone ahead of UTC),
 * so future dates are never treated as zero-contribution days.
 */
export function normalizeCalendarDays(rawDays, year, now = new Date()) {
  const first = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const nowMs = now.getTime();
  const todayUtc = isoDate(nowMs);
  const latestPossible = isoDate(nowMs + MAX_TZ_AHEAD_MS);
  if (first > latestPossible) throw new Error(`Year ${year} has not started yet.`);

  const byDate = new Map();
  for (const raw of rawDays) {
    const ms = parseDate(raw.date);
    const count = raw.count;
    if (!Number.isFinite(ms)) throw new Error(`Invalid date from GitHub: ${raw.date}`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid count ${count} on ${raw.date}`);
    if (raw.date < first || raw.date > yearEnd || raw.date > latestPossible) continue;
    if (raw.date > todayUtc && count === 0) continue;
    if (byDate.has(raw.date) && byDate.get(raw.date) !== count) {
      throw new Error(`Conflicting counts for ${raw.date}`);
    }
    byDate.set(raw.date, count);
  }

  const dates = [...byDate.keys()].sort();
  if (!dates.length) throw new Error(`GitHub returned no days for ${year}.`);
  if (dates[0] !== first) throw new Error(`Calendar does not start on ${first} (got ${dates[0]}).`);
  const lastDate = dates.at(-1);

  const days = [];
  for (let ms = parseDate(first), end = parseDate(lastDate); ms <= end; ms += DAY_MS) {
    const date = isoDate(ms);
    if (!byDate.has(date)) throw new Error(`Calendar is missing ${date}; refusing to invent data.`);
    days.push({ date, contributions: byDate.get(date) });
  }
  return days;
}

export function buildDataset({ username, year, days, source, now = new Date() }) {
  return {
    username,
    year,
    source,
    generatedAt: now.toISOString(),
    firstDate: days[0].date,
    lastDate: days.at(-1).date,
    totalContributions: days.reduce((s, d) => s + d.contributions, 0),
    totalDays: days.length,
    days,
  };
}

/** Throws a descriptive Error if the dataset is malformed; returns it otherwise. */
export function validateDataset(d) {
  const fail = (msg) => {
    throw new Error(`Invalid contribution data: ${msg}`);
  };
  if (!d || typeof d !== 'object') fail('not an object');
  if (typeof d.username !== 'string' || !d.username) fail('missing username');
  if (!Number.isInteger(d.year) || d.year < 2008 || d.year > 9999) fail(`bad year ${d.year}`);
  if (!Array.isArray(d.days) || d.days.length === 0) fail('no days');
  if (d.firstDate !== `${d.year}-01-01`) fail(`firstDate must be ${d.year}-01-01`);
  if (d.days[0]?.date !== d.firstDate) fail('days must start at firstDate');
  if (d.days.at(-1)?.date !== d.lastDate) fail('days must end at lastDate');
  if (d.lastDate > `${d.year}-12-31`) fail('lastDate is outside the year');
  const generated = Date.parse(d.generatedAt);
  if (!Number.isFinite(generated)) fail('bad generatedAt');
  if (d.lastDate > isoDate(generated + MAX_TZ_AHEAD_MS)) fail('contains future dates');

  let expected = parseDate(d.firstDate);
  let sum = 0;
  for (const day of d.days) {
    if (!day || parseDate(day.date) !== expected) fail(`dates not contiguous at ${day?.date}`);
    if (!Number.isInteger(day.contributions) || day.contributions < 0) {
      fail(`bad contribution count on ${day.date}`);
    }
    sum += day.contributions;
    expected += DAY_MS;
  }
  if (d.totalDays !== d.days.length) fail(`totalDays ${d.totalDays} != ${d.days.length}`);
  if (d.totalContributions !== sum) fail(`totalContributions ${d.totalContributions} != sum ${sum}`);
  return d;
}

export function computeStats(days) {
  let total = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let run = 0;
  let bestDay = null;
  for (const day of days) {
    total += day.contributions;
    if (day.contributions > 0) {
      activeDays++;
      longestStreak = Math.max(longestStreak, ++run);
      if (!bestDay || day.contributions > bestDay.contributions) bestDay = day;
    } else run = 0;
  }
  // A zero on the latest day doesn't break the streak yet: the day may still be in progress.
  let currentStreak = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributions === 0) i--;
  while (i >= 0 && days[i].contributions > 0) {
    currentStreak++;
    i--;
  }
  return {
    total,
    activeDays,
    zeroDays: days.length - activeDays,
    longestStreak,
    currentStreak,
    bestDay,
    avgPerActiveDay: activeDays ? total / activeDays : 0,
  };
}

/** Running streak as of each day (index-aligned with days). */
export function runningStreaks(days) {
  const out = new Array(days.length);
  let run = 0;
  for (let i = 0; i < days.length; i++) out[i] = run = days[i].contributions > 0 ? run + 1 : 0;
  return out;
}

/** Deterministic 32-bit FNV-1a hash, used for seeding layouts and tracks. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clearly-labelled synthetic dataset for demos/tests. Never presented as real data. */
export function makeDemoDataset(year, now = new Date(), username = 'demo') {
  const rand = mulberry32(hashString(`demo-${year}`));
  const yearEnd = `${year}-12-31`;
  const today = isoDate(now.getTime());
  const last = today < yearEnd ? today : yearEnd;
  const days = [];
  for (let ms = parseDate(`${year}-01-01`), end = parseDate(last); ms <= end; ms += DAY_MS) {
    const r = rand();
    const contributions = r < 0.35 ? 0 : r < 0.8 ? 1 + Math.floor(rand() * 4) : r < 0.95 ? 5 + Math.floor(rand() * 5) : 10 + Math.floor(rand() * 25);
    days.push({ date: isoDate(ms), contributions });
  }
  return { ...buildDataset({ username, year, days, source: 'demo', now }), demo: true };
}
