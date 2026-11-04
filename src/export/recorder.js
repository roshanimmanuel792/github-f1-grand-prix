// Renders a deterministic replay frame-by-frame at a fixed export resolution and frame rate.
import { ReplayClock } from '../game/replay.js';
import { createGifWriter } from './gif.js';
import { drawOverlay } from './overlay.js';
import { createVideoWriter } from './video.js';

const nextTick = () => new Promise((r) => setTimeout(r, 0));

/**
 * @param {object} o
 * @param {import('../three/engine.js').Engine} o.engine
 * @param {import('../game/race.js').Race} o.race fresh race from raceFromReplay()
 * @param {(frame: HTMLCanvasElement, t: number, g: CanvasRenderingContext2D) => Promise<void>|void} o.onFrame
 */
export async function renderReplay({ engine, race, width, height, fps, speed, onFrame, onProgress = () => {}, signal }) {
  const comp = document.createElement('canvas');
  comp.width = width;
  comp.height = height;
  const g = comp.getContext('2d', { willReadFrequently: true });
  const clock = new ReplayClock(race, { fps, speed });
  const total = clock.estimateFrames();
  const previous = engine.race;
  engine.attach(race);
  const restore = engine.beginExport(width, height);
  try {
    while (!clock.done) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = clock.next();
      engine.frame(speed / fps, { cameraMode: 'tv' });
      g.drawImage(engine.canvas, 0, 0, width, height);
      drawOverlay(g, race, width, height);
      await onFrame(comp, t, g);
      onProgress(Math.min(0.99, clock.frame / total), clock.frame);
      if (clock.frame % 3 === 0) await nextTick(); // keep the page responsive
    }
    return { frames: clock.frame, duration: clock.frame / fps, score: race.score, completedDays: race.completedDays };
  } finally {
    restore();
    engine.attach(previous);
  }
}

export async function exportGif({ engine, race, preset, onProgress, signal }) {
  const { width, height, fps, colors } = preset;
  const writer = createGifWriter({ width, height, fps, colors });
  const info = await renderReplay({
    engine,
    race,
    width,
    height,
    fps,
    speed: 2,
    signal,
    onProgress,
    onFrame: (_, __, g) => writer.add(g.getImageData(0, 0, width, height).data),
  });
  const { blob } = writer.finish();
  return { blob, ...info, width, height, fps, type: 'image/gif', extension: 'gif' };
}

export async function exportVideo({ engine, race, preset, onProgress, signal }) {
  const { width, height, fps, bitrate } = preset;
  // The encoder samples this canvas on each add(); frames are copied into it as they render.
  const holder = document.createElement('canvas');
  holder.width = width;
  holder.height = height;
  const hg = holder.getContext('2d');
  const writer = await createVideoWriter(holder, { fps, bitrate });
  try {
    const info = await renderReplay({
      engine,
      race,
      width,
      height,
      fps,
      speed: 2,
      signal,
      onProgress,
      onFrame: async (frame, t) => {
        hg.drawImage(frame, 0, 0);
        await writer.add(t);
      },
    });
    const blob = await writer.finish();
    return { blob, ...info, width, height, fps, codec: writer.codec, container: writer.container, method: writer.method, type: blob.type, extension: writer.container };
  } catch (err) {
    await writer.cancel().catch(() => {});
    throw err;
  }
}
