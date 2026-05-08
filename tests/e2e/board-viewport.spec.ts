import { test, expect } from './utils/base-test';

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

    // Programmatically inject a bottom channel into the board state
    await page.evaluate(() => {
      const vp = document.querySelector('board-viewport') as any;
      if (!vp || !vp.boardState) return;
      
            const channelLayer = {
        name: "Test Channel",
        isSymmetric: true,
        rightOutline: {
          controlPoints: [[2.0, 0.0, 25.0],[2.0, 0.0, 75.0]],
          tangents1: [[2.0, 0.0, 25.0],[2.0, 0.0, 75.0]],
          tangents2: [[2.0, 0.0, 25.0],[2.0, 0.0, 75.0]]
        },
        rightDepth: {
          controlPoints: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]],
          tangents1: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]],
          tangents2: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]]
        },
        leftOutline: {
          controlPoints: [[-2.0, 0.0, 25.0],[-2.0, 0.0, 75.0]],
          tangents1: [[-2.0, 0.0, 25.0],[-2.0, 0.0, 75.0]],
          tangents2: [[-2.0, 0.0, 25.0],[-2.0, 0.0, 75.0]]
        },
        leftDepth: {
          controlPoints: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]],
          tangents1: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]],
          tangents2: [[0.0, 0.5, 25.0],[0.0, 0.5, 75.0]]
        }
      };
      
      vp.boardState = {
        ...vp.boardState,
        bottomChannels: [channelLayer]
      };
      
      // Force an update to trigger the geometry rebuild
      vp.requestUpdate('boardState');
    });

    // Wait for the geometry debounce and WASM generation to settle
    await page.waitForTimeout(1000);

    // Verify the canvas is still there and no errors occurred
    await expect(viewport.locator('canvas')).toBeVisible();
    const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
  });
});
