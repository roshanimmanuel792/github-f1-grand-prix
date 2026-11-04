const $ = (id) => document.getElementById(id);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SCREENS = ['loading', 'ready', 'paused', 'over', 'error'];

export const formatDate = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}`;
const fmt = (n) => n.toLocaleString('en-US');

/** Thin DOM layer: screens, HUD and controls. Only touches the DOM when a value changes. */
export class UI {
  constructor(handlers) {
    this.cache = new Map();
    const on = (id, fn) => $(id).addEventListener('click', fn);
    on('btn-start', handlers.onStart);
    on('btn-restart-over', handlers.onRestart);
    on('btn-race-again', handlers.onRaceAgain);
    on('btn-resume', handlers.onPause);
    on('btn-pause', handlers.onPause);
    on('btn-restart', handlers.onRestart);
    on('btn-mute', handlers.onMute);
    on('btn-retry', () => location.reload());
    on('btn-demo', handlers.onDemo);
    $('year-select').addEventListener('change', (e) => handlers.onYear(e.target.value));
  }

  set(id, value) {
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    $(id).textContent = value;
  }

  show(screen) {
    for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
  }

  setState(state) {
    document.body.dataset.state = state;
    const inRace = state === 'racing' || state === 'paused' || state === 'finished';
    $('hud').hidden = !inRace;
    $('controls').hidden = !inRace || !this.showControls;
    $('btn-pause').textContent = state === 'paused' ? 'RESUME' : 'PAUSE';
    $('btn-pause').disabled = state === 'finished';
    if (state === 'loading' || state === 'error') this.show(state);
    else if (state === 'ready') this.show('ready');
    else if (state === 'paused') this.show('paused');
    else if (state === 'racing') this.show(null);
  }

  loading(progress, text) {
    $('load-bar').style.width = `${Math.round(progress * 100)}%`;
    $('load-text').textContent = text;
  }

  ready({ dataset, years, config, stats }) {
    this.showControls = config.showControls;
    const demo = Boolean(dataset.demo);
    $('demo-badge').hidden = !demo;
    $('ready-demo').hidden = !demo;
    this.set('ready-user', `@${dataset.username}`);
    this.set('ready-year', String(dataset.year));
    this.set('ready-total', fmt(dataset.totalContributions));
    this.set('ready-days', String(dataset.totalDays));
    this.set('ready-range', `${formatDate(dataset.firstDate)} → ${formatDate(dataset.lastDate)} ${dataset.year}`);
    this.set('ready-streak', `${stats.longestStreak} days`);
    this.set('ready-source', demo ? 'DEMO DATA (not real contributions)' : `GitHub ${dataset.source === 'graphql' ? 'GraphQL API' : 'public calendar'} · updated ${dataset.generatedAt.slice(0, 10)}`);
    const select = $('year-select');
    select.replaceChildren(...years.map((y) => new Option(String(y), String(y), false, y === dataset.year)));
    $('year-field').hidden = years.length < 2;
    for (const a of document.querySelectorAll('.profile-link')) a.href = `https://github.com/${encodeURIComponent(dataset.username)}`;
    this.set('hud-year', String(dataset.year));
    this.set('hud-total', fmt(dataset.totalContributions));
    this.set('hud-best', String(stats.longestStreak));
  }

  autoStart(seconds) {
    this.set('autostart', seconds > 0 ? `Lights out in ${Math.ceil(seconds)}…` : '');
  }

  hud(race, streaks, status) {
    const day = race.currentDay;
    const i = race.currentDayIndex;
    if (this.cache.get('day-index') !== i) {
      this.cache.set('day-index', i);
      this.set('hud-date', formatDate(day.date));
      this.set('hud-day', `${day.contributions} commit${day.contributions === 1 ? '' : 's'}`);
      this.set('hud-streak', String(streaks[i]));
    }
    this.set('hud-score', fmt(race.score));
    this.set('hud-days', `DAY ${race.completedDays}/${race.totalDays}`);
    const pct = Math.floor(race.progress * 100);
    if (this.cache.get('pct') !== pct) {
      this.cache.set('pct', pct);
      this.set('hud-pct', `${pct}%`);
      $('hud-bar').style.width = `${pct}%`;
    }
    this.set('hud-status', status);
  }

  gameOver(race, stats) {
    const d = race.dataset;
    this.set('over-user', `@${d.username}`);
    this.set('over-year', String(d.year));
    this.set('over-score', fmt(race.score));
    this.set('over-total', fmt(d.totalContributions));
    this.set('over-days', `${race.completedDays} / ${race.totalDays}`);
    this.set('over-completion', `${Math.round(race.progress * 100)}%`);
    this.set('over-finish', `${formatDate(d.lastDate)} ${d.year}`);
    this.set('stat-best', stats.bestDay ? `${stats.bestDay.contributions} on ${formatDate(stats.bestDay.date)}` : '—');
    this.set('stat-avg', stats.avgPerActiveDay.toFixed(2));
    this.set('stat-active', String(stats.activeDays));
    this.set('stat-zero', String(stats.zeroDays));
    this.set('stat-longest', `${stats.longestStreak} days`);
    this.set('stat-current', `${stats.currentStreak} days`);
    this.set('stat-obstacles', `${race.passed} / ${race.rows.length}`);
    this.show('over');
    $('btn-race-again').focus({ preventScroll: true });
  }

  error(message, canDemo) {
    this.set('error-message', message);
    $('btn-demo').hidden = !canDemo;
    this.setState('error');
  }

  setMuted(muted) {
    $('btn-mute').textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    $('btn-mute').setAttribute('aria-pressed', String(!muted));
  }

  debug(text) {
    const el = $('debug');
    el.hidden = false;
    el.textContent = text;
  }
}
