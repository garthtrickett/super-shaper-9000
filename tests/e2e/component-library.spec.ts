import { test, expect } from "./utils/base-test";

test.describe("Component Library (Mix & Match) E2E Suite", () => {
  test.setTimeout(120000);

  test("Isolate and save/load Outline Component", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    // 1. Load the app
    await page.goto("/");
    await expect(page.locator("app-shell")).toBeVisible();
    const viewport = page.locator("board-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport.locator("canvas")).toBeVisible();

    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();

    // Wait for Web worker and WASM compilation to settle
    await page.waitForTimeout(1000);

    // 2. Select outline node 1 (middle anchor)
    const hitPosition = await page.evaluate(() => {
      type BoardViewportElement = HTMLElement & {
        updateGizmoScale?: (quad: string, scale: number) => void;
        mathEngine?: {
          project_to_screen(
            quad: string,
            x: number,
            y: number,
            z: number,
            aspect: number
          ): Float32Array;
        };
        boardState?: {
          outline?: {
            controlPoints?: [number, number, number][];
            control_points?: { x: number; y: number; z: number }[];
          };
        };
      };

      const vp = document.querySelector(
        "board-viewport"
      ) as unknown as BoardViewportElement | null;
      if (!vp || !vp.boardState || !vp.boardState.outline) return null;

      if (vp.updateGizmoScale) {
        vp.updateGizmoScale("top", 3.0);
      }

      const outline = vp.boardState.outline;
      const cpList = outline.controlPoints || outline.control_points;
      const cp = cpList ? cpList[1] : undefined;
      if (!cp) return null;

      const canvas =
        vp.shadowRoot?.querySelector("canvas") ||
        vp.querySelector("canvas");
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;

      const x = Array.isArray(cp) ? cp[0] : (cp as { x: number }).x;
      const z = Array.isArray(cp) ? cp[2] : (cp as { z: number }).z;

      let ndcX = 0;
      let ndcY = 0;
      if (vp.mathEngine && vp.mathEngine.project_to_screen) {
        const proj = vp.mathEngine.project_to_screen(
          "top",
          x,
          0,
          z,
          aspect
        );
        ndcX = proj[0]!;
        ndcY = proj[1]!;
      } else {
        return null;
      }

      const w = rect.width / 2;
      const h = rect.height / 2;

      return {
        x: rect.left + ((ndcX + 1) / 2) * w,
        y: rect.top + ((1 - ndcY) / 2) * h,
      };
    });

    expect(hitPosition).toBeTruthy();
    await page.mouse.click(hitPosition!.x, hitPosition!.y);

    // 3. Update Anchor position X to a large value (e.g. 15.0) to make it wide
    const inspector = page.locator("node-inspector");
    await expect(inspector).toBeVisible({ timeout: 15000 });

    const xInput = inspector
      .locator('div:has-text("Anchor Position") input')
      .first();
    await xInput.fill("15.0");
    await xInput.press("Enter");

    // Wait briefly for main-thread mathEngine sync
    await page.waitForTimeout(300);

    // 4. Set up Dialog intercepts for naming the component and saving
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("Enter a name")) {
        await dialog.accept("Super Wide Tail");
      } else if (
        dialog.message().includes("Are you sure you want to start a new design")
      ) {
        await dialog.accept();
      } else {
        await dialog.accept();
      }
    });

    // 5. Click Save Outline Component
    const saveBtn = boardControls.locator(
      'button[title="Save Outline Component"]'
    );
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await page.waitForTimeout(500);

    // 6. Click Start New Design to reset back to default
    const newBtn = boardControls.getByRole("button", {
      name: /Start New Design/i,
    });
    await expect(newBtn).toBeVisible();
    await newBtn.click();
    await page.waitForTimeout(600);

    // Verify the board has reset to default (Outline Node 1 X value is back to ~9.375)
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await expect(inspector).toBeVisible();
    await expect(xInput).toHaveValue("9.38");

    // Close node inspector by clicking somewhere else on the canvas
    const canvasBox = await viewport.locator("canvas").boundingBox();
    await page.mouse.click(canvasBox!.x + 150, canvasBox!.y + 150);
    await expect(inspector).toBeHidden();

    // 7. Click Load Outline Component to open the Component Library modal
    const loadBtn = boardControls.locator(
      'button[title="Load Outline Component"]'
    );
    await expect(loadBtn).toBeVisible();
    await loadBtn.click();

    // Verify Component Library modal is visible
    const libraryModal = page.locator("component-library-modal");
    await expect(libraryModal.locator(".bg-zinc-900")).toBeVisible();
    await expect(libraryModal.getByText("Super Wide Tail")).toBeVisible();

    // 8. Load the Outline Component
    const modalLoadBtn = libraryModal.getByRole("button", {
      name: /^Load$/i,
    });
    await expect(modalLoadBtn).toBeVisible();
    await modalLoadBtn.click();

    // Modal should close automatically on load
    await expect(libraryModal.locator(".bg-zinc-900")).toBeHidden();
    await page.waitForTimeout(600);

    // 9. Verify the outline has been updated with the "Super Wide Tail" (Node 1 X = 15.0)
    await page.mouse.click(hitPosition!.x, hitPosition!.y);
    await expect(inspector).toBeVisible();
    await expect(xInput).toHaveValue("15.00");

    // Verify original length (70.0) remains active (not overwritten)
    const lengthContainer = boardControls
      .locator(".mb-4")
      .filter({ hasText: "Length" })
      .first();
    const lengthInput = lengthContainer.locator('input[type="text"]');
    await expect(lengthInput).toHaveValue("5'10\"");

    // 10. Clean up / delete the component to leave the environment clean
    await loadBtn.click();
    await expect(libraryModal.locator(".bg-zinc-900")).toBeVisible();

    const deleteBtn = libraryModal.getByRole("button", {
      name: /^Delete$/i,
    });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    await page.waitForTimeout(500);

    // Verify the component has been deleted
    await expect(libraryModal.getByText("Super Wide Tail")).toBeHidden();

    // Close modal
    const closeBtn = libraryModal.getByRole("button", { name: /Close/i });
    await closeBtn.click();
    await expect(libraryModal.locator(".bg-zinc-900")).toBeHidden();

    // 11. Assert no WebGL or NaN errors were thrown
    const criticalErrors = errors.filter(
      (e) =>
        (e.includes("WebGL") || e.includes("NaN")) &&
        !e.includes("unsupported")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});