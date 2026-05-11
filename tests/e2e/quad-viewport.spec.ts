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
    await page.waitForTimeout(3000);
  });

  test('should render the four-quadrant layout', async ({ page }) => {
    // Bumping tolerance to account for anti-aliasing differences and subtle shading
    // improvements from the new B-Rep tail/nose cap topology.
        await expect(page).toHaveScreenshot('quad-view-baseline.png', { 
      maxDiffPixels: 15000,
      mask:[page.locator('button[title*="Flip"]')],
      timeout: 15000
    });
  });

  test('should only allow camera orbiting in the perspective view', async ({ page }) => {
    const canvas = page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // Define quadrant coordinates (top-right of each quadrant to avoid top-left overlay buttons and centered board)
    const topLeft = { x: box!.x + box!.width * 0.40, y: box!.y + box!.height * 0.10 };
    const topRight = { x: box!.x + box!.width * 0.90, y: box!.y + box!.height * 0.10 };

    // Helper to extract the exact position of the perspective camera
    const getPerspectiveCameraPos = async () => {
      return page.evaluate<{ x: number; y: number; z: number } | null>(() => {
        type BoardViewportElement = HTMLElement & {
          sceneManager?: {
            cameras: {
              perspective: {
                position: { x: number; y: number; z: number };
              };
            };
          };
        };
                const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
        const cam = viewport?.sceneManager?.cameras?.perspective;
        return cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null;
      });
    };

    const initialPos = await getPerspectiveCameraPos();
    expect(initialPos).not.toBeNull();

    // --- 1. Drag in a 2D view (Top Left) and verify NO perspective rotation occurs ---
    await page.mouse.move(topLeft.x, topLeft.y);
    await page.mouse.down();
    await page.mouse.move(topLeft.x - 50, topLeft.y + 50, { steps: 10 });
    await page.mouse.up();
    
    // Check that the perspective camera did not move
    const posAfter2DDrag = await getPerspectiveCameraPos();
    expect(posAfter2DDrag).not.toBeNull();
    expect(posAfter2DDrag!.x).toBeCloseTo(initialPos!.x, 2);
    expect(posAfter2DDrag!.y).toBeCloseTo(initialPos!.y, 2);
    expect(posAfter2DDrag!.z).toBeCloseTo(initialPos!.z, 2);

    // --- 2. Drag in the 3D Perspective view (Top Right) and verify rotation DOES occur ---
    await page.mouse.move(topRight.x, topRight.y);
    await page.mouse.down();
    await page.mouse.move(topRight.x - 100, topRight.y + 100, { steps: 10 });
    await page.mouse.up();
    
    // Check that the perspective camera DID move
    const posAfter3DDrag = await getPerspectiveCameraPos();
    expect(posAfter3DDrag).not.toBeNull();
    
    // Calculate 3D distance moved
    const dx = posAfter3DDrag!.x - initialPos!.x;
    const dy = posAfter3DDrag!.y - initialPos!.y;
    const dz = posAfter3DDrag!.z - initialPos!.z;
    const distanceMoved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // It should have moved significantly
    expect(distanceMoved).toBeGreaterThan(0.5);
  });

  test('should update 3D model when dragging a gizmo in a 2D view', async ({ page }) => {
    const canvas = page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // --- 1. Dynamically locate the 3D Gizmo from the application state ---
    // This perfectly calculates the projection matrix equivalent to find the 2px sphere.
    const hitPosition = await page.evaluate<{ x: number; y: number } | null>(() => {
      type BoardViewportElement = HTMLElement & {
        boardState?: {
          outline?: {
            controlPoints:[number, number, number][];
          };
        };
      };

      const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!viewport || !viewport.boardState || !viewport.boardState.outline) return null;

      const outline = viewport.boardState.outline;
      // Index 1 is the wide point in the middle of the board
      const cp = outline.controlPoints[1];
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
    await expect(page.locator('node-inspector')).toBeVisible();

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

    // 4. Verify the coordinate changed in the DOM as our deterministic assertion
    const finalX = await xInput.inputValue();
    const diff = Math.abs(parseFloat(finalX) - parseFloat(initialX));
    
    // Verify it moved by at least half an inch
    expect(diff).toBeGreaterThan(0.5);
  });
});
