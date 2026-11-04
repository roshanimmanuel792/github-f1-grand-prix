import { mulberry32 } from '../data/dataset.js';

export const SEGMENT_LENGTH = 200;
export const SEGMENTS_PER_DAY = 20;
export const DAY_LENGTH = SEGMENT_LENGTH * SEGMENTS_PER_DAY;
export const LEAD_IN_SEGMENTS = 60;
export const START_SEGMENT = 48; // car's grid position
export const START_LINE_SEGMENT = 54;
export const TAIL_SEGMENTS = 440; // coast-down + draw distance after the finish line
export const ROAD_WIDTH = 2000; // half-width, world units

export const SCENERY = { none: 0, pine: 1, tree: 2, bush: 3, rock: 4, billboard: 5, stand: 6 };

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Procedural circuit: smooth curvature and hills from layered sines (continuous, no
 * jumps), straight start/finish, and deterministic roadside scenery. All typed arrays,
 * so the renderer reads it without allocating.
 */
export function buildTrack(totalDays, seed) {
  const finishSegment = LEAD_IN_SEGMENTS + totalDays * SEGMENTS_PER_DAY;
  const count = finishSegment + TAIL_SEGMENTS;
  const rand = mulberry32(seed);
  const p = Array.from({ length: 4 }, () => rand() * Math.PI * 2);

  const curve = new Float32Array(count);
  const height = new Float32Array(count + 1);
  const sceneryL = new Uint8Array(count);
  const sceneryR = new Uint8Array(count);
  const offsetL = new Float32Array(count);
  const offsetR = new Float32Array(count);
  const variant = new Uint8Array(count);

  for (let i = 0; i <= count; i++) {
    const ramp = smoothstep(LEAD_IN_SEGMENTS - 10, LEAD_IN_SEGMENTS + 60, i) * (1 - smoothstep(finishSegment - 80, finishSegment - 10, i));
    height[i] = 5000 * ramp * (Math.sin(i / 180 + p[2]) * 0.6 + Math.sin(i / 430 + p[3]) * 0.4);
    if (i === count) break;
    const s = Math.sin(i / 97 + p[0]) * 0.65 + Math.sin(i / 251 + p[1]) * 0.35;
    curve[i] = 5 * ramp * Math.sign(s) * Math.abs(s) ** 1.2;

    if (i > START_SEGMENT + 4 && i < LEAD_IN_SEGMENTS + 24 && i % 6 === 0) {
      sceneryL[i] = sceneryR[i] = SCENERY.stand;
      offsetL[i] = -2.3;
      offsetR[i] = 2.3;
      continue;
    }
    const place = (side) => {
      const r = rand();
      if (r > 0.3) return [SCENERY.none, 0];
      if (r < 0.025) return [SCENERY.billboard, side * (1.45 + rand() * 0.2)];
      const type = r < 0.13 ? SCENERY.pine : r < 0.21 ? SCENERY.tree : r < 0.27 ? SCENERY.bush : SCENERY.rock;
      return [type, side * (1.35 + rand() * 2.4)];
    };
    [sceneryL[i], offsetL[i]] = place(-1);
    [sceneryR[i], offsetR[i]] = place(1);
    variant[i] = Math.floor(rand() * 4);
  }

  return { count, finishSegment, curve, height, sceneryL, sceneryR, offsetL, offsetR, variant };
}

/** Road height at world z, interpolated between segment boundaries. */
export function heightAt(track, z) {
  const f = z / SEGMENT_LENGTH;
  const i = Math.max(0, Math.min(track.count - 1, Math.floor(f)));
  const t = Math.min(1, Math.max(0, f - i));
  return track.height[i] + (track.height[i + 1] - track.height[i]) * t;
}
