// GitHub Grand Prix contributions API (Cloudflare Worker).
// Public lookups scrape GitHub's public contribution calendar server-side (browsers can't: no CORS).
// Optional OAuth lets a visitor include their own private contribution counts.
// The repository owner's GH_TOKEN is never available here.
import { GitHubError, fetchYearDataset, isValidUsername } from '../../src/data/github.js';

const DEFAULTS = {
  ALLOWED_ORIGINS: 'https://roshanimmanuel792.github.io,http://localhost:5173,http://localhost:4173',
  FRONTEND_URL: 'https://roshanimmanuel792.github.io/github-f1-grand-prix/',
  CACHE_TTL_SECONDS: '3600', // current season
  HISTORY_TTL_SECONDS: '604800', // finished seasons barely change
  RATE_LIMIT_PER_MINUTE: '30',
};
const SESSION_TTL = 8 * 3600;
const STATE_TTL = 600;
const SESSION_COOKIE = '__Host-gp_session';
const STATE_COOKIE = '__Host-gp_oauth';
const STATUS = { user_not_found: 404, rate_limited: 503, invalid_data: 502, upstream: 502, auth: 401 };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
};

const setting = (env, key) => env?.[key] ?? DEFAULTS[key];
const allowedOrigins = (env) => setting(env, 'ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
export const oauthConfigured = (env) => Boolean(env?.GITHUB_CLIENT_ID && env?.GITHUB_CLIENT_SECRET && env?.SESSION_SECRET?.length >= 32);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, env, status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...corsHeaders(request, env), ...headers },
  });
}

const fail = (request, env, status, code, message, headers) => json(request, env, status, { error: { code, message } }, { 'Cache-Control': 'no-store', ...headers });

// ---------- sessions: AES-GCM encrypted cookies (no server-side storage needed) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sessionKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(env), new TextEncoder().encode(JSON.stringify(data))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64url(out);
}

export async function unseal(env, value, nowSec) {
  try {
    const bytes = unb64url(value);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await sessionKey(env), bytes.slice(12));
    const data = JSON.parse(new TextDecoder().decode(pt));
    return data.exp > nowSec ? data : null;
  } catch {
    return null; // tampered, wrong key or malformed
  }
}

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const cookie = (name, value, maxAge, sameSite) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;

/** Only redirect back to an allowed frontend origin (prevents open redirects). */
export function safeReturnTo(env, value) {
  const fallback = setting(env, 'FRONTEND_URL');
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.hostname === 'localhost') && allowedOrigins(env).includes(url.origin)) return url.href;
  } catch {}
  return fallback;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- rate limiting & caching ----------
const windows = new Map();
function memoryAllow(key, limit, nowMs) {
  const minute = Math.floor(nowMs / 60_000);
  const entry = windows.get(key);
  if (!entry || entry.minute !== minute) {
    if (windows.size > 10_000) windows.clear(); // bound memory per isolate
    windows.set(key, { minute, count: 1 });
    return true;
  }
  return ++entry.count <= limit;
}

function memoryCache() {
  const store = new Map();
  return {
    async match(key) {
      const hit = store.get(key);
      return hit && hit.expires > Date.now() ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
    async put(key, res) {
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1] || 0);
      store.set(key, { body: await res.text(), headers: Object.fromEntries(res.headers), expires: Date.now() + maxAge * 1000 });
    },
  };
}

/**
 * Build a handler with injectable dependencies (tests pass fake fetch/cache/clock).
 * In production Cloudflare provides fetch and caches.default.
 */
export function createHandler({ fetchImpl = (...a) => fetch(...a), cache, now = () => new Date(), sleep } = {}) {
  const inflight = new Map();
  const getCache = () => cache ?? (cache = globalThis.caches?.default ?? memoryCache());

  async function contributions(request, env, ctx, url) {
    const user = url.searchParams.get('user') || '';
    const year = Number(url.searchParams.get('year'));
    const current = now().getUTCFullYear();
    if (!isValidUsername(user)) return fail(request, env, 400, 'invalid_username', 'That is not a valid GitHub username.');
    if (!Number.isInteger(year) || year < 2008 || year > current) return fail(request, env, 400, 'invalid_year', `Year must be between 2008 and ${current}.`);

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const limited = env?.RATE_LIMITER?.limit
      ? !(await env.RATE_LIMITER.limit({ key: ip })).success
      : !memoryAllow(ip, Number(setting(env, 'RATE_LIMIT_PER_MINUTE')), now().getTime());
    if (limited) return fail(request, env, 429, 'rate_limited', 'Too many lookups. Please wait a minute and try again.', { 'Retry-After': '60' });

    const login = user.toLowerCase();
    // Signed-in visitor asking for their own season: use their token, never share-cache it.
    if (oauthConfigured(env)) {
      const raw = getCookie(request, SESSION_COOKIE);
      const session = raw && (await unseal(env, raw, now().getTime() / 1000));
      if (session && session.login.toLowerCase() === login) {
        const dataset = await fetchYearDataset({ username: session.login, year, token: session.token, now: now(), fetchImpl, sleep, source: 'graphql-oauth' });
        return json(request, env, 200, dataset, { 'Cache-Control': 'private, no-store' });
      }
    }

    const ttl = Number(setting(env, year < current ? 'HISTORY_TTL_SECONDS' : 'CACHE_TTL_SECONDS'));
    const key = `https://gp-cache.internal/v1/contributions/${login}/${year}`;
    const hit = await getCache().match(key);
    if (hit) return json(request, env, 200, JSON.parse(await hit.text()), { 'Cache-Control': `public, max-age=${ttl}`, 'X-Cache': 'HIT' });

    if (!inflight.has(key)) {
      inflight.set(
        key,
        fetchYearDataset({ username: login, year, token: '', now: now(), fetchImpl, sleep }).finally(() => inflight.delete(key)),
      );
    }
    const dataset = await inflight.get(key);
    const body = JSON.stringify(dataset);
    const put = getCache().put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
    ctx?.waitUntil ? ctx.waitUntil(put) : await put;
    return json(request, env, 200, dataset, { 'Cache-Control': `public, max-age=${ttl}`, 'X-Cache': 'MISS' });
  }

  async function login(request, env, url) {
    if (!oauthConfigured(env)) return fail(request, env, 501, 'oauth_not_configured', 'GitHub sign-in is not configured on this server.');
    const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const returnTo = safeReturnTo(env, url.searchParams.get('return_to'));
    const sealed = await seal(env, { state, returnTo, exp: now().getTime() / 1000 + STATE_TTL });
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
    authorize.searchParams.set('scope', 'read:user');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');
    return new Response(null, {
      status: 302,
      headers: { Location: authorize.href, 'Set-Cookie': cookie(STATE_COOKIE, sealed, STATE_TTL, 'Lax'), 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
    });
  }

  async function callback(request, env, url) {
    if (!oauthConfigured(env)) return fail(request, env, 501, 'oauth_not_configured', 'GitHub sign-in is not configured on this server.');
    const raw = getCookie(request, STATE_COOKIE);
    const saved = raw && (await unseal(env, raw, now().getTime() / 1000));
    if (!saved || !constantTimeEqual(saved.state, url.searchParams.get('state') || '')) {
      return fail(request, env, 400, 'invalid_state', 'Sign-in expired or was tampered with. Please try again.');
    }
    const back = new URL(saved.returnTo);
    const clearState = cookie(STATE_COOKIE, '', 0, 'Lax');
    const redirect = (status, extraCookie) => {
      back.searchParams.set('auth', status);
      const headers = new Headers({ Location: back.href, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      headers.append('Set-Cookie', clearState);
      if (extraCookie) headers.append('Set-Cookie', extraCookie);
      return new Response(null, { status: 302, headers });
    };
    const code = url.searchParams.get('code');
    if (!code) return redirect('denied');

    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'github-f1-grand-prix' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/callback` }),
    });
    const tokenBody = tokenRes.ok ? await tokenRes.json() : {};
    if (!tokenBody.access_token) return redirect('error');
    const userRes = await fetchImpl('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'github-f1-grand-prix' },
    });
    const ghUser = userRes.ok ? await userRes.json() : {};
    if (!isValidUsername(ghUser.login)) return redirect('error');
    const session = await seal(env, { token: tokenBody.access_token, login: ghUser.login, exp: now().getTime() / 1000 + SESSION_TTL });
    // SameSite=None: the frontend (github.io) calls this API cross-site with credentials.
    return redirect('ok', cookie(SESSION_COOKIE, session, SESSION_TTL, 'None'));
  }

  async function me(request, env) {
    const raw = oauthConfigured(env) && getCookie(request, SESSION_COOKIE);
    const session = raw && (await unseal(env, raw, now().getTime() / 1000));
    return json(request, env, 200, { configured: oauthConfigured(env), authenticated: Boolean(session), login: session?.login ?? null }, { 'Cache-Control': 'no-store' });
  }

  async function logout(request, env) {
    // CSRF: state-changing request must come from an allowed origin.
    if (!allowedOrigins(env).includes(request.headers.get('Origin'))) return fail(request, env, 403, 'forbidden_origin', 'Origin not allowed.');
    const raw = oauthConfigured(env) && getCookie(request, SESSION_COOKIE);
    const session = raw && (await unseal(env, raw, now().getTime() / 1000));
    if (session) {
      await fetchImpl(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'github-f1-grand-prix',
        },
        body: JSON.stringify({ access_token: session.token }),
      }).catch(() => {}); // revocation is best-effort; the cookie is cleared regardless
    }
    return json(request, env, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0, 'None'), 'Cache-Control': 'no-store' });
  }

  return async function handle(request, env = {}, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(request, env) } });
      const route = `${request.method} ${url.pathname}`;
      if (route === 'GET /api/health') return json(request, env, 200, { ok: true, oauth: oauthConfigured(env) }, { 'Cache-Control': 'no-store' });
      if (route === 'GET /api/contributions') return await contributions(request, env, ctx, url);
      if (route === 'GET /auth/login') return await login(request, env, url);
      if (route === 'GET /auth/callback') return await callback(request, env, url);
      if (route === 'GET /auth/me') return await me(request, env);
      if (route === 'POST /auth/logout') return await logout(request, env);
      return fail(request, env, 404, 'not_found', 'Not found.');
    } catch (err) {
      if (err instanceof GitHubError) {
        const extra = err.retryAfter ? { 'Retry-After': String(Math.ceil(err.retryAfter)) } : {};
        return fail(request, env, STATUS[err.code] ?? 502, err.code, err.message, extra);
      }
      console.error('Unhandled error', err?.name); // never log request headers or tokens
      return fail(request, env, 500, 'internal_error', 'Something went wrong. Please try again.');
    }
  };
}

const handler = createHandler();
export default { fetch: (request, env, ctx) => handler(request, env, ctx) };
