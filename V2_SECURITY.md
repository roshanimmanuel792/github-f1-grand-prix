# GitHub Grand Prix V2: Security

## Assets
| Asset | Where it lives | Exposure |
| --- | --- | --- |
| Owner's `GH_TOKEN` | GitHub Actions secret | Only the "Fetch contributions" step of `update-contributions.yml`. Never in the Worker, frontend, build or JSON. |
| OAuth client secret | Worker secret `GITHUB_CLIENT_SECRET` | Used only in the server-side code exchange and revocation calls. |
| Session key | Worker secret `SESSION_SECRET` (≥ 32 chars) | Encrypts session and state cookies (AES-GCM). |
| Visitor access token | Inside an encrypted `__Host-gp_session` cookie | HttpOnly, Secure, never in URLs, responses, logs or JS-readable storage. |
| Cloudflare deploy token | Actions secret `CLOUDFLARE_API_TOKEN` | `worker.yml` deploy step only. |

## Controls (implemented and tested)
- **Username validation** (`^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$`) before any upstream call, in both the browser and the Worker. The Worker only ever fetches two fixed GitHub hosts with the encoded username, so there is **no arbitrary URL fetching**. Tested with `https://evil…` and `../` inputs.
- **Response validation:** every dataset passes `validateDataset` (schema, contiguity, no future days, totals). The browser also checks the response belongs to the requested user and year (dataset isolation test).
- **Upstream limits:** GitHub responses are capped at 2 MB (streamed). Retries are only for 5xx/429/network errors, with backoff. Identical concurrent lookups are de-duplicated.
- **Rate limiting:** Cloudflare `ratelimits` binding (30 requests per minute per IP, across isolates), with an in-memory per-isolate fallback. Returns 429 + `Retry-After`.
- **Caching:** keyed by lower-case username + year (1 h for the current season, 7 d for past seasons). Signed-in GraphQL responses are `private, no-store` and never enter the shared cache.
- **CORS:** `Access-Control-Allow-Origin` only for `ALLOWED_ORIGINS` (exact match), with `Vary: Origin`. Unknown origins get no CORS grant (tested).
- **OAuth:**
  - Scope `read:user` only.
  - `state` is 32 random bytes, sealed in an HttpOnly `SameSite=Lax` cookie (10 min) and compared in constant time. A mismatch is rejected with 400, before any token exchange.
  - The code exchange is server-side.
  - The session cookie is `__Host-` prefixed, HttpOnly, Secure, `SameSite=None` (cross-site API), with an 8 h expiry inside the sealed payload. Tampered, expired or wrong-key cookies are rejected (tested).
  - `return_to` must be on an allowed origin, so there are **no open redirects** (tested).
  - Logout is `POST`-only and requires an allowed `Origin` (CSRF). It revokes the token via `DELETE /applications/{client_id}/token` and clears the cookie.
  - The token never appears in the redirect URL (tested).
- **Logging:** the Worker logs only `err.name` for unexpected errors; never headers, cookies or tokens.
- **Headers:** Worker responses carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and HSTS. The frontend ships a CSP `<meta>` (`script-src 'self'`, `connect-src 'self' <api origin>`, images limited to self/data/blob/GitHub avatars, `object-src 'none'`, `base-uri 'self'`). GitHub Pages can't set response headers, so `frame-ancestors` isn't enforceable there.
- **No HTML injection:** the UI writes text with `textContent`/`replaceChildren` only (no `innerHTML`/`eval`; checked by scan). README markdown refuses usernames that aren't valid GitHub logins.
- **Secrets hygiene:** `.env`, `.dev.vars`, `worker/.wrangler` are git-ignored. A repo scan found no token patterns (test fixtures use obvious fakes). The `dist/` scan found no secrets.

## Residual risks / limitations
- Cross-site cookies: browsers that block third-party cookies (Safari by default; Chrome with the setting on) won't send the session from `github.io` to `*.workers.dev`, so OAuth falls back to public data there. Fix: serve the API from a subdomain of the same site (custom domain for both).
- The public calendar is HTML scraping. If GitHub changes the markup, lookups fail closed (`invalid_data`) rather than showing wrong data.
- The in-memory rate-limit fallback is per isolate; the Cloudflare binding is the real limit in production.
- OAuth with `read:user` returns what GitHub's API reports for the viewer. Private repositories' contributions appear as counts when the user's "Private contributions" profile setting is on; no repository contents are ever accessible.
