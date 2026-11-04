import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const config = JSON.parse(readFileSync(new URL('./game.config.json', import.meta.url), 'utf8'));
const apiOrigin = config.apiBaseUrl ? new URL(config.apiBaseUrl).origin : '';

/**
 * Local dev/preview: serve /api and /auth by running the real Worker handler in Node, so
 * lookups work without deploying (it fetches github.com server-side, like production).
 */
function contributionsApi() {
  let handler;
  const middleware = async (req, res, next) => {
    if (!/^\/(api|auth)\//.test(req.url)) return next();
    try {
      handler ??= (await import('./worker/src/index.js')).createHandler();
      const host = req.headers.host || 'localhost';
      const request = new Request(new URL(req.url, `http://${host}`), { method: req.method, headers: req.headers });
      const env = { ALLOWED_ORIGINS: `http://${host}`, FRONTEND_URL: `http://${host}/`, RATE_LIMIT_PER_MINUTE: '120' };
      const response = await handler(request, env, { waitUntil() {} });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      next(err);
    }
  };
  return {
    name: 'contributions-api',
    // must not return the connect app: Vite would call a returned function as a post-hook
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    transformIndexHtml: (html) => html.replace('%API_ORIGIN%', apiOrigin),
  };
}

export default defineConfig({
  // Relative base: works at https://USER.github.io/ANY-REPO/ without knowing the repo name.
  base: './',
  plugins: [contributionsApi()],
  build: { chunkSizeWarningLimit: 800 }, // three.js is most of the main chunk; encoders load lazily
  test: {
    include: ['tests/**/*.test.js'],
  },
});
