import { defineConfig, devices } from '@playwright/test';
if (process.env.NIX_CC && !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    console.warn("⚠️ Running in NixOS but PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is missing!");
    console.warn("Ensure you are inside the `nix develop` shell or `direnv` is loaded.");
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects:[
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        channel: undefined
      },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
