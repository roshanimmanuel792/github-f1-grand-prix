import { mulberry32 } from '../data/dataset.js';
import { LANES } from '../game/obstacles.js';
import { CAR_HALF_WIDTH, STATES } from '../game/race.js';
import { ROAD_WIDTH, SCENERY, SEGMENT_LENGTH, START_LINE_SEGMENT, heightAt } from '../game/track.js';
import { createSprites } from './sprites.js';

const FOV_DEG = 100;
const DEPTH = 1 / Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
const CAMERA_HEIGHT = 1100;
const PLAYER_Z = (DEPTH * ROAD_WIDTH) / 0.9; // road spans ~90% of the focal width at the car
const CAMERA_FOLLOW = 0.7;
const DRAW_DISTANCE = 300;
const FOG_STEPS = 24;
const FOG = [169, 216, 240];
const LANE_EDGE = 1 / 3;

const SCENERY_WIDTH = { [SCENERY.pine]: 1100, [SCENERY.tree]: 1500, [SCENERY.bush]: 700, [SCENERY.rock]: 500, [SCENERY.billboard]: 1700, [SCENERY.stand]: 2600 };
const OBSTACLE_WIDTH = { block: 1000, cone: 1050, tyres: 1000, tyreBarrier: 1333, barrier: 1333 };
const NITRO_STREAKS = [0, 10, 18, 30];

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (rgb, t) => `rgb(${rgb.map((c, i) => Math.round(c + (FOG[i] - c) * t)).join(',')})`;

function fogPalette(colors) {
  return Array.from({ length: FOG_STEPS }, (_, s) => {
    const t = s / (FOG_STEPS - 1);
    return Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, mix(hexRgb(v), t)]));
  });
}

const PALETTES = [
  fogPalette({ grass: '#43a84f', rumble: '#e01e2c', road: '#5d626a', lane: '#e9edf1' }),
  fogPalette({ grass: '#3a9446', rumble: '#f2f2f2', road: '#585d64', lane: '#585d64' }),
];

function offscreen(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  return c;
}

/** Pseudo-3D (OutRun-style) canvas renderer. Reads simulation state, never mutates it. */
export class Renderer {
  constructor(canvas, { resolution = 360, reducedMotion = false, year }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.resolution = resolution;
    this.reducedMotion = reducedMotion;
    this.sprites = createSprites(year);
    const n = DRAW_DISTANCE + 2;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pw = new Float32Array(n);
    this.ps = new Float32Array(n);
    this.offsets = { clouds: 0, far: 0, near: 0 };
    this.lastZ = null;
    const rand = mulberry32(7);
    this.streakAngles = Float32Array.from({ length: 32 }, () => (rand() < 0.5 ? Math.PI - 0.15 - rand() * 0.9 : 0.15 + rand() * 0.9));
    this.resize();
  }

  /** Fixed low internal resolution (pixel-art look, cheap on any DPR); CSS scales it up. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = Math.min(2.4, Math.max(1, (rect.width || 16) / (rect.height || 9)));
    const h = this.resolution;
    const w = Math.round(h * aspect);
    if (w === this.w && h === this.h) return;
    this.canvas.width = this.w = w;
    this.canvas.height = this.h = h;
    this.ctx.imageSmoothingEnabled = false;
    this.focal = Math.min(h * 0.889, w * 0.6);
    this.horizon = Math.round(h * 0.86 - CAMERA_HEIGHT * (DEPTH / PLAYER_Z) * this.focal);
    this.buildBackground();
  }

  buildBackground() {
    const { w, horizon } = this;
    const rand = mulberry32(42);
    this.sky = offscreen(w, horizon + 2, (g, cw, ch) => {
      const grad = g.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, '#1a4fa8');
      grad.addColorStop(0.6, '#5aa9e6');
      grad.addColorStop(1, `rgb(${FOG.join(',')})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      const sx = Math.round(cw * 0.78);
      const sy = Math.round(ch * 0.28);
      for (const [r, a] of [[26, 0.12], [18, 0.22], [12, 1]]) {
        g.fillStyle = a === 1 ? '#fff4c4' : `rgba(255,244,196,${a})`;
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fill();
      }
    });
    this.clouds = offscreen(w * 2, Math.round(horizon * 0.7), (g, cw, ch) => {
      for (let i = 0; i < 14; i++) {
        const x = rand() * cw;
        const y = rand() * ch * 0.8;
        const s = 6 + rand() * 10;
        for (let j = 0; j < 5; j++) {
          g.fillStyle = j < 2 ? 'rgba(255,255,255,0.95)' : 'rgba(236,244,252,0.9)';
          g.fillRect(Math.round(x + (j - 2) * s * 0.9), Math.round(y - (j % 2) * s * 0.5), Math.round(s * 1.6), Math.round(s * 0.8));
        }
      }
    });
    const ridge = (g, cw, ch, base, amp, color, snow) => {
      const pts = [];
      let y = base;
      for (let x = 0; x <= cw; x += 4) {
        y += (rand() - 0.5) * amp * 0.5 + (base - y) * 0.08;
        pts.push(y + Math.sin((x / cw) * Math.PI * 6) * amp * 0.6);
      }
      pts[pts.length - 1] = pts[0]; // seamless tiling
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, ch);
      pts.forEach((py, i) => g.lineTo(i * 4, Math.round(py)));
      g.lineTo(cw, ch);
      g.fill();
      if (snow) {
        g.fillStyle = '#eaf2ff';
        pts.forEach((py, i) => {
          if (py < base - amp * 0.35) g.fillRect(i * 4, Math.round(py), 4, Math.round((base - amp * 0.35 - py) * 0.6) + 1);
        });
      }
    };
    const farH = Math.round(horizon * 0.55);
    this.far = offscreen(w * 2, farH, (g, cw, ch) => ridge(g, cw, ch, ch * 0.45, ch * 0.5, '#6f86b5', true));
    const nearH = Math.round(horizon * 0.28);
    this.near = offscreen(w * 2, nearH, (g, cw, ch) => {
      ridge(g, cw, ch, ch * 0.5, ch * 0.4, '#2f7d3a', false);
      g.fillStyle = '#25662f';
      for (let x = 0; x < cw; x += 3 + Math.floor(rand() * 6)) {
        const th = 3 + Math.floor(rand() * 5);
        g.fillRect(x, ch - th - Math.floor(ch * 0.25 * rand()), 2, th);
      }
    });
  }

  drawLayer(img, offset, y) {
    const x = -Math.floor((((offset % 1) + 1) % 1) * img.width);
    this.ctx.drawImage(img, x, y);
    this.ctx.drawImage(img, x + img.width, y);
  }

  render(race, time) {
    const { ctx, w, h, focal, horizon, px, py, pw, ps } = this;
    const { track, driver } = race;
    const carZ = race.z;
    const camZ = carZ - PLAYER_Z;
    const camX = driver.x * ROAD_WIDTH * CAMERA_FOLLOW;
    const camY = heightAt(track, carZ) + CAMERA_HEIGHT;
    const carSeg = Math.min(track.count - 1, Math.floor(carZ / SEGMENT_LENGTH));
    const nitro = race.nitroLevel;
    const fx = !this.reducedMotion;
    this.finishSegment = track.finishSegment;

    const dz = this.lastZ === null ? 0 : Math.max(0, carZ - this.lastZ);
    this.lastZ = carZ;
    const bend = (track.curve[carSeg] * dz) / SEGMENT_LENGTH;
    this.offsets.far += bend * 0.0015;
    this.offsets.near += bend * 0.003;
    this.offsets.clouds += bend * 0.0008;

    ctx.save();
    if (fx && nitro >= 3) ctx.translate(Math.round(Math.sin(time * 70)), Math.round(Math.cos(time * 55)));

    // background
    ctx.drawImage(this.sky, 0, 0);
    const lift = Math.round((camY - CAMERA_HEIGHT) * 0.0025);
    this.drawLayer(this.clouds, this.offsets.clouds + (fx ? time * 0.004 : 0), Math.round(horizon * 0.05));
    this.drawLayer(this.far, this.offsets.far, horizon - this.far.height + lift + 2);
    this.drawLayer(this.near, this.offsets.near, horizon - this.near.height + lift * 2 + 2);
    ctx.fillStyle = PALETTES[1][FOG_STEPS - 1].grass;
    ctx.fillRect(0, horizon, w, h - horizon);

    // project segment boundaries, accumulating curvature (no allocation)
    const base = Math.floor(camZ / SEGMENT_LENGTH);
    let x = 0;
    let dx = -track.curve[Math.max(0, base)] * ((camZ % SEGMENT_LENGTH) / SEGMENT_LENGTH);
    let count = 0;
    for (let n = 0; n <= DRAW_DISTANCE; n++) {
      const i = base + n;
      if (i > track.count) break;
      const s = DEPTH / Math.max(1, i * SEGMENT_LENGTH - camZ);
      ps[n] = s;
      px[n] = w / 2 + s * (x - camX) * focal;
      py[n] = horizon - s * (track.height[Math.max(0, i)] - camY) * focal;
      pw[n] = s * ROAD_WIDTH * focal;
      x += dx;
      dx += track.curve[Math.min(track.count - 1, Math.max(0, i))];
      count = n;
    }

    // painter's order: far to near, road then that segment's sprites
    for (let n = count - 1; n >= 0; n--) {
      const i = base + n;
      if (i < 0 || i * SEGMENT_LENGTH - camZ <= 1) continue;
      const y1 = py[n];
      const y2 = py[n + 1];
      if (y2 < y1) this.drawSegment(i, n, y1, y2);
      this.drawSegmentSprites(race, i, n, camZ, time);
    }

    this.drawCar(race, time, camX, carSeg, nitro);
    if (fx && nitro > 0) this.drawStreaks(nitro, time);
    ctx.restore();
  }

  drawSegment(i, n, y1, ySeam) {
    const { ctx, w, px, pw } = this;
    const y2 = ySeam - 0.75; // overlap the farther segment to hide anti-aliasing seams
    const fogT = 1 - Math.exp(-((n / DRAW_DISTANCE) ** 2) * 4.5);
    const pal = PALETTES[Math.floor(i / 3) % 2][Math.min(FOG_STEPS - 1, Math.round(fogT * (FOG_STEPS - 1)))];
    const x1 = px[n];
    const x2 = px[n + 1];
    const w1 = pw[n];
    const w2 = pw[n + 1];
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, Math.floor(y2), w, Math.ceil(y1 - y2) + 1);
    quad(ctx, x1, y1, w1 * 1.12, x2, y2, w2 * 1.12, pal.rumble);
    const special = i === START_LINE_SEGMENT || i === this.finishSegment;
    if (special) {
      for (let k = 0; k < 8; k++) {
        const a = -1 + k / 4;
        ctx.fillStyle = (k + (i % 2)) % 2 ? '#111' : '#f5f5f5';
        quadSpan(ctx, x1, y1, w1, x2, y2, w2, a, a + 0.25);
      }
      return;
    }
    quad(ctx, x1, y1, w1, x2, y2, w2, pal.road);
    if (pal.lane !== pal.road) {
      ctx.fillStyle = pal.lane;
      quadSpan(ctx, x1, y1, w1, x2, y2, w2, -LANE_EDGE - 0.015, -LANE_EDGE + 0.015);
      quadSpan(ctx, x1, y1, w1, x2, y2, w2, LANE_EDGE - 0.015, LANE_EDGE + 0.015);
    }
  }

  drawSprite(img, n, offset, worldWidth, lift = 0) {
    const s = this.ps[n];
    const dw = worldWidth * s * this.focal;
    if (dw < 1) return null;
    const dh = (dw * img.height) / img.width;
    const cx = this.px[n] + offset * this.pw[n];
    const y = this.py[n] - dh - lift * s * this.focal;
    if (cx + dw / 2 < 0 || cx - dw / 2 > this.w || y > this.h) return null;
    this.ctx.drawImage(img, Math.round(cx - dw / 2), Math.round(y), Math.round(dw), Math.round(dh));
    return y;
  }

  drawSegmentSprites(race, i, n, camZ, time) {
    const { track } = race;
    if (i >= track.count || i * SEGMENT_LENGTH - camZ < PLAYER_Z * 0.5) return;
    const sc = this.sprites.scenery;
    const pick = (type) =>
      type === SCENERY.billboard ? sc.billboards[track.variant[i]] : type === SCENERY.stand ? sc.stands[i % 2] : type === SCENERY.pine ? sc.pine : type === SCENERY.tree ? sc.tree : type === SCENERY.bush ? sc.bush : sc.rock;
    if (track.sceneryL[i]) this.drawSprite(pick(track.sceneryL[i]), n, track.offsetL[i], SCENERY_WIDTH[track.sceneryL[i]]);
    if (track.sceneryR[i]) this.drawSprite(pick(track.sceneryR[i]), n, track.offsetR[i], SCENERY_WIDTH[track.sceneryR[i]]);

    if (i === START_LINE_SEGMENT) this.drawGantry(n, race.lightsOn, 'GITHUB GRAND PRIX');
    if (i === track.finishSegment) this.drawGantry(n, -1, 'FINISH');

    const r = race.rowBySegment[i];
    if (r < 0 || i * SEGMENT_LENGTH - camZ < PLAYER_Z * 0.55) return;

    const row = race.rows[r];
    const ob = this.sprites.obstacles;
    let topY = Infinity;
    for (const lane of row.blocked) {
      const img = row.kind === 'barrier' ? (lane < row.safeLane ? ob.barrierLeft : ob.barrierRight) : ob[row.kind];
      const y = this.drawSprite(img, n, LANES[lane], OBSTACLE_WIDTH[row.kind]);
      if (y !== null) topY = Math.min(topY, y);
    }
    if (row.kind === 'barrier') {
      const bob = this.reducedMotion ? 0 : Math.sin(time * 6) * 60;
      this.drawSprite(this.sprites.gapArrow, n, LANES[row.safeLane], 420, 1300 + bob);
    }
    const size = this.ps[n] * this.focal * 1333;
    if (topY !== Infinity && size > 26) {
      const ctx = this.ctx;
      ctx.font = size > 70 ? 'bold 14px monospace' : 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0d1117';
      const lx = this.px[n] + LANES[row.blocked[0]] * this.pw[n];
      ctx.fillText(row.label, lx + 1, topY - 3);
      ctx.fillStyle = '#39d353';
      ctx.fillText(row.label, lx, topY - 4);
    }
  }

  drawGantry(n, lightsOn, text) {
    const { ctx, focal } = this;
    const s = this.ps[n];
    const unit = s * focal;
    if (unit * 4000 < 6) return;
    const half = this.pw[n] * 1.22;
    const cx = this.px[n];
    const base = this.py[n];
    const top = base - 1900 * unit;
    const bh = 380 * unit;
    ctx.fillStyle = '#8b949e';
    ctx.fillRect(Math.round(cx - half - 60 * unit), Math.round(top), Math.max(1, Math.round(120 * unit)), Math.round(base - top));
    ctx.fillRect(Math.round(cx + half - 60 * unit), Math.round(top), Math.max(1, Math.round(120 * unit)), Math.round(base - top));
    if (lightsOn < 0) {
      for (let k = 0; k < 16; k++) {
        ctx.fillStyle = k % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(Math.round(cx - half + (k * half) / 8), Math.round(top), Math.ceil(half / 8), Math.round(bh));
      }
    } else {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(Math.round(cx - half), Math.round(top), Math.round(half * 2), Math.round(bh));
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = k < lightsOn ? '#ff2a2a' : '#30363d';
        ctx.fillRect(Math.round(cx - half * 0.5 + k * half * 0.22), Math.round(top + bh * 0.2), Math.max(1, Math.round(half * 0.12)), Math.max(1, Math.round(bh * 0.6)));
      }
    }
    if (bh > 9) {
      ctx.font = `bold ${Math.min(14, Math.round(bh * 0.5))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = lightsOn < 0 ? '#d8202a' : '#39d353';
      ctx.fillText(text, Math.round(cx), Math.round(top - bh * 0.25));
    }
  }

  drawCar(race, time, camX, carSeg, nitro) {
    const { ctx, focal, w, h } = this;
    const scale = DEPTH / PLAYER_Z;
    const dw = Math.round(CAR_HALF_WIDTH * 2 * ROAD_WIDTH * scale * focal);
    const dh = Math.round((dw * 36) / 64);
    const cx = w / 2 + (race.driver.x * ROAD_WIDTH - camX) * scale * focal;
    const moving = race.speed > 0;
    const bounce = moving && Math.sin(time * 38) > 0.6 ? 1 : 0;
    const contact = Math.round(h * 0.86);
    const turn = race.driver.steer + race.track.curve[carSeg] * 0.12;
    const lean = turn < -0.25 ? 0 : turn > 0.25 ? 2 : 1;
    const roll = moving ? Math.floor(race.z / 90) % 3 : 0;
    const left = Math.round(cx - dw / 2);
    const top = contact - dh - bounce;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(left - 2, contact - 3, dw + 4, 5);
    ctx.drawImage(this.sprites.cars[lean][roll], left, top, dw, dh);

    const unit = dw / 64;
    if ((race.state === STATES.RACING || race.state === STATES.PAUSED) && Math.floor(time * 4) % 2) {
      ctx.fillStyle = 'rgba(255,60,60,0.55)';
      ctx.fillRect(Math.round(left + 28 * unit), Math.round(top + 24.5 * unit), Math.round(8 * unit), Math.round(5 * unit));
    }
    if (nitro > 0) {
      const fl = this.sprites.flames[Math.floor(time * 20) % 2];
      const fw = Math.round(unit * (6 + nitro * 3));
      const fh = Math.round((fw * 16) / 12);
      ctx.drawImage(fl, Math.round(left + 32 * unit - fw / 2), Math.round(top + 23 * unit - fh * 0.15), fw, fh);
    }
  }

  drawStreaks(level, time) {
    const { ctx, w, horizon } = this;
    const count = NITRO_STREAKS[level];
    ctx.strokeStyle = level >= 3 ? 'rgba(57,211,83,0.65)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const a = this.streakAngles[k];
      const p = (time * 2.2 + k * 0.137) % 1;
      const r0 = w * (0.25 + p * 0.55);
      const r1 = r0 + w * 0.12 * p;
      ctx.moveTo(w / 2 + Math.cos(a) * r0, horizon + Math.sin(a) * r0 * 0.6);
      ctx.lineTo(w / 2 + Math.cos(a) * r1, horizon + Math.sin(a) * r1 * 0.6);
    }
    ctx.stroke();
    if (level >= 3) {
      ctx.strokeStyle = `rgba(57,211,83,${0.35 + 0.25 * Math.sin(time * 12)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, this.h - 3);
    }
  }
}

function quad(ctx, x1, y1, w1, x2, y2, w2, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - w1, y1);
  ctx.lineTo(x2 - w2, y2);
  ctx.lineTo(x2 + w2, y2);
  ctx.lineTo(x1 + w1, y1);
  ctx.fill();
}

/** Fill the road strip between lateral positions a..b (road half-width units). */
function quadSpan(ctx, x1, y1, w1, x2, y2, w2, a, b) {
  ctx.beginPath();
  ctx.moveTo(x1 + w1 * a, y1);
  ctx.lineTo(x2 + w2 * a, y2);
  ctx.lineTo(x2 + w2 * b, y2);
  ctx.lineTo(x1 + w1 * b, y1);
  ctx.fill();
}
