# GitHub Grand Prix V2: Architecture

```
                ┌──────────── GitHub Pages (static) ─────────────┐
 visitor ──▶    │ index.html + Vite bundle (three.js, UI)          │
                │ public/data/contributions/*.json (owner, daily)  │
                └───────────────┬──────────────────────────────────┘
                                │ fetch /api/contributions?user&year (credentials for OAuth)
                ┌───────────────▼───────── Cloudflare Worker ──────────────┐
                │ validate input → rate limit → cache (caches.default)     │
                │ → github.com/users/<u>/contributions (public HTML)        │
                │   or GraphQL with the visitor's own OAuth token           │
                │ → normalize + validate (shared src/data) → JSON           │
                └───────────────────────────────────────────────────────────┘
 GitHub Actions: update-contributions (owner, GH_TOKEN) → deploy (tests → Pages) ; worker.yml (wrangler deploy)
```

## Modules

| Layer | Files | Responsibility |
| --- | --- | --- |
| Shared data | `src/data/dataset.js`, `src/data/github.js` | Date math, normalization, **validation**, stats, demo data; GitHub GraphQL + public-calendar fetching with typed errors, retries and a 2 MB response cap. Runs in Node, the Worker and the browser. |
| Browser data | `src/data/loader.js` | Owner's season from static JSON, everyone else via the API. Validates and checks that the response matches the requested user and year. |
| Worker | `worker/src/index.js`, `worker/wrangler.toml` | `/api/contributions`, `/api/health`, `/auth/login`, `/auth/callback`, `/auth/me`, `/auth/logout`. Injectable fetch/cache/clock for tests. |
| Simulation | `src/game/track.js`, `obstacles.js`, `planner.js`, `driver.js`, `physics.js`, `race.js`, `replay.js` | Deterministic fixed-step (1/120 s) race. V1 track, obstacles, Viterbi planner and safety controller are reused unchanged in spirit. |
| 3D | `src/three/world.js`, `track3d.js`, `scenery3d.js`, `obstacles3d.js`, `car.js`, `effects.js`, `cameras.js`, `textures.js`, `engine.js` | Builds the circuit once per race and renders simulation state. Never mutates the simulation. |
| Export | `src/export/presets.js`, `overlay.js`, `recorder.js`, `gif.js`, `video.js`, `readme.js` | Deterministic replay rendering, HUD compositing, GIF/MP4 encoding and validation, README/share text. Encoders are lazy-loaded. |
| UI | `index.html`, `src/styles.css`, `src/ui/ui.js`, `src/ui/input.js`, `src/main.js` | Screens, HUD (change-only DOM writes), keyboard/touch input, lifecycle. `window.__GP__` hook for tests and capture. |
| Owner pipeline | `scripts/*.js`, `.github/workflows/update-contributions.yml` | Unchanged behaviour from V1; fetch logic now imported from `src/data/github.js`. |

## Simulation model
- **Track coordinates:** distance `z` (world units; 1 day = 4000 units = 40 m) and lateral `x` in road half-widths (−1…1; lanes at −⅔, 0, +⅔).
- **Physics** (`physics.js`): throttle/brake/coast, nitro top-speed boost, speed-dependent steering authority, first-order grip lag (slides under hard steering), centrifugal drift from road curvature, grass slowdown, barrier bounce.
- **Manual:** digital inputs → ramped steering → physics. Inputs are recorded as `[step, bits]` on change.
- **Autonomous:** the V1 `AutonomousDriver` now produces a *reference line* (planner lane + smoothstep manoeuvres timed to finish before each obstacle). `steerFor()` turns it into a steering command for the *same* physics: feedforward of the line's rate, curvature compensation, and position feedback looking one grip time-constant ahead. A brake request covers tight manoeuvres. The safety override from V1 is preserved.
- **Collisions** are checked when the car crosses an obstacle row (same rule for both modes). A hit cuts speed by 55% and knocks the car aside; the score is untouched.
- **Scoring/lifecycle** are unchanged from V1 (`READY → RACING(countdown) ⇄ PAUSED → FINISHED`).

## 3D presentation
- `world.js` integrates track curvature into a heading and height per segment, so the centreline is real 3D. `poseAt(z, x)` gives position, yaw and pitch with no allocation.
- `track3d.js` builds long ribbon meshes (road with lane-marking texture, flat-coloured kerb quads, terrain falling to a valley floor, double-sided barriers), chequered lines, and gantries with emissive start lights.
- `scenery3d.js` places instanced trees, bushes, rocks, billboards, floodlights and crowds (a handful of draw calls for about 10k objects), plus the pit building and grandstands.
- `obstacles3d.js` builds instanced obstacle parts per contribution row (jersey block, cone cluster, tyre stack, tyre wall + belt, chevron barrier + lamps, floating gap arrow). Each instance remembers its row, so hits knock it over. A pool of 4 sprites shows `+N · MM/DD` for upcoming rows.
- `engine.js`: renderer (ACES tone mapping, sRGB), `Sky` with clamped HDR output and animated clouds, sun shadow frustum following the car, PMREM reflections, fog, MSAA/bloom composer, quality presets, adaptive resolution (0.5–1.0× when frames exceed budget), and `beginExport()`/`attach()` for replays.
- `cameras.js`: chase, close, cockpit and a deterministic TV director (grid, chase, avoid, wide, corner, finish line, orbit). Smoothing is applied to the camera's offset from the car, so it never lags at speed.

## Replay & export
1. `createReplay(race)` stores `{version, username, year, digest(dataset), mode, sim config, inputs, result}`.
2. `raceFromReplay()` rebuilds an identical race. The digest prevents replaying against different data.
3. `ReplayClock` maps output frame *n* to `round(n · speed · 120 / fps)` simulation steps (2× by default) and runs until 4 s after the flag.
4. `renderReplay()` points the existing scene at the replay race (`engine.attach`), renders at a fixed resolution, and composites a 2D HUD/GAME OVER overlay.
5. GIF: per-frame palettes plus inter-frame transparency, with fps values that divide 100 so delays are exact. MP4: mediabunny `CanvasSource` → `Mp4OutputFormat`, timestamps from the replay clock. Codec order is H.264 → VP9 → AV1, falling back to MediaRecorder with the container reported truthfully.
6. Validation: GIF structure parsed back (`inspectGif`); video decoded by the browser's media element (dimensions and duration). Tests additionally demux with mediabunny and run ffprobe.

## Deployment
- **Pages:** `deploy.yml` (unit tests → data validation → Playwright on SwiftShader with ffprobe → build → Pages). Vite `base: './'` so any repository path works.
- **Worker:** `worker.yml` runs the API tests and then `wrangler deploy`. It skips deploy if `CLOUDFLARE_API_TOKEN` is absent. The frontend learns the API from `game.config.json → apiBaseUrl`; the CSP `connect-src` is filled from it at build time.
- **Local:** Vite dev/preview mounts the real Worker handler as middleware, so `/api` works without deploying.
