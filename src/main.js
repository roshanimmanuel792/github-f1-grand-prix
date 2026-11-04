import './styles.css';
import { AudioManager } from './audio/audio.js';
import { resolveConfig } from './config.js';
import { computeStats, runningStreaks } from './data/dataset.js';
import { loadContributions } from './data/loader.js';
import { Race, STATES } from './game/race.js';
import { Renderer } from './render/renderer.js';
import { UI } from './ui/ui.js';

const GAME_OVER_DELAY = 1.4; // let the car coast past the flag first
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('game');
const audio = new AudioManager();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

let config;
let race;
let renderer;
let stats;
let streaks;
let appState = STATES.LOADING;
let autoStartIn = 0;
let overShown = false;
let goFlash = 0;
let visualTime = 0;

const ui = new UI({
  onStart: () => startRace(),
  onPause: () => race?.togglePause(),
  onRestart: () => restart(false),
  onRaceAgain: () => restart(true),
  onMute: () => ui.setMuted(audio.toggleMute()),
  onYear: (year) => navigate({ year, demo: null }),
  onDemo: () => navigate({ demo: '1', year: null }),
});

function navigate(params) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) (v === null ? q.delete(k) : q.set(k, v));
  location.search = q.toString();
}

function startRace() {
  if (!race || race.state !== STATES.READY) return;
  autoStartIn = 0;
  ui.autoStart(0);
  race.start();
}

function restart(raceNow) {
  if (!race) return;
  race.reset();
  renderer.lastZ = null;
  overShown = false;
  if (raceNow) race.start();
}

function statusText() {
  const { driver } = race;
  if (race.state === STATES.FINISHED) return 'CHEQUERED FLAG';
  if (race.state === STATES.PAUSED) return 'PAUSED';
  if (race.countdown > 0) return `LIGHTS ${'●'.repeat(race.lightsOn)}${'○'.repeat(5 - race.lightsOn)}`;
  if (goFlash > 0) return 'LIGHTS OUT — GO!';
  const nitro = race.nitroLevel;
  if (nitro) return nitro >= 3 ? 'MAX NITRO!!!' : `NITRO x${nitro}`;
  if (driver.maneuvering) {
    if (driver.targetLane === 1 && driver.next < race.rows.length && race.rowZ[driver.next] - race.z > driver.lookahead) return 'RACING LINE';
    return driver.to < driver.from ? '◀ AVOIDING' : 'AVOIDING ▶';
  }
  return race.currentDay.contributions === 0 ? 'CLEAR TRACK' : 'CRUISING';
}

function onEvent(type, payload) {
  if (type === 'go') {
    goFlash = 1;
    audio.beep(880, 0, 0.4);
  } else if (type === 'pass') audio.pass();
  else if (type === 'day') {
    const next = race.days[race.completedDays];
    if (next && next.contributions >= config.nitroThresholds[0]) audio.nitro();
  } else if (type === 'finish') audio.finish();
  else if (type === 'collision' && config.debug) console.warn('[AI] collision', payload);
}

/** One frame of simulation + presentation. */
function frame(dt) {
  visualTime += dt;
  if (autoStartIn > 0) {
    autoStartIn -= dt;
    ui.autoStart(autoStartIn);
    if (autoStartIn <= 0) startRace();
  }
  race.update(dt);
  goFlash = Math.max(0, goFlash - dt);
  renderer.render(race, visualTime);

  if (race.state !== appState) {
    appState = race.state;
    ui.setState(appState);
  }
  if (appState !== STATES.READY) ui.hud(race, streaks, statusText());
  if (appState === STATES.FINISHED && !overShown && race.time - race.finishedAt >= GAME_OVER_DELAY) {
    overShown = true;
    ui.gameOver(race, stats);
  }
  audio.setEngine(race.speed / race.cruiseSpeed, race.nitroLevel);
}

function loop() {
  const minFrameMs = 1000 / config.targetFPS - 1;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  const tick = (now) => {
    requestAnimationFrame(tick);
    const elapsed = now - last;
    if (elapsed < minFrameMs) return;
    last = now;
    frame(elapsed / 1000);
    if (config.debug && (fpsTime += elapsed) > 500) {
      const d = race.driver;
      ui.debug(`FPS ${Math.round((++fpsFrames * 1000) / fpsTime)} | row ${d.next}/${race.rows.length} | lane ${d.targetLane} | collisions ${race.collisions} | emergencies ${d.emergencies}`);
      fpsFrames = fpsTime = 0;
    } else fpsFrames++;
  };
  requestAnimationFrame(tick);
}

function info() {
  return {
    state: appState,
    score: race.score,
    totalContributions: race.totalContributions,
    completedDays: race.completedDays,
    totalDays: race.totalDays,
    collisions: race.collisions,
    passed: race.passed,
    obstacles: race.rows.length,
    emergencies: race.driver.emergencies,
    overShown,
    counts: race.days.map((d) => d.contributions),
  };
}

function bindKeys() {
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement || e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyP') {
      if (race.state === STATES.RACING || race.state === STATES.PAUSED) {
        e.preventDefault();
        race.togglePause();
      }
    } else if (e.code === 'Enter' && race.state === STATES.READY && !(e.target instanceof HTMLButtonElement)) startRace();
    else if (e.code === 'KeyR') restart(false);
    else if (e.code === 'KeyM') ui.setMuted(audio.toggleMute());
  });
}

async function boot() {
  ui.setState(STATES.LOADING);
  try {
    config = resolveConfig(location.search, { reducedMotion });
  } catch (err) {
    ui.error(err.message, false);
    return;
  }
  try {
    ui.loading(0.05, 'Reading race configuration');
    const { dataset, years } = await loadContributions(config, (p, text) => ui.loading(p, text));
    ui.loading(0.7, 'Building circuit, obstacles and AI route');
    await nextFrame();
    race = new Race(dataset, config, { onEvent, log: config.debug ? (d) => console.debug('[AI]', d) : undefined });
    ui.loading(0.85, 'Painting car, obstacles and scenery');
    await nextFrame();
    renderer = new Renderer(canvas, { resolution: config.resolution, reducedMotion, year: dataset.year });
    stats = computeStats(dataset.days);
    streaks = runningStreaks(dataset.days);
    ui.loading(1, 'Ready');
    ui.ready({ dataset, years, config, stats });
    new ResizeObserver(() => renderer.resize()).observe(canvas);
    bindKeys();
    appState = STATES.READY;
    ui.setState(appState);
    renderer.render(race, 0);
    window.__GP__ = {
      info,
      start: startRace,
      restart,
      seekDay: (d) => race.seekDay(d),
      advance: (dt) => (frame(dt), info()),
    };
    if (config.capture) {
      document.body.classList.add('capture');
      return; // capture tooling drives frames via __GP__.advance
    }
    if (config.autoPlay) autoStartIn = config.autoPlayDelaySeconds;
    loop();
  } catch (err) {
    console.error(err);
    ui.error(err.message, !config.demo);
  }
}

boot();
