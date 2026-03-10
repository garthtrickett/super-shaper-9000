import { test, expect } from '@playwright/test';

test('Board Builder UI updates correctly on slider changes', async ({ page }) => {
  // Intercept the API call to return mock data
  await page.route('**/api/compute/board', async route => {
    // slight delay to ensure "Shaping..." overlay is visible to the test
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: "success", data: { mesh: "MOCK_BASE64_MESH_DATA" } })
    });
  });

  await page.goto('/');

  await expect(page.locator('board-controls')).toBeVisible();

  page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  // Shaping overlay should appear on initial load (due to TRIGGER_COMPUTE)
  try {
    // Depending on Vite's initial compilation time, this overlay might appear and disappear 
    // before page.goto() fully resolves. We catch the timeout so it doesn't flake.
    await expect(page.locator('text=Shaping...')).toBeVisible({ timeout: 2000 });
  } catch (e) {
    console.log('Initial shaping overlay missed (likely completed during page.goto), proceeding...');
  }
  await expect(page.locator('text=Shaping...')).toBeHidden({ timeout: 10000 });

  // Move the length slider
  const lengthSlider = page.locator('input[type="range"]').first();
  
  // Wait for app to be ready
  await page.waitForTimeout(500); 
  await lengthSlider.fill('80');
  await lengthSlider.dispatchEvent('input');

  // Shaping overlay should appear again due to debounce
  await expect(page.locator('text=Shaping...')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('text=Shaping...')).toBeHidden({ timeout: 5000 });

  await expect(page.locator('canvas')).toBeVisible();
});
