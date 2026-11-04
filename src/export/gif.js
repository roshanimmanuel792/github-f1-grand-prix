import * as gifencModule from 'gifenc';

// Vite resolves gifenc's ESM build; Node (tests, scripts) gets its CommonJS build via `default`.
const { GIFEncoder, applyPalette, quantize } = gifencModule.GIFEncoder ? gifencModule : gifencModule.default;

const DIFF_TOLERANCE = 32; // summed RGB difference below which a pixel is "unchanged"

/**
 * GIF writer with inter-frame transparency: pixels that barely changed since the last
 * frame are written transparent (the previous frame shows through), which makes static
 * areas (sky, HUD) nearly free and keeps full-season replays README-sized.
 */
export function createGifWriter({ width, height, fps, colors }) {
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  const shown = new Uint8ClampedArray(width * height * 4); // what the viewer currently sees
  let frames = 0;
  return {
    /** @param {Uint8ClampedArray} rgba width*height*4 pixels (modified in place) */
    add(rgba) {
      if (frames > 0) {
        for (let i = 0; i < rgba.length; i += 4) {
          const d = Math.abs(rgba[i] - shown[i]) + Math.abs(rgba[i + 1] - shown[i + 1]) + Math.abs(rgba[i + 2] - shown[i + 2]);
          if (d < DIFF_TOLERANCE) rgba[i + 3] = 0;
          else {
            shown[i] = rgba[i];
            shown[i + 1] = rgba[i + 1];
            shown[i + 2] = rgba[i + 2];
            rgba[i + 3] = 255;
          }
        }
      } else {
        shown.set(rgba);
        for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      }
      const palette = quantize(rgba, colors, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(rgba, palette, 'rgba4444');
      const transparentIndex = palette.findIndex((c) => c[3] === 0);
      gif.writeFrame(index, width, height, { palette, delay, repeat: 0, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 1 });
      frames++;
    },
    finish() {
      gif.finish();
      return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), frames };
    },
  };
}

/**
 * Minimal GIF structure reader for validating exports: header, size, frame count, and total
 * duration from graphic-control delays. Throws on malformed files.
 */
export function inspectGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Not a GIF file.');
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  const skipSubBlocks = () => {
    while (b[p] !== 0) {
      if (p >= b.length) throw new Error('Truncated GIF.');
      p += b[p] + 1;
    }
    p++;
  };
  let frames = 0;
  let durationCs = 0;
  for (;;) {
    if (p >= b.length) throw new Error('Truncated GIF (no trailer).');
    const block = b[p];
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (b[p + 1] === 0xf9) durationCs += b[p + 4] | (b[p + 5] << 8);
      p += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      frames++;
      const packed = b[p + 9];
      p += 10;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
      p++; // LZW minimum code size
      skipSubBlocks();
    } else throw new Error(`Unexpected GIF block 0x${block.toString(16)}.`);
  }
  return { width, height, frames, duration: durationCs / 100, bytes: b.length };
}
