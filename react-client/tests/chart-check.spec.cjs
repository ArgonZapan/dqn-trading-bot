const { test } = require('@playwright/test');
const BASE = 'http://localhost:5173';

test('sprawdź wykres i dane epizodu', async ({ page }) => {
  // Capture console
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(5000);

  // Check API data
  const data = await page.evaluate(async () => {
    const res = await fetch('http://localhost:3000/api/episode-data');
    return res.json();
  });
  console.log(`API: prices=${data.prices?.length} candles=${data.candles?.length} trades=${data.trades?.length}`);

  // Check chart container
  const chartEl = await page.locator('.tv-lightweight-charts').count();
  console.log(`Chart containers: ${chartEl}`);

  // Check visible candles on chart
  const canvas = await page.locator('canvas').count();
  console.log(`Canvas elements: ${canvas}`);

  // Take screenshot
  await page.screenshot({ path: '/tmp/chart-check.png', fullPage: true });
  console.log('Screenshot saved');

  // Console errors
  const errors = logs.filter(l => l.includes('[error]'));
  console.log(`Console errors: ${errors.length}`);
  errors.forEach(e => console.log('  ', e));
});
