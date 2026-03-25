import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173');

    // Wait for the main app to load
    await page.waitForSelector('text=PCF Validator', { timeout: 5000 });

    // Switch to 3D Topology Tab
    console.log('Switching to 3D Topology Tab...');
    await page.click('text=3D Topology');
    await page.waitForTimeout(2000); // Wait for canvas to mount and models to load

    // Wait for canvas toolbar to appear
    await page.waitForSelector('button[title="Toggle Section Box"]', { timeout: 5000 });

    console.log('Clicking Toggle Section Box...');
    await page.click('button[title="Toggle Section Box"]');
    await page.waitForTimeout(1000);

    console.log('Clicking Assign Pipeline Ref Mode...');
    await page.click('button[title="Assign Pipeline Ref Mode"]');
    await page.waitForTimeout(1000);

    console.log('Taking screenshot...');
    await page.screenshot({ path: '/app/playwright-toolbar5.png' });
    console.log('Screenshot saved to /app/playwright-toolbar5.png');

  } catch (error) {
    console.error('Error during verification script:', error);
  } finally {
    await browser.close();
  }
})();