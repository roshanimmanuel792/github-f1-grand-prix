# GitHub Grand Prix V2: Product Requirements

## Problem
V1 raced one hard-coded GitHub account in a pixel-art pseudo-3D view. V2 lets **any visitor** race **any GitHub user's** contribution season in a real 3D circuit, drive it themselves or watch the AI, and take home a shareable replay.

## Users
- **Visitor:** types a username, races it, shares the result.
- **Developer showing off a profile:** exports a GIF or MP4 for their GitHub README.
- **Repository owner:** keeps the daily self-updating dataset and README from V1.

## Experiences
1. **Playable game:** landing page → username + season → contribution lookup → setup (mode, camera, graphics, conditions) → race → results.
2. **Replay export:** a deterministic re-simulation of the whole season at 2× simulation speed, rendered with cinematic cameras. Exports a GIF (README-sized) and an MP4, plus ready-to-paste README markdown.

## Requirements (as shipped)
| Area | Requirement |
| --- | --- |
| Multi-user | Any valid GitHub username, any season from 2008 to now. Validated datasets, isolated per user and year. Owner's season comes from the committed daily data. |
| Data | Public contribution calendar, fetched server-side by a Cloudflare Worker (browsers can't read it: no CORS). Optional GitHub OAuth (`read:user`) for the signed-in user's own private counts. |
| Safety of data | Strict schema validation: contiguous dates, no future days, totals match. Never substitutes demo data; demo is opt-in and labelled. |
| 3D | Three.js / WebGL 2: procedural F1-style car, ribbon road with elevation and bends, kerbs, barriers, gantries with working start lights, pit building, grandstands, floodlights, billboards, instanced forest, physical sky with clouds, shadows, reflections, bloom. Quality presets Low / Medium / High / Ultra; Day / Sunset / Night. |
| Driving | Manual (keyboard + touch) and Autonomous through the **same physics, obstacles, collisions and scoring**. |
| Scoring | `score += day.contributions` only when a day is completed. Final score === dataset total, in both modes. Collisions cost speed, never points. |
| Replay | Deterministic: AI races re-simulate exactly; manual races replay a recorded input timeline. 2× = twice the simulation time per output frame. |
| Export | GIF (presets; frame-diffed; size reported, warning above 10 MB) and MP4 (WebCodecs → H.264/VP9/AV1 in an MP4 container; MediaRecorder fallback labelled honestly). Both validated after encoding. |
| Results | Score, totals, completion, days, active/zero days, streak, best day, obstacles cleared, collisions, mode. Buttons: race again, GIF, MP4, README markdown, share link, profile, new driver. |
| Access | Keyboard navigation, visible focus, ≥44 px touch targets, reduced-motion support, WebGL-unsupported message. |
| Security | Owner's `GH_TOKEN` never reaches visitors. OAuth secrets server-side only. Encrypted HttpOnly sessions, state/CSRF checks, origin-restricted CORS, rate limits, no arbitrary URL fetching. |

## Non-goals (V2)
- Real multiplayer (racing other people live). "Multi-user" means any user's data, one driver at a time.
- Weather simulation (rain or wet physics). Environment presets cover lighting only.
- Server-side video rendering. Exports render in the visitor's browser.
- Hosting exported videos (no upload service; the README explains GitHub's drag-and-drop attachment).

## Acceptance
See [V2_TEST_REPORT.md](V2_TEST_REPORT.md) for evidence against the Definition of Done.
