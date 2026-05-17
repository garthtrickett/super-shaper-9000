import { test, expect } from './utils/base-test';

test.describe('Quad Viewport CAD Interface', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('board-viewport canvas');
    await page.waitForTimeout(3000);
  });

  test('should render the four-quadrant layout', async ({ page }) => {
    await expect(page).toHaveScreenshot('quad-view-baseline.png', { 
      maxDiffPixels: 15000,
      mask:[page.locator('button[title*="Flip"]')],
      timeout: 15000
    });
  });
});
