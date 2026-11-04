<div align="center">

# 🏁 GITHUB GRAND PRIX

**Race any GitHub user's contribution year in 3D. Every day is a stretch of circuit; every contribution is an obstacle and a point.**

<a href="https://roshanimmanuel792.github.io/github-f1-grand-prix/">
  <img src="docs/preview.gif" alt="Full-season replay at 2x: a 3D Formula-style car races a curving circuit, steering around obstacles generated from each day's GitHub contributions while the score climbs to the yearly total" width="640" />
</a>

### [▶ PLAY GITHUB GRAND PRIX](https://roshanimmanuel792.github.io/github-f1-grand-prix/)

<sub>The preview above is the game's own full-season replay export (2× speed) of this repository owner's season.</sub>

</div>

## 🏆 This season

<!-- STATS:START -->
| Season | Final score | Race days | Active days | Zero days | Longest streak | Current streak | Best day |
| :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **2026** | **328** | 308 | 89 | 219 | 13 days | 2 days | 32 (2026-05-09) |

<sub>Contributions from 2026-01-01 to 2026-11-04 · source: GitHub GraphQL API · refreshed daily by GitHub Actions</sub>
<!-- STATS:END -->

## 🎮 How it works

1. Enter **any GitHub username** and pick a season (2008 → now). Public contribution data only; no sign-in needed. Optionally sign in with GitHub to include *your own* private contribution counts.
2. Choose **Autonomous** (the AI drives) or **Manual** (you drive), plus camera, graphics quality and conditions (day, sunset, night).
3. Race the whole season. Each calendar day is 40 m of track; that day's contributions become an obstacle:

   | Daily contributions | Obstacle |
   | :-: | --- |
   | 0 | Clear track |
   | 1–2 | Jersey road block |
   | 3–4 | Traffic cones / tyre stack |
   | 5–9 | Tyre wall across two lanes |
   | 10+ | Chevron barrier with one gap (green arrow) |

4. **Score = contributions.** A day's count is added only when you complete that day. The final score always equals the season total. Collisions cost speed, never points.
5. Get your **results**, then export a **full-season 2× replay** as a GIF or MP4 with ready-to-paste README markdown.

**Manual controls:** <kbd>W</kbd>/<kbd>↑</kbd> throttle · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> steer · <kbd>Shift</kbd> nitro · <kbd>C</kbd> camera · <kbd>P</kbd>/<kbd>Esc</kbd> pause. On phones, on-screen steering, gas, brake and nitro buttons appear.

**Share links:** `…/github-f1-grand-prix/?user=octocat&year=2025&mode=manual` (also `quality=low|medium|high|ultra`, `env=day|sunset|night`, `demo=1`).

### Put your replay on your profile
1. On the results screen, choose **Download GIF** (README preset, about 9 MB for a 300-day season) and commit it next to your profile `README.md` without renaming it.
2. Click **Copy README markdown** and paste it into that README. The image path is relative, so it works once the GIF is committed.
3. For the **MP4**: edit your README on github.com and drag the video into the editor. GitHub uploads it and inserts a playable link.

## 🛠️ Tech
Three.js (WebGL 2) · vanilla ES modules · Vite · Cloudflare Workers · WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny) (MP4) · [gifenc](https://github.com/mattdesl/gifenc) (GIF) · Vitest · Playwright · GitHub Actions/Pages.
All 3D models, textures and sounds are procedurally generated in code: no third-party assets, team liveries or trademarks.

Docs: [Product](V2_PRD.md) · [Architecture](V2_ARCHITECTURE.md) · [Security](V2_SECURITY.md) · [Test report](V2_TEST_REPORT.md) · [Plan](V2_IMPLEMENTATION_PLAN.md) · [Tasks](V2_TASKS.md)

## 🚀 Setup

### Frontend (GitHub Pages)
Already configured: **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs tests and deploys. The owner's season (`githubUsername` in `game.config.json`) refreshes daily via `update-contributions.yml`, which uses the `GH_TOKEN` Actions secret (classic PAT, `read:user` only). Visitor lookups never use that token.

### Contributions API (Cloudflare Worker): needed for usernames other than the owner's
GitHub's public calendar has no CORS headers, so browsers can't read it directly; the Worker fetches it server-side.

1. `cd worker && npm install && npx wrangler login` (or create an API token with **Workers Scripts: Edit**).
2. `npx wrangler deploy`. Note the URL, e.g. `https://github-grand-prix-api.<account>.workers.dev`.
3. Put that URL in `game.config.json → "apiBaseUrl"` and push. The CSP `connect-src` is filled from it at build time.
4. Optional automation: add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `worker.yml` then redeploys the Worker on changes, and skips deploy if they're absent.

`worker/wrangler.toml` sets `ALLOWED_ORIGINS` (CORS), `FRONTEND_URL`, cache TTLs, and a Cloudflare rate limit (30 requests per minute per IP).

### Optional: GitHub sign-in (private contribution counts)
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**. Homepage: your Pages URL. Callback: `https://<worker-url>/auth/callback`.
2. In `worker/wrangler.toml` set `GITHUB_CLIENT_ID = "<client id>"`.
3. `npx wrangler secret put GITHUB_CLIENT_SECRET` and `npx wrangler secret put SESSION_SECRET` (any random string of 32+ characters), then `npx wrangler deploy`.
4. The landing page shows **Sign in with GitHub** once `/auth/me` reports OAuth configured. Scope is `read:user`; sessions are encrypted HttpOnly cookies. See [V2_SECURITY.md](V2_SECURITY.md).

## 💻 Development
```bash
npm install
npm run dev            # http://localhost:5173. /api runs the real Worker code locally
npm test               # unit + integration tests (game, physics, replay, export, Worker API, OAuth)
npx playwright install chromium && npm run test:e2e
npm run build
npm run preview:gif    # re-record docs/preview.gif with the in-app exporter
cd worker && npx wrangler dev   # the Worker in Cloudflare's local runtime
```
