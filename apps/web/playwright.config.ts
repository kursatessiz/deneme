import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end suite for the web panel. It drives the full stack
 * (built API + built-and-started Next.js app) against a seeded Postgres
 * database -- see docs/WEB_PANEL.md "Testler" for how to run it locally
 * and .github/workflows/ci.yml's `web-e2e` job for how CI runs it.
 */

const WEB_PORT = 3000;
const API_PORT = 4000;
const baseURL = `http://localhost:${WEB_PORT}`;
const apiURL = `http://localhost:${API_PORT}`;

/** DATABASE_URL must point at an already migrated and seeded database; there is no safe local default. */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set to run the web e2e suite (a migrated, seeded Postgres database). See docs/WEB_PANEL.md.',
  );
}

// Throwaway defaults so the suite works locally without extra setup; CI sets its own values explicitly.
const jwtSecret = process.env.JWT_SECRET ?? 'web-e2e-throwaway-secret-0123456789abcdef';
const otpTestCode = process.env.OTP_TEST_CODE ?? '482915';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Both servers are started fresh for every run (reuseExistingServer: false)
  // so they always bind to the DATABASE_URL this run was given, never to a
  // stale process left over from a previous seeded database.
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: path.resolve(__dirname, '../api'),
      url: `${apiURL}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        JWT_SECRET: jwtSecret,
        OTP_TEST_CODE: otpTestCode,
        PUBLIC_APP_URL: baseURL,
        PUBLIC_API_URL: apiURL,
        CORS_ORIGIN: baseURL,
      },
    },
    {
      // `next build` runs here (not in a separate CI step) so this config
      // is self-contained: `pnpm --filter @platform/web test:e2e` builds and
      // serves the web app itself, as long as @platform/shared is already
      // built (see the "Build" step both CI jobs share).
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      cwd: __dirname,
      url: `${baseURL}/giris`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_INTERNAL_URL: apiURL,
      },
    },
  ],
});
