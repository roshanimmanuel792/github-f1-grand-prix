import { describe, expect, it } from 'vitest';
import { createGifWriter, inspectGif } from '../src/export/gif.js';
import { GIF_PRESETS, VIDEO_PRESETS } from '../src/export/presets.js';
import { gifFileName, readmeMarkdown, shareUrl } from '../src/export/readme.js';

function frame(w, h, shift) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x + shift) % 256;
      px[i + 1] = y * 4;
      px[i + 2] = x > w / 2 ? 200 : 40;
      px[i + 3] = 255;
    }
  }
  return px;
}

describe('GIF export', () => {
  it('encodes frames with exact timing and inspects back', async () => {
    const w = 64;
    const h = 36;
    const gif = createGifWriter({ width: w, height: h, fps: 10, colors: 32 });
    for (let i = 0; i < 12; i++) gif.add(frame(w, h, i * 3));
    const { blob, frames } = gif.finish();
    const info = inspectGif(new Uint8Array(await blob.arrayBuffer()));
    expect(frames).toBe(12);
    expect(info).toMatchObject({ width: w, height: h, frames: 12, duration: 1.2 });
    expect(blob.type).toBe('image/gif');
  });

  it('inter-frame diffing makes static frames far smaller', async () => {
    const make = async (moving) => {
      const gif = createGifWriter({ width: 96, height: 54, fps: 10, colors: 32 });
      for (let i = 0; i < 20; i++) gif.add(frame(96, 54, moving ? i * 7 : 0));
      return (await gif.finish().blob.arrayBuffer()).byteLength;
    };
    expect(await make(false)).toBeLessThan((await make(true)) * 0.7); // per-frame palettes still cost bytes
  });

  it('rejects files that are not GIFs or are truncated', () => {
    expect(() => inspectGif(new TextEncoder().encode('PNG....nope'))).toThrow(/Not a GIF/);
    const gif = createGifWriter({ width: 8, height: 8, fps: 10, colors: 8 });
    gif.add(frame(8, 8, 0));
    return gif
      .finish()
      .blob.arrayBuffer()
      .then((buf) => expect(() => inspectGif(new Uint8Array(buf).slice(0, buf.byteLength - 5))).toThrow(/Truncated/));
  });

  it('presets keep exact GIF delays (fps divides 100) and sane video sizes', () => {
    for (const p of Object.values(GIF_PRESETS)) expect(100 % (100 / p.fps)).toBe(0);
    for (const p of Object.values(VIDEO_PRESETS)) expect(p.width % 2 + p.height % 2).toBe(0); // H.264 needs even sizes
  });
});

describe('README + share links', () => {
  it('builds markdown with the real username, season, score and a relative GIF path', () => {
    const md = readmeMarkdown({ username: 'Octo-Cat', year: 2025, score: 1234, days: 365, mode: 'ai' });
    expect(md).toContain('./github-grand-prix-octo-cat-2025.gif');
    expect(md).toContain('**1,234**');
    expect(md).toContain('https://roshanimmanuel792.github.io/github-f1-grand-prix/?user=Octo-Cat&year=2025&mode=ai');
    expect(md).not.toMatch(/\.mp4|user-attachments/); // never invents a hosted video URL
  });

  it('refuses unsafe usernames (no markdown/HTML injection)', () => {
    expect(() => readmeMarkdown({ username: '](javascript:alert(1))', year: 2025, score: 1, days: 1 })).toThrow();
  });

  it('share links encode parameters', () => {
    expect(shareUrl({ username: 'a-b', year: 2024 }, 'https://x.dev/gp/')).toBe('https://x.dev/gp/?user=a-b&year=2024');
    expect(gifFileName('ABC', 2026)).toBe('github-grand-prix-abc-2026.gif');
  });
});
