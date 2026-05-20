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
    const toggleViewportCheckbox = async (labelText: string, targetState: boolean) => {
      const row = viewport.locator('.grid.items-center', { hasText: labelText }).first();
      const inputs = row.locator('input[type="checkbox"]');
      if (await inputs.count() >= 2) {
          const lineInput = inputs.nth(0);
          const gizmoInput = inputs.nth(1);
          
          if (!targetState) {
              await lineInput.uncheck({ force: true });
              await gizmoInput.uncheck({ force: true });
          } else {
              await lineInput.check({ force: true });
              await gizmoInput.check({ force: true });
          }
      } else {
          const label = viewport.locator('label', { hasText: labelText }).first();
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
      }
    };

        // 5. Maximize the perspective view FIRST so the settings dropdown doesn't get clipped
    const maximizeBtn = viewport.locator('button[title="Maximize Perspective"]');
    if (await maximizeBtn.isVisible()) {
      await maximizeBtn.click();
      await page.waitForTimeout(500);
    }

    // Open Perspective Cog
    const perspectiveCog = viewport.locator('button[title="Display Settings"]').first(); 
    await perspectiveCog.click();
    await page.waitForTimeout(200);

    await toggleViewportCheckbox("Outline", false);
    await toggleViewportCheckbox("Rocker Top", false);
    await toggleViewportCheckbox("Rocker Bottom", false);
    await toggleViewportCheckbox("Apex Outline", false);
    await toggleViewportCheckbox("Rail (Tuck)", false);
    await toggleViewportCheckbox("Apex Rocker", false);
        await toggleViewportCheckbox("Deck Shoulder", false);
    await toggleViewportCheckbox("Cross Sections", false);
    
    // 3. Enable Zebra Flow
    await toggleViewportCheckbox("Zebra Flow", true);

    await perspectiveCog.click(); // close cog
    await page.waitForTimeout(200);

    // Wait for material to apply
    await page.waitForTimeout(1000);

        // Zebra animation is now handled in WGPU. We wait for it to settle.
    await page.waitForTimeout(500);

    // Let the canvas render the frozen frame
    await page.waitForTimeout(500);

        // 6. Screenshot the viewport
                await expect(viewport).toHaveScreenshot('zebra-flow-smart-filter.png', {
      maxDiffPixels: 150000, 
      threshold: 0.5,
      timeout: 15000,
      mask: [viewport.locator('button')]
    });
  });
});
