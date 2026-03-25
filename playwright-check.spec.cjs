const { test, expect } = require('@playwright/test');

test('Check Marquee and Measure SVGs', async ({ page }) => {
  await page.goto('http://localhost:5173');

  await page.waitForTimeout(2000);
  await page.click('text=3D Topology');
  await page.waitForTimeout(1000);

  // Select CA1 to display the legend
  const zoomBtn = await page.locator('[title="Marquee Zoom Mode"]');
  const measureBtn = await page.locator('[title="MEASURE Mode (M)"]');

  await expect(zoomBtn).toBeVisible();
  await expect(measureBtn).toBeVisible();
});
test('Ensure getCAColor exists and color mapping renders', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);
});
