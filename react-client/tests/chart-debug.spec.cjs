const { test, expect } = require('@playwright/test');
const BASE = 'http://localhost:5173';

test.describe('Episode Chart — test działania', () => {

  test('strona się ładuje', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('training page — karta jest widoczna', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    // Check page title exists
    const title = await page.locator('h1').first().textContent();
    console.log('Title:', title);
  });

  test('episode chart — sprawdź czy canvas/container istnieje', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Check for chart container
    const chartContainers = await page.locator('[class*="chart"], canvas, [class*="Chart"]').count();
    console.log('Chart containers found:', chartContainers);

    // Check for any visible error
    const errors = await page.locator('text=/error|Error|ErrorBoundary/i').count();
    console.log('Errors on page:', errors);

    // Take screenshot
    await page.screenshot({ path: '/tmp/dashboard-training.png', fullPage: true });
    console.log('Screenshot saved');
  });

  test('episode data API — sprawdź odpowiedź', async ({ page }) => {
    const response = await page.goto(BASE);
    const apiData = await page.evaluate(async () => {
      const res = await fetch('http://localhost:3000/api/episode-data');
      return res.json();
    });
    console.log('Episode data:', JSON.stringify({
      prices: apiData.prices?.length,
      candles: apiData.candles?.length,
      trades: apiData.trades?.length,
      equity: apiData.equity?.length,
    }));
    if (apiData.candles?.length > 0) {
      console.log('First candle:', apiData.candles[0]);
      console.log('Last candle:', apiData.candles[apiData.candles.length - 1]);
    }
  });

  test('nawigacja — sprawdź czy zakładki działają', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

    for (const section of ['backtest', 'paper', 'analytics', 'live']) {
      const link = page.locator(`a[href="/${section}"]`);
      if (await link.count() > 0) {
        await link.click();
        await page.waitForTimeout(1000);
        const url = page.url();
        console.log(`${section}: ${url}`);
        await page.screenshot({ path: `/tmp/dashboard-${section}.png`, fullPage: true });
      }
    }
  });

  test('console errors — zbierz błędy', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(5000);

    console.log('Console errors:', errors.length);
    errors.forEach(e => console.log('  -', e));
  });
});
