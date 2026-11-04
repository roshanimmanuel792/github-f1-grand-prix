// Maps the simulation's track coordinates (distance z in world units, lateral x in road
// half-widths) onto a real 3D centreline built from the track's curvature and height.
import { SEGMENT_LENGTH } from '../game/track.js';

export const METERS_PER_UNIT = 0.01; // 1 day (4000 units) = 40 m of track
export const SEG_M = SEGMENT_LENGTH * METERS_PER_UNIT; // 2 m per segment
export const ROAD_HALF_M = 7; // 14 m wide, three 4.67 m lanes
const HEADING_PER_CURVE = 0.0033; // rad per curve unit per segment → ~120 m tightest radius
const HEIGHT_SCALE = 0.004;

/**
 * Centreline sampled at every segment boundary: position, heading and the right-hand
 * vector. Typed arrays; built once per race.
 */
export function buildCenterline(track) {
  const n = track.count + 1;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const heading = new Float32Array(n);
  let x = 0;
  let z = 0;
  let h = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    px[i] = x;
    pz[i] = z;
    py[i] = track.height[i] * HEIGHT_SCALE;
    heading[i] = h;
    minY = Math.min(minY, py[i]);
    maxY = Math.max(maxY, py[i]);
    x += Math.sin(h) * SEG_M;
    z += Math.cos(h) * SEG_M;
    if (i < track.count) h -= track.curve[i] * HEADING_PER_CURVE; // + curve = right-hand bend
  }
  return { n, px, py, pz, heading, minY, maxY };
}

/**
 * Pose on the track at distance zUnits and lateral offset xNorm (road half-widths, + = right).
 * Writes into `out` (no allocation): { x, y, z, yaw, pitch }.
 */
export function poseAt(line, zUnits, xNorm, out) {
  const f = Math.max(0, Math.min(line.n - 1.001, zUnits / SEGMENT_LENGTH));
  const i = Math.floor(f);
  const t = f - i;
  const h = line.heading[i] + (line.heading[i + 1] - line.heading[i]) * t;
  const cx = line.px[i] + (line.px[i + 1] - line.px[i]) * t;
  const cz = line.pz[i] + (line.pz[i + 1] - line.pz[i]) * t;
  const lateral = xNorm * ROAD_HALF_M;
  // right-hand vector for heading h (forward = (sin h, 0, cos h), y up)
  out.x = cx - Math.cos(h) * lateral;
  out.z = cz + Math.sin(h) * lateral;
  out.y = line.py[i] + (line.py[i + 1] - line.py[i]) * t;
  out.yaw = h;
  out.pitch = -Math.atan2(line.py[i + 1] - line.py[i], SEG_M);
  return out;
}

export const newPose = () => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

/** Terrain height beside the road: flat verge, then easing down to the valley floor. */
export function terrainY(line, roadY, xNorm) {
  const a = Math.abs(xNorm);
  if (a <= 2) return roadY;
  const t = Math.min(1, (a - 2) / 38);
  return roadY + (line.minY - 6 - roadY) * t * t * (3 - 2 * t);
}
