import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * End-to-end tests run the app in fixture mode (no Qloo or LLM keys needed),
 * so the suite is fully deterministic and works offline.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1024, height: 1366 },
  },
  projects: [
    {
      name: "chromium-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 1366 } },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      QLOO_MODE: "fixture", QLOO_FIXTURE_LATENCY_MS: "120",
      LLM_MODE: "fixture",
      QLOO_API_KEY: "",
      LLM_API_KEY: "",
    },
  },
});
