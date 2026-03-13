import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Web3 DApp UI tests.
 *
 * Tests mock window.ethereum to simulate MetaMask without the real extension.
 * For full MetaMask E2E testing in staging, switch to Synpress.
 *
 * See: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,

  // Fail CI if test.only is accidentally left in
  forbidOnly: !!process.env.CI,

  // Retry on CI to handle flaky network/timing issues
  retries: process.env.CI ? 2 : 0,

  // Single worker in CI to avoid port conflicts
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html"],
    ["list"],
  ],

  use: {
    // Base URL for page.goto("/") calls
    baseURL: process.env.APP_URL || "http://localhost:3000",

    // Capture trace on first retry for debugging
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
