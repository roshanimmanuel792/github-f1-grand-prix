# GitHub Grand Prix V2: Implementation Plan (as executed)

| Milestone | What was done | Key decisions |
| --- | --- | --- |
| 0. Audit V1 | Read all source, scripts, workflows, data; ran the baseline (72 unit, 12 E2E, build). Created branch `feature/v2-realistic-multiplayer`. Confirmed github.com's calendar has no CORS header and the V1 parser works for other users. | A backend proxy is required for visitors; the owner's pipeline stays as it is. |
| 1. Multi-user data | Moved fetch/parse to `src/data/github.js` (typed errors, 2 MB cap), re-exported from the owner script. Built the Worker: validation, rate limit, cache, de-dupe, CORS, security headers, OAuth (sealed cookies, state, revocation). Ran it in `wrangler dev` against live GitHub. | Encrypted cookies instead of KV (no server storage). Cloudflare `ratelimits` binding with an in-memory fallback. Dev/preview mount the same handler. |
| 2. 3D foundation | `world.js` turns track curvature and height into a 3D centreline; ribbon road, kerbs, terrain, barriers, gantries; instanced scenery; procedural car; Sky with clamped HDR; shadows following the car; PMREM; fog; composer with MSAA and bloom. | Procedural geometry and canvas textures: original and licence-free, no asset pipeline. |
| 3. Simulation | `physics.js` shared by both modes. The AI follows the V1 driver's reference line through the same physics (feedforward + lag-compensated feedback). Collisions cost speed only. Manual input recording. | Track-coordinate arcade physics keeps V1's scoring, planner and solvable-obstacle guarantee intact. |
| 4. Interface | Landing over a live 3D attract race, setup (mode, camera, quality, conditions), glass HUD, touch controls, pause, results, error and WebGL screens. | DOM UI over the canvas; change-only writes. |
| 5. Replay | Replay format (digest + sim config + inputs), `raceFromReplay`, integer-step `ReplayClock` (2×), TV director cameras (grid, chase, avoid, wide, corner, finish line, orbit). | Deterministic re-simulation rather than screen recording. |
| 6. Export | GIF (per-frame palette + inter-frame transparency; fps values divide 100), MP4 (mediabunny over WebCodecs, H.264 → VP9 → AV1; MediaRecorder fallback labelled honestly), HUD overlay, in-browser validation, README/share text, lazy-loaded encoders. | Real-data full-season tests: GIF 9.1 MB, MP4 checked with ffprobe. |
| 7. Production | V2 E2E suite (desktop + Pixel 7), measured performance on both GPUs (removed instanced tree shadows), security scans, CI updates (ffprobe, SwiftShader), Worker deploy workflow, docs. | Deploy/push left for the owner's approval. |

Fixes found by testing along the way:
- A Vite hook returning the connect app.
- Inverted ribbon winding (caught before render).
- The sun disc flooding bloom.
- The chase camera lagging at 250 km/h.
- `PCFSoftShadowMap` removal in three r187.
- gifenc's CommonJS entry under Node.
- The 13 MB GIF, reduced to 9.1 MB.
- Found by CI on PR #1:
  - Error screens didn't update the app state (fixed in `main.js`).
  - Browser tests waited on wall-clock time, which breaks at software-WebGL frame rates; they now wait on simulation state and use the Low preset.
