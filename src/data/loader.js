import { makeDemoDataset, validateDataset } from './dataset.js';

export class DataError extends Error {}

async function getJson(url, what) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new DataError(`Network error while loading the ${what}. Check your connection and retry.`);
  }
  if (!res.ok) {
    throw new DataError(`The ${what} was not found (HTTP ${res.status}). Run the "Update contributions" GitHub Action to generate it.`);
  }
  try {
    return await res.json();
  } catch {
    throw new DataError(`The ${what} is not valid JSON.`);
  }
}

/** Loads the generated contribution JSON (never calls the GitHub API from the browser). */
export async function loadContributions(config, onProgress = () => {}) {
  if (config.demo) {
    onProgress(1, 'Generating DEMO DATA');
    const now = new Date();
    return { dataset: makeDemoDataset(now.getUTCFullYear(), now, config.githubUsername), years: [] };
  }
  const base = import.meta.env.BASE_URL;
  onProgress(0.2, 'Loading contribution index');
  const index = await getJson(`${base}data/contributions/index.json`, 'contribution index');
  if (!Array.isArray(index.years) || !index.years.length) throw new DataError('The contribution index lists no years.');
  const year = config.selectedYear === 'auto' ? index.latestYear : Number(config.selectedYear);
  if (!index.years.includes(year)) {
    throw new DataError(`No contribution data for ${year}. Available years: ${index.years.join(', ')}.`);
  }
  onProgress(0.5, `Loading ${year} contributions`);
  const raw = await getJson(`${base}data/contributions/${year}.json`, `${year} contribution data`);
  try {
    return { dataset: validateDataset(raw), years: index.years };
  } catch (err) {
    throw new DataError(err.message);
  }
}
