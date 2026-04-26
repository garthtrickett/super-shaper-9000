// tests/e2e/quad-viewport.spec.ts
import { test, expect } from './utils/base-test';

test.describe('Quad Viewport CAD Interface', () => {
  // Give this entire suite more time since software WebGL is very slow in headless mode
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the 3D viewport to be initialized and rendered
    await page.waitForSelector('board-viewport canvas');
    // Give a brief moment for the initial board to render to avoid flaky screenshots
    await page.waitForTimeout(1000);
  });

  test('should render the four-quadrant layout', async ({ page }) => {
    // Bumping tolerance slightly because high-frequency grid lines and text sprites 
    // cause anti-aliasing variations between GPU (headed) and CPU (headless) rendering.
    await expect(page).toHaveScreenshot('quad-view-baseline.png', { 
      maxDiffPixels: 2500,
      mask:[page.locator('button[title*="Flip"]')]
    });
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
    await page.mouse.move(topLeft.x + 50, topLeft.y + 50, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(500); // Wait for momentum to settle

    await expect(page).toHaveScreenshot('quad-view-no-rotation.png', { 
      maxDiffPixels: 2500,
      mask: [page.locator('button[title*="Flip"]')]
    });

    // --- 2. Drag in the 3D view (Top Right) and verify rotation DOES occur ---
    await page.mouse.move(topRight.x, topRight.y);
    await page.mouse.down();
    await page.mouse.move(topRight.x + 80, topRight.y + 50, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(500); // Wait for orbit controls to settle

    // Compare against the *un-rotated* screenshot. They should NOT match.
    await expect(page).not.toHaveScreenshot('quad-view-no-rotation.png', {
      mask: [page.locator('button[title*="Flip"]')]
    });
  });

  test('should update 3D model when dragging a gizmo in a 2D view', async ({ page }) => {
    // --- 1. Enter manual mode ---
    await page.getByRole('button', { name: 'Unlock Manual Sculpting' }).click();
    // Wait for gizmos to be generated and rendered
    await page.waitForTimeout(1000);

    const canvas = await page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // Take a screenshot of the initial state before we drag anything
    await expect(page).toHaveScreenshot('quad-view-gizmos-initial.png', { 
      maxDiffPixels: 2500,
      mask: [page.locator('button[title*="Flip"]')]
    });

    // --- 2. Dynamically locate the 3D Gizmo from the application state ---
    // This perfectly calculates the projection matrix equivalent to find the 2px sphere.
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & {
        boardState?: {
          manualOutline?: {
            controlPoints: [number, number, number][];
          };
        };
      };

      const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!viewport || !viewport.boardState || !viewport.boardState.manualOutline) return null;

      const outline = viewport.boardState.manualOutline;
      // Index 3 is t=0.5 (Z=0, Wide Point)
      const cp = outline.controlPoints[3];
      if (!cp) return null;

      const canvas = viewport.shadowRoot?.querySelector('canvas') || viewport.querySelector('canvas');
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;

      const worldX = cp[0] / 12;
      const worldZ = cp[2] / 12;

      const orthoRight = 5 * aspect;
      const orthoTop = 5;

      const ndcX = worldX / orthoRight;
      const ndcY = -worldZ / orthoTop; // -Z is UP

      const w = rect.width / 2;
      const h = rect.height / 2;

      const pixelX = rect.left + ((ndcX + 1) / 2 * w);
      const pixelY = rect.top + ((1 - ndcY) / 2 * h);

      return { x: pixelX, y: pixelY };
    });
    expect(hitPosition).toBeTruthy();

    // Select the gizmo to open the inspector
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await page.waitForTimeout(100);
    expect(await page.locator('node-inspector').isVisible()).toBe(true);

    // 1. Get the initial value of the X/Z input in the node inspector
    const xInput = page.locator('node-inspector input').first();
    const initialX = await xInput.inputValue();

    // 2. Perform your drag securely on the precisely located gizmo
    await page.mouse.move(hitPosition!.x, hitPosition!.y);
    await page.mouse.down();
    // Drag it inwards to dramatically narrow the board (use fewer steps to save time in headless WebGL)
    await page.mouse.move(hitPosition!.x - 40, hitPosition!.y, { steps: 2 });
    await page.mouse.up();

    // 3. WAIT for the DOM to reflect the new coordinates (this doesn't stall the GPU)
    await expect(xInput).not.toHaveValue(initialX);

    // Optional: Give headless WebGL a tiny breather to finish the new paint
    await page.waitForTimeout(500);

    // 4. Now assert the screenshot (will pass instantly without looping)
    await expect(page).not.toHaveScreenshot('quad-view-gizmos-initial.png', {
      mask: [page.locator('button[title*="Flip"]')]
    });
  });

});
