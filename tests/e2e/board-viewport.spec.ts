import { test, expect } from '@playwright/test';

test.describe('Board Viewport E2E', () => {
  test('should render without WebGL errors', async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.locator('board-viewport')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
