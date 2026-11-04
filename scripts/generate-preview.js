#!/usr/bin/env node
// Records docs/preview.gif with the product's own replay exporter: races the owner's latest
// season autonomously, then exports the full-season 2x replay GIF (`npm run preview:gif`, which builds first).
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { inspectGif } from '../src/export/gif.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'preview.gif');
const PRESET = process.argv[2] || 'readme';

const config = JSON.parse(await readFile(path.join(ROOT, 'game.config.json'), 'utf8'));
const index = JSON.parse(await readFile(path.join(ROOT, 'public/data/contributions/index.json'), 'utf8'));
const server = await preview({ root: ROOT, preview: { port: 4180, strictPort: false } });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  await page.goto(`${server.resolvedUrls.local[0]}?user=${config.githubUsername}&year=${index.latestYear}`);
  await page.waitForFunction(() => window.__GP__?.state === 'setup', null, { timeout: 120_000 });
  await page.click('#btn-start');
  await page.evaluate(() => window.__GP__.fastForward());
  await page.waitForFunction(() => window.__GP__.state === 'results', null, { timeout: 60_000 });
  const download = page.waitForEvent('download', { timeout: 600_000 });
  const result = await page.evaluate((p) => window.__GP__.exportGif(p), PRESET);
  if (result.error) throw new Error(result.error);
  await mkdir(path.dirname(OUT), { recursive: true });
  await (await download).saveAs(OUT);
  const info = inspectGif(await readFile(OUT));
  console.log(`Wrote docs/preview.gif: ${(info.bytes / 1048576).toFixed(1)} MB, ${info.frames} frames, ${info.duration.toFixed(1)} s, ${info.width}×${info.height}, final score ${result.score}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
