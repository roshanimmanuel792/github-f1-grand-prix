import fileConfig from '../game.config.json';

export const QUALITY_NAMES = ['low', 'medium', 'high', 'ultra'];
export const ENVIRONMENT_NAMES = ['day', 'sunset', 'night'];
export const MODE_NAMES = ['ai', 'manual'];

/**
 * game.config.json merged with URL overrides (share links and tests):
 * ?user=octocat&year=2025&mode=ai|manual ?quality=low..ultra ?env=day|sunset|night
 * ?duration=60 ?autoplay=0|1 ?demo=1 ?debug=1 ?capture=1
 */
export function resolveConfig(search = '', { reducedMotion = false } = {}) {
  const q = new URLSearchParams(search);
  const c = { ...fileConfig, obstacleThresholds: { ...fileConfig.obstacleThresholds } };
  if (q.has('year')) c.selectedYear = q.get('year');
  if (q.has('duration')) c.raceDurationSeconds = Number(q.get('duration'));
  c.autoPlay = q.has('autoplay') ? q.get('autoplay') !== '0' : c.autoPlay && !reducedMotion;
  c.user = q.get('user') || '';
  c.mode = MODE_NAMES.includes(q.get('mode')) ? q.get('mode') : 'ai';
  c.quality = QUALITY_NAMES.includes(q.get('quality')) ? q.get('quality') : c.defaultQuality ?? 'high';
  c.environment = ENVIRONMENT_NAMES.includes(q.get('env')) ? q.get('env') : c.defaultEnvironment ?? 'day';
  c.demo = q.get('demo') === '1';
  c.debug = q.get('debug') === '1';
  c.capture = q.get('capture') === '1';
  c.reducedMotion = reducedMotion;
  return validateConfig(c);
}

export function validateConfig(c) {
  const fail = (m) => {
    throw new Error(`Invalid game.config.json: ${m}`);
  };
  if (!c.githubUsername) fail('githubUsername is required');
  if (c.raceMode !== 'yearly') fail('raceMode must be "yearly"');
  if (c.selectedYear !== 'auto' && !Number.isInteger(Number(c.selectedYear))) fail('selectedYear must be "auto" or a year');
  if (!(c.raceDurationSeconds > 0)) fail('raceDurationSeconds must be > 0');
  if (!(c.minSecondsPerDay > 0)) fail('minSecondsPerDay must be > 0');
  if (!(c.aiLookaheadDays >= 1.1)) fail('aiLookaheadDays must be >= 1.1 so consecutive obstacle days are always seen');
  if (!(c.targetFPS >= 15)) fail('targetFPS must be >= 15');
  if (c.apiBaseUrl && !/^https:\/\/[^/]+/.test(c.apiBaseUrl)) fail('apiBaseUrl must be an https:// URL (or empty)');
  const t = c.obstacleThresholds;
  const steps = [t.small, t.medium, t.hard, t.extreme];
  if (!steps.every((v, i) => Number.isInteger(v) && v >= 1 && (i === 0 || v > steps[i - 1]))) {
    fail('obstacleThresholds must be ascending positive integers (small < medium < hard < extreme)');
  }
  const n = c.nitroThresholds;
  if (!Array.isArray(n) || !n.every((v, i) => v > 0 && (i === 0 || v > n[i - 1]))) fail('nitroThresholds must be ascending');
  return c;
}
