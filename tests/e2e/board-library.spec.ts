import { test, expect } from "./utils/base-test";

test.describe("Board Library E2E Flow", () => {
  test.setTimeout(120000);

  test("Named save, load, and delete workflow", async ({ page }) => {
    // 1. Open the builder page
    await page.goto("/");
    await expect(page.locator("app-shell")).toBeVisible();
    await expect(page.locator("board-viewport canvas")).toBeVisible();
    await page.waitForTimeout(1000); // Allow initialization

    const boardControls = page.locator("board-controls");
    await expect(boardControls).toBeVisible();

    // 2. Adjust board dimensions (e.g. Change length to 85 inches)
    const lengthContainer = boardControls.locator(".mb-4").filter({ hasText: /^Length$/i }).first();
    const lengthSlider = lengthContainer.locator('input[type="range"]');
    const lengthInput = lengthContainer.locator('input[type="text"]');

    await lengthSlider.fill("85");
    await lengthSlider.dispatchEvent("input");
    await lengthSlider.dispatchEvent("pointerup");

    // Wait for the WASM debounce and HUD update
    await page.waitForTimeout(600);
    await expect(lengthInput).toHaveValue('7\'1"'); // 85 inches is 7 feet 1 inch

    // 3. Click "Save to Library"
    const saveBtn = boardControls.getByRole("button", { name: /Save to Library/i });
    await expect(saveBtn).toBeVisible();

    // Set up native dialog prompt handler
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Enter a name for your saved design");
      await dialog.accept("My Custom Fish");
    });

    // Accept success alert
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("successfully saved to your library");
      await dialog.accept();
    });

    await saveBtn.click();
    await page.waitForTimeout(500);

    // 4. Reset the board back to default by clicking "Start New Design"
    const newBtn = boardControls.getByRole("button", { name: /Start New Design/i });
    await expect(newBtn).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to start a new design");
      await dialog.accept();
    });

    await newBtn.click();
    await page.waitForTimeout(600);

    // Verify length is back to default (70 inches)
    await expect(lengthInput).toHaveValue('5\'10"'); // 70 inches is 5 feet 10 inches

    // 5. Open "My Library" modal
    const libraryBtn = boardControls.getByRole("button", { name: /My Library/i });
    await expect(libraryBtn).toBeVisible();
    await libraryBtn.click();

    const libraryModal = page.locator("library-modal");
    await expect(libraryModal).toBeVisible();
    await expect(libraryModal.getByText("My Custom Fish")).toBeVisible();

    // 6. Click "Load" on our custom design
    const loadBtn = libraryModal.getByRole("button", { name: /^Load$/i });
    await expect(loadBtn).toBeVisible();
    await loadBtn.click();

    // Verify modal automatically closed on load
    await expect(libraryModal).toBeHidden();
    await page.waitForTimeout(600);

    // 7. Verify the 3D viewport and HUD updated to reflect the 85-inch length
    await expect(lengthInput).toHaveValue('7\'1"');

    // 8. Open library again to clean up/delete the design
    await libraryBtn.click();
    await expect(libraryModal).toBeVisible();

    const deleteBtn = libraryModal.getByRole("button", { name: /^Delete$/i });
    await expect(deleteBtn).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Are you sure you want to permanently delete");
      await dialog.accept();
    });

    await deleteBtn.click();
    await page.waitForTimeout(500);

    // Verify the design is gone and empty state is displayed
    await expect(libraryModal.getByText("My Custom Fish")).toBeHidden();
    await expect(libraryModal.getByText("Library is empty")).toBeVisible();

    // Close modal
    const closeBtn = libraryModal.getByRole("button", { name: /Close/i });
    await closeBtn.click();
    await expect(libraryModal).toBeHidden();
  });
});
