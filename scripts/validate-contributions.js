#!/usr/bin/env node
// Validates every generated contribution file and the year index. Exits 1 on any problem.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateDataset } from '../src/data/dataset.js';
import { DATA_DIR } from './fetch-contributions.js';

const files = (await readdir(DATA_DIR)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
const errors = [];
for (const f of files) {
  try {
    const d = validateDataset(JSON.parse(await readFile(path.join(DATA_DIR, f), 'utf8')));
    if (`${d.year}.json` !== f) throw new Error(`year ${d.year} does not match file name`);
    console.log(`✓ ${f}: ${d.totalContributions} contributions, ${d.totalDays} days, ${d.firstDate} → ${d.lastDate}`);
  } catch (err) {
    errors.push(`${f}: ${err.message}`);
  }
}
try {
  const index = JSON.parse(await readFile(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const expected = files.map((f) => Number(f.slice(0, 4))).sort((a, b) => b - a);
  if (JSON.stringify(index.years) !== JSON.stringify(expected) || index.latestYear !== expected[0]) {
    errors.push(`index.json lists ${JSON.stringify(index.years)}, files are ${JSON.stringify(expected)}`);
  }
} catch (err) {
  errors.push(`index.json: ${err.message}`);
}
if (!files.length) errors.push('no contribution files found; run `npm run fetch`');
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
