import { defineConfig, devices } from '@playwright/test';

// Real GPU locally (Windows/ANGLE); software WebGL in CI.
const gpuArgs = process.env.CI ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: process.env.CI ? 1 : 2,
  use: { baseURL: 'http://localhost:4173/', launchOptions: { args: gpuArgs } },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
