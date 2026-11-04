# GitHub Grand Prix V2: Tasks

## Milestone 0: Audit
- [x] Inspect package.json, src, scripts, workflows, config, datasets, tests, deployment
- [x] Baseline: 72 unit / 12 E2E / build
- [x] Branch `feature/v2-realistic-multiplayer`

## Milestone 1: Multi-user data
- [x] Shared GitHub fetch module with typed errors and response cap
- [x] Cloudflare Worker: `/api/contributions`, `/api/health`
- [x] Username/year validation, rate limiting, caching, de-dupe, CORS, security headers
- [x] Optional OAuth: login, callback, me, logout + revocation; sealed cookies; state/CSRF; safe redirects
- [x] Browser loader: owner static path, API path, isolation checks, friendly errors
- [x] Verified in `wrangler dev` against live GitHub
- [ ] Deploy the Worker (**needs your Cloudflare authorization**)
- [ ] Register an OAuth app (**needs your GitHub account**)

## Milestone 2: 3D foundation
- [x] Centreline, road, kerbs, terrain, barriers, start/finish lines, gantries + start lights
- [x] Procedural F1-style car (wings, halo, sidepods, suspension, 4 wheels, lights, exhaust, nitro flame)
- [x] Scenery: forest, bushes, rocks, billboards, floodlights, pit building, grandstands with crowds
- [x] Sky + clouds, sun shadows, reflections, fog, bloom; day/sunset/night
- [x] Quality presets + adaptive resolution; WebGL 2 check

## Milestone 3: Simulation
- [x] Shared arcade physics (accel, brake, grip/slide, curvature, grass, barriers)
- [x] Manual driving (keyboard + touch) with recorded inputs
- [x] AI through the same physics (0 collisions in all tests)
- [x] 3D obstacles linked to date + count; knocked over on hits
- [x] Exact scoring in both modes

## Milestone 4: Interface
- [x] Landing, loading, setup, HUD, pause, results, error screens
- [x] Mobile touch controls, ≥ 44 px targets; reduced motion; keyboard focus

## Milestone 5: Replay
- [x] Replay format + validation; deterministic AI and manual replays
- [x] 2× replay clock; TV director cameras; GAME OVER sequence

## Milestone 6: Export
- [x] GIF export with presets, progress, cancel, size check, validation
- [x] MP4 export (WebCodecs/mediabunny) + labelled MediaRecorder fallback
- [x] README markdown + share link + profile instructions
- [x] Independent validation (ffprobe, mediabunny demux)

## Milestone 7: Production
- [x] V2 Playwright suite (desktop + mobile)
- [x] Performance measured on integrated + discrete GPU
- [x] Security review and scans
- [x] CI: deploy.yml (ffprobe, SwiftShader), worker.yml
- [x] Docs: PRD, Architecture, Plan, Tasks, Security, Test report, README
- [ ] Push branch / open PR / merge to `main` (**needs your approval**)
- [ ] Verify V2 on GitHub Pages after merge
- [ ] Set `apiBaseUrl` after the Worker is deployed

## Not planned for V2
- Weather (rain), GLB assets / KTX2 textures, live multiplayer
