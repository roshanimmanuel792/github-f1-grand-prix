// Original procedural pixel art, painted once into offscreen canvases at load time.
import { mulberry32 } from '../data/dataset.js';

const C = {
  body: '#11161f',
  bodyHi: '#26313f',
  accent: '#39d353',
  accentDark: '#0e4429',
  tyre: '#141414',
  tyreHi: '#343434',
  groove: '#060606',
  wing: '#0b0f16',
  flap: '#1c2533',
  helmet: '#f2cc0c',
  halo: '#4a5462',
  red: '#ff2a2a',
  diffuser: '#07090c',
  strake: '#2c3442',
  white: '#eef2f6',
};

function paint(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const px = (x, y, pw, ph, color) => {
    g.fillStyle = color;
    g.fillRect(x, y, pw, ph);
  };
  draw(px, g);
  return canvas;
}

/** Rear-view F1 car, 64x36. lean: -1 left, 0 straight, 1 right. roll: tyre tread phase 0-2. */
function car(lean, roll) {
  return paint(64, 36, (px) => {
    const s = lean;
    // front tyres, steered and partly hidden behind the sidepods
    px(10 + s * 2, 12, 7, 9, '#0d0d0d');
    px(47 + s * 2, 12, 7, 9, '#0d0d0d');
    px(11 + s * 2, 12, 5, 1, C.tyreHi);
    px(48 + s * 2, 12, 5, 1, C.tyreHi);
    // sidepods
    px(15, 19, 34, 9, C.body);
    px(15, 19, 34, 1, C.bodyHi);
    px(15, 23, 34, 1, C.accent);
    px(15, 24, 34, 1, C.accentDark);
    // engine cover, tapering toward the cockpit (top leans into the turn)
    for (let y = 9; y <= 26; y++) {
      const hw = Math.round(4 + (y - 9) * 0.6);
      const shift = Math.round(s * ((26 - y) / 17) * 2);
      px(32 - hw + shift, y, hw * 2, 1, y === 9 ? C.bodyHi : C.body);
      if (y >= 12) px(31 + shift, y, 2, 1, C.accent);
    }
    // halo + helmet
    const hs = s * 2;
    px(26 + hs, 7, 12, 1, C.halo);
    px(26 + hs, 7, 1, 4, C.halo);
    px(37 + hs, 7, 1, 4, C.halo);
    px(30 + hs, 8, 4, 1, C.helmet);
    px(29 + hs, 9, 6, 1, C.helmet);
    px(28 + hs, 10, 8, 4, C.helmet);
    px(29 + hs, 14, 6, 1, '#c9a800');
    px(28 + hs, 11, 8, 1, C.accent);
    // rear tyres with rolling tread
    for (const x of [1, 48]) {
      px(x, 15, 15, 20, C.tyre);
      px(x + 1, 15, 13, 1, C.tyreHi);
      for (let y = 17 + roll; y < 34; y += 3) px(x, y, 15, 1, C.groove);
      px(x === 1 ? 1 : 62, 16, 1, 18, C.helmet); // compound band on the shoulder
      px(x === 1 ? 15 : 48, 20, 1, 10, '#3a3a3a');
    }
    // diffuser, crash structure, rain light, exhaust
    px(17, 28, 30, 7, C.diffuser);
    for (let x = 19; x < 46; x += 4) px(x, 28, 1, 7, C.strake);
    px(29, 25, 6, 4, '#222831');
    px(30, 26, 4, 2, C.red);
    px(31, 23, 2, 2, '#59606b');
    // rear wing on its swan-neck pillar
    const ws = s;
    px(30 + ws, 6, 4, 4, C.wing);
    px(5 + ws, 1, 4, 15, C.wing);
    px(55 + ws, 1, 4, 15, C.wing);
    px(5 + ws, 1, 4, 1, C.accent);
    px(55 + ws, 1, 4, 1, C.accent);
    px(8 + ws, 1, 48, 2, C.flap);
    px(8 + ws, 3, 48, 4, C.wing);
    px(8 + ws, 3, 48, 1, C.accent);
    px(8 + ws, 5, 48, 1, '#000');
    px(29 + ws, 3, 6, 1, C.white); // number plate
    px(6 + ws, 13, 2, 2, C.red);
    px(56 + ws, 13, 2, 2, C.red);
  });
}

function block() {
  return paint(32, 14, (px) => {
    px(0, 10, 32, 4, '#2a2a2a');
    for (let x = 1; x < 31; x++) for (let y = 2; y < 11; y++) px(x, y, 1, 1, (x + y) % 8 < 4 ? '#f4c20d' : '#151515');
    px(1, 2, 30, 1, '#fff3a0');
    px(3, 5, 2, 2, C.red);
    px(27, 5, 2, 2, C.red);
  });
}

function cones() {
  return paint(32, 18, (px) => {
    for (const cx of [5, 16, 27]) {
      px(cx - 5, 15, 11, 3, '#222');
      for (let y = 2; y < 15; y++) {
        const hw = Math.round(1 + (y - 2) * 0.32);
        px(cx - hw, y, hw * 2 + 1, 1, y === 7 || y === 8 || y === 11 ? C.white : '#ff7a1a');
      }
    }
  });
}

function tyreStacks() {
  return paint(32, 24, (px) => {
    for (const x of [2, 18]) {
      for (let i = 0; i < 3; i++) {
        const y = 16 - i * 7;
        px(x, y, 13, 7, '#151515');
        px(x + 1, y, 11, 1, '#3a3a3a');
        px(x, y + 3, 13, 1, i % 2 ? C.red : C.white);
      }
      px(x + 4, 2, 5, 1, '#000');
    }
  });
}

function tyreBarrier() {
  return paint(32, 18, (px) => {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const x = i * 8 - (row ? 4 : 0);
        const y = row ? 1 : 9;
        px(x, y, 8, 8, '#161616');
        px(x, y, 8, 3, (i + row) % 2 ? C.red : C.white);
        px(x + 3, y + 1, 2, 1, '#000');
      }
    }
  });
}

function barrierPanel(dir) {
  return paint(32, 28, (px) => {
    px(2, 6, 28, 16, '#d8202a');
    for (let x = 0; x < 28; x++) {
      for (let y = 0; y < 16; y++) {
        if ((((x + dir * Math.abs(y - 7.5) * 1.2) % 9) + 9) % 9 < 3) px(2 + x, 6 + y, 1, 1, C.white);
      }
    }
    px(0, 4, 3, 20, '#9aa4b2');
    px(29, 4, 3, 20, '#9aa4b2');
    px(0, 22, 32, 6, '#8b929c');
    px(0, 22, 32, 1, '#b7bec8');
    px(15, 22, 1, 6, '#5d636b');
    px(5, 1, 4, 3, '#ffb000');
    px(23, 1, 4, 3, '#ffb000');
  });
}

function gapArrow() {
  return paint(12, 12, (px) => {
    for (let y = 0; y < 6; y++) px(4, y, 4, 1, C.accent);
    for (let y = 6; y < 12; y++) {
      const hw = 11 - y;
      px(6 - hw, y, hw * 2, 1, C.accent);
    }
  });
}

function flame(frame) {
  return paint(12, 16, (px) => {
    const f = frame;
    for (let y = 0; y < 16; y++) {
      const hw = Math.max(1, Math.round(5 - Math.abs(y - 5 - f) * 0.55));
      px(6 - hw, y, hw * 2, 1, y < 4 ? '#fff6c2' : y < 9 ? '#ffb000' : '#ff5a1f');
      if (y > 1 && y < 7) px(5, y, 2, 1, '#7fd4ff');
    }
  });
}

function pine() {
  return paint(24, 44, (px) => {
    px(10, 34, 4, 10, '#5a3a1e');
    for (let layer = 0; layer < 4; layer++) {
      const top = 2 + layer * 8;
      for (let y = 0; y < 12; y++) {
        const hw = Math.round(2 + y * (0.55 + layer * 0.12));
        px(12 - hw, top + y, hw * 2, 1, y % 4 === 0 ? '#2e8b4a' : '#1f6f3a');
      }
    }
  });
}

function roundTree() {
  return paint(32, 36, (px) => {
    px(14, 24, 4, 12, '#5a3a1e');
    const blobs = [[16, 9, 9], [9, 15, 7], [23, 15, 7], [16, 18, 8]];
    for (const [cx, cy, r] of blobs) {
      for (let y = -r; y <= r; y++) {
        const hw = Math.round(Math.sqrt(r * r - y * y));
        px(cx - hw, cy + y, hw * 2, 1, y < -r / 3 ? '#4cbc55' : '#2f8f3a');
      }
    }
  });
}

function bush() {
  return paint(20, 10, (px) => {
    px(2, 4, 16, 6, '#2a7a34');
    px(5, 1, 6, 4, '#2a7a34');
    px(11, 2, 6, 3, '#2a7a34');
    px(6, 1, 4, 1, '#4cbc55');
    px(12, 2, 4, 1, '#4cbc55');
    px(3, 4, 3, 1, '#4cbc55');
  });
}

function rock() {
  return paint(16, 10, (px) => {
    px(1, 4, 14, 6, '#6b737d');
    px(3, 1, 9, 4, '#7d8590');
    px(4, 1, 6, 1, '#a3acb8');
    px(2, 4, 4, 1, '#a3acb8');
    px(1, 9, 14, 1, '#3d434a');
  });
}

function billboard(text, bg) {
  return paint(48, 30, (px, g) => {
    px(8, 18, 3, 12, '#5d636b');
    px(37, 18, 3, 12, '#5d636b');
    px(0, 0, 48, 20, C.white);
    px(1, 1, 46, 18, bg);
    px(1, 15, 46, 4, C.accent);
    g.fillStyle = C.white;
    g.font = 'bold 8px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 24, 8);
  });
}

function grandstand(seed) {
  const rand = mulberry32(seed);
  const crowd = ['#f2cc0c', '#ff5a1f', '#39d353', '#58a6ff', '#eef2f6', '#d8202a', '#bc8cff'];
  return paint(64, 40, (px) => {
    px(0, 2, 64, 4, '#30363d');
    px(0, 2, 64, 1, C.accent);
    for (let x = 2; x < 64; x += 20) px(x, 6, 2, 34, '#8b949e');
    for (let row = 0; row < 6; row++) {
      const y = 10 + row * 5;
      px(0, y + 3, 64, 2, '#6e7681');
      for (let x = 1; x < 63; x += 2) px(x, y, 1, 3, crowd[Math.floor(rand() * crowd.length)]);
    }
  });
}

export function createSprites(year) {
  const cars = [-1, 0, 1].map((lean) => [0, 1, 2].map((roll) => car(lean, roll)));
  return {
    cars, // [lean index][roll]
    obstacles: {
      block: block(),
      cone: cones(),
      tyres: tyreStacks(),
      tyreBarrier: tyreBarrier(),
      barrierLeft: barrierPanel(1),
      barrierRight: barrierPanel(-1),
    },
    gapArrow: gapArrow(),
    flames: [flame(0), flame(1)],
    scenery: {
      pine: pine(),
      tree: roundTree(),
      bush: bush(),
      rock: rock(),
      billboards: [
        billboard('GITHUB GP', '#0d1117'),
        billboard('COMMIT!', '#1f6feb'),
        billboard(String(year), '#8957e5'),
        billboard('PUSH IT', '#d8202a'),
      ],
      stands: [grandstand(1), grandstand(2)],
    },
  };
}
