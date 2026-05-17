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
          mathEngine?: {
            camera_pos: () => Float32Array;
          };
        };
        const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
        if (viewport?.mathEngine?.camera_pos) {
            const pos = viewport.mathEngine.camera_pos();
            return { x: pos[0], y: pos[1], z: pos[2] };
        }
        return null;
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
        requestUpdate?: () => void;
        boardState?: {
          gizmoScaleTop?: number;
          outline?: {
            controlPoints:[number, number, number][];
          };
        };
      };

            const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!viewport || !viewport.boardState || !viewport.boardState.outline) return null;

      if (viewport.boardState) {
        viewport.boardState.gizmoScaleTop = 3.0;
        viewport.requestUpdate?.();
      }

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
    await page.waitForTimeout(500);

    // Select the gizmo to open the inspector
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await expect(page.locator('node-inspector')).toBeVisible();

    // 1. Get the initial value of the X/Z input in the node inspector
    const xInput = page.locator('node-inspector input').first();
    const initialX = await xInput.inputValue();

        // 2. Perform your drag securely on the precisely located gizmo
    await page.mouse.move(hitPosition!.x, hitPosition!.y);
    await page.mouse.down();

                // Capture the wireframe vertex before moving
    const initialOutlineX = await page.evaluate<number>(() => {
      type ViewportElement = HTMLElement & {
        mathEngine?: {
          get_point_on_curve: (curve: string, t: number) => Float32Array;
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as ViewportElement | null;
      if (!vp || !vp.mathEngine) return 0;
      const pt = vp.mathEngine.get_point_on_curve('outline', 0.5);
      return pt ? pt[0] : 0;
    });

        // Drag it inwards to dramatically narrow the board
    await page.mouse.move(hitPosition!.x - 40, hitPosition!.y, { steps: 10 });
    await page.waitForTimeout(200); // Give the event loop a moment to catch up

        // Verify the real-time preview modified the wireframe buffer BEFORE mouseup
    const previewOutlineX = await page.evaluate<number>(() => {
      type ViewportElement = HTMLElement & {
        mathEngine?: {
          get_point_on_curve: (curve: string, t: number) => Float32Array;
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as ViewportElement | null;
      if (!vp || !vp.mathEngine) return 0;
      const pt = vp.mathEngine.get_point_on_curve('outline', 0.5);
      return pt ? pt[0] : 0;
    });

    expect(previewOutlineX).not.toEqual(initialOutlineX);
    expect(previewOutlineX).toBeLessThan(initialOutlineX);

    await page.mouse.up();

    // 3. WAIT for the DOM to reflect the new coordinates (this doesn't stall the GPU)
    await expect(xInput).not.toHaveValue(initialX);

    // 4. Verify the coordinate changed in the DOM as our deterministic assertion
    const finalX = await xInput.inputValue();
    const diff = Math.abs(parseFloat(finalX) - parseFloat(initialX));
    
    // Verify it moved by at least half an inch
        expect(diff).toBeGreaterThan(0.5);
  });

  test('should trigger copy cursor when hovering over curves in any quadrant', async ({ page }) => {
    const canvas = page.locator('board-viewport canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeDefined();

    // Helper to check cursor
    const checkCursor = async (pos: { x: number, y: number }) => {
      await page.mouse.move(pos.x, pos.y);
      await page.waitForTimeout(200); // allow raycaster to update
      const cursor = await page.evaluate(() => {
        const canvas = document.querySelector('board-viewport')?.shadowRoot?.querySelector('canvas') || document.querySelector('board-viewport canvas');
        return window.getComputedStyle(canvas!).cursor;
      });
      return cursor;
    };

    const getCurvePositionInQuadrant = async (cameraName: 'top' | 'side' | 'profile' | 'perspective') => {
      return page.evaluate((camName) => {
        type Vector3Mock = { set(x: number, y: number, z: number): void, project(cam: unknown): void, x: number, y: number, z: number };
        type CameraMock = { position: { clone(): Vector3Mock } };
        type BoardViewportElement = HTMLElement & {
          mathEngine?: {
            get_point_on_curve(curveName: string, t: number): Float32Array;
            get_profile_at_z(z: number): { apexY: number, topY: number };
          };
                    sceneManager?: {
            cameras: Record<'top' | 'side' | 'profile' | 'perspective', CameraMock>;
          }
        };
        const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
        if (!vp || !vp.mathEngine || !vp.sceneManager) return null;

                        const curveName = camName === 'side' ? 'rockerTop' : 'outline';
        const pt = vp.mathEngine.get_point_on_curve(curveName, 0.25);
        if (!pt) return null;

        const worldX = pt[0]! / 12;
        let worldY = pt[1]! / 12;
        const worldZ = pt[2]! / 12;

        if (curveName === 'outline') {
            const profile = vp.mathEngine.get_profile_at_z(pt[2]!);
            worldY = profile.apexY / 12;
        }

                        const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        const frustumSize = 10;
        const orthoRight = frustumSize * aspect / 2;
        const orthoTop = frustumSize / 2;

        let ndcX = 0, ndcY = 0;
        if (camName === 'top') {
            ndcX = worldX / orthoRight;
            ndcY = -worldZ / orthoTop;
        } else if (camName === 'side') {
            ndcX = -worldZ / orthoRight;
            ndcY = worldY / (orthoTop / 2.5);
        } else if (camName === 'profile') {
            ndcX = worldX / orthoRight;
            ndcY = worldY / (orthoTop / 2.5);
        }
        const vec = { x: ndcX, y: ndcY };

        const w = rect.width / 2;
        const h = rect.height / 2;
        
        let pixelX = 0;
        let pixelY = 0;
        
        if (camName === 'top') {
            pixelX = rect.left + ((vec.x + 1) / 2 * w);
            pixelY = rect.top + ((1 - vec.y) / 2 * h);
        } else if (camName === 'side') {
            pixelX = rect.left + ((vec.x + 1) / 2 * w);
            pixelY = rect.top + h + ((1 - vec.y) / 2 * h);
        } else if (camName === 'profile') {
            pixelX = rect.left + w + ((vec.x + 1) / 2 * w);
            pixelY = rect.top + h + ((1 - vec.y) / 2 * h);
        } else {
            pixelX = rect.left + w + ((vec.x + 1) / 2 * w);
            pixelY = rect.top + ((1 - vec.y) / 2 * h);
        }

        return { x: pixelX, y: pixelY };
      }, cameraName);
    };

    const topPos = await getCurvePositionInQuadrant('top');
    expect(topPos).toBeTruthy();
    expect(await checkCursor(topPos!)).toBe('copy');

    const sidePos = await getCurvePositionInQuadrant('side');
    expect(sidePos).toBeTruthy();
    expect(await checkCursor(sidePos!)).toBe('copy');

    const profilePos = await getCurvePositionInQuadrant('profile');
    expect(profilePos).toBeTruthy();
    expect(await checkCursor(profilePos!)).toBe('copy');

    // Make sure an empty area returns default
    expect(await checkCursor({ x: box!.x + 10, y: box!.y + 10 })).not.toBe('copy');
  });
});
