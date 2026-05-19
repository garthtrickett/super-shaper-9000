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

      test("Diagnostic toggles (Foil Ratio, Zebra, MRI Slice)", async ({ page }) => {
    // 1. Load the app
    await page.goto("/");
    await expect(page.locator("app-shell")).toBeVisible();

    // 2. Wait for viewport and controls to mount
    await expect(page.locator("board-viewport")).toBeVisible();
    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();

        // 3. Locate the checkboxes via their wrapping labels
    const heatmapLabel = boardControls.locator('label').filter({ hasText: /Foil Ratio/i });
    const zebraLabel = boardControls.locator('label').filter({ hasText: /Zebra Flow/i });
    const mriLabel = boardControls.locator('label').filter({ hasText: /MRI Slice/i });

    const heatmapCheckbox = heatmapLabel.locator('input[type="checkbox"]');
    const zebraCheckbox = zebraLabel.locator('input[type="checkbox"]');
    const mriCheckbox = mriLabel.locator('input[type="checkbox"]');

    // 4. Initially all should be off (based on INITIAL_STATE)
    await expect(heatmapCheckbox).not.toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();
    await expect(mriCheckbox).not.toBeChecked();

    // 5. Turn on Foil Ratio
    console.info("Testing: Enabling Foil Ratio");
    await heatmapLabel.click();
    await expect(heatmapCheckbox).toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();

    // 6. Turn on Zebra (Foil Ratio should auto-disable)
    console.info("Testing: Enabling Zebra Flow (Should disable Foil Ratio)");
    await zebraLabel.click();
    await expect(zebraCheckbox).toBeChecked();
    await expect(heatmapCheckbox).not.toBeChecked();

    // 7. Turn on Foil Ratio again (Zebra should auto-disable)
    console.info("Testing: Re-enabling Foil Ratio (Should disable Zebra Flow)");
    await heatmapLabel.click();
    await expect(heatmapCheckbox).toBeChecked();
    await expect(zebraCheckbox).not.toBeChecked();

    // 9. Turn on MRI Slice (Should disable Zebra Flow via Rust Reducer)
    console.info("Testing: Enabling MRI Slice (Should disable Zebra Flow)");
    await zebraLabel.click(); // Turn Zebra back on first to test the override
    await expect(zebraCheckbox).toBeChecked();
    
    await mriLabel.click();
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
        requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: {
          gizmoScaleTop?: number;
          outline?: {
            controlPoints?: [number, number, number][];
            control_points?: {x: number, y: number, z: number}[];
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
      const cpList = outline.controlPoints || outline.control_points;
      const cp = cpList ? cpList[1] : undefined;
      if (!cp) throw new Error('cp not found: ' + JSON.stringify(outline));

      const canvas = viewport.shadowRoot?.querySelector('canvas') || viewport.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');

      const rect = canvas.getBoundingClientRect();
            const aspect = rect.width / rect.height;

      const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
      const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;

      const worldX = x / 12;
      const worldZ = z / 12;

            const dist = viewport.mathEngine ? (viewport.mathEngine).camera_distance_top() : 8.0;
      const orthoTop = dist / 4.0;
      const orthoRight = orthoTop * aspect;

      const ndcX = worldX / orthoRight;
      const ndcY = -worldZ / orthoTop;

      const w = rect.width / 2;
      const h = rect.height / 2;

      const pixelX = rect.left + ((ndcX + 1) / 2 * w);
      const pixelY = rect.top + ((1 - ndcY) / 2 * h);

      return { x: pixelX, y: pixelY };
    });
        expect(hitPosition).toBeTruthy();
    await page.waitForTimeout(500);
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

        // 2. Verify the inspector appears
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });

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
    await depthInput.dispatchEvent('pointerup');
    
    // Wait for the geometry debounce to settle
    await page.waitForTimeout(500);

    // 4. Verify the canvas doesn't crash
    await expect(page.locator("board-viewport canvas")).toBeVisible();
    
        // Assert no WebGL or NaN errors were thrown by the bifurcated mesh generator
    const criticalErrors = errors.filter(e => (e.includes('WebGL') || e.includes('NaN')) && !e.includes('unsupported'));
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

        // 3. Verify 'Layer 0' appears in the controls list
    const wingItem = boardControls.locator("span", { hasText: /Layer 0/i });
        await expect(wingItem).toBeVisible();

    // Wait for the viewport to process the new geometry and render the gizmo
    await page.waitForTimeout(1000);

    // 4. Verify 3D Gizmo selection for the new wing
    // We'll use the same coordinate calculation logic as other tests to click the wing gizmo
        const hitPosition = await page.evaluate(() => {
                              type BoardViewportElement = HTMLElement & { 
        requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: {
          gizmoScaleTop?: number;
          outlineLayers?: { active?: boolean, otlExt: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      // Based on Rust defaults: wing_start_z = tip_z - 15.0. 
      // The wing node for Layer 0 EXT should be there.
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers || vp.boardState.outlineLayers.length === 0) return null;
      
      // Force gizmos to be huge to prevent exact-pixel misses in headless
      if (vp.boardState) {
        vp.boardState.gizmoScaleTop = 3.0;
        vp.requestUpdate?.();
      }
      
      const otlExt = vp.boardState.outlineLayers[0]!.otlExt;
      const cpList = otlExt.controlPoints || otlExt.control_points;
      const cp = cpList ? cpList[0] : undefined;
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
            // Project CAD inches to normalized viewport coords
      if (cp) {
        const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
        const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
                const dist = vp.mathEngine ? vp.mathEngine.camera_distance_top() : 8.0;
        const orthoTop = dist / 4.0;
        const orthoRight = orthoTop * aspect;
        const ndcX = (x / 12) / orthoRight;
        const ndcY = -(z / 12) / orthoTop;
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
    await page.waitForTimeout(500); // Allow gizmo scale to apply
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

        // 5. Verify the inspector reveals the layer correctly
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });
    await expect(inspector).toContainText(/Layer 0 \(EXT\)/i, { timeout: 15000 });

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
    await expect(boardControls.locator("span", { hasText: /Layer 0/i })).toBeVisible();

    // Wait for the viewport to process the new geometry and render the gizmo
    await page.waitForTimeout(1000);

    // 2. Locate the wing's start node (Layer 0 EXT, Index 0)
        const hitPosition = await page.evaluate(() => {
                  type BoardViewportElement = HTMLElement & { 
                requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: {
          gizmoScaleTop?: number;
          outlineLayers?: { active?: boolean, otlExt: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
      
      if (vp.boardState) {
        vp.boardState.gizmoScaleTop = 3.0;
        vp.requestUpdate?.();
      }
      const otlExt = vp.boardState.outlineLayers[0]!.otlExt;
      const cpList = otlExt.controlPoints || otlExt.control_points;
      const cp = cpList ? cpList[0] : undefined;
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      
                  // Project CAD inches to normalized viewport coords using Top Ortho logic
      if (cp) {
        const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
        const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
        const dist = vp.mathEngine ? vp.mathEngine.camera_distance_top() : 20.0;
        const orthoTop = dist / 4.0;
        const orthoRight = orthoTop * aspect;
        const ndcX = (x / 12) / orthoRight;
        const ndcY = -(z / 12) / orthoTop;
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
    await page.waitForTimeout(500);
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await page.waitForTimeout(1000);

    // 3. Drag the gizmo outward (+X direction)
    await page.mouse.move(hitPosition!.x, hitPosition!.y);
    await page.mouse.down();
    // Move pixels right to ensure a significant coordinate change
    await page.mouse.move(hitPosition!.x + 100, hitPosition!.y, { steps: 10 });
    await page.mouse.up();

        // 4. Verify Node Inspector reflects the change
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });
    await expect(inspector).toContainText(/Layer 0 \(EXT\)/i, { timeout: 15000 });

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

                // 3. Verify 'Channel 0' appears in the controls list
    const channelItem = boardControls.locator("span", { hasText: /Channel 0/i });
    await expect(channelItem).toBeVisible();

    // Wait for the viewport to process the new geometry and render the gizmo
    await page.waitForTimeout(1000);

        // 4. Verify 3D Gizmo selection for the new channel
    const hitPosition = await page.evaluate(() => {
                  type BoardViewportElement = HTMLElement & { 
        requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: {
          gizmoScaleTop?: number;
          bottomChannels?: { rightOutline: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.bottomChannels || vp.boardState.bottomChannels.length === 0) return null;
      
      if (vp.boardState) {
        vp.boardState.gizmoScaleTop = 3.0;
        vp.requestUpdate?.();
      }
      const rightOutline = vp.boardState.bottomChannels[0]!.rightOutline;
      const cpList = rightOutline.controlPoints || rightOutline.control_points;
      const cp = cpList ? cpList[0] : undefined;
      
      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      // Project CAD inches to normalized viewport coords
      if (cp) {
        const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
        const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
        const dist = vp.mathEngine ? vp.mathEngine.camera_distance_top() : 8.0;
        const orthoTop = dist / 4.0;
        const orthoRight = orthoTop * aspect;
        const ndcX = (x / 12) / orthoRight;
        const ndcY = -(z / 12) / orthoTop;
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
    await page.waitForTimeout(500);
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

        // 5. Verify the inspector reveals the layer correctly
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });
    await expect(inspector).toContainText(/Channel 0 \(RIGHT OUTLINE\)/i, { timeout: 15000 });

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

        await expect(boardControls.locator('span', { hasText: /Layer 0/i })).toBeVisible();

    // Wait for the viewport to process the new geometry and render the gizmo
    await page.waitForTimeout(1000);

    // 2. Locate the INTERIOR gizmo for the new wing (otlInt, Node 0)
    const hitPosition = await page.evaluate(() => {
                              type BoardViewportElement = HTMLElement & { 
        requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: {
          gizmoScaleTop?: number;
          outlineLayers?: { active?: boolean, otlInt: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } }[]
        }
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outlineLayers?.length) return null;
      
      if (vp.boardState) {
        vp.boardState.gizmoScaleTop = 3.0;
        vp.requestUpdate?.();
      }
      // Target the Interior curve which is typically further IN than the exterior
      const otlInt = vp.boardState.outlineLayers[0]!.otlInt;
      const cpList = otlInt.controlPoints || otlInt.control_points;
      const cp = cpList ? cpList[0] : undefined;
      
                  const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      if (cp) {
        const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
        const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
        const dist = vp.mathEngine ? vp.mathEngine.camera_distance_top() : 20.0;
        const orthoTop = dist / 4.0;
        const orthoRight = orthoTop * aspect;
        const ndcX = (x / 12) / orthoRight;
        const ndcY = -(z / 12) / orthoTop;
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
    await page.waitForTimeout(500);
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

        // 3. Verify Node Inspector specifically confirms 'INT'
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });
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
        const criticalErrors = errors.filter(e => (e.includes('WebGL') || e.includes('NaN')) && !e.includes('unsupported'));
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
    
    const criticalErrors = errors.filter(e => (e.includes('WebGL') || e.includes('NaN')) && !e.includes('unsupported'));
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
        requestUpdate?: () => void;
        mathEngine?: { camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
                boardState?: { gizmoScaleTop?: number, outline?: { controlPoints?: [number, number, number][], control_points?: {x: number, y: number, z: number}[] } };
      };
      const viewport = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!viewport || !viewport.boardState || !viewport.boardState.outline) return null;
      
      if (viewport.boardState) {
        viewport.boardState.gizmoScaleTop = 3.0;
        viewport.requestUpdate?.();
      }
      const outline = viewport.boardState.outline;
      const cpList = outline.controlPoints || outline.control_points;
      const cp = cpList ? cpList[1] : undefined;
      if (!cp) throw new Error('cp not found');
      const canvas = viewport.shadowRoot?.querySelector('canvas') || viewport.querySelector('canvas');
      if (!canvas) throw new Error('canvas not found');
            const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const x = Array.isArray(cp) ? cp[0] : (cp as {x: number}).x;
      const z = Array.isArray(cp) ? cp[2] : (cp as {z: number}).z;
            const dist = viewport.mathEngine ? viewport.mathEngine.camera_distance_top() : 8.0;
      const orthoTop = dist / 4.0;
      const orthoRight = orthoTop * aspect;
      const ndcX = (x / 12) / orthoRight;
      const ndcY = -(z / 12) / orthoTop;
      const w = rect.width / 2;
      const h = rect.height / 2;
      return { x: rect.left + ((ndcX + 1) / 2 * w), y: rect.top + ((1 - ndcY) / 2 * h) };
    });
    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

        // 2. Verify the inspector appears
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });

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
    await weightSlider.dispatchEvent('input');
    await weightSlider.dispatchEvent('pointerup');

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

        test("Dynamic Node Insertion in Orthographic Views", async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();
    await page.waitForTimeout(1000);

        // Test Top Ortho View (Top-Left Quadrant)
        const topHitPosition = await page.evaluate(() => {
            type BoardViewportElement = HTMLElement & {
                mathEngine?: { get_point_on_curve(curveName: string, t: number): Float32Array; camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.mathEngine) return null;

      const pt = vp.mathEngine.get_point_on_curve('outline', 0.25);
      if (!pt) return null;

      const worldX = pt[0]! / 12;
      const worldZ = pt[2]! / 12;

      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;

                        // Manual projection for top-left quadrant
      const dist = vp.mathEngine ? vp.mathEngine.camera_distance_top() : 8.0;
      const orthoTop = dist / 4.0;
      const orthoRight = orthoTop * aspect;
      const ndcX = worldX / orthoRight;
      const ndcY = -worldZ / orthoTop;

      const w = rect.width / 2;
      const h = rect.height / 2;

      const pixelX = rect.left + ((ndcX + 1) / 2 * w);
      const pixelY = rect.top + ((1 - ndcY) / 2 * h);

      return { x: pixelX, y: pixelY };
    });

    expect(topHitPosition).toBeTruthy();

    // Move to the hit position to trigger hover state
    await page.mouse.move(topHitPosition!.x, topHitPosition!.y);
    await page.waitForTimeout(500);

    // Alt-Click to Insert
    await page.keyboard.down('Alt');
    await page.mouse.click(topHitPosition!.x, topHitPosition!.y, { button: 'left' });
    await page.keyboard.up('Alt');
    
    // Wait for WASM debounce and Three.js rebuild
    await page.waitForTimeout(1000);

        // Verify the inspector automatically opens for the newly inserted node
    const inspector = page.locator("node-inspector");
    await expect(async () => {
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("Main Outline");
      await expect(inspector).toContainText("Node 1");
    }).toPass({ timeout: 15000 });
    
    // Test Side Ortho View (Bottom-Left Quadrant)
        // First dismiss inspector by clicking somewhere empty on the canvas
    const canvasBox = await viewport.locator("canvas").boundingBox();
    await page.mouse.click(canvasBox!.x + 150, canvasBox!.y + 150);
    await expect(inspector).toBeHidden({ timeout: 5000 });

        const sideHitPosition = await page.evaluate(() => {
            type BoardViewportElement = HTMLElement & {
        mathEngine?: { get_point_on_curve(curveName: string, t: number): Float32Array; camera_distance_top(): number; camera_distance_side(): number; camera_distance_profile(): number; camera_distance_persp(): number; camera_distance(): number; };
      };
      const vp = document.querySelector('board-viewport') as unknown as BoardViewportElement | null;
      if (!vp || !vp.mathEngine) return null;

      const pt = vp.mathEngine.get_point_on_curve('rockerTop', 0.25);
      if (!pt) return null;

      const worldY = pt[1]! / 12;
      const worldZ = pt[2]! / 12;

      const canvas = vp.shadowRoot?.querySelector('canvas') || vp.querySelector('canvas');
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;

                        // Manual projection for bottom-left quadrant (Side view)
      const dist = vp.mathEngine ? vp.mathEngine.camera_distance_side() : 8.0;
      const frustumSize = (dist / 4.0) * 2.0;
      const stretchY = 2.5;
      const orthoRight = frustumSize * aspect / 2;
      const orthoTop = (frustumSize / 2) / stretchY;
      
            const ndcX = worldZ / orthoRight; // In side view, +Z is to the right
      const ndcY = worldY / orthoTop; // And Y is vertical

      const w = rect.width / 2;
      const h = rect.height / 2;
      
      // Bottom-left quadrant
      const pixelX = rect.left + ((ndcX + 1) / 2 * w);
      const pixelY = rect.top + h + ((1 - ndcY) / 2 * h);

      return { x: pixelX, y: pixelY };
    });

    expect(sideHitPosition).toBeTruthy();

    await page.mouse.move(sideHitPosition!.x, sideHitPosition!.y);
    await page.waitForTimeout(500);

    // Alt-Click to Insert
    await page.keyboard.down('Alt');
    await page.mouse.click(sideHitPosition!.x, sideHitPosition!.y, { button: 'left' });
        await page.keyboard.up('Alt');
    
    await page.waitForTimeout(1000);

    await expect(async () => {
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("Rocker (Top)");
      await expect(inspector).toContainText("Node 1");
    }).toPass({ timeout: 15000 });

    // Test Cross Section Insertion via Ctrl-Click
    await page.mouse.click(canvasBox!.x + 150, canvasBox!.y + 150);
    await expect(inspector).toBeHidden({ timeout: 5000 });

    await page.mouse.move(topHitPosition!.x, topHitPosition!.y);
    await page.waitForTimeout(500);

    await page.keyboard.down('Control');
    await page.mouse.click(topHitPosition!.x, topHitPosition!.y, { button: 'left' });
        await page.keyboard.up('Control');
    
    await page.waitForTimeout(1000);

    await expect(async () => {
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("Slice");
    }).toPass({ timeout: 15000 });
  });
});
