// DOM layer: screens, setup, HUD and results. Writes to the DOM only when values change.
import { METERS_PER_UNIT } from '../three/world.js';

export const $ = (id) => document.getElementById(id);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SCREENS = ['landing', 'loading', 'setup', 'paused', 'results', 'error'];
export const formatDate = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}`;
export const fmt = (n) => Number(n).toLocaleString('en-US');
const cache = new Map();

export function set(id, value) {
  const v = String(value);
  if (cache.get(id) === v) return;
  cache.set(id, v);
  $(id).textContent = v;
}

/** Show one screen (or none while racing) and mirror the state on <body data-state>. */
export function show(state) {
  document.body.dataset.state = state;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== state;
  const racing = state === 'racing' || state === 'paused';
  $('hud').hidden = !racing;
}

export function loading(text) {
  $('loading-text').textContent = text;
  show('loading');
}

export function error(message) {
  $('error-message').textContent = message;
  show('error');
  $('btn-error-retry').focus();
}

function avatar(img, username, demo) {
  img.hidden = demo;
  if (!demo) img.src = `https://github.com/${encodeURIComponent(username)}.png?size=128`;
}

export function fillSeasons(select, current, selected) {
  select.replaceChildren(...Array.from({ length: current - 2007 }, (_, i) => current - i).map((y) => new Option(String(y), String(y), false, y === selected)));
}

export function setup(dataset, stats, race) {
  const demo = Boolean(dataset.demo);
  avatar($('setup-avatar'), dataset.username, demo);
  set('setup-user', demo ? 'Demo driver' : `@${dataset.username}`);
  set('setup-meta', `${dataset.year} season · ${formatDate(dataset.firstDate)} – ${formatDate(dataset.lastDate)} · ${sourceLabel(dataset)}`);
  $('setup-demo').hidden = !demo;
  set('setup-total', fmt(dataset.totalContributions));
  set('setup-days', dataset.totalDays);
  set('setup-active', stats.activeDays);
  set('setup-streak', `${stats.longestStreak} days`);
  set('setup-best', stats.bestDay ? `${stats.bestDay.contributions} · ${formatDate(stats.bestDay.date)}` : '—');
  set('setup-obstacles', race.rows.length);
  show('setup');
}

export const sourceLabel = (d) =>
  d.demo ? 'synthetic demo data' : d.source === 'graphql-oauth' ? 'GitHub API (signed in, incl. private counts)' : d.source === 'graphql' ? 'GitHub API' : 'public contribution calendar';

export function hudStatic(dataset, stats, mode, camera) {
  avatar($('hud-avatar'), dataset.username, Boolean(dataset.demo));
  set('hud-user', dataset.demo ? 'Demo driver' : `@${dataset.username}`);
  set('hud-year', `${dataset.year} season${dataset.demo ? ' · DEMO DATA' : ''}`);
  set('hud-total', fmt(dataset.totalContributions));
  set('hud-best', stats.bestDay ? stats.bestDay.contributions : 0);
  set('hud-mode', mode === 'manual' ? 'Manual' : 'Autonomous');
  set('hud-camera', camera);
  $('hud-nitro').hidden = mode !== 'manual';
}

export function hud(race, streaks, status) {
  const i = race.currentDayIndex;
  const day = race.currentDay;
  set('hud-date', formatDate(day.date));
  set('hud-today', `+${day.contributions} today`);
  set('hud-score', fmt(race.score));
  set('hud-days', `DAY ${race.completedDays} / ${race.totalDays}`);
  const pct = Math.floor(race.progress * 100);
  if (cache.get('pct') !== pct) {
    cache.set('pct', pct);
    set('hud-pct', `${pct}%`);
    $('hud-bar').style.width = `${pct}%`;
  }
  set('hud-speed', Math.round(race.speed * METERS_PER_UNIT * 3.6));
  set('hud-cleared', race.passed);
  set('hud-hits', race.collisions);
  set('hud-streak', streaks[i]);
  set('hud-status', status);
  if (race.mode === 'manual') {
    const n = Math.round(race.nitroTank * 100);
    if (cache.get('nitro') !== n) {
      cache.set('nitro', n);
      $('hud-nitro-bar').style.width = `${n}%`;
    }
  }
}

export function results(race, stats) {
  const d = race.dataset;
  set('results-sub', `${d.demo ? 'Demo driver' : `@${d.username}`} · ${d.year} season${d.demo ? ' · DEMO DATA' : ''}`);
  set('res-score', fmt(race.score));
  set('res-check', race.score === d.totalContributions ? `= ${fmt(d.totalContributions)} contributions ✓` : '');
  set('res-total', fmt(d.totalContributions));
  set('res-completion', `${Math.round(race.progress * 100)}%`);
  set('res-days', `${race.completedDays} / ${race.totalDays}`);
  set('res-active', stats.activeDays);
  set('res-zero', stats.zeroDays);
  set('res-streak', `${stats.longestStreak} days`);
  set('res-best', stats.bestDay ? `${stats.bestDay.contributions} · ${formatDate(stats.bestDay.date)}` : '—');
  set('res-cleared', `${race.passed} / ${race.rows.length}`);
  set('res-collisions', race.collisions);
  set('res-mode', race.mode === 'manual' ? 'Manual' : 'Autonomous');
  $('btn-profile').href = `https://github.com/${encodeURIComponent(d.username)}`;
  $('btn-profile').hidden = Boolean(d.demo);
  $('btn-readme').disabled = Boolean(d.demo);
  $('export').hidden = true;
  show('results');
}

let toastTimer;
export function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), 4000);
}

export function formatBytes(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}
