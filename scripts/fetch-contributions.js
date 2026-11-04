#!/usr/bin/env node
// Fetches a year of GitHub contributions and writes public/data/contributions/<year>.json.
// Usage: node scripts/fetch-contributions.js [year]   (env: GH_TOKEN, GITHUB_USERNAME, YEAR)
// On any failure it exits non-zero and leaves existing data files untouched.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, normalizeCalendarDays, validateDataset } from '../src/data/dataset.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'public', 'data', 'contributions');
const USER_AGENT = 'github-f1-grand-prix';

const QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

class RetryableError extends Error {}

async function withRetry(fn, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof RetryableError || err.name === 'TypeError'; // TypeError = network failure in fetch
      if (!retryable || i >= attempts) throw err;
      await sleep(2000 * i);
    }
  }
}

export async function fetchGraphQL(username, year, token, { fetchImpl = fetch, now = new Date(), sleep } = {}) {
  const yearEnd = `${year}-12-31T23:59:59Z`;
  const nowIso = now.toISOString();
  const variables = { login: username, from: `${year}-01-01T00:00:00Z`, to: nowIso < yearEnd ? nowIso : yearEnd };
  const body = await withRetry(
    async () => {
      const res = await fetchImpl('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: QUERY, variables }),
      });
      if (res.status === 401) throw new Error('GitHub rejected GH_TOKEN (401): it is invalid, expired or revoked.');
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        const when = reset ? ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.` : '';
        if (remaining === '0') throw new Error(`GitHub API rate limit exhausted.${when}`);
        throw new RetryableError(`GitHub API returned ${res.status} (secondary rate limit or missing token scope).`);
      }
      if (res.status >= 500) throw new RetryableError(`GitHub API server error ${res.status}.`);
      if (!res.ok) throw new Error(`GitHub API request failed with HTTP ${res.status}.`);
      return res.json();
    },
    { sleep },
  );
  if (body.errors?.length) throw new Error(`GitHub GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  const calendar = body.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`GitHub user "${username}" not found or calendar unavailable.`);
  return {
    raw: calendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
    total: calendar.totalContributions,
  };
}

/** Parses GitHub's public contribution calendar HTML (no token; public + shared private counts). */
export function parseContributionsHtml(html) {
  const dateById = new Map();
  for (const [tag] of html.matchAll(/<td\b[^>]*data-date="[^"]*"[^>]*>/g)) {
    dateById.set(/\bid="([^"]+)"/.exec(tag)?.[1], /data-date="([^"]+)"/.exec(tag)[1]);
  }
  const countById = new Map();
  for (const [, id, text] of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const m = /^(No|\d[\d,]*) contributions?\b/.exec(text.trim());
    if (m) countById.set(id, m[1] === 'No' ? 0 : Number(m[1].replace(/,/g, '')));
  }
  if (!dateById.size) throw new Error('Public contribution calendar HTML had no days (page format changed?).');
  const raw = [...dateById].map(([id, date]) => {
    if (!countById.has(id)) throw new Error(`No contribution count for ${date} in public calendar.`);
    return { date, count: countById.get(id) };
  });
  const heading = /(\d[\d,]*)\s+contributions?\s+in\s+\d{4}/.exec(html.replace(/\s+/g, ' '));
  return { raw, total: heading ? Number(heading[1].replace(/,/g, '')) : null };
}

export async function fetchPublic(username, year, { fetchImpl = fetch, sleep } = {}) {
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions?from=${year}-01-01&to=${year}-12-31`;
  const html = await withRetry(
    async () => {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) throw new Error(`GitHub user "${username}" not found.`);
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`github.com returned ${res.status}.`);
      if (!res.ok) throw new Error(`Public calendar request failed with HTTP ${res.status}.`);
      return res.text();
    },
    { sleep },
  );
  return parseContributionsHtml(html);
}

export async function fetchYearDataset({ username, year, token, now = new Date(), fetchImpl, sleep }) {
  const { raw, total } = token
    ? await fetchGraphQL(username, year, token, { fetchImpl, now, sleep })
    : await fetchPublic(username, year, { fetchImpl, sleep });
  const days = normalizeCalendarDays(raw, year, now);
  const dataset = buildDataset({ username, year, days, source: token ? 'graphql' : 'public', now });
  if (total !== null && dataset.totalContributions !== total) {
    throw new Error(`Day sum ${dataset.totalContributions} != GitHub total ${total}; refusing to write.`);
  }
  return validateDataset(dataset);
}

/** Years to refresh: the configured one, or the current UTC year (+ last year during Jan 1-7 to capture Dec 31). */
export function resolveYears(selected, now = new Date()) {
  if (selected && selected !== 'auto') {
    const y = Number(selected);
    if (!Number.isInteger(y) || y < 2008 || y > now.getUTCFullYear()) throw new Error(`Invalid year "${selected}".`);
    return [y];
  }
  const y = now.getUTCFullYear();
  return now.getUTCMonth() === 0 && now.getUTCDate() <= 7 ? [y - 1, y] : [y];
}

const sameData = (a, b) =>
  a && a.username === b.username && a.year === b.year && a.source === b.source && JSON.stringify(a.days) === JSON.stringify(b.days);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

export async function writeIfChanged(file, dataset) {
  if (sameData(await readJson(file), dataset)) return false;
  await writeJsonAtomic(file, dataset);
  return true;
}

export async function updateIndex(dir, username) {
  const years = (await readdir(dir))
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
    .sort((a, b) => b - a);
  const index = { username, latestYear: years[0], years };
  const file = path.join(dir, 'index.json');
  if (JSON.stringify(await readJson(file)) === JSON.stringify(index)) return false;
  await writeJsonAtomic(file, index);
  return true;
}

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, 'game.config.json'), 'utf8'));
  const username = process.env.GITHUB_USERNAME || config.githubUsername;
  const token = process.env.GH_TOKEN || '';
  if (!username || username === 'YOUR_GITHUB_USERNAME') throw new Error('Set githubUsername in game.config.json.');
  if (!token) console.warn('GH_TOKEN not set: falling back to the public contribution calendar.');
  await mkdir(DATA_DIR, { recursive: true });

  for (const year of resolveYears(process.argv[2] || process.env.YEAR || config.selectedYear)) {
    const dataset = await fetchYearDataset({ username, year, token });
    const changed = await writeIfChanged(path.join(DATA_DIR, `${year}.json`), dataset);
    console.log(
      `${year}: ${dataset.totalContributions} contributions over ${dataset.totalDays} days ` +
        `(${dataset.firstDate} → ${dataset.lastDate}, source: ${dataset.source}) — ${changed ? 'updated' : 'unchanged'}`,
    );
  }
  if (await updateIndex(DATA_DIR, username)) console.log('index.json updated');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Contribution fetch failed: ${err.message}`);
    process.exit(1);
  });
}
