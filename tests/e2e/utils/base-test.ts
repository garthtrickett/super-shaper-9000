import { test as base, expect } from "@playwright/test";

// Extend the base test to automatically pipe browser console logs to the terminal
export const test = base.extend({
  page: async ({ page }, use) => {
        page.on("console", (msg) => {
      // Pipe out ALL logs to the terminal for debugging headless runs
      console.log(`[Browser ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.error(`[Browser Exception] ${err.message}`);
    });
    await use(page);
  },
});

export { expect };
