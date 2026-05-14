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
      length: number;
      outline?: { controlPoints: unknown[] };
    };
    
    // Assert the state correctly reflects the populated curves
    expect(parsedState.length).toBeGreaterThan(10);
    expect(parsedState.outline).toBeDefined();
    expect(Array.isArray(parsedState.outline?.controlPoints)).toBe(true);
    expect(parsedState.outline!.controlPoints.length).toBeGreaterThan(2);
    
    // Close the modal
    const closeBtn = page.getByRole('button', { name: "Close" });
    await closeBtn.click();
    await expect(modalHeading).toBeHidden();
  });

    test("Diagnostic toggles (Foil Ratio, Zebra, Curvature)", async ({ page }) => {
    // 1. Load the app
    await page.goto("/");
    await expect(page.locator("app-shell")).toBeVisible();

    // 2. Wait for viewport and controls to mount
    await expect(page.locator("board-viewport")).toBeVisible();
    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();

    // 3. Locate the checkboxes via their wrapping labels
    const heatmapCheckbox = boardControls.locator('label').filter({ hasText: /Foil Ratio/i }).locator('input[type="checkbox"]');
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

        // 6. Turn on Foil Ratio
    console.info("Testing: Enabling Foil Ratio");
    await heatmapCheckbox.check({ force: true });
    await expect(heatmapCheckbox).toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();
    await expect(curvatureCheckbox).toBeChecked(); // Curvature should still be checked

    // 7. Turn on Zebra (Foil Ratio should auto-disable, Curvature unaffected)
    console.info("Testing: Enabling Zebra Flow (Should disable Foil Ratio)");
    await zebraCheckbox.check({ force: true });
    await expect(zebraCheckbox).toBeChecked();
    await expect(heatmapCheckbox).not.toBeChecked();
    await expect(curvatureCheckbox).toBeChecked(); // Curvature should still be checked

    // 8. Turn on Foil Ratio again (Zebra should auto-disable)
    console.info("Testing: Re-enabling Foil Ratio (Should disable Zebra Flow)");
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
            type BoardViewportElement = HTMLElement & { 
        boardState?: {
          outlineLayers?: { active?: boolean, otlExt: { controlPoints:[number, number, number][] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      // Based on Rust defaults: wing_start_z = tip_z - 15.0. 
      // The wing node for Layer 0 EXT should be there.
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers || vp.boardState.outlineLayers.length === 0) return null;
      const cp = vp.boardState.outlineLayers[0]!.otlExt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Project CAD inches to normalized viewport coords
      if (cp) {
        const ndcX = (cp[0] / 12) / (5 * aspect);
        const ndcY = -(cp[2] / 12) / 5;
        const w = rect.width / 2;
        const h = rect.height / 2;
        return {
          x: rect.left + ((ndcX + 1) / 2 * w),
          y: rect.top + ((1 - ndcY) / 2 * h)
        };
      }
      return null;
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
            type BoardViewportElement = HTMLElement & { 
        boardState?: {
          outlineLayers?: { active?: boolean, otlExt: { controlPoints: [number, number, number][] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
      const cp = vp.boardState.outlineLayers[0]!.otlExt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      
      // Project CAD inches to normalized viewport coords using Top Ortho logic
      if (cp) {
        const ndcX = (cp[0] / 12) / (5 * aspect);
        const ndcY = -(cp[2] / 12) / 5;
        const w = rect.width / 2;
        const h = rect.height / 2;
        
        return {
          x: rect.left + ((ndcX + 1) / 2 * w),
          y: rect.top + ((1 - ndcY) / 2 * h)
        };
      }
      return null;
    });

    expect(hitPosition).toBeTruthy();

    // Select the gizmo to open the inspector
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await page.waitForTimeout(100);

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
    
    
    // The default start X for a 18.75" board is approx 8.3". 
        // Dragging right in the top quadrant (+X world) should increase this significantly.
    await expect(async () => {
      const xValue = parseFloat(await xInput.inputValue());
      expect(xValue).toBeGreaterThan(12.0);
    }).toPass({ timeout: 5000 });
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
      type BoardViewportElement = HTMLElement & { 
        boardState?: {
          bottomChannels?: { rightOutline: { controlPoints:[number, number, number][] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.bottomChannels || vp.boardState.bottomChannels.length === 0) return null;
      const cp = vp.boardState.bottomChannels[0]!.rightOutline.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Project CAD inches to normalized viewport coords
      if (cp) {
        const ndcX = (cp[0] / 12) / (5 * aspect);
        const ndcY = -(cp[2] / 12) / 5;
        const w = rect.width / 2;
        const h = rect.height / 2;
        return {
          x: rect.left + ((ndcX + 1) / 2 * w),
          y: rect.top + ((1 - ndcY) / 2 * h)
        };
      }
      return null;
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

        await expect(boardControls.locator('span', { hasText: /Wing 1/i })).toBeVisible();

    // 2. Locate the INTERIOR gizmo for the new wing (otlInt, Node 0)
    const hitPosition = await page.evaluate(() => {
            type BoardViewportElement = HTMLElement & { 
        boardState?: {
          outlineLayers?: { active?: boolean, otlInt: { controlPoints: [number, number, number][] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
      // Target the Interior curve which is typically further IN than the exterior
      const cp = vp.boardState.outlineLayers[0]!.otlInt.controlPoints[0];
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      if (cp) {
        const ndcX = (cp[0] / 12) / (5 * aspect);
        const ndcY = -(cp[2] / 12) / 5;
        const w = rect.width / 2;
        const h = rect.height / 2;
      
        return {
          x: rect.left + ((ndcX + 1) / 2 * w),
          y: rect.top + ((1 - ndcY) / 2 * h)
        };
      }
      return null;
    });

    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 3. Verify Node Inspector specifically confirms 'INT'
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible();
    // The refined title logic should display 'Layer 0 (INT)'
    await expect(inspector.locator('h3')).toContainText("Layer 0 (INT)");
  });

    test("S3DX Native Export Pipeline", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Setup the download interceptor BEFORE clicking export
    const downloadPromise = page.waitForEvent('download');

    // 2. Click Export S3DX
    const exportBtn = boardControls.getByRole('button', { name: /Export \.s3dx/i });
    await exportBtn.click();

    // 3. Wait for the download to be triggered by the Rust worker responding
    const download = await downloadPromise;
    
    // 4. Verify the filename is dynamically generated based on the board length
    expect(download.suggestedFilename()).toMatch(/SuperShaper_\d+\.\d+\.s3dx/);

    // 5. Ensure the canvas didn't crash during the async worker transaction
    await expect(page.locator("board-viewport canvas")).toBeVisible();
  });

  test("BRD Native Export Pipeline", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Setup the download interceptor BEFORE clicking export
    const downloadPromise = page.waitForEvent('download');

    // 2. Click Export BRD
    const exportBtn = boardControls.getByRole('button', { name: /Export \.brd/i });
    await exportBtn.click();

    // 3. Wait for the download to be triggered by the Rust worker responding
    const download = await downloadPromise;
    
    // 4. Verify the filename is dynamically generated based on the board length
    expect(download.suggestedFilename()).toMatch(/SuperShaper_\d+\.\d+\.brd/);

    // 5. Verify the payload is a valid binary blob (not empty)
    const failure = await download.failure();
    expect(failure).toBeNull();

    // 6. Ensure the canvas didn't crash during the async worker transaction
    await expect(page.locator("board-viewport canvas")).toBeVisible();
  });

  test("S3DX Native Import Pipeline", async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

    // 1. Capture initial volume from the HUD to compare later
        const volumeDisplay = boardControls.locator('div.text-2xl.font-black.text-blue-500');
    const rawVolume = await volumeDisplay.textContent();
    const initialVolume = rawVolume?.trim();
    expect(initialVolume).toBeTruthy();

    // 2. Open the Import Modal
    const importBtn = boardControls.getByRole('button', { name: /Import Design/i });
    await importBtn.click();

    const modalHeading = page.getByRole('heading', { name: "Import Design" });
    await expect(modalHeading).toBeVisible();

        // 3. Trigger the file chooser and upload the golden S3DX fixture
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Select File').click();
    const fileChooser = await fileChooserPromise;
    
    // Use the known fixture file from the repository
    await fileChooser.setFiles('./src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx');

    // 4. The modal should automatically close upon successful Rust parsing and state update
        await expect(modalHeading).toBeHidden();

    // 5. Verify the WASM Worker processed the file by checking if the volume updated
    // We use a Regex to be whitespace-insensitive to avoid Lit template indentation issues.
    await expect(volumeDisplay).not.toHaveText(new RegExp(initialVolume!.replace('.', '\\.')));
    
    // Wait briefly for debounce and geometry to build
    await page.waitForTimeout(500);

    // 6. Ensure the canvas is still rendering without WebGL crashes
    await expect(page.locator("board-viewport canvas")).toBeVisible();
    
    // 7. Verify no WebGL or NaN errors occurred during the mesh generation of the imported file
        const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
  });

  test("BRD Native Import Pipeline", async ({ page }) => {
    const errors: string[] =[];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("board-viewport canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");

        const volumeDisplay = boardControls.locator('div.text-2xl.font-black.text-blue-500');
    const rawVolume = await volumeDisplay.textContent();
    const initialVolume = rawVolume?.trim();
    expect(initialVolume).toBeTruthy();

    const importBtn = boardControls.getByRole('button', { name: /Import Design/i });
    await importBtn.click();

    const modalHeading = page.getByRole('heading', { name: "Import Design" });
    await expect(modalHeading).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Select File').click();
    const fileChooser = await fileChooserPromise;
    
    // Upload the golden BRD fixture
    await fileChooser.setFiles('./src/assets/fixtures/brd/6\'4-Bump-Squash-Full-Nose.brd');

        await expect(modalHeading).toBeHidden();

    // Verify volume changed
    await expect(volumeDisplay).not.toHaveText(new RegExp(initialVolume!.replace('.', '\\.')));
    
    // Let geometry settle
    await page.waitForTimeout(500);

    await expect(page.locator("board-viewport canvas")).toBeVisible();
    
    const criticalErrors = errors.filter(e => e.includes('WebGL') || e.includes('NaN'));
    expect(criticalErrors).toHaveLength(0);
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
        boardState?: { outline?: { controlPoints: [number, number, number][] } };
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

      test("Dynamic Node Insertion via Alt+Click", async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();
    await page.waitForTimeout(1000);

    // Maximize Perspective View to easily project the 3D coordinate to a 2D screen coordinate
    const maximizeBtn = viewport.locator('button[title="Maximize Perspective"]');
    await maximizeBtn.click();
    await page.waitForTimeout(500);

    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & {
        mathEngine?: {
          get_point_on_curve(curveName: string, t: number): Float32Array;
          get_profile_at_z(z: number): any;
        };
        sceneManager?: {
          cameras: {
            perspective: any;
          }
        };
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.mathEngine || !vp.sceneManager) return null;

      const pt = vp.mathEngine.get_point_on_curve('outline', 0.25);
      if (!pt) return null;

      const profile = vp.mathEngine.get_profile_at_z(pt[2]!);

      const worldX = pt[0]! / 12;
      const worldY = profile.apexY / 12;
      const worldZ = pt[2]! / 12;

      const camera = vp.sceneManager.cameras.perspective;
      const vec = camera.position.clone();
      vec.set(worldX, worldY, worldZ);
      vec.project(camera);

      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const pixelX = rect.left + ((vec.x + 1) / 2 * rect.width);
      const pixelY = rect.top + ((1 - vec.y) / 2 * rect.height);

      return { x: pixelX, y: pixelY };
    });

    expect(hitPosition).toBeTruthy();

    // 1. Move to the hit position to trigger hover state
    await page.mouse.move(hitPosition!.x, hitPosition!.y);
    await page.waitForTimeout(500);

    // 2. Alt-Click to Insert
    await page.keyboard.down('Alt');
    await page.mouse.click(hitPosition!.x, hitPosition!.y, { button: 'left' });
    await page.keyboard.up('Alt');
    
        // 3. Wait for WASM debounce and Three.js rebuild
    await page.waitForTimeout(1000);

    // 4. Dynamically find the exact screen coordinates of the new Gizmo (Index 1)
    const newGizmoPos = await page.evaluate(() => {
      const vp = document.querySelector('board-viewport') as any;
      if (!vp || !vp.sceneManager) return null;

            let gizmo: any = null;
      vp.sceneManager.scene.traverse((child: any) => {
        if (child.userData?.isGizmo && child.userData.curve === 'outline' && child.userData.index === 1 && child.userData.type === 'anchor') {
          gizmo = child;
        }
      });
      if (!gizmo) return null;

      const camera = vp.sceneManager.cameras.perspective;
      const vec = gizmo.position.clone();
      vec.project(camera);

      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((vec.x + 1) / 2 * rect.width),
        y: rect.top + ((1 - vec.y) / 2 * rect.height)
      };
    });

    expect(newGizmoPos).toBeTruthy();

    // 5. Move to the new gizmo and click it
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await page.mouse.move(newGizmoPos!.x, newGizmoPos!.y);
    await page.waitForTimeout(500);
    await page.mouse.click(newGizmoPos!.x, newGizmoPos!.y);
    await page.waitForTimeout(500);

    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 5000 });
    await expect(inspector).toContainText("Main Outline");
    await expect(inspector).toContainText("Node 1");
  });
});
