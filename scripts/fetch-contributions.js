#!/usr/bin/env node
// Fetches a year of the OWNER's GitHub contributions and writes public/data/contributions/<year>.json.
// Usage: node scripts/fetch-contributions.js [year]   (env: GH_TOKEN, GITHUB_USERNAME, YEAR)
// On any failure it exits non-zero and leaves existing data files untouched.
// Visitor lookups go through the Cloudflare Worker (worker/) and never use GH_TOKEN.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchYearDataset } from '../src/data/github.js';

export { fetchGraphQL, fetchPublic, fetchYearDataset, parseContributionsHtml } from '../src/data/github.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'public', 'data', 'contributions');

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
