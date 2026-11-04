import { beforeEach, describe, expect, it } from 'vitest';
import { createHandler, safeReturnTo, seal, unseal } from '../worker/src/index.js';

const NOW = new Date('2026-01-05T12:00:00Z');
const ORIGIN = 'https://roshanimmanuel792.github.io';
const ENV = { ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, FRONTEND_URL: `${ORIGIN}/github-f1-grand-prix/`, RATE_LIMIT_PER_MINUTE: '1000' };
const OAUTH = { ...ENV, GITHUB_CLIENT_ID: 'client-id', GITHUB_CLIENT_SECRET: 'client-secret', SESSION_SECRET: 'x'.repeat(40) };

function calendarHtml(counts) {
  const cells = counts.map((c, i) => `<td data-date="2026-01-0${i + 1}" id="d${i}"></td><tool-tip for="d${i}">${c ? `${c} contributions` : 'No contributions'} on Jan.</tool-tip>`);
  return `${cells.join('')}<h2>${counts.reduce((a, b) => a + b, 0)} contributions in 2026</h2>`;
}

function fakeGitHub(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [pattern, reply] of routes) if (pattern.test(String(url))) return reply(String(url), init);
    return new Response('not mocked', { status: 500 });
  };
  return { fetchImpl, calls };
}

const req = (path, init = {}) => new Request(`https://api.example.dev${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers || {}) } });
const cookieValue = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

describe('contributions API', () => {
  let gh;
  let handle;
  beforeEach(() => {
    gh = fakeGitHub([
      [/users\/octocat\/contributions/, () => new Response(calendarHtml([0, 2, 4, 8, 1]))],
      [/users\/torvalds\/contributions/, () => new Response(calendarHtml([5, 5, 5, 5, 5]))],
      [/users\/ghost-nobody\/contributions/, () => new Response('Not Found', { status: 404 })],
      [/users\/flaky\/contributions/, () => new Response('oops', { status: 503 })],
      [/users\/huge\/contributions/, () => new Response('x'.repeat(2_100_000))],
    ]);
    handle = createHandler({ fetchImpl: gh.fetchImpl, now: () => NOW, sleep: async () => {} });
  });

  it('returns a validated dataset for a public user, with CORS for allowed origins', async () => {
    const res = await handle(req('/api/contributions?user=OctoCat&year=2026'), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const d = await res.json();
    expect(d).toMatchObject({ username: 'octocat', year: 2026, totalContributions: 15, totalDays: 5, source: 'public', lastDate: '2026-01-05' });
  });

  it('isolates users: different usernames give different datasets', async () => {
    const a = await (await handle(req('/api/contributions?user=octocat&year=2026'), ENV)).json();
    const b = await (await handle(req('/api/contributions?user=torvalds&year=2026'), ENV)).json();
    expect(a.username).toBe('octocat');
    expect(b.username).toBe('torvalds');
    expect(b.totalContributions).toBe(25);
  });

  it('caches by normalized username + year', async () => {
    const first = await handle(req('/api/contributions?user=octocat&year=2026'), ENV);
    const second = await handle(req('/api/contributions?user=OCTOCAT&year=2026'), ENV);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(gh.calls.filter((c) => c.url.includes('octocat'))).toHaveLength(1);
    expect(await second.json()).toEqual(await first.json());
  });

  it('dedupes concurrent lookups for the same user', async () => {
    await Promise.all([1, 2, 3].map(() => handle(req('/api/contributions?user=octocat&year=2026'), ENV)));
    expect(gh.calls).toHaveLength(1);
  });

  it.each([
    ['/api/contributions?user=-bad-&year=2026', 400, 'invalid_username'],
    ['/api/contributions?user=a%2F..%2Fetc&year=2026', 400, 'invalid_username'],
    ['/api/contributions?user=octocat&year=2031', 400, 'invalid_year'],
    ['/api/contributions?user=ghost-nobody&year=2026', 404, 'user_not_found'],
    ['/api/contributions?user=flaky&year=2026', 502, 'upstream'],
    ['/api/contributions?user=huge&year=2026', 502, 'upstream'],
    ['/nope', 404, 'not_found'],
  ])('%s → %i %s', async (path, status, code) => {
    const res = await handle(req(path), ENV);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it('never calls GitHub for invalid input (no arbitrary URL fetching)', async () => {
    await handle(req('/api/contributions?user=https://evil.example&year=2026'), ENV);
    expect(gh.calls).toHaveLength(0);
  });

  it('rate limits per IP', async () => {
    const env = { ...ENV, RATE_LIMIT_PER_MINUTE: '2' };
    const ask = () => handle(req('/api/contributions?user=octocat&year=2026', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    const blocked = await ask();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
  });

  it('uses the Cloudflare rate-limit binding when present', async () => {
    const env = { ...ENV, RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== 'blocked-ip' }) } };
    const res = await handle(req('/api/contributions?user=octocat&year=2026', { headers: { 'CF-Connecting-IP': 'blocked-ip' } }), env);
    expect(res.status).toBe(429);
  });

  it('does not grant CORS to unknown origins', async () => {
    const res = await handle(req('/api/contributions?user=octocat&year=2026', { headers: { Origin: 'https://evil.example' } }), ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('reports health and OAuth configuration', async () => {
    expect(await (await handle(req('/api/health'), ENV)).json()).toEqual({ ok: true, oauth: false });
    expect(await (await handle(req('/api/health'), OAUTH)).json()).toEqual({ ok: true, oauth: true });
  });
});

describe('OAuth', () => {
  const token = 'gho_secret_token_value';
  let gh;
  let handle;
  beforeEach(() => {
    gh = fakeGitHub([
      [/login\/oauth\/access_token/, () => Response.json({ access_token: token, scope: 'read:user' })],
      [/api\.github\.com\/user$/, () => Response.json({ login: 'OctoCat' })],
      [/api\.github\.com\/graphql/, () =>
        Response.json({ data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: 7, weeks: [{ contributionDays: [1, 2, 0, 3, 1].map((c, i) => ({ date: `2026-01-0${i + 1}`, contributionCount: c })) }] } } } } }),
      ],
      [/applications\/client-id\/token/, () => new Response(null, { status: 204 })],
      [/users\/octocat\/contributions/, () => new Response(calendarHtml([0, 0, 0, 0, 1]))],
    ]);
    handle = createHandler({ fetchImpl: gh.fetchImpl, now: () => NOW, sleep: async () => {} });
  });

  async function signIn() {
    const login = await handle(req(`/auth/login?return_to=${encodeURIComponent(`${ORIGIN}/github-f1-grand-prix/`)}`), OAUTH);
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    const stateCookie = cookieValue(login, '__Host-gp_oauth');
    const cb = await handle(req(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `__Host-gp_oauth=${stateCookie}` } }), OAUTH);
    return { login, cb, session: cookieValue(cb, '__Host-gp_session') };
  }

  it('returns 501 when OAuth is not configured', async () => {
    expect((await handle(req('/auth/login'), ENV)).status).toBe(501);
  });

  it('redirects to GitHub with minimal scope and a state cookie', async () => {
    const res = await handle(req('/auth/login'), OAUTH);
    const loc = new URL(res.headers.get('Location'));
    expect(res.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('scope')).toBe('read:user');
    expect(loc.searchParams.get('state')).toMatch(/^[\w-]{40,}$/);
    expect(res.headers.get('Set-Cookie')).toMatch(/__Host-gp_oauth=.*HttpOnly; SameSite=Lax/);
    expect(loc.href).not.toContain('client-secret');
  });

  it('rejects a callback whose state does not match (CSRF)', async () => {
    const login = await handle(req('/auth/login'), OAUTH);
    const stateCookie = cookieValue(login, '__Host-gp_oauth');
    const res = await handle(req('/auth/callback?code=abc&state=forged', { headers: { Cookie: `__Host-gp_oauth=${stateCookie}` } }), OAUTH);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_state');
    expect(gh.calls.some((c) => c.url.includes('access_token'))).toBe(false);
  });

  it('exchanges the code server-side, sets an encrypted HttpOnly session, and never puts the token in the URL', async () => {
    const { cb, session } = await signIn();
    expect(cb.status).toBe(302);
    const location = cb.headers.get('Location');
    expect(location).toBe(`${ORIGIN}/github-f1-grand-prix/?auth=ok`);
    expect(location).not.toContain(token);
    expect(session).toBeTruthy();
    expect(session).not.toContain(token);
    expect(cb.headers.getSetCookie().join()).toMatch(/__Host-gp_session=.*HttpOnly; SameSite=None/);
    const exchange = gh.calls.find((c) => c.url.includes('access_token'));
    expect(JSON.parse(exchange.init.body).client_secret).toBe('client-secret');
  });

  it('serves the signed-in user their own season via GraphQL, uncached', async () => {
    const { session } = await signIn();
    const res = await handle(req('/api/contributions?user=octocat&year=2026', { headers: { Cookie: `__Host-gp_session=${session}` } }), OAUTH);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ username: 'OctoCat', totalContributions: 7, source: 'graphql-oauth' });
    const me = await (await handle(req('/auth/me', { headers: { Cookie: `__Host-gp_session=${session}` } }), OAUTH)).json();
    expect(me).toEqual({ configured: true, authenticated: true, login: 'OctoCat' });
  });

  it('uses public data when a signed-in user looks up someone else', async () => {
    const { session } = await signIn();
    gh.calls.length = 0;
    const res = await handle(req('/api/contributions?user=torvalds-x&year=2026', { headers: { Cookie: `__Host-gp_session=${session}` } }), OAUTH);
    expect(gh.calls.some((c) => c.url.includes('graphql'))).toBe(false);
    expect(res.status).toBe(502); // not mocked → upstream error, but crucially no token use
  });

  it('logout requires an allowed Origin, revokes the token and clears the cookie', async () => {
    const { session } = await signIn();
    const forged = await handle(req('/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: `__Host-gp_session=${session}` } }), OAUTH);
    expect(forged.status).toBe(403);
    const res = await handle(req('/auth/logout', { method: 'POST', headers: { Cookie: `__Host-gp_session=${session}` } }), OAUTH);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/__Host-gp_session=; .*Max-Age=0/);
    const revoke = gh.calls.find((c) => c.url.includes('applications/client-id/token'));
    expect(revoke.init.method).toBe('DELETE');
  });

  it('rejects tampered or expired sessions', async () => {
    const sealed = await seal(OAUTH, { token, login: 'octocat', exp: NOW.getTime() / 1000 + 60 });
    expect(await unseal(OAUTH, sealed, NOW.getTime() / 1000)).toMatchObject({ login: 'octocat' });
    expect(await unseal(OAUTH, sealed, NOW.getTime() / 1000 + 120)).toBeNull();
    expect(await unseal(OAUTH, `${sealed.slice(0, -2)}AA`, NOW.getTime() / 1000)).toBeNull();
    expect(await unseal({ SESSION_SECRET: 'y'.repeat(40) }, sealed, NOW.getTime() / 1000)).toBeNull();
  });

  it('prevents open redirects', () => {
    expect(safeReturnTo(OAUTH, 'https://evil.example/phish')).toBe(OAUTH.FRONTEND_URL);
    expect(safeReturnTo(OAUTH, 'javascript:alert(1)')).toBe(OAUTH.FRONTEND_URL);
    expect(safeReturnTo(OAUTH, `${ORIGIN}/github-f1-grand-prix/?x=1`)).toBe(`${ORIGIN}/github-f1-grand-prix/?x=1`);
  });
});
