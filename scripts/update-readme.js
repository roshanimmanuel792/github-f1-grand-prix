#!/usr/bin/env node
// Rewrites the <!-- STATS:START --> … <!-- STATS:END --> block in README.md from the latest dataset.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStats, validateDataset } from '../src/data/dataset.js';
import { DATA_DIR } from './fetch-contributions.js';

const README = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md');
const readJson = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), 'utf8'));

const index = await readJson('index.json');
const d = validateDataset(await readJson(`${index.latestYear}.json`));
const s = computeStats(d.days);
const n = (v) => v.toLocaleString('en-US');
const best = s.bestDay ? `${s.bestDay.contributions} (${s.bestDay.date})` : '—';
const source = d.source === 'graphql' ? 'GitHub GraphQL API' : 'GitHub public contribution calendar';

const block = `<!-- STATS:START -->
| Season | Final score | Race days | Active days | Zero days | Longest streak | Current streak | Best day |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **${d.year}** | **${n(d.totalContributions)}** | ${d.totalDays} | ${s.activeDays} | ${s.zeroDays} | ${s.longestStreak} days | ${s.currentStreak} days | ${best} |

<sub>Contributions from ${d.firstDate} to ${d.lastDate} · source: ${source} · refreshed daily by GitHub Actions</sub>
<!-- STATS:END -->`;

const readme = await readFile(README, 'utf8');
const pattern = /<!-- STATS:START -->[\s\S]*?<!-- STATS:END -->/;
if (!pattern.test(readme)) {
  console.error('README.md has no STATS markers.');
  process.exit(1);
}
const next = readme.replace(pattern, block);
if (next === readme) console.log('README stats unchanged');
else {
  await writeFile(README, next);
  console.log(`README stats updated for ${d.year}`);
}
