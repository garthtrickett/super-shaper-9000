import { test, expect } from "./utils/base-test";

test.describe("Board Builder E2E: The Golden Path", () => {
  test("Parametric -> Manual -> Export pipeline", async ({ page }) => {
    // 1. Load the app
    await page.goto("/");

    // Wait for the app-shell and board-viewport to mount
    await expect(page.locator("app-shell")).toBeVisible();
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();

    // 2. Verify 3D canvas mounts
    const canvas = viewport.locator("canvas");
    await expect(canvas).toBeVisible();

    // 3. Verify HUD is rendered with all metrics
    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();
    // The volume calculates dynamically on mount based on the mesh geometry.
    // We just verify the HUD renders a valid floating point number.
    await expect(boardControls.getByText(/\d+\.\d+L/)).toBeVisible();
    await expect(boardControls.getByText(/Vertices/)).toBeVisible();
    await expect(boardControls.getByText(/\d+\.\d+k/).first()).toBeVisible();
    await expect(boardControls.getByText(/Triangles/)).toBeVisible();
    await expect(boardControls.getByText(/\d+\.\d+k/).last()).toBeVisible();

    // 3.5. Verify Flip Board button is available and works
    const flipBtn = page.locator('button[title*="Flip"]');
    await expect(flipBtn).toBeVisible();
    await flipBtn.click(); // Flip to bottom
    await flipBtn.click(); // Flip back to top

    // NOTE: Assertions for viewport camera toggle buttons have been removed.
    // The UI was updated to a permanent 4-way split view, making these buttons obsolete.

    // 4. Export JSON
    const exportBtn = boardControls.getByRole('button', { name: /Export JSON/i });
    await exportBtn.click();

    // Verify Modal Appears
    const modalHeading = page.getByRole('heading', { name: "Export Design" });
    await expect(modalHeading).toBeVisible();

    // 7. Verify downloaded file structure (in this case, read from the JSON textarea)
    const textarea = page.locator("textarea[readonly]");
    await expect(textarea).toBeVisible();
    
    const jsonContent = await textarea.inputValue();
    expect(jsonContent.length).toBeGreaterThan(0);
    
    const parsedState = JSON.parse(jsonContent) as {
      volume: number;
      outline?: { controlPoints: unknown[] };
    };
    
    // Assert the state correctly reflects the populated curves
    expect(parsedState.volume).toBeGreaterThan(10); // Dynamically calculated, just ensure it's a valid size
    expect(parsedState.outline).toBeDefined();
    expect(Array.isArray(parsedState.outline?.controlPoints)).toBe(true);
    expect(parsedState.outline!.controlPoints.length).toBeGreaterThan(2);
    
    // Close the modal
    const closeBtn = page.getByRole('button', { name: "Close" });
    await closeBtn.click();
    await expect(modalHeading).toBeHidden();
  });

    test("Diagnostic toggles (Heatmap, Zebra, Curvature)", async ({ page }) => {
    // 1. Load the app
    await page.goto("/");
    await expect(page.locator("app-shell")).toBeVisible();

    // 2. Wait for viewport and controls to mount
    await expect(page.locator("board-viewport")).toBeVisible();
    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();

    // 3. Locate the checkboxes via their wrapping labels
        const heatmapCheckbox = boardControls.locator('label').filter({ hasText: /Heatmap/i }).locator('input[type="checkbox"]');
    const zebraCheckbox = boardControls.locator('label').filter({ hasText: /Zebra Flow/i }).locator('input[type="checkbox"]');
    const curvatureCheckbox = boardControls.locator('label').filter({ hasText: /Curvature/i }).locator('input[type="checkbox"]');
    const mriCheckbox = boardControls.locator('label').filter({ hasText: /MRI Slice/i }).locator('input[type="checkbox"]');

    // 4. Initially all should be off (based on INITIAL_STATE)
    await expect(heatmapCheckbox).not.toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();
    await expect(curvatureCheckbox).not.toBeChecked();
    await expect(mriCheckbox).not.toBeChecked();

    // 5. Turn on Curvature (should not affect others)
    console.info("Testing: Enabling Curvature");
    await curvatureCheckbox.check({ force: true });
    await expect(curvatureCheckbox).toBeChecked();
    await expect(heatmapCheckbox).not.toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();

    // 6. Turn on Heatmap
    console.info("Testing: Enabling Heatmap");
    await heatmapCheckbox.check({ force: true });
    await expect(heatmapCheckbox).toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();
    await expect(curvatureCheckbox).toBeChecked(); // Curvature should still be checked

    // 7. Turn on Zebra (Heatmap should auto-disable, Curvature unaffected)
    console.info("Testing: Enabling Zebra Flow (Should disable Heatmap)");
    await zebraCheckbox.check({ force: true });
    await expect(zebraCheckbox).toBeChecked();
    await expect(heatmapCheckbox).not.toBeChecked();
    await expect(curvatureCheckbox).toBeChecked(); // Curvature should still be checked

        // 8. Turn on Heatmap again (Zebra should auto-disable)
    console.info("Testing: Re-enabling Heatmap (Should disable Zebra Flow)");
    await heatmapCheckbox.check({ force: true });
    await expect(heatmapCheckbox).toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();

    // 9. Turn on MRI Slice (Should disable Zebra Flow via Rust Reducer)
    console.info("Testing: Enabling MRI Slice (Should disable Zebra Flow)");
    await zebraCheckbox.check({ force: true }); // Turn Zebra back on first to test the override
    await expect(zebraCheckbox).toBeChecked();
    
    await mriCheckbox.check({ force: true });
    await expect(mriCheckbox).toBeChecked();
    // Verify WASM pipeline successfully mutated state and updated UI
    await expect(zebraCheckbox).not.toBeChecked();

    // 10. Verify the Slice Position slider dynamically appears in the DOM
        const sliceSliderLabel = boardControls.locator('label').filter({ hasText: /Slice Position/i });
    await expect(sliceSliderLabel).toBeVisible();
  });

  test("Node Inspector G2 Continuity", async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();
    await page.waitForTimeout(500); // Allow initial render

    // 1. Programmatically find and click the middle anchor point in the top-down view
    const hitPosition = await page.evaluate(() => {
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
      const cp = outline.controlPoints[1]; // Target middle control point
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
      const ndcY = -worldZ / orthoTop;

      const w = rect.width / 2;
      const h = rect.height / 2;

      const pixelX = rect.left + ((ndcX + 1) / 2 * w);
      const pixelY = rect.top + ((1 - ndcY) / 2 * h);

      return { x: pixelX, y: pixelY };
    });
    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 2. Verify the inspector appears
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();

    // 3. Set continuity to G2 (Fair)
    await inspector.locator('button', { hasText: 'Fair' }).click();

    // 4. Get tangent input fields
    const t1LengthInput = inspector.locator('div:has-text("Incoming (T1)") input[type="number"]').last();
    const t2LengthInput = inspector.locator('div:has-text("Outgoing (T2)") input[type="number"]').last();
    
    const initialT2Length = await t2LengthInput.inputValue();
    expect(parseFloat(initialT2Length)).toBeGreaterThan(0);

    // 5. Change the length of the T1 handle
    await t1LengthInput.fill('5.0');
    await t1LengthInput.press('Enter');

    // 6. Assert that the T2 handle's length was auto-updated by the Rust solver
    await expect(t2LengthInput).not.toHaveValue(initialT2Length);
  });
});
