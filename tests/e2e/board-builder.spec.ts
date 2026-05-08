import { test, expect } from "./utils/base-test";

test.describe("Board Builder E2E: The Golden Path", () => {
  test.setTimeout(120000);

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
    await expect(boardControls.getByText(/\d+(\.\d+)?k/).first()).toBeVisible();
    await expect(boardControls.getByText(/Triangles/)).toBeVisible();
    await expect(boardControls.getByText(/\d+(\.\d+)?k/).last()).toBeVisible();

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

    test("Swallow Tail Generation and Geometry Validation", async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");
    
    // 1. Change Tail Type to "swallow"
    const tailTypeContainer = boardControls.locator('.mb-4').filter({ hasText: /Tail Type/i }).first();
    const tailTypeSelect = tailTypeContainer.locator('select');
    await tailTypeSelect.selectOption('swallow');
    
    // Wait a bit for the Rust Web Worker to finish processing the state change
    await page.waitForTimeout(200);

    // 2. Verify the depth slider appears
    const depthContainer = boardControls.locator('.mb-4').filter({ hasText: /Notch Depth/i }).first();
    await expect(depthContainer).toBeVisible();

    // 3. Adjust the depth
    const depthInput = depthContainer.locator('input[type="range"]');
    await depthInput.fill('6.5');
    await depthInput.dispatchEvent('input');
    
    // Wait for the geometry debounce to settle
    await page.waitForTimeout(500);

    // 4. Verify the canvas doesn't crash
    await expect(page.locator("board-viewport canvas")).toBeVisible();
    
    // Assert no WebGL or NaN errors were thrown by the bifurcated mesh generator
    const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
  });

    test("Wing Layer Manipulation", async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();
    await page.waitForTimeout(500);

        // 1. Programmatically inject a wing layer into the state
    await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & {
        boardState?: any;
        requestUpdate?: (name?: string) => void;
      };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      if (!vp || !vp.boardState) return;
      
      const wingLayer = {
        name: "Wing",
        otlExt: {
          controlPoints: [[8.0, 0.0, 70.0],[8.0, 0.0, 80.0]],
          tangents1: [[8.0, 0.0, 70.0],[8.0, 0.0, 75.0]],
          tangents2: [[8.0, 0.0, 75.0],[8.0, 0.0, 80.0]]
        },
        otlInt: {
          controlPoints:[], tangents1: [], tangents2:[]
        }
      };
      vp.boardState.outlineLayers =[wingLayer];
      // Force re-render of gizmos
      if (vp.requestUpdate) vp.requestUpdate();
    });
    await page.waitForTimeout(200);

        // 2. Find and click the wing layer gizmo
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & { boardState?: any };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers || !vp.boardState.outlineLayers[0]) return null;
      
      const cp = vp.boardState.outlineLayers[0].otlExt.controlPoints[0];
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      return { x: rect.left + ((ndcX + 1) / 2 * w), y: rect.top + ((1 - ndcY) / 2 * h) };
    });
    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition.x, hitPosition.y);

        // 3. Verify inspector shows Wing Layer
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText(/Layer 0 \(EXT\)/i);
  });

  test("Wing Creation and Removal UI Flow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

        // 1. Find the 'ADD' button in the Curve Tree section
    // The Curve Tree accordion is open by default.
    const addWingBtn = boardControls.locator('button[title="Add Wing/Flyer"]');
    await expect(addWingBtn).toBeVisible();

    // 2. Click Add Wing
    await addWingBtn.click();

    // 3. Verify 'Wing 1' appears in the controls list
    const wingItem = boardControls.locator("span", { hasText: /Wing 1/i });
    await expect(wingItem).toBeVisible();

    // 4. Verify 3D Gizmo selection for the new wing
        // We'll use the same coordinate calculation logic as other tests to click the wing gizmo
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & { boardState?: any };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      // Based on Rust defaults: wing_start_z = tip_z - 15.0. 
      // The wing node for Layer 0 EXT should be there.
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers || vp.boardState.outlineLayers.length === 0) return null;
            const cp = vp.boardState.outlineLayers[0].otlExt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Project CAD inches to normalized viewport coords
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      return {
        x: rect.left + ((ndcX + 1) / 2 * w),
        y: rect.top + ((1 - ndcY) / 2 * h)
      };
    });

    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 5. Verify the inspector reveals the layer correctly
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText(/Layer 0 \(EXT\)/i);

    // 6. Test Removal
    const removeBtn = boardControls.locator("button", { hasText: "×" }).first();
    await removeBtn.click();

    // 7. Verify wing is gone from list
        await expect(wingItem).toBeHidden();
    await expect(boardControls.getByText(/No wings defined/i)).toBeVisible();
  });

    test("Dynamically created Wing Gizmo Interaction", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Create the wing
    await boardControls.locator('button[title="Add Wing/Flyer"]').click();
    await expect(boardControls.locator("span", { hasText: /Wing 1/i })).toBeVisible();

        // 2. Locate the wing's start node (Layer 0 EXT, Index 0)
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & { boardState?: any };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
            const cp = vp.boardState.outlineLayers[0].otlExt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      
      // Project CAD inches to normalized viewport coords using Top Ortho logic
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      
      return {
        x: rect.left + ((ndcX + 1) / 2 * w),
        y: rect.top + ((1 - ndcY) / 2 * h)
      };
    });

    expect(hitPosition).toBeTruthy();

    // 3. Drag the gizmo outward (+X direction)
    await page.mouse.move(hitPosition!.x, hitPosition!.y);
    await page.mouse.down();
    // Move pixels right to ensure a significant coordinate change
    await page.mouse.move(hitPosition!.x + 100, hitPosition!.y, { steps: 10 });
    await page.mouse.up();

    // 4. Verify Node Inspector reflects the change
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText(/Layer 0 \(EXT\)/i);

    const xInput = inspector.locator('div:has-text("Anchor Position") input').first();
    const xValue = parseFloat(await xInput.inputValue());
    
        // The default start X for a 18.75" board is approx 8.3". 
    // Dragging right in the top quadrant (+X world) should increase this significantly.
    expect(xValue).toBeGreaterThan(12.0);
  });

    test("Bottom Channel Creation and Manipulation Flow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Find the 'ADD' button for channels (using its specific title)
    const addBtn = boardControls.locator('button[title="Add Bottom Channel"]');
    await expect(addBtn).toBeVisible();

    // 2. Click Add Channel
    await addBtn.click();

    // 3. Verify 'Channel 1' appears in the controls list
    const channelItem = boardControls.locator("span", { hasText: /Channel 1/i });
    await expect(channelItem).toBeVisible();

        // 4. Verify 3D Gizmo selection for the new channel
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & { boardState?: any };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.bottomChannels || vp.boardState.bottomChannels.length === 0) return null;
                        const cp = vp.boardState.bottomChannels[0].rightOutline.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Project CAD inches to normalized viewport coords
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      return {
        x: rect.left + ((ndcX + 1) / 2 * w),
        y: rect.top + ((1 - ndcY) / 2 * h)
      };
    });

    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 5. Verify the inspector reveals the layer correctly
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
        await expect(inspector).toContainText(/Channel 0 \(RIGHT OUTLINE\)/i);

    // 6. Test Removal
    const removeBtn = boardControls.locator('button[title="Remove Channel 1"]');
    await removeBtn.click();

    // 7. Verify channel is gone from list
    await expect(channelItem).toBeHidden();
    await expect(boardControls.getByText(/No channels defined/i)).toBeVisible();
  });

    test("Visual Confirmation of Interior (INT) Wing Selection", async ({ page }) => {
    await page.goto("/");
    const boardControls = page.locator("board-controls");

    // 1. Create the wing
    await boardControls.locator('button[title="Add Wing/Flyer"]').click();

        // 2. Locate the INTERIOR gizmo for the new wing (otlInt, Node 0)
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & { boardState?: any };
      const vp = document.querySelector('board-viewport') as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
      // Target the Interior curve which is typically further IN than the exterior
            const cp = vp.boardState.outlineLayers[0].otlInt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      
      return {
        x: rect.left + ((ndcX + 1) / 2 * w),
        y: rect.top + ((1 - ndcY) / 2 * h)
      };
    });

    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 3. Verify Node Inspector specifically confirms 'INT'
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
    // The refined title logic should display 'Layer 0 (INT)'
    await expect(inspector.locator('h3')).toContainText("Layer 0 (INT)");
  });

  test("Node Inspector Weight Update", async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();
    await page.waitForTimeout(500);

    // 1. Programmatically find and click the middle anchor point
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & {
        boardState?: { outline?: { controlPoints:[number, number, number][] } };
      };
      const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!viewport || !viewport.boardState || !viewport.boardState.outline) return null;
      const cp = viewport.boardState.outline.controlPoints[1];
      if (!cp) return null;
            const canvas = viewport.shadowRoot?.querySelector('canvas') || viewport.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const ndcX = (cp[0] / 12) / (5 * aspect);
      const ndcY = -(cp[2] / 12) / 5;
      const w = rect.width / 2;
      const h = rect.height / 2;
      return { x: rect.left + ((ndcX + 1) / 2 * w), y: rect.top + ((1 - ndcY) / 2 * h) };
    });
    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 2. Verify the inspector appears
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();

                // 3. Change Tension/Weight via the new UI slider
    // Find the specific section div that contains the Tension heading
    const tensionContainer = inspector.locator('div.mb-4').filter({
      has: page.getByRole('heading', { name: /Node Tension/i })
    });
    const weightSlider = tensionContainer.locator('input[type="range"]');
    // Use a regex to match the numeric format (e.g., 1.00x) to avoid matching other labels like 'X (W)'
    const weightBadge = tensionContainer.locator('span').filter({ hasText: /\d\.\d{2}x/ });
    
    // Default should be 1.00x
    await expect(weightBadge).toContainText('1.00x');

    // Set the slider value (Playwright supports fill for range inputs)
    await weightSlider.fill('5.5');

    // 4. Verify no crash and the DOM successfully re-renders with WASM data
    const canvas = viewport.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(weightBadge).toContainText('5.50x');

    // 5. Test the reset button integration
    const resetBtn = tensionContainer.locator('button', { hasText: 'RST' });
    await resetBtn.click();
    await expect(weightBadge).toContainText('1.00x');
    await expect(weightSlider).toHaveValue('1');
  });
});
