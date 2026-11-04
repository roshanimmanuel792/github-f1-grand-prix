import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { inspectGif } from '../../src/export/gif.js';
import { fixtureDataset } from './fixtures.js';

const OCTO = fixtureDataset('octo-tester', 2025, 30, 7);
const OTHER = fixtureDataset('other-tester', 2025, 30, 99);
const FAST = '&duration=8&quality=low'; // short, light races keep CI quick

/** Mock the contributions API with deterministic fixtures; record every request. */
async function mockApi(page, datasets = [OCTO, OTHER]) {
  const calls = [];
  await page.route('**/api/contributions**', (route) => {
    const url = new URL(route.request().url());
    calls.push(url.searchParams.get('user'));
    const d = datasets.find((x) => x.username === url.searchParams.get('user')?.toLowerCase());
    if (!d) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'user_not_found', message: 'nope' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
  });
  return calls;
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels|Automatic fallback to software WebGL/.test(m.text()) && errors.push(m.text()));
  return errors;
}

const info = (page) => page.evaluate(() => window.__GP__.info());
const waitState = (page, state, timeout = 60_000) => page.waitForFunction((s) => window.__GP__?.state === s, state, { timeout });

async function openRace(page, user = 'octo-tester', extra = '') {
  await page.goto(`./?user=${user}&year=2025${FAST}${extra}`);
  await waitState(page, 'setup');
}

test('landing page renders the 3D scene and the lookup form', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await waitState(page, 'landing');
  await expect(page.getByRole('heading', { name: /Your GitHub year/ })).toBeVisible();
  await expect(page.getByLabel('GitHub username')).toBeFocused();
  const canvas = await page.locator('#scene').boundingBox();
  expect(canvas.width).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test('invalid usernames are rejected without calling the API', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('./');
  await waitState(page, 'landing');
  await page.getByLabel('GitHub username').fill('-not valid-');
  await page.getByRole('button', { name: 'Start engine' }).click();
  await expect(page.locator('#lookup-error')).toContainText('valid GitHub username');
  expect(calls).toEqual([]);
});

test('unknown users get a friendly error and can go back', async ({ page }) => {
  await mockApi(page);
  await page.goto('./');
  await waitState(page, 'landing');
  await page.getByLabel('GitHub username').fill('nobody-here');
  await page.getByLabel('Season').selectOption('2025');
  await page.getByRole('button', { name: 'Start engine' }).click();
  await expect(page.locator('#screen-error')).toBeVisible();
  await expect(page.locator('#error-message')).toHaveText('No GitHub user with that name.');
  await page.getByRole('button', { name: 'Back' }).click();
  await waitState(page, 'landing');
});

test('API data for the wrong user is refused (dataset isolation)', async ({ page }) => {
  await page.route('**/api/contributions**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OTHER) }));
  await page.goto(`./?user=octo-tester&year=2025${FAST}`);
  await expect(page.locator('#error-message')).toContainText('different user');
});

test('autonomous race: personalised, exact score, results only at the end, no console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page);
  await openRace(page);
  await expect(page.locator('#setup-user')).toHaveText('@octo-tester');
  await expect(page.locator('#setup-total')).toHaveText(OCTO.totalContributions.toLocaleString('en-US'));
  await page.getByRole('button', { name: 'Start race' }).click();
  await waitState(page, 'racing');
  await page.waitForFunction(() => window.__GP__.info().score > 0, null, { timeout: 30_000 });
  const mid = await info(page);
  expect(mid.completedDays).toBeLessThan(mid.totalDays);
  await expect(page.locator('#screen-results')).toBeHidden();
  await page.evaluate(() => window.__GP__.fastForward());
  await waitState(page, 'results');
  const done = await info(page);
  expect(done).toMatchObject({ score: OCTO.totalContributions, completedDays: 30, collisions: 0, mode: 'ai' });
  expect(done.passed).toBe(done.obstacles);
  await expect(page.locator('#res-score')).toHaveText(OCTO.totalContributions.toLocaleString('en-US'));
  await expect(page.locator('#res-completion')).toHaveText('100%');
  await expect(page.locator('#btn-profile')).toHaveAttribute('href', 'https://github.com/octo-tester');
  expect(errors).toEqual([]);
});

test('different usernames produce different races', async ({ page }) => {
  await mockApi(page);
  await openRace(page, 'octo-tester');
  const a = await info(page);
  await openRace(page, 'other-tester');
  const b = await info(page);
  expect(a.username).toBe('octo-tester');
  expect(b.username).toBe('other-tester');
  expect(a.totalContributions).not.toBe(b.totalContributions);
});

test('manual driving: responds to keys, pause/resume, camera switch keeps progress', async ({ page }) => {
  await mockApi(page);
  await openRace(page);
  await page.getByText('Manual', { exact: true }).click();
  await page.getByRole('button', { name: 'Start race' }).click();
  await waitState(page, 'racing');
  await page.waitForTimeout(3600); // start lights
  expect((await info(page)).speedKmh).toBe(0); // no input: the car must not drive itself
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  const moving = await info(page);
  expect(moving.speedKmh).toBeGreaterThan(40);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyA');
  expect((await info(page)).x).toBeLessThan(-0.1);
  const before = await info(page);
  await page.keyboard.press('KeyC');
  const after = await info(page);
  expect(after.camera).not.toBe(before.camera);
  expect(after.completedDays).toBeGreaterThanOrEqual(before.completedDays);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyP');
  await waitState(page, 'paused');
  const frozen = await info(page);
  await page.waitForTimeout(500);
  expect((await info(page)).completedDays).toBe(frozen.completedDays);
  await page.getByRole('button', { name: 'Resume' }).click();
  await waitState(page, 'racing');
  // finish under manual control (throttle held) and check the score contract
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__GP__.fastForward());
  await page.keyboard.up('KeyW');
  await waitState(page, 'results');
  const done = await info(page);
  expect(done.score).toBe(OCTO.totalContributions);
  expect(done.completedDays).toBe(30);
  expect(done.replayInputs).toBeGreaterThan(0);
});

test('exports a validated full-season GIF and MP4 of the replay', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'export runs once, on desktop');
  test.setTimeout(240_000);
  await mockApi(page);
  await openRace(page);
  await page.getByRole('button', { name: 'Start race' }).click();
  await page.evaluate(() => window.__GP__.fastForward());
  await waitState(page, 'results');

  const gifDownload = page.waitForEvent('download');
  const gif = await page.evaluate(() => window.__GP__.exportGif('tiny'));
  expect(gif.error).toBeUndefined();
  const gifPath = testInfo.outputPath('replay.gif');
  await (await gifDownload).saveAs(gifPath);
  const g = inspectGif(readFileSync(gifPath));
  expect(g).toMatchObject({ width: 256, height: 144, frames: gif.frames });
  expect(g.duration).toBeCloseTo(gif.duration, 1);
  expect(gif.score).toBe(OCTO.totalContributions);
  await expect(page.locator('#export-status')).toContainText('Validated');

  const mp4Download = page.waitForEvent('download');
  const video = await page.evaluate(() => window.__GP__.exportVideo('p480'));
  test.skip(Boolean(video.error) && /cannot encode/.test(video.error), `no video encoder in ${browserName}`);
  expect(video.error).toBeUndefined();
  expect(video.container).toBe('mp4');
  const mp4Path = testInfo.outputPath('replay.mp4');
  await (await mp4Download).saveAs(mp4Path);
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(readFileSync(mp4Path)) });
  expect((await input.getFormat()).name).toMatch(/MP4/i);
  const track = await input.getPrimaryVideoTrack();
  expect([track.displayWidth, track.displayHeight]).toEqual([854, 480]);
  expect(await input.computeDuration()).toBeCloseTo(video.duration, 0);
  try {
    const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'csv=p=0', mp4Path]).toString().trim();
    const [codec, frames] = probe.split(',');
    expect(['h264', 'vp9', 'av1']).toContain(codec);
    expect(Number(frames)).toBe(video.frames);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // ffprobe not installed: container checks above still ran
  }
});

test('README markdown and share link contain the real username, season and score', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'clipboard permissions are desktop-only here');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockApi(page);
  await openRace(page);
  await page.getByRole('button', { name: 'Start race' }).click();
  await page.evaluate(() => window.__GP__.fastForward());
  await waitState(page, 'results');
  await page.getByRole('button', { name: 'Copy README markdown' }).click();
  const md = await page.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('github-grand-prix-octo-tester-2025.gif');
  expect(md).toContain(`**${OCTO.totalContributions.toLocaleString('en-US')}**`);
  expect(md).toContain('?user=octo-tester&year=2025');
  await page.getByRole('button', { name: 'Share race link' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\?user=octo-tester&year=2025&mode=ai$/);
});

test('mobile: touch controls drive the car and nothing overflows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile only');
  await mockApi(page);
  await openRace(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByText('Manual', { exact: true }).click();
  await page.getByRole('button', { name: 'Start race' }).click();
  await waitState(page, 'racing');
  await expect(page.locator('#touch')).toBeVisible();
  for (const name of ['Accelerate', 'Brake', 'Nitro', 'Steer left', 'Steer right']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.waitForTimeout(3600);
  const gas = page.getByRole('button', { name: 'Accelerate' });
  await gas.dispatchEvent('pointerdown', { pointerId: 1 });
  await page.waitForTimeout(1200);
  expect((await info(page)).speedKmh).toBeGreaterThan(30);
  await gas.dispatchEvent('pointerup', { pointerId: 1 });
});

test('reduced motion is respected', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await mockApi(page);
  await page.goto(`./?user=octo-tester&year=2025${FAST}`);
  await waitState(page, 'setup');
  const animation = await page.locator('.lights i').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
  await context.close();
});

test("the owner's season loads from the committed dataset without the API", async ({ page }) => {
  const calls = await mockApi(page, []);
  const index = await (await page.request.get('data/contributions/index.json')).json();
  const data = await (await page.request.get(`data/contributions/${index.latestYear}.json`)).json();
  await page.goto(`./?user=${index.username}&year=${index.latestYear}&quality=low`);
  await waitState(page, 'setup');
  await expect(page.locator('#setup-total')).toHaveText(data.totalContributions.toLocaleString('en-US'));
  expect(calls).toEqual([]);
});

test('demo mode is clearly labelled', async ({ page }) => {
  await page.goto('./?demo=1&quality=low');
  await waitState(page, 'setup');
  await expect(page.locator('#setup-demo')).toHaveText('DEMO DATA');
  await expect(page.locator('#setup-meta')).toContainText('synthetic demo data');
});
