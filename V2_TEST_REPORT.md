# GitHub Grand Prix V2: Test Report

All results below were produced on 2026-11-04 on branch `feature/v2-realistic-multiplayer`, on a Windows laptop: AMD Radeon integrated + NVIDIA RTX 3050 Laptop GPU, Node 24, Chromium (Playwright 1.64).

## Baseline (V1, before changes)
| Check | Result |
| --- | --- |
| Vitest | 72 / 72 passed |
| Playwright | 12 / 12 passed |
| Build | 37 KB JS (15 KB gzip) |

## V2 results
| Suite | Result | Notes |
| --- | --- | --- |
| Unit + integration (Vitest) | **147 / 147 passed**, 10 files | V1's 72 tests kept (2 adjusted for the new physics; see below) + 75 new |
| Browser (Playwright, desktop 1280×720 + Pixel 7) | **23 passed, 3 skipped by design** | export + clipboard tests run on desktop only; touch test on mobile only |
| Data validation (`npm run validate`) | 2025 ✓, 2026 ✓ | |
| Production build | ✓ | main chunk 704 KB (187 KB gzip, mostly three.js); MP4 encoder 52 KB gzip and GIF code lazy-loaded |
| Owner updater (`fetch-contributions.js`, public fallback) | ✓ 2026: 328 contributions / 308 days | changes reverted, to leave daily data to the bot |
| **GitHub Actions on PR #1** (ubuntu, SwiftShader WebGL, ffprobe installed) | ✅ 147/147 unit; 23 passed / 3 skipped by design (incl. MP4 export + ffprobe); build ✓ | run 41903141817 |
| Worker in Cloudflare's local runtime (`wrangler dev`) against live GitHub | ✓ | gaearon 2026: 775 / 308 days (MISS, then HIT); octocat 2024: 366 days (leap year); unknown user 404; bad name 400; OAuth unconfigured 501; RATE_LIMITER binding loaded |

### What the new tests cover
- `worker.test.js` (25): public lookup + CORS, per-user isolation, cache by normalized key, concurrent de-dupe, invalid username/year, unknown user, upstream 5xx, oversized response, no fetch for URL-like input, per-IP and binding rate limits, CORS refusal, health; OAuth: 501 when unconfigured, authorize redirect (scope, state, no secret), state mismatch rejected before token exchange, server-side exchange, encrypted HttpOnly session, token never in URL, signed-in GraphQL uncached, public data when looking up someone else, logout Origin check + revocation, tampered/expired/wrong-key sessions, open-redirect prevention.
- `physics.test.js` (14): acceleration, nitro, braking, coasting, no sideways motion at rest, speed-dependent steering, centrifugal drift, sliding, grass, barrier impacts; manual: no motion without input, grid hold, collisions cost speed but never score (still finishes exactly), nitro tank, compact input log; AI through shared physics keeps >0.05 half-width clearance at 180 s, 45 s and fastest pace, and stays on the road through every bend.
- `replay.test.js` (4): AI and manual replays reproduce the race exactly at the finish step (after JSON round-trip, ignoring live input); digest/timeline validation; 2× clock = 240 steps per 30 output frames, exact monotonic timestamps, whole season covered.
- `export.test.js` (7): GIF encode → inspect (frames, size, 1.2 s duration), frame-diffing shrinks static content, malformed/truncated GIFs rejected, preset timing exact, even video sizes; README markdown (real username/season/score, relative GIF path, no invented video URL, injection refused), share links.
- `loader.test.js` (25): username rules, API + credentials, wrong-user/season refused, invalid data refused, friendly 404/429/502, no-API detection, network errors, owner path avoids the API, no requests for bad input, demo labelled; config URL params and https-only API URL.
- E2E (13 tests × 2 viewports): landing renders with no console errors; invalid username blocked client-side (no API call); unknown user → friendly error → back; wrong-user API response refused; AI race personalised with exact score, results only after the last day, 0 collisions, all obstacles cleared, no console errors; different users → different races; manual: no motion without input, W accelerates, A steers, camera switch keeps progress, pause freezes, finishes with exact score and a recorded input timeline; GIF + MP4 export validated outside the browser; README/share text; mobile touch controls (≥ 44 px, gas drives the car, no overflow); reduced motion disables animation; owner's season without the API; demo labelled.

### V1 tests changed
- `scoring.test.js` "identical at different frame rates" and the AI tests now run on the physics-driven car. Assertions are unchanged; they still pass with 0 collisions.
- V1's Playwright spec targeted the removed 2D UI; it was replaced by the V2 spec above.

## Export validation (full season, real data: gaearon 2026, 308 days, score 775)
| Export | Size | Frames | Duration | Render time | Independent check |
| --- | --- | --- | --- | --- | --- |
| GIF README preset 320×180 @10 fps | **9.1 MB** | 942 | 94.2 s | 29 s | ffprobe: gif 320×180, 942 frames, 10 fps, 94.2 s; mid-frame inspected |
| GIF Large 480×270 @10 fps | 21.5 MB | 942 | 94.2 s | 34 s | ffprobe: 942 frames, 94.2 s |
| MP4 854×480 @30 fps | 36.1 MB | 2826 | 94.2 s | 46 s | ffprobe: **h264**, 2826 frames, 30/1 fps, 94.2 s; full decode with no errors; first frame = grid with lights, score 0; last frame = GAME OVER, 775 pts, day 308/308, 100% |

The race took about 188 s of simulated time (countdown + 308 days at 0.58 s per day + 4 s tail). 94.2 s of output means the replay ran at exactly 2× simulation speed. In the browser, both exports are also re-validated after encoding (GIF parsed back; video decoded by the media element) and rejected if the replay score differs. In the E2E test the MP4 is additionally demuxed by mediabunny in Node, and frames are counted with ffprobe.

The repository's `docs/preview.gif` (8.9 MB, 942 frames, final score 328) was produced by this same exporter.

## Performance (measured, headed Chromium, AI race on gaearon 2026, 5 s windows)
| GPU / viewport | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| RTX 3050 Laptop, 1920×1080 | 188 fps | 153 fps | 82 fps | 105 fps |
| AMD Radeon integrated, 1920×1080 | 116 fps | 77 fps | 59 fps (p95 36 ms) | 51 fps |
| AMD Radeon integrated, 412×915 @2.6× (phone viewport) | 128 fps | 96 fps | 69 fps | 56 fps |

- JS heap stays at 29–39 MB through a race. Adaptive resolution did not need to engage in these runs.
- Instanced tree shadows were found to cost about 3× on High (RTX 55 → 82 fps after removing them) and were disabled.
- Real phones and Firefox/Safari were **not** tested.

## Security checks
- Scan of tracked + new files for token patterns: only the obvious fakes in `worker.test.js`.
- `dist/` contains no `GH_TOKEN`, client secret or session secret.
- No `innerHTML`/`eval`/`new Function` in `src/` or `worker/src/`.
- Worker logs only `err.name`.
- Details in [V2_SECURITY.md](V2_SECURITY.md).

## Status
| Item | Implemented | Tested | Deployed | Needs user config |
| --- | :-: | :-: | :-: | :-: |
| Multi-user lookup (any username) | ✅ | ✅ unit + local runtime + E2E (mocked) | ❌ | Deploy Worker + set `apiBaseUrl` |
| Owner's daily pipeline | ✅ (unchanged behaviour) | ✅ | ✅ (V1 on main, still running) | — |
| Optional GitHub OAuth | ✅ | ✅ with mocked GitHub | ❌ | OAuth app + Worker secrets |
| Three.js 3D game (car, circuit, scenery, obstacles, cameras, quality, environments) | ✅ | ✅ | ❌ (branch not pushed) | Approve push/merge |
| Manual + autonomous driving, shared physics | ✅ | ✅ | ❌ | — |
| Exact scoring | ✅ | ✅ | ❌ | — |
| Deterministic 2× replay, GIF + MP4 export | ✅ | ✅ (ffprobe) | ❌ | — |
| MediaRecorder fallback | ✅ | ⚠️ not exercised (Chromium has WebCodecs) | ❌ | — |
| Cloudflare Worker deployment workflow | ✅ | ⚠️ tests run; deploy needs credentials | ❌ | Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

### Not implemented
- Weather presets (rain/wet). Day/sunset/night lighting only.
- GLB/glTF assets and compressed (KTX2) textures. Models and textures are procedural (licence-free); there are no files to compress.
- Live multiplayer (not requested; "multi-user" means per-user datasets).

## Remaining limitations
- Third-party-cookie blocking (Safari; optional in Chrome) prevents the cross-site OAuth session. Those users still get public data.
- Long or busy seasons can produce README GIFs over 10 MB. The UI shows the size, warns, and offers a 5 fps Tiny preset.
- Scenery placement doesn't test for the procedural circuit looping back over itself.
- Public-calendar lookups depend on github.com's HTML and fail closed if it changes.
