import { isValidUsername } from '../data/github.js';

export const GAME_URL = 'https://roshanimmanuel792.github.io/github-f1-grand-prix/';

export const gifFileName = (username, year) => `github-grand-prix-${username.toLowerCase()}-${year}.gif`;

export function shareUrl({ username, year, mode }, base = GAME_URL) {
  const url = new URL(base);
  url.searchParams.set('user', username);
  url.searchParams.set('year', String(year));
  if (mode) url.searchParams.set('mode', mode);
  return url.href;
}

/**
 * README snippet for a profile. The image path is relative: it works once the downloaded GIF
 * is committed next to the README (no invented hosting URL).
 */
export function readmeMarkdown({ username, year, score, days, mode }, base = GAME_URL) {
  if (!isValidUsername(username)) throw new Error('Invalid username.');
  const n = Number(score).toLocaleString('en-US');
  return [
    `### 🏁 GitHub Grand Prix ${year}`,
    '',
    `[![${username}'s ${year} GitHub Grand Prix replay: ${n} contributions](./${gifFileName(username, year)})](${shareUrl({ username, year, mode }, base)})`,
    '',
    `**@${username}** raced all **${days}** days of ${year} and scored **${n}**: one point per contribution.  `,
    `[▶ Race your own season](${base})`,
    '',
  ].join('\n');
}
