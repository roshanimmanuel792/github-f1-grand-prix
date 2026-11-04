import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig, validateConfig } from '../src/config.js';
import { isValidUsername } from '../src/data/github.js';
import { apiBase, loadSeason } from '../src/data/loader.js';
import { CONFIG, datasetFrom } from './helpers.js';

const config = { ...CONFIG, githubUsername: 'owner', apiBaseUrl: 'https://api.example.dev' };
const forUser = (username, counts = [1, 2, 3]) => ({ ...datasetFrom(counts, 2025), username });

function mockFetch(handler) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url));
  });
  return calls;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('usernames', () => {
  it.each([
    ['octocat', true],
    ['a', true],
    ['a-b-c', true],
    ['x'.repeat(39), true],
    ['x'.repeat(40), false],
    ['-lead', false],
    ['trail-', false],
    ['dou--ble', false],
    ['has space', false],
    ['../etc', false],
    ['', false],
  ])('%s → %s', (u, ok) => expect(isValidUsername(u)).toBe(ok));
});

describe('loadSeason', () => {
  it('loads a visitor season from the API with credentials and validates it', async () => {
    const calls = mockFetch(() => json(200, forUser('octocat')));
    const d = await loadSeason(config, { username: 'OctoCat', year: 2025 });
    expect(d.username).toBe('octocat');
    expect(calls[0].url).toBe('https://api.example.dev/api/contributions?user=OctoCat&year=2025');
    expect(calls[0].init.credentials).toBe('include');
  });

  it('refuses data for a different user or season', async () => {
    mockFetch(() => json(200, forUser('someone-else')));
    await expect(loadSeason(config, { username: 'octocat', year: 2025 })).rejects.toThrow(/different user/);
    mockFetch(() => json(200, { ...forUser('octocat'), year: 2025 }));
    await expect(loadSeason(config, { username: 'octocat', year: 2024 })).rejects.toThrow();
  });

  it('refuses invalid datasets instead of racing on them', async () => {
    mockFetch(() => json(200, { ...forUser('octocat'), totalContributions: 999 }));
    await expect(loadSeason(config, { username: 'octocat', year: 2025 })).rejects.toMatchObject({ code: 'invalid_data' });
  });

  it.each([
    [404, { error: { code: 'user_not_found' } }, 'No GitHub user with that name.'],
    [429, { error: { code: 'rate_limited' } }, /Too many lookups/],
    [502, { error: { code: 'upstream' } }, /GitHub did not respond/],
  ])('maps API %i to a friendly message', async (status, body, message) => {
    mockFetch(() => json(status, body));
    await expect(loadSeason(config, { username: 'octocat', year: 2025 })).rejects.toThrow(message);
  });

  it('explains when no lookup service is deployed', async () => {
    mockFetch(() => new Response('<html>404</html>', { status: 404 }));
    await expect(loadSeason({ ...config, apiBaseUrl: '' }, { username: 'octocat', year: 2025 })).rejects.toMatchObject({ code: 'no_api' });
  });

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(loadSeason(config, { username: 'octocat', year: 2025 })).rejects.toMatchObject({ code: 'network' });
  });

  it("serves the owner's season from the committed dataset, not the API", async () => {
    const calls = mockFetch((url) => (url.includes('/data/contributions/') ? json(200, forUser('owner')) : json(500, {})));
    const d = await loadSeason(config, { username: 'Owner', year: 2025 });
    expect(d.username).toBe('owner');
    expect(calls.every((c) => !c.url.includes('/api/'))).toBe(true);
  });

  it('rejects bad input before any request', async () => {
    const calls = mockFetch(() => json(200, {}));
    await expect(loadSeason(config, { username: 'bad name', year: 2025 })).rejects.toMatchObject({ code: 'invalid_username' });
    await expect(loadSeason(config, { username: 'octocat', year: 1999 })).rejects.toMatchObject({ code: 'invalid_year' });
    expect(calls).toHaveLength(0);
  });

  it('labels demo data and never fetches for it', async () => {
    const calls = mockFetch(() => json(500, {}));
    const d = await loadSeason(config, { demo: true, year: 2024 });
    expect(d.demo).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('config', () => {
  it('reads share-link parameters', () => {
    const c = resolveConfig('?user=octocat&year=2024&mode=manual&quality=low&env=night');
    expect(c).toMatchObject({ user: 'octocat', selectedYear: '2024', mode: 'manual', quality: 'low', environment: 'night' });
  });
  it('ignores unknown modes/qualities', () => {
    const c = resolveConfig('?mode=cheat&quality=insane');
    expect(c.mode).toBe('ai');
    expect(c.quality).toBe('high');
  });
  it('requires an https API URL', () => {
    expect(() => validateConfig({ ...CONFIG, apiBaseUrl: 'http://insecure.dev' })).toThrow(/https/);
    expect(apiBase({ apiBaseUrl: 'https://x.dev/' })).toBe('https://x.dev');
    expect(apiBase({ apiBaseUrl: '' })).toBe('.');
  });
});
