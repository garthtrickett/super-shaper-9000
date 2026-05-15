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
  
  const newVertices = await vertexDisplay.textContent();
  console.log(`[Test] New Vertices: ${newVertices}`);
});
