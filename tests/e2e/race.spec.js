import { expect, test } from '@playwright/test';

const watchErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
};

test('loads real data, races autonomously to GAME OVER with the exact score, and restarts', async ({ page }) => {
  const errors = watchErrors(page);
  const index = await (await page.request.get('data/contributions/index.json')).json();
  const data = await (await page.request.get(`data/contributions/${index.latestYear}.json`)).json();

  await page.goto('./?duration=8&autoplay=0');
  await expect(page.locator('#screen-ready')).toBeVisible();
  await expect(page.locator('#ready-total')).toHaveText(data.totalContributions.toLocaleString('en-US'));
  await expect(page.locator('#ready-days')).toHaveText(String(data.totalDays));
  await expect(page.locator('#demo-badge')).toBeHidden();

  await page.getByRole('button', { name: 'START RACE' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'racing');
  await expect(page.locator('#hud')).toBeVisible();

  // score climbs while racing, and GAME OVER never appears early
  await page.waitForFunction(() => window.__GP__.info().score > 0, null, { timeout: 30_000 });
  const mid = await page.evaluate(() => window.__GP__.info());
  expect(mid.completedDays).toBeLessThan(mid.totalDays);
  await expect(page.locator('#screen-over')).toBeHidden();

  // The minimum pace (0.25 s/day) makes a real-time year last over a minute; fast-forward the
  // remaining frames through the same frame() path the requestAnimationFrame loop uses.
  await page.evaluate(() => {
    while (window.__GP__.info().state !== 'finished') window.__GP__.advance(1 / 30);
  });
  await expect(page.locator('#screen-over')).toBeVisible({ timeout: 10_000 });
  const done = await page.evaluate(() => window.__GP__.info());
  expect(done).toMatchObject({ state: 'finished', score: data.totalContributions, completedDays: data.totalDays, collisions: 0 });
  await expect(page.locator('#over-score')).toHaveText(data.totalContributions.toLocaleString('en-US'));
  await expect(page.locator('#over-completion')).toHaveText('100%');
  await expect(page.locator('.profile-link')).toHaveAttribute('href', `https://github.com/${data.username}`);

  await page.getByRole('button', { name: 'RESTART RACE' }).click();
  await expect(page.locator('#screen-ready')).toBeVisible();
  expect((await page.evaluate(() => window.__GP__.info())).score).toBe(0);

  await page.getByRole('button', { name: 'START RACE' }).click();
  await page.getByRole('button', { name: 'PAUSE' }).click();
  await expect(page.locator('#screen-paused')).toBeVisible();
  await page.locator('#btn-resume').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'racing');

  await page.locator('#btn-mute').click();
  await expect(page.locator('#btn-mute')).toHaveText('SOUND ON');
  await page.keyboard.press('KeyM');
  await expect(page.locator('#btn-mute')).toHaveText('SOUND OFF');
  expect(errors).toEqual([]);
});

test('autoplay starts the race without interaction', async ({ page }) => {
  await page.goto('./?autoplay=1');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'racing', { timeout: 15_000 });
});

test('layout has no horizontal overflow and the canvas fills the stage', async ({ page }) => {
  await page.goto('./?autoplay=0');
  await expect(page.locator('#screen-ready')).toBeVisible();
  const { scrollW, clientW, canvasW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    canvasW: document.getElementById('game').getBoundingClientRect().width,
  }));
  expect(scrollW).toBeLessThanOrEqual(clientW);
  expect(canvasW).toBeCloseTo(clientW, -1);
});

test('missing data shows a clear error with retry and a labelled demo option', async ({ page }) => {
  await page.route('**/data/contributions/index.json', (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto('./');
  await expect(page.locator('#screen-error')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('not found');
  await page.getByRole('button', { name: 'PLAY DEMO DATA' }).click();
  await expect(page.locator('#screen-ready')).toBeVisible();
  await expect(page.locator('#ready-demo')).toBeVisible();
  await expect(page.locator('#ready-source')).toContainText('DEMO DATA');
});

test('invalid JSON is rejected instead of raced', async ({ page }) => {
  await page.route(/data\/contributions\/\d{4}\.json/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"username":"x","year":2026,"days":[]}' }));
  await page.goto('./');
  await expect(page.locator('#screen-error')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('Invalid contribution data');
});

test('historical season can be selected', async ({ page }) => {
  const index = await (await page.request.get('data/contributions/index.json')).json();
  test.skip(index.years.length < 2, 'only one season available');
  const older = index.years.at(-1);
  await page.goto(`./?year=${older}&autoplay=0`);
  await expect(page.locator('#ready-year')).toHaveText(String(older));
});
