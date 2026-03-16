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

    // 3. Verify default volume is ~30.5L
    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();
    // Look for the "30.5" text in the HUD
    await expect(boardControls.getByText("30.5", { exact: true })).toBeVisible();

    // 4. Click "Unlock Manual Sculpting"
    const unlockBtn = boardControls.getByRole('button', { name: /Unlock Manual Sculpting/i });
    await expect(unlockBtn).toBeVisible();
    await unlockBtn.click();

    // 5. Verify UI switches to Manual Mode
    // "Revert" button should appear
    const revertBtn = boardControls.getByRole('button', { name: /Revert to Parametric/i });
    await expect(revertBtn).toBeVisible();

    // Structural sliders should be disabled (e.g., Length)
    // Finding the first range input (which is Length)
    const firstSlider = boardControls.locator('input[type="range"]').first();
    await expect(firstSlider).toBeDisabled();

    // Viewport camera toggle buttons should become visible (Using locator instead of getByRole due to Shadow DOM piercing limitations on some generic setups, though PW usually handles it)
    const topViewBtn = viewport.locator('button', { hasText: /Top \(Outline\)/i });
    await expect(topViewBtn).toBeVisible();

    // 6. Export JSON
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
    
    const parsedState = JSON.parse(jsonContent);
    
    // Assert the state correctly reflects the manual switch and populated curves
    expect(parsedState.editMode).toBe("manual");
    expect(parsedState.volume).toBeCloseTo(30.5, 1);
    expect(parsedState.manualOutline).toBeDefined();
    expect(Array.isArray(parsedState.manualOutline.controlPoints)).toBe(true);
    expect(parsedState.manualOutline.controlPoints.length).toBeGreaterThan(3);
    
    // Close the modal
    const closeBtn = page.getByRole('button', { name: "Close" });
    await closeBtn.click();
    await expect(modalHeading).toBeHidden();
  });
});
