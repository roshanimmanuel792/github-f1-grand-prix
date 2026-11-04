import './styles.css';
import { AudioManager } from './audio/audio.js';
import { resolveConfig } from './config.js';
import { computeStats, makeDemoDataset, runningStreaks } from './data/dataset.js';
import { isValidUsername } from './data/github.js';
import { apiBase, authStatus, loadSeason } from './data/loader.js';
import { GAME_OVER_AFTER } from './export/overlay.js';
import { GIF_PRESETS, README_SIZE_LIMIT, VIDEO_PRESETS } from './export/presets.js';
import { gifFileName, readmeMarkdown, shareUrl } from './export/readme.js';
import { MODES, Race, STATES } from './game/race.js';
import { createReplay, raceFromReplay } from './game/replay.js';
import { CAMERA_MODES } from './three/cameras.js';
import { Engine, webglSupport } from './three/engine.js';
import { METERS_PER_UNIT } from './three/world.js';
import { Input, isTouchDevice } from './ui/input.js';
import * as ui from './ui/ui.js';

const { $ } = ui;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CAMERA_LABELS = { chase: 'Chase cam', close: 'Close cam', cockpit: 'Cockpit', tv: 'TV director' };
const audio = new AudioManager();
const input = new Input($('touch'));
const currentYear = new Date().getUTCFullYear();

const app = {
  state: 'boot',
  config: null,
  engine: null,
  attract: null,
  dataset: null,
  stats: null,
  streaks: null,
  preview: null,
  race: null,
  replay: null,
  mode: MODES.AI,
  camera: 'chase',
  exporting: null,
  flash: { text: '', until: 0 },
  lastExport: null,
};

function setState(state) {
  app.state = state;
  ui.show(state);
  $('touch').hidden = !(state === 'racing' && app.mode === MODES.MANUAL && isTouchDevice());
  input.enabled = state === 'racing' && app.mode === MODES.MANUAL;
  if (!input.enabled) input.clear();
}

function showError(message) {
  app.state = 'error';
  ui.error(message);
}

function fail(err) {
  console.error(err);
  showError(err.message || String(err));
}

// ---------------------------------------------------------------- data + races
async function loadAttract(config) {
  try {
    const index = await (await fetch(`${import.meta.env.BASE_URL}data/contributions/index.json`, { cache: 'no-cache' })).json();
    return await loadSeason(config, { username: config.githubUsername, year: index.latestYear });
  } catch {
    return makeDemoDataset(currentYear); // background scenery only; never shown as anyone's stats
  }
}

function startAttract() {
  const race = new Race(app.attractData, { ...app.config, raceDurationSeconds: 240 });
  race.start();
  app.attract = race;
  app.engine.setRace(race);
}

async function lookup(username, year, { demo = false } = {}) {
  $('lookup-error').textContent = '';
  if (!demo && !isValidUsername(username)) {
    $('lookup-error').textContent = 'Enter a valid GitHub username (letters, numbers and single hyphens).';
    $('username').focus();
    return;
  }
  ui.loading(demo ? 'Generating a demo season…' : `Fetching @${username}'s ${year} contributions…`);
  app.state = 'loading';
  try {
    const dataset = await loadSeason(app.config, { username, year, demo });
    ui.loading('Building the circuit…');
    await new Promise((r) => requestAnimationFrame(r));
    prepare(dataset);
    if (!demo) history.replaceState(null, '', `?user=${encodeURIComponent(username)}&year=${year}`);
  } catch (err) {
    app.retry = () => lookup(username, year, { demo });
    fail(err);
  }
}

function prepare(dataset) {
  app.dataset = dataset;
  app.stats = computeStats(dataset.days);
  app.streaks = runningStreaks(dataset.days);
  app.preview = new Race(dataset, app.config, { mode: app.mode });
  app.engine.setRace(app.preview);
  ui.setup(dataset, app.stats, app.preview);
  app.state = 'setup';
  $('btn-start').focus();
}

function onRaceEvent(type, payload) {
  app.engine.onRaceEvent(type, payload);
  if (type === 'go') {
    audio.beep(880, 0, 0.4);
    flash('LIGHTS OUT — GO!', 1.2);
  } else if (type === 'pass') audio.pass();
  else if (type === 'collision') {
    audio.burst(0.3, 800, 200, 0.25, 'lowpass');
    flash(`HIT · ${payload.date} · SPEED LOST`, 1.2);
  } else if (type === 'day' && payload.contributions >= app.config.nitroThresholds[0]) audio.nitro();
  else if (type === 'finish') audio.finish();
}

function flash(text, seconds) {
  app.flash = { text, until: performance.now() + seconds * 1000 };
}

function startRace() {
  app.mode = document.querySelector('input[name=mode]:checked').value;
  app.camera = $('opt-camera').value;
  const race = new Race(app.dataset, app.config, { mode: app.mode, onEvent: onRaceEvent, log: app.config.debug ? (d) => console.debug('[AI]', d) : undefined });
  app.race = race;
  app.replay = null;
  if (app.engine.race?.dataset === app.dataset) app.engine.attach(race);
  else app.engine.setRace(race);
  race.start();
  ui.hudStatic(app.dataset, app.stats, app.mode, CAMERA_LABELS[app.camera]);
  setState('racing');
}

function togglePause() {
  const race = app.race;
  if (!race || (app.state !== 'racing' && app.state !== 'paused') || race.state === STATES.FINISHED) return;
  race.togglePause();
  $('pause-camera').value = app.camera;
  $('pause-quality').value = app.engine.quality;
  setState(race.state === STATES.PAUSED ? 'paused' : 'racing');
  if (app.state === 'paused') $('btn-resume').focus();
}

function cycleCamera() {
  app.camera = CAMERA_MODES[(CAMERA_MODES.indexOf(app.camera) + 1) % CAMERA_MODES.length];
  ui.set('hud-camera', CAMERA_LABELS[app.camera]);
  flash(CAMERA_LABELS[app.camera].toUpperCase(), 0.8);
}

function toMenu() {
  if (app.race?.state === STATES.PAUSED) app.race.togglePause();
  app.race = null;
  startAttract();
  setState('landing');
  history.replaceState(null, '', location.pathname);
  $('username').focus();
}

function statusText(race) {
  if (performance.now() < app.flash.until) return app.flash.text;
  if (race.state === STATES.FINISHED) return 'CHEQUERED FLAG';
  if (race.countdown > 0) return `${'●'.repeat(race.lightsOn)}${'○'.repeat(5 - race.lightsOn)}`;
  const nitro = race.nitroLevel;
  if (nitro) return nitro >= 3 ? 'MAX NITRO' : `NITRO ×${nitro}`;
  if (race.mode === MODES.AI && Math.abs(race.car.vLat) > 0.5) return race.car.vLat < 0 ? '◀ AVOIDING' : 'AVOIDING ▶';
  if (race.mode === MODES.MANUAL && race.speed === 0) return 'HOLD GAS TO GO';
  return race.currentDay.contributions === 0 ? 'CLEAR TRACK' : '';
}

// ---------------------------------------------------------------- results + export
function showResults() {
  app.replay = createReplay(app.race);
  ui.results(app.race, app.stats);
  setState('results');
  $('btn-again').focus();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Decode the exported video with the browser's media pipeline (independent of the encoder). */
function probeVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, video: v });
    v.onerror = () => reject(new Error('This browser cannot play back the exported file.'));
    v.src = url;
  });
}

async function runExport(kind) {
  if (app.exporting || !app.replay) return null;
  const ctl = new AbortController();
  app.exporting = ctl;
  const panel = $('export');
  const result = $('export-result');
  panel.hidden = false;
  result.hidden = true;
  result.replaceChildren();
  $('export-title').textContent = kind === 'gif' ? 'Rendering full-season GIF (2× replay)' : 'Rendering full-season video (2× replay)';
  $('btn-cancel').hidden = false;
  const bar = $('export-bar');
  const status = $('export-status');
  const started = performance.now();
  const onProgress = (p, frames) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    bar.parentElement.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    status.textContent = `Frame ${frames} · ${Math.round(p * 100)}% · ${((performance.now() - started) / 1000).toFixed(0)} s`;
  };
  const race = raceFromReplay(app.replay, app.dataset, app.config, { onEvent: (t) => app.engine.onRaceEvent(t) });
  try {
    status.textContent = 'Loading encoder…';
    const [{ exportGif, exportVideo }, { inspectGif }] = await Promise.all([import('./export/recorder.js'), import('./export/gif.js')]);
    const out =
      kind === 'gif'
        ? await exportGif({ engine: app.engine, race, preset: GIF_PRESETS[$('opt-gif').value], onProgress, signal: ctl.signal })
        : await exportVideo({ engine: app.engine, race, preset: VIDEO_PRESETS[$('opt-video').value], onProgress, signal: ctl.signal });
    if (out.score !== app.replay.result.score || out.completedDays !== app.dataset.totalDays) throw new Error('Replay did not reproduce the race; export discarded.');
    const url = URL.createObjectURL(out.blob);
    const base = app.dataset.demo ? `github-grand-prix-demo-${app.dataset.year}` : gifFileName(app.dataset.username, app.dataset.year).replace(/\.gif$/, '');
    const name = `${base}.${out.extension}`;
    let check;
    let preview;
    if (kind === 'gif') {
      const info = inspectGif(new Uint8Array(await out.blob.arrayBuffer()));
      if (info.frames !== out.frames || info.width !== out.width || info.height !== out.height) throw new Error('GIF validation failed.');
      check = `${info.frames} frames · ${info.duration.toFixed(1)} s · ${info.width}×${info.height}`;
      preview = Object.assign(document.createElement('img'), { src: url, alt: 'Exported replay GIF preview' });
      if (out.blob.size > README_SIZE_LIMIT) check += ' · over 10 MB: choose a smaller GIF size for README use';
    } else {
      const probe = await probeVideo(url);
      if (Math.abs(probe.width - out.width) > 1 || Math.abs(probe.duration - out.duration) > 0.5) throw new Error('Video validation failed.');
      check = `${out.container.toUpperCase()} (${out.codec}) · ${probe.duration.toFixed(1)} s · ${probe.width}×${probe.height}`;
      preview = probe.video;
      preview.controls = true;
    }
    const link = Object.assign(document.createElement('a'), { href: url, download: name, className: 'btn primary small', textContent: `Save ${out.extension.toUpperCase()} again` });
    const meta = Object.assign(document.createElement('p'), { textContent: `${name} · ${ui.formatBytes(out.blob.size)} · ${check}` });
    result.append(preview, Object.assign(document.createElement('div'), {}), meta, link);
    result.hidden = false;
    bar.style.width = '100%';
    status.textContent = `Done in ${((performance.now() - started) / 1000).toFixed(0)} s. Validated ✓`;
    download(out.blob, name);
    app.lastExport = { kind, name, size: out.blob.size, frames: out.frames, duration: out.duration, width: out.width, height: out.height, codec: out.codec, container: out.container ?? 'gif', score: out.score };
    return app.lastExport;
  } catch (err) {
    status.textContent = err.name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${err.message}`;
    bar.style.width = '0%';
    app.lastExport = { error: err.message };
    return app.lastExport;
  } finally {
    $('btn-cancel').hidden = true;
    app.exporting = null;
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast(message);
  } catch {
    window.prompt('Copy this:', text);
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.exporting) return; // the exporter owns the renderer
  const engine = app.engine;
  if (app.race && ['racing', 'paused', 'results'].includes(app.state)) {
    const race = app.race;
    if (race.mode === MODES.MANUAL) race.setInput(input.bits);
    race.update(dt);
    engine.frame(dt, { cameraMode: app.state === 'results' ? 'tv' : app.camera });
    if (app.state === 'racing') {
      ui.hud(race, app.streaks, statusText(race));
      if (race.state === STATES.FINISHED && race.time - race.finishedAt >= GAME_OVER_AFTER) showResults();
    }
    audio.setEngine(race.speed / race.cruiseSpeed, race.nitroLevel);
  } else if (app.state === 'setup') {
    engine.frame(dt, { cameraMode: 'tv' });
  } else if (app.attract) {
    const a = app.attract;
    a.update(dt);
    if (a.state === STATES.FINISHED && a.time - a.finishedAt > 6) {
      a.reset();
      a.start();
    }
    engine.frame(dt, { cameraMode: 'tv' });
  }
  if (app.config.debug && (fpsAcc += dt) > 0.5) {
    const r = app.race ?? app.attract;
    $('hud-debug').hidden = false;
    $('hud-debug').textContent = `FPS ${Math.round(++fpsFrames / fpsAcc)} · res ${engine.resScale.toFixed(2)} · ${engine.quality} · x ${r?.car.x.toFixed(2)} · hits ${r?.collisions}`;
    fpsAcc = fpsFrames = 0;
  } else fpsFrames++;
}

// ---------------------------------------------------------------- wiring
function bind() {
  $('lookup').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup($('username').value.trim().replace(/^@/, ''), Number($('season').value));
  });
  $('btn-demo').addEventListener('click', () => lookup('', Number($('season').value), { demo: true }));
  $('btn-back').addEventListener('click', toMenu);
  $('btn-start').addEventListener('click', startRace);
  $('opt-quality').addEventListener('change', (e) => app.engine.setQuality(e.target.value));
  $('pause-quality').addEventListener('change', (e) => app.engine.setQuality(e.target.value));
  $('opt-env').addEventListener('change', (e) => app.engine.setEnvironment(e.target.value));
  $('pause-camera').addEventListener('change', (e) => {
    app.camera = e.target.value;
    ui.set('hud-camera', CAMERA_LABELS[app.camera]);
  });
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-restart').addEventListener('click', startRace);
  $('btn-menu').addEventListener('click', toMenu);
  $('btn-cam').addEventListener('click', cycleCamera);
  $('btn-mute').addEventListener('click', () => {
    const muted = audio.toggleMute();
    $('btn-mute').textContent = muted ? 'Sound off' : 'Sound on';
    $('btn-mute').setAttribute('aria-pressed', String(!muted));
  });
  $('btn-again').addEventListener('click', startRace);
  $('btn-results-menu').addEventListener('click', toMenu);
  $('btn-gif').addEventListener('click', () => runExport('gif'));
  $('btn-mp4').addEventListener('click', () => runExport('video'));
  $('btn-cancel').addEventListener('click', () => app.exporting?.abort());
  $('btn-readme').addEventListener('click', () => {
    const d = app.dataset;
    copyText(readmeMarkdown({ username: d.username, year: d.year, score: app.race.score, days: d.totalDays, mode: app.mode }), `README markdown copied. Commit ${gifFileName(d.username, d.year)} next to your README.`);
  });
  $('btn-share').addEventListener('click', async () => {
    const d = app.dataset;
    const url = d.demo ? location.origin + location.pathname : shareUrl({ username: d.username, year: d.year, mode: app.mode }, location.origin + location.pathname);
    if (navigator.share && isTouchDevice()) navigator.share({ title: 'GitHub Grand Prix', url }).catch(() => {});
    else copyText(url, 'Race link copied.');
  });
  $('btn-error-retry').addEventListener('click', () => (app.retry ? app.retry() : location.reload()));
  $('btn-error-back').addEventListener('click', toMenu);
  $('btn-signin').addEventListener('click', () => {
    location.href = `${apiBase(app.config)}/auth/login?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
  });
  $('btn-signout').addEventListener('click', async () => {
    await fetch(`${apiBase(app.config)}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    location.reload();
  });
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyC' && app.state === 'racing') cycleCamera();
  });
  addEventListener('resize', () => app.engine.resize(innerWidth, innerHeight));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.state === 'racing' && app.race?.state === STATES.RACING) togglePause();
  });
}

async function boot() {
  try {
    app.config = resolveConfig(location.search, { reducedMotion });
  } catch (err) {
    return fail(err);
  }
  const config = app.config;
  if (!webglSupport()) {
    return showError('This device or browser does not support WebGL 2, which GitHub Grand Prix needs for its 3D circuit. Try a recent Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.');
  }
  ui.fillSeasons($('season'), currentYear, Number(config.selectedYear) || currentYear);
  $('opt-quality').value = config.quality;
  $('opt-env').value = config.environment;
  $('opt-camera').value = app.camera;
  for (const [k, p] of Object.entries(GIF_PRESETS)) $('opt-gif').append(new Option(p.label, k, false, k === 'readme'));
  for (const [k, p] of Object.entries(VIDEO_PRESETS)) $('opt-video').append(new Option(p.label, k, false, k === 'p720'));
  document.querySelector(`input[name=mode][value=${config.mode}]`).checked = true;
  bind();
  ui.loading('Building the circuit…');
  try {
    app.engine = new Engine($('scene'), { quality: config.quality, environment: config.environment, reducedMotion });
  } catch (err) {
    return showError(`Could not start the 3D renderer: ${err.message}`);
  }
  app.engine.resize(innerWidth, innerHeight);
  app.attractData = await loadAttract(config);
  startAttract();
  setState('landing');
  requestAnimationFrame(tick);

  import('./export/video.js').then((m) => m.videoSupport()).then((s) => {
    $('video-support').textContent = s ? `This browser exports ${s.container.toUpperCase()} (${s.codec})${s.container !== 'mp4' ? ' — MP4 is not available here' : ''}.` : 'Video export is not supported in this browser.';
    $('btn-mp4').textContent = s && s.container !== 'mp4' ? 'Download WebM' : 'Download MP4';
    $('btn-mp4').disabled = !s;
  });
  authStatus(config).then((s) => {
    if (!s?.configured) return;
    $('signin-wrap').hidden = s.authenticated;
    if (s.authenticated) {
      $('auth-chip').hidden = $('btn-signout').hidden = false;
      $('auth-chip').textContent = `Signed in as @${s.login}`;
      if (!$('username').value) $('username').value = s.login;
    }
  });

  const params = new URLSearchParams(location.search);
  if (config.demo) lookup('', Number(config.selectedYear) || currentYear, { demo: true });
  else if (config.user) {
    $('username').value = config.user;
    lookup(config.user, Number(params.get('year')) || currentYear);
  } else $('username').focus();

  window.__GP__ = {
    get state() {
      return app.state;
    },
    info() {
      const r = app.race ?? app.preview ?? app.attract;
      return {
        state: app.state,
        raceState: r?.state,
        countdown: r?.countdown ?? 0,
        mode: r?.mode,
        camera: app.camera,
        username: r?.dataset.username,
        demo: Boolean(r?.dataset.demo),
        score: r?.score,
        totalContributions: r?.totalContributions,
        completedDays: r?.completedDays,
        totalDays: r?.totalDays,
        collisions: r?.collisions,
        passed: r?.passed,
        obstacles: r?.rows.length,
        x: r?.car.x,
        speedKmh: r ? r.speed * METERS_PER_UNIT * 3.6 : 0,
        quality: app.engine.quality,
        resScale: app.engine.resScale,
        replayInputs: app.replay?.inputs.length ?? null,
      };
    },
    /** Fast-forward the current race through its normal fixed-step simulation. */
    fastForward(maxSeconds = 3600) {
      const r = app.race;
      for (let t = 0; t < maxSeconds && r.state !== STATES.FINISHED; t += 0.25) {
        if (r.mode === MODES.MANUAL) r.setInput(input.bits);
        r.update(0.25);
      }
      return this.info();
    },
    exportGif: async (preset = 'readme') => (($('opt-gif').value = preset), runExport('gif')),
    exportVideo: async (preset = 'p480') => (($('opt-video').value = preset), runExport('video')),
  };
}

boot();
