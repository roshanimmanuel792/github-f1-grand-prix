#!/usr/bin/env node
// Records docs/preview.gif from the real game renderer (run `npm run preview:gif`, which builds first).
// Frames are stepped deterministically through window.__GP__.advance, so output is reproducible.
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { preview } from 'vite';

const { GIFEncoder, applyPalette, quantize } = gifenc; // CommonJS package

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'preview.gif');
const WIDTH = 640;
const HEIGHT = 360;
const FPS = 15;
const SECONDS = 6;

/** Start of the 8-day window with the most obstacle days (most action for the preview). */
export function busiestWindow(counts, size = 8) {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i + size <= counts.length; i++) {
    const win = counts.slice(i, i + size);
    const score = win.filter((c) => c > 0).length * 1000 + win.reduce((a, b) => a + b, 0);
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

async function main() {
  const server = await preview({ root: ROOT, preview: { port: 4180, strictPort: false } });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.goto(`${url}?capture=1&res=${HEIGHT}`);
    await page.waitForFunction(() => window.__GP__, null, { timeout: 30_000 });
    const counts = await page.evaluate(() => window.__GP__.info().counts);
    const day = Math.max(0, busiestWindow(counts) - 1);
    await page.evaluate((d) => {
      window.__GP__.start();
      window.__GP__.seekDay(d);
    }, day);

    const gif = GIFEncoder();
    for (let f = 0; f < FPS * SECONDS; f++) {
      await page.evaluate((dt) => window.__GP__.advance(dt), 1 / FPS);
      const png = PNG.sync.read(await page.screenshot({ type: 'png' }));
      const palette = quantize(png.data, 256);
      gif.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: Math.round(1000 / FPS) });
    }
    gif.finish();
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, gif.bytes());
    console.log(`Wrote ${path.relative(ROOT, OUT)} (${(gif.bytes().length / 1024).toFixed(0)} KB, ${FPS * SECONDS} frames, from day ${day})`);
  } finally {
    await browser.close();
    server.httpServer.close();
  }
}

main().catch((err) => {
  console.error(`Preview generation failed: ${err.message}`);
  process.exit(1);
});
