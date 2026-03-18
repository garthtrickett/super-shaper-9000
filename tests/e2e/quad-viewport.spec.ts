// tests/e2e/quad-viewport.spec.ts
import { test, expect } from './utils/base-test';

test.describe('Quad Viewport CAD Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the 3D viewport to be initialized and rendered
    await page.waitForSelector('board-viewport canvas');
    // Give a brief moment for the initial board to render to avoid flaky screenshots
    await page.waitForTimeout(1000);
  });

  test('should render the four-quadrant layout', async ({ page }) => {
    await expect(page).toHaveScreenshot('quad-view-baseline.png', { maxDiffPixels: 1000 });
  });

  test('should only allow camera orbiting in the perspective view', async ({ page }) => {
    const canvas = await page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // Define quadrant centers
    const topLeft = { x: box!.x + box!.width * 0.25, y: box!.y + box!.height * 0.25 };
    const topRight = { x: box!.x + box!.width * 0.75, y: box!.y + box!.height * 0.25 };

    // --- 1. Drag in a 2D view (Top Left) and verify NO rotation occurs ---
    await page.mouse.move(topLeft.x, topLeft.y);
    await page.mouse.down();
    await page.mouse.move(topLeft.x + 50, topLeft.y + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500); // Wait for momentum to settle

    await expect(page).toHaveScreenshot('quad-view-no-rotation.png', { maxDiffPixels: 1000 });

    // --- 2. Drag in the 3D view (Top Right) and verify rotation DOES occur ---
    await page.mouse.move(topRight.x, topRight.y);
    await page.mouse.down();
    await page.mouse.move(topRight.x + 80, topRight.y + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500); // Wait for orbit controls to settle

    // Compare against the *un-rotated* screenshot. They should NOT match.
    await expect(page).not.toHaveScreenshot('quad-view-no-rotation.png');
  });

  test('should update 3D model when dragging a gizmo in a 2D view', async ({ page }) => {
    // --- 1. Enter manual mode ---
    await page.getByRole('button', { name: 'Unlock Manual Sculpting' }).click();
    // Wait for gizmos to be generated and rendered
    await page.waitForTimeout(1000);

    const canvas = await page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // Take a screenshot of the initial manual state before we drag anything
    await expect(page).toHaveScreenshot('quad-view-gizmos-initial.png', { maxDiffPixels: 1000 });

    // --- 2. Drag a known gizmo area in the Top-Left (Outline) view ---
    // This coordinate is near the wide point of the board outline
    const widePointGizmo = { x: box!.x + box!.width * 0.25, y: box!.y + box!.height * 0.25 };

    await page.mouse.move(widePointGizmo.x, widePointGizmo.y);
    await page.mouse.down();
    // Drag it inwards to dramatically narrow the board
    await page.mouse.move(widePointGizmo.x - 40, widePointGizmo.y, { steps: 10 });
    await page.mouse.up();
    // Wait for the debounce timer (150ms) + geometry generation buffer
    await page.waitForTimeout(500);

    // --- 3. Verify the visual state has changed ---
    // The new screenshot should not match the initial state, proving the drag updated the geometry.
    await expect(page).not.toHaveScreenshot('quad-view-gizmos-initial.png');
  });
});
