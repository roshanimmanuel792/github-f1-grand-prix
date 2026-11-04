import { isValidUsername } from './github.js';
import { makeDemoDataset, validateDataset } from './dataset.js';

export class DataError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.code = code;
  }
}

const FRIENDLY = {
  invalid_username: 'That is not a valid GitHub username.',
  invalid_year: 'That season is not available.',
  user_not_found: 'No GitHub user with that name.',
  rate_limited: 'Too many lookups right now. Please wait a minute and try again.',
  upstream: 'GitHub did not respond properly. Please try again shortly.',
  invalid_data: 'GitHub returned contribution data we could not verify, so we will not race on it.',
};

async function getJson(url, what, init) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache', ...init });
  } catch {
    throw new DataError(`Network error while loading ${what}. Check your connection and retry.`, 'network');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new DataError(`${what} is not valid JSON.`, 'invalid_data');
  }
  if (!res.ok) {
    const code = body?.error?.code;
    if (res.status === 404 && !code) throw new DataError(`The contributions lookup service is not available on this deployment.`, 'no_api');
    throw new DataError(FRIENDLY[code] ?? body?.error?.message ?? `Lookup failed (HTTP ${res.status}).`, code ?? 'http');
  }
  return body;
}

/** Base URL of the contributions API: configured Worker URL, or same-origin (dev server middleware). */
export const apiBase = (config) => (config.apiBaseUrl ? config.apiBaseUrl.replace(/\/+$/, '') : '.');

/**
 * Load one user's season. The repository owner's season comes from the committed daily
 * dataset; everyone else goes through the contributions API. Results are always validated
 * and must belong to the requested user and year (no cross-user leakage).
 */
export async function loadSeason(config, { username, year, demo = false }) {
  const now = new Date();
  if (demo) return { ...makeDemoDataset(year ?? now.getUTCFullYear(), now, 'demo-driver') };
  if (!isValidUsername(username)) throw new DataError(FRIENDLY.invalid_username, 'invalid_username');
  const current = now.getUTCFullYear();
  if (!Number.isInteger(year) || year < 2008 || year > current) throw new DataError(FRIENDLY.invalid_year, 'invalid_year');

  let dataset;
  if (username.toLowerCase() === config.githubUsername.toLowerCase()) {
    dataset = await getJson(`${import.meta.env.BASE_URL}data/contributions/${year}.json`, `${year} contribution data`).catch(() => null);
  }
  if (!dataset) {
    const url = `${apiBase(config)}/api/contributions?user=${encodeURIComponent(username)}&year=${year}`;
    dataset = await getJson(url, 'contributions', { credentials: config.apiBaseUrl ? 'include' : 'same-origin' });
  }
  try {
    validateDataset(dataset);
  } catch (err) {
    throw new DataError(err.message, 'invalid_data');
  }
  if (dataset.username.toLowerCase() !== username.toLowerCase() || dataset.year !== year) {
    throw new DataError('The lookup service returned data for a different user or season.', 'invalid_data');
  }
  return dataset;
}

/** Optional GitHub sign-in status from the API (null when the API or OAuth is unavailable). */
export async function authStatus(config) {
  if (!config.apiBaseUrl) return null;
  try {
    const res = await fetch(`${apiBase(config)}/auth/me`, { credentials: 'include', cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
