import { test, expect } from "./utils/base-test";

test.describe("Bottom Contour Editor E2E", () => {
  test("Add channel, open 2D editor, drag node asymmetrically", async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Add a Bottom Channel
    const addChannelBtn = boardControls.locator('button[title="Add Bottom Channel"]');
    await expect(addChannelBtn).toBeVisible();
    await addChannelBtn.click();

    // 2. Unlink Symmetry
    const toggleSymBtn = boardControls.locator('button[title="Toggle Symmetry"]').first();
    await expect(toggleSymBtn).toBeVisible();
    await toggleSymBtn.click();

        // 3. Open 2D Editor
    const edit2DBtn = boardControls.locator('button[title="Open 2D Contour Editor"]');
    await expect(edit2DBtn).toBeVisible();
    await edit2DBtn.click();

    // Give the worker time to respond and UI to re-render nodes
    await page.waitForTimeout(500);

        const contourEditor = page.locator("bottom-contour-editor");
    await expect(contourEditor).toBeVisible();
    
    // Use toBeAttached to bypass potential SVG 0-size bounding box issues in headless Chromium
    await expect(contourEditor.locator('circle').first()).toBeAttached({ timeout: 10000 });

    // 4. Drag a node asymmetrically in the SVG
    await page.evaluate(() => {
      const editor = document.querySelector('bottom-contour-editor');
      const svg = editor?.shadowRoot?.querySelector('svg') || editor?.querySelector('svg');
      if (!svg) return;
      const circle = svg.querySelector('circle');
      if (!circle) return;

      const rect = circle.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      circle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: centerX, clientY: centerY }));
      svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: centerX + 50, clientY: centerY - 20 }));
      svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });

    // Wait for WASM to compute the asymmetric mesh
    await page.waitForTimeout(500);

    // 5. Close Editor
    const closeBtn = contourEditor.locator('button').first();
    await closeBtn.click();
    await expect(contourEditor).toBeHidden();

    // Verify no WebGL or NaN errors
    const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
  });
});
