// GitHub contribution fetching shared by the owner's daily updater (Node) and the public
// contributions API (Cloudflare Worker). Runtime-neutral: only fetch/Response/TextDecoder.
import { buildDataset, normalizeCalendarDays, validateDataset } from './dataset.js';

const USER_AGENT = 'github-f1-grand-prix';
export const MAX_CALENDAR_BYTES = 2_000_000;

// GitHub logins: 1-39 chars, alphanumeric or single hyphens, no leading/trailing hyphen.
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
export const isValidUsername = (u) => typeof u === 'string' && USERNAME_RE.test(u);

/** Error with a stable code the API maps to HTTP statuses. Messages never contain tokens. */
export class GitHubError extends Error {
  constructor(code, message, { retryable = false, retryAfter } = {}) {
    super(message);
    this.code = code; // user_not_found | rate_limited | auth | upstream | invalid_data
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

const QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function withRetry(fn, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.retryable || err.name === 'TypeError'; // TypeError = network failure in fetch
      if (!retryable || i >= attempts) throw err;
      await sleep(2000 * i);
    }
  }
}

function rateLimitError(res) {
  const reset = res.headers.get('x-ratelimit-reset');
  const retryAfter = Number(res.headers.get('retry-after')) || (reset ? Math.max(1, Number(reset) - Date.now() / 1000) : 60);
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const when = reset ? ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.` : '';
    return new GitHubError('rate_limited', `GitHub API rate limit exhausted.${when}`, { retryAfter });
  }
  return new GitHubError('rate_limited', `GitHub API returned ${res.status} (secondary rate limit or missing token scope).`, {
    retryable: true,
    retryAfter,
  });
}

/** Read a response body as text, refusing anything larger than maxBytes. */
async function readCapped(res, maxBytes) {
  if (!res.body?.getReader) {
    const text = await res.text();
    if (text.length > maxBytes) throw new GitHubError('upstream', 'GitHub response was unexpectedly large.');
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new GitHubError('upstream', 'GitHub response was unexpectedly large.');
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function fetchGraphQL(username, year, token, { fetchImpl = fetch, now = new Date(), sleep } = {}) {
  const yearEnd = `${year}-12-31T23:59:59Z`;
  const nowIso = now.toISOString();
  const variables = { login: username, from: `${year}-01-01T00:00:00Z`, to: nowIso < yearEnd ? nowIso : yearEnd };
  const body = await withRetry(
    async () => {
      const res = await fetchImpl('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: QUERY, variables }),
      });
      if (res.status === 401) throw new GitHubError('auth', 'GitHub rejected the token (401): it is invalid, expired or revoked.');
      if (res.status === 403 || res.status === 429) throw rateLimitError(res);
      if (res.status >= 500) throw new GitHubError('upstream', `GitHub API server error ${res.status}.`, { retryable: true });
      if (!res.ok) throw new GitHubError('upstream', `GitHub API request failed with HTTP ${res.status}.`);
      return res.body?.getReader ? JSON.parse(await readCapped(res, MAX_CALENDAR_BYTES)) : res.json();
    },
    { sleep },
  );
  if (body.errors?.length) {
    const notFound = body.errors.some((e) => e.type === 'NOT_FOUND');
    throw new GitHubError(notFound ? 'user_not_found' : 'upstream', `GitHub GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  const calendar = body.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new GitHubError('user_not_found', `GitHub user "${username}" not found or calendar unavailable.`);
  return {
    raw: calendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
    total: calendar.totalContributions,
  };
}

/** Parses GitHub's public contribution calendar HTML (no token; public + shared private counts). */
export function parseContributionsHtml(html) {
  const dateById = new Map();
  for (const [tag] of html.matchAll(/<td\b[^>]*data-date="[^"]*"[^>]*>/g)) {
    dateById.set(/\bid="([^"]+)"/.exec(tag)?.[1], /data-date="([^"]+)"/.exec(tag)[1]);
  }
  const countById = new Map();
  for (const [, id, text] of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const m = /^(No|\d[\d,]*) contributions?\b/.exec(text.trim());
    if (m) countById.set(id, m[1] === 'No' ? 0 : Number(m[1].replace(/,/g, '')));
  }
  if (!dateById.size) throw new GitHubError('invalid_data', 'Public contribution calendar HTML had no days (page format changed?).');
  const raw = [...dateById].map(([id, date]) => {
    if (!countById.has(id)) throw new GitHubError('invalid_data', `No contribution count for ${date} in public calendar.`);
    return { date, count: countById.get(id) };
  });
  const heading = /(\d[\d,]*)\s+contributions?\s+in\s+\d{4}/.exec(html.replace(/\s+/g, ' '));
  return { raw, total: heading ? Number(heading[1].replace(/,/g, '')) : null };
}

export async function fetchPublic(username, year, { fetchImpl = fetch, sleep } = {}) {
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions?from=${year}-01-01&to=${year}-12-31`;
  const html = await withRetry(
    async () => {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 404) throw new GitHubError('user_not_found', `GitHub user "${username}" not found.`);
      if (res.status === 429) throw new GitHubError('rate_limited', 'github.com is rate limiting requests.', { retryable: true, retryAfter: 60 });
      if (res.status >= 500) throw new GitHubError('upstream', `github.com returned ${res.status}.`, { retryable: true });
      if (!res.ok) throw new GitHubError('upstream', `Public calendar request failed with HTTP ${res.status}.`);
      return readCapped(res, MAX_CALENDAR_BYTES);
    },
    { sleep },
  );
  return parseContributionsHtml(html);
}

export async function fetchYearDataset({ username, year, token, now = new Date(), fetchImpl, sleep, source }) {
  const { raw, total } = token
    ? await fetchGraphQL(username, year, token, { fetchImpl, now, sleep })
    : await fetchPublic(username, year, { fetchImpl, sleep });
  let days;
  try {
    days = normalizeCalendarDays(raw, year, now);
  } catch (err) {
    throw new GitHubError('invalid_data', err.message);
  }
  const dataset = buildDataset({ username, year, days, source: source ?? (token ? 'graphql' : 'public'), now });
  if (total !== null && dataset.totalContributions !== total) {
    throw new GitHubError('invalid_data', `Day sum ${dataset.totalContributions} != GitHub total ${total}; refusing to write.`);
  }
  return validateDataset(dataset);
}
