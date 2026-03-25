const { test, expect } = require('@playwright/test');

test('Check Rendering After CA Fix', async ({ page }) => {
  await page.goto('http://localhost:5173');

  await page.waitForTimeout(2000);
  await page.click('text=3D Topology');
  await page.waitForTimeout(1000);

  const select = await page.locator('select');
  await select.selectOption({ label: 'Color by CA1' });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'playwright-toolbar4.png' });
});
