import { test, expect } from './utils/base-test';

test.describe('Board Viewport E2E', () => {
  test.setTimeout(60000);

  test('should render without WebGL errors', async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.locator('board-viewport')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('should render bottom channels without WebGL or NaN errors', async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    const viewport = page.locator('board-viewport');
    await expect(viewport).toBeVisible();
    await expect(viewport.locator('canvas')).toBeVisible();
    await page.waitForTimeout(500);

            const boardControls = page.locator('board-controls');
    await boardControls.locator('button[title="Add Bottom Channel"]').click();

    // Wait for the geometry debounce and WASM generation to settle
    await page.waitForTimeout(1000);

    // Verify the canvas is still there and no errors occurred
    await expect(viewport.locator('canvas')).toBeVisible();
    const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
  });
});
