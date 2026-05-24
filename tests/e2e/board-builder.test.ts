import { test, expect } from "./utils/base-test";

test('Board Builder UI updates correctly on slider changes', async ({ page }) => {
  await page.goto('/');

  const boardControls = page.locator('board-controls');
  await expect(boardControls).toBeVisible();

  // Listen for browser errors to ensure WASM doesn't crash during scaling
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('BROWSER EXCEPTION:', err.message));

  // Wait for the WASM engine to finish initial processing and render the canvas
  await expect(page.locator('board-viewport canvas')).toBeVisible();
  
  // Give the Rust core a moment to build the initial mesh and post the stats back to the UI
  await page.waitForTimeout(1000);

  // 1. Get the initial vertex count from the HUD
  // If the adaptive mesh generator works, longer boards require more Z-rings to maintain curvature tolerance.
  const vertexDisplay = boardControls.locator('div.text-xl.font-black.text-zinc-400.tracking-tighter').first();
  const initialVertices = await vertexDisplay.textContent();
  expect(initialVertices).toBeTruthy();
  
  console.log(`[Test] Initial Vertices: ${initialVertices}`);

    // 2. Drag the Length slider to change the board size
  const lengthContainer = boardControls.locator('.mb-4').filter({ hasText: /^Length$/i }).first();
  const lengthSlider = lengthContainer.locator('input[type="range"]');

  const startTime = Date.now();

  // Change length from 70 to 90 (significantly longer to trigger adaptive subdivision)
  await lengthSlider.fill('90'); 
  await lengthSlider.dispatchEvent('input');
  await lengthSlider.dispatchEvent('pointerup');

  // 3. Wait for debounce (150ms) and WASM worker computation to settle
  await page.waitForTimeout(600);

  // 4. Verify the vertex count changed in the HUD
  // This proves that the Parametric UI successfully told Rust to scale the Bezier coordinates, 
  // Rust successfully generated a denser mesh, and the Worker posted the new state back to the UI.
  await expect(vertexDisplay).not.toHaveText(initialVertices as string);
  
  const duration = Date.now() - startTime;
  console.log(`[Performance] WASM Mesh Rebuild and HUD Update completed in ${duration}ms`);

    const newVertices = await vertexDisplay.textContent();
  console.log(`[Test] New Vertices: ${newVertices}`);
});

test('Draft-Mode Dragging performance benchmark maintains fluid main thread', async ({ page }) => {
  await page.goto('/');
  const viewport = page.locator("board-viewport");
  await expect(viewport).toBeVisible();
  await expect(viewport.locator("canvas")).toBeVisible();
  await page.waitForTimeout(1000);

  // Get node coordinates
  const hitPosition = await page.evaluate(() => {
    type BoardViewportElement = HTMLElement & {
      requestUpdate?: () => void;
      updateGizmoScale?: (quad: string, scale: number) => void;
      mathEngine?: { project_to_screen(quad: string, x: number, y: number, z: number, aspect: number): Float32Array; };
      boardState?: { gizmoScaleTop?: number, outline?: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } };
    };
    const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
    if (!viewport || !viewport.boardState || !viewport.boardState.outline) return null;
    if (viewport.updateGizmoScale) viewport.updateGizmoScale('top', 3.0);
    const outline = viewport.boardState.outline;
    const cpList = outline.controlPoints || outline.control_points;
    const cp = cpList ? cpList[1] : undefined;
    if (!cp) return null;
    const canvas = viewport.shadowRoot?.querySelector('canvas') || viewport.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
    const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
    let ndcX = 0, ndcY = 0;
    if (viewport.mathEngine && viewport.mathEngine.project_to_screen) {
        const proj = viewport.mathEngine.project_to_screen('top', x, 0, z, aspect);
        ndcX = proj[0]!;
        ndcY = proj[1]!;
    } else {
        return null;
    }
    const w = rect.width / 2;
    const h = rect.height / 2;
    return { x: rect.left + ((ndcX + 1) / 2 * w), y: rect.top + ((1 - ndcY) / 2 * h) };
  });

  expect(hitPosition).toBeTruthy();

  const startTime = Date.now();

  await page.mouse.move(hitPosition!.x, hitPosition!.y);
  await page.mouse.down();

  // Move rapidly to simulate high-frequency dragging (30 intermediate steps)
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(hitPosition!.x, hitPosition!.y + i, { steps: 1 });
  }

  await page.mouse.up();
  await page.waitForTimeout(500); // Allow final commit to resolve

  const duration = Date.now() - startTime;
  console.log(`[Performance Benchmark] 30 rapid dragging frames resolved in ${duration}ms`);

  // With draft-mode and unprojection caching, 30 rapid moves must execute in well under 1000ms
  expect(duration).toBeLessThan(1000);
});
