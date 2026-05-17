import { test, expect } from './utils/base-test';

test.describe('Visual Regression', () => {
  test.setTimeout(120000);

  test('Zebra Flow analysis matches golden snapshot', async ({ page }) => {
    // Suppress expected console errors for cleaner test output
    page.on('console', msg => {
      if (msg.type() === 'error') console.info(`[Browser Error] ${msg.text()}`);
    });

    await page.goto('/');

    const viewport = page.locator('board-viewport');
    await expect(viewport.locator('canvas')).toBeVisible();

    const boardControls = page.locator('board-controls');
    await expect(boardControls).toBeVisible();

    // 1. Open Import Modal and load golden s3dx
    await boardControls.getByRole('button', { name: /Import Design/i }).click();
    const modalHeading = page.getByRole('heading', { name: "Import Design" });
    await expect(modalHeading).toBeVisible();

        const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Select File').click();
    const fileChooser = await fileChooserPromise;
    
    // Ensure we use the correct path relative to the test runner
    await fileChooser.setFiles('./src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx');

    await expect(modalHeading).toBeHidden();

    // Wait for the geometry to settle
    await page.waitForTimeout(2000);

    // 2. Hide all wireframes and gizmos to isolate the solid mesh
    const toggleCheckbox = async (labelText: string, targetState: boolean) => {
      const label = boardControls.locator('label', { hasText: labelText }).first();
      const input = label.locator('input[type="checkbox"]');
      if (await input.count() > 0) {
        const isChecked = await input.isChecked();
        if (isChecked !== targetState) {
          if (!targetState) {
              await input.uncheck({ force: true });
          } else {
              await input.check({ force: true });
          }
        }
      }
    };

    await toggleCheckbox("Control Points", false);
    await toggleCheckbox("Outline", false);
    await toggleCheckbox("Rocker Top", false);
    await toggleCheckbox("Rocker Bottom", false);
    await toggleCheckbox("Apex Outline", false);
    await toggleCheckbox("Rail Outline (Tuck)", false);
    await toggleCheckbox("Apex Rocker", false);
    await toggleCheckbox("Deck Shoulder", false);
    await toggleCheckbox("Cross Sections", false);

    // 3. Enable Zebra Flow
    const zebraLabel = boardControls.locator('label').filter({ hasText: /Zebra Flow/i });
    const zebraCheckbox = zebraLabel.locator('input[type="checkbox"]');
    await zebraCheckbox.check({ force: true });
    
    // Wait for material to apply
    await page.waitForTimeout(1000);

        // Zebra animation is now handled in WGPU. We wait for it to settle.
    await page.waitForTimeout(500);

    // Let the canvas render the frozen frame
    await page.waitForTimeout(500);

    // 5. Maximize the perspective view
    const maximizeBtn = viewport.locator('button[title="Maximize Perspective"]');
    if (await maximizeBtn.isVisible()) {
      await maximizeBtn.click();
      await page.waitForTimeout(500);
    }

        // 6. Screenshot the viewport
    await expect(viewport).toHaveScreenshot('zebra-flow-golden.png', {
      maxDiffPixels: 35000, 
      threshold: 0.25,
      timeout: 15000,
      mask: [viewport.locator('button')]
    });
  });
});
