// Procedural canvas textures (original artwork, generated at load — no external assets).
import * as THREE from 'three';
import { mulberry32 } from '../data/dataset.js';

function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function noise(g, w, h, seed, alpha, light = 255) {
  const rand = mulberry32(seed);
  for (let i = 0; i < (w * h) / 6; i++) {
    const v = Math.floor(rand() * light);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** Asphalt with white edge lines and two dashed lane dividers. u spans the road width; v repeats every 12 m. */
export function roadTexture() {
  return canvasTexture(
    512,
    1024,
    (g, w, h) => {
      g.fillStyle = '#3a3d42';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 11, 0.18);
      noise(g, w, h, 12, 0.12, 40);
      // racing line rubber
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0.35, 'rgba(10,10,12,0)');
      grad.addColorStop(0.5, 'rgba(10,10,12,0.22)');
      grad.addColorStop(0.65, 'rgba(10,10,12,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e9ecef';
      g.fillRect(w * 0.02, 0, w * 0.018, h);
      g.fillRect(w * 0.962, 0, w * 0.018, h);
      for (const u of [1 / 3, 2 / 3]) g.fillRect(w * u - 5, 0, 10, h * 0.45);
    },
    { repeat: true },
  );
}

export function barrierTexture() {
  return canvasTexture(
    256,
    64,
    (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#e8ebef' : '#c8202b';
        g.fillRect((i * w) / 4, 0, w / 4, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, h - 6, w, 6);
    },
    { repeat: true },
  );
}

export function chevronTexture(dir) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#c8202b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f4f6f8';
    g.lineWidth = 22;
    for (let x = -w; x < w * 2; x += 80) {
      g.beginPath();
      g.moveTo(x, 10);
      g.lineTo(x + dir * 50, h / 2);
      g.lineTo(x, h - 10);
      g.stroke();
    }
  });
}

export function hazardTexture() {
  return canvasTexture(
    256,
    64,
    (g, w, h) => {
      g.fillStyle = '#f2c40c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#16181b';
      for (let x = -h; x < w; x += 48) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 24, h);
        g.lineTo(x + 24 + h, 0);
        g.lineTo(x + h, 0);
        g.fill();
      }
    },
    { repeat: true },
  );
}

export function checkerTexture() {
  return canvasTexture(
    256,
    64,
    (g, w, h) => {
      const s = h / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < w / s; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        g.fillRect(x * s, y * s, s, s);
      }
    },
    { repeat: true },
  );
}

export function bannerTexture(text, bg = '#0d1117', fg = '#f0f6fc', accent = '#2ea043') {
  return canvasTexture(1024, 192, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, h - 22, w, 22);
    g.fillStyle = fg;
    g.font = 'italic 800 104px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h * 0.44, w * 0.92);
  });
}

export function liveryTexture() {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#1b2027';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2ea043';
    g.beginPath();
    g.moveTo(0, h * 0.62);
    g.lineTo(w, h * 0.3);
    g.lineTo(w, h * 0.45);
    g.lineTo(0, h * 0.78);
    g.fill();
    g.fillStyle = '#f0f6fc';
    g.font = 'italic 800 54px "Segoe UI", system-ui, sans-serif';
    g.fillText('GRAND PRIX', 24, 58);
    g.font = '700 22px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = '#8b949e';
    g.fillText('CONTRIBUTION RACING', 28, 100);
  });
}

export function glassTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#1d2733';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = '#2b3a4a';
      g.fillRect(x + 2, 8, 28, h - 30);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x + 2, 8, 10, h - 30);
    }
    g.fillStyle = '#c9d1d9';
    g.fillRect(0, h - 18, w, 18);
  });
}

export function grassTexture() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#3f7d32';
      g.fillRect(0, 0, w, h);
      const rand = mulberry32(5);
      for (let i = 0; i < 4000; i++) {
        const v = 40 + rand() * 60;
        g.fillStyle = `rgba(${v * 0.6},${v + 50},${v * 0.4},0.35)`;
        g.fillRect(rand() * w, rand() * h, 1, 2 + rand() * 3);
      }
    },
    { repeat: true },
  );
}

export function softSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
}

/** "+N" contribution label for an obstacle. Returns {texture, draw(text)} so pooled labels can be redrawn. */
export function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 112;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    texture: tex,
    draw(count, date) {
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(13,17,23,0.82)';
      g.beginPath();
      g.roundRect(6, 6, c.width - 12, c.height - 12, 18);
      g.fill();
      g.strokeStyle = '#2ea043';
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = '#3fb950';
      g.font = '800 52px "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`+${count}`, c.width / 2, 62);
      g.fillStyle = '#c9d1d9';
      g.font = '600 22px "Segoe UI", system-ui, sans-serif';
      g.fillText(date, c.width / 2, 92);
      tex.needsUpdate = true;
    },
  };
}
