// HUD composited into exported replay frames (the live HUD is DOM and isn't captured).
import { STATES } from '../game/race.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FONT = '"Segoe UI", "Inter", system-ui, sans-serif';
export const GAME_OVER_AFTER = 1.5; // seconds after the flag before the results card appears

function panel(g, x, y, w, h, r) {
  g.fillStyle = 'rgba(13,17,23,0.72)';
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
  g.strokeStyle = 'rgba(240,246,252,0.14)';
  g.lineWidth = Math.max(1, r / 6);
  g.stroke();
}

export function drawOverlay(g, race, w, h) {
  const s = h / 720;
  const pad = 22 * s;
  const d = race.currentDay;
  const user = race.dataset.username;
  g.textBaseline = 'alphabetic';

  // top-left: driver, season, date
  panel(g, pad, pad, 330 * s, 118 * s, 14 * s);
  g.fillStyle = '#3fb950';
  g.font = `italic 800 ${17 * s}px ${FONT}`;
  g.fillText('GITHUB GRAND PRIX', pad + 18 * s, pad + 32 * s);
  g.fillStyle = '#f0f6fc';
  g.font = `700 ${24 * s}px ${FONT}`;
  g.fillText(`@${user}`, pad + 18 * s, pad + 64 * s, 300 * s);
  g.fillStyle = '#9da7b3';
  g.font = `600 ${18 * s}px ${FONT}`;
  g.fillText(`${race.dataset.year} · ${MONTHS[Number(d.date.slice(5, 7)) - 1]} ${d.date.slice(8)} · ${d.contributions} today`, pad + 18 * s, pad + 96 * s);

  // top-right: score
  const sw = 250 * s;
  panel(g, w - pad - sw, pad, sw, 118 * s, 14 * s);
  g.textAlign = 'right';
  g.fillStyle = '#9da7b3';
  g.font = `700 ${15 * s}px ${FONT}`;
  g.fillText('SCORE', w - pad - 18 * s, pad + 30 * s);
  g.fillStyle = '#f0f6fc';
  g.font = `italic 800 ${52 * s}px ${FONT}`;
  g.fillText(race.score.toLocaleString('en-US'), w - pad - 18 * s, pad + 82 * s);
  g.fillStyle = '#9da7b3';
  g.font = `600 ${16 * s}px ${FONT}`;
  g.fillText(`of ${race.totalContributions.toLocaleString('en-US')}`, w - pad - 18 * s, pad + 106 * s);
  g.textAlign = 'left';

  // bottom: season progress
  const bw = w - pad * 2;
  const by = h - pad - 12 * s;
  g.fillStyle = 'rgba(13,17,23,0.6)';
  g.fillRect(pad, by, bw, 10 * s);
  g.fillStyle = '#2ea043';
  g.fillRect(pad, by, bw * race.progress, 10 * s);
  g.fillStyle = '#f0f6fc';
  g.font = `700 ${16 * s}px ${FONT}`;
  g.fillText(`DAY ${race.completedDays} / ${race.totalDays}`, pad, by - 10 * s);
  g.textAlign = 'right';
  g.fillText(`${Math.floor(race.progress * 100)}%`, w - pad, by - 10 * s);
  g.textAlign = 'left';

  // start lights
  if (race.countdown > 0) {
    const r = 18 * s;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i < race.lightsOn ? '#ff2a2a' : 'rgba(40,44,52,0.9)';
      g.beginPath();
      g.arc(w / 2 + (i - 2) * r * 2.6, pad + 40 * s, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  // GAME OVER card
  if (race.state === STATES.FINISHED && race.time - race.finishedAt >= GAME_OVER_AFTER) {
    const t = Math.min(1, (race.time - race.finishedAt - GAME_OVER_AFTER) / 0.6);
    g.globalAlpha = t;
    g.fillStyle = 'rgba(1,4,9,0.55)';
    g.fillRect(0, 0, w, h);
    const cw = 620 * s;
    const ch = 300 * s;
    panel(g, (w - cw) / 2, (h - ch) / 2, cw, ch, 22 * s);
    g.textAlign = 'center';
    g.fillStyle = '#3fb950';
    g.font = `italic 800 ${22 * s}px ${FONT}`;
    g.fillText(`GITHUB GRAND PRIX · ${race.dataset.year}`, w / 2, h / 2 - 92 * s);
    g.fillStyle = '#f0f6fc';
    g.font = `italic 900 ${62 * s}px ${FONT}`;
    g.fillText('GAME OVER', w / 2, h / 2 - 28 * s);
    g.font = `italic 800 ${48 * s}px ${FONT}`;
    g.fillStyle = '#f2cc0c';
    g.fillText(`${race.score.toLocaleString('en-US')} pts`, w / 2, h / 2 + 38 * s);
    g.fillStyle = '#9da7b3';
    g.font = `600 ${19 * s}px ${FONT}`;
    g.fillText(`@${user} · ${race.completedDays} days · ${race.passed} obstacles cleared`, w / 2, h / 2 + 90 * s, cw - 40 * s);
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }
}
