import { CENTER_LANE, isBlocked } from './obstacles.js';

/** Lanes the car can move between two rows `dayGap` days apart (one lane per day, max two). */
export const laneReach = (dayGap) => Math.min(2, dayGap);

/**
 * Optimal lane per obstacle row (Viterbi over 3 lanes): never enters a blocked lane,
 * respects per-row lane-change reach, minimises steering, and mildly prefers the centre
 * racing line. Returns null if no route exists.
 */
export function planLanes(rows, { startLane = CENTER_LANE, centerBias = 0.3 } = {}) {
  const n = rows.length;
  const cost = new Float64Array(n * 3).fill(Infinity);
  const from = new Int8Array(n * 3).fill(-1);
  for (let r = 0; r < n; r++) {
    const reach = laneReach(r ? rows[r].dayIndex - rows[r - 1].dayIndex : rows[0].dayIndex + 2);
    for (let lane = 0; lane < 3; lane++) {
      if (isBlocked(rows[r], lane)) continue;
      for (let prev = 0; prev < 3; prev++) {
        const move = Math.abs(lane - prev);
        if (move > reach) continue;
        const base = r ? cost[(r - 1) * 3 + prev] : prev === startLane ? 0 : Infinity;
        const c = base + move + (lane === CENTER_LANE ? 0 : centerBias);
        if (c < cost[r * 3 + lane]) {
          cost[r * 3 + lane] = c;
          from[r * 3 + lane] = prev;
        }
      }
    }
  }
  if (!n) return [];
  let lane = -1;
  let best = Infinity;
  for (let l = 0; l < 3; l++) {
    if (cost[(n - 1) * 3 + l] < best) best = cost[(n - 1) * 3 + (lane = l)];
  }
  if (lane < 0) return null;
  const plan = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    plan[r] = lane;
    lane = from[r * 3 + lane];
  }
  return plan;
}

/** Safe fallback: nearest free lane to the previous choice, row by row. */
export function greedyLanes(rows, startLane = CENTER_LANE) {
  let lane = startLane;
  return rows.map((row) => {
    const free = [0, 1, 2].filter((l) => !isBlocked(row, l));
    lane = free.reduce((best, l) => (Math.abs(l - lane) < Math.abs(best - lane) ? l : best), free[0]);
    return lane;
  });
}

export function planRoute(rows, log) {
  const plan = planLanes(rows);
  if (plan) return plan;
  log?.({ type: 'fallback', reason: 'no optimal route; using nearest-free-lane fallback' });
  return greedyLanes(rows);
}
