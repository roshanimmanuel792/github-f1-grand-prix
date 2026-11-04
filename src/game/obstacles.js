import { hashString, mulberry32 } from '../data/dataset.js';

/** Lane centres in road half-width units (road spans -1..1). */
export const LANES = [-2 / 3, 0, 2 / 3];
export const CENTER_LANE = 1;

export const OBSTACLE_KINDS = {
  block: { label: 'Road block', difficulty: 'Easy' },
  cone: { label: 'Traffic cones', difficulty: 'Medium' },
  tyres: { label: 'Tyre stack', difficulty: 'Medium' },
  tyreBarrier: { label: 'Tyre barrier', difficulty: 'Hard' },
  barrier: { label: 'Racing barrier', difficulty: 'Extreme' },
};

export function obstacleKindFor(count, thresholds, date = '') {
  if (count < thresholds.small) return null;
  if (count < thresholds.medium) return 'block';
  if (count < thresholds.hard) return hashString(date) & 1 ? 'tyres' : 'cone';
  if (count < thresholds.extreme) return 'tyreBarrier';
  return 'barrier';
}

/**
 * One obstacle row per non-clear day. Every row is generated around a "safe lane" that
 * moves at most one lane per day (two after a clear day), so a collision-free route
 * always exists for the planner. Deterministic per date.
 */
export function generateObstacleRows(days, thresholds) {
  const rows = [];
  let safeLane = CENTER_LANE;
  let lastDay = -2; // the car starts centred on a multi-day lead-in
  for (let i = 0; i < days.length; i++) {
    const { date, contributions } = days[i];
    const kind = obstacleKindFor(contributions, thresholds, date);
    if (!kind) continue;
    const rand = mulberry32(hashString(`${date}:${kind}`));
    const reach = Math.min(2, i - lastDay);
    // Tyre barriers block two adjacent lanes, so their gap can only be on a side.
    const options = [0, 1, 2].filter(
      (l) => Math.abs(l - safeLane) <= reach && (kind !== 'tyreBarrier' || l !== CENTER_LANE),
    );
    const gap = options[Math.floor(rand() * options.length)];
    const others = [0, 1, 2].filter((l) => l !== gap);
    const blocked = kind === 'tyreBarrier' || kind === 'barrier' ? others : [others[Math.floor(rand() * 2)]];
    rows.push({ dayIndex: i, date, count: contributions, kind, blocked, safeLane: gap, label: `+${contributions}` });
    safeLane = gap;
    lastDay = i;
  }
  return rows;
}

export const isBlocked = (row, lane) => row.blocked.includes(lane);
