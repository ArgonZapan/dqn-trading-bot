const { test } = require('@playwright/test');
const BASE = 'http://localhost:5173';

test('sprawdź prevEp data', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  
  const data = await page.evaluate(async () => {
    const res = await fetch('http://localhost:3000/api/episode-data');
    return res.json();
  });
  
  console.log('=== currentEp ===');
  console.log(`candles: ${data.currentEp?.candles?.length || 0}`);
  console.log(`trades: ${data.currentEp?.trades?.length || 0}`);
  if (data.currentEp?.candles?.length > 0) {
    console.log(`first: ${JSON.stringify(data.currentEp.candles[0])}`);
    console.log(`last: ${JSON.stringify(data.currentEp.candles[data.currentEp.candles.length - 1])}`);
  }
  
  console.log('\n=== prevEp ===');
  console.log(`candles: ${data.prevEp?.candles?.length || 0}`);
  console.log(`trades: ${data.prevEp?.trades?.length || 0}`);
  console.log(`episode: ${data.prevEp?.episode}`);
  if (data.prevEp?.candles?.length > 0) {
    console.log(`first: ${JSON.stringify(data.prevEp.candles[0])}`);
    console.log(`last: ${JSON.stringify(data.prevEp.candles[data.prevEp.candles.length - 1])}`);
  }
  
  // Check unique timestamps in prevEp
  if (data.prevEp?.candles) {
    const times = data.prevEp.candles.map(c => c.time);
    const unique = [...new Set(times)];
    console.log(`unique times: ${unique.length} / ${times.length}`);
  }
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/prev-ep-chart.png', fullPage: true });
  
  // Check legacy fields
  console.log('\n=== legacy ===');
  console.log(`prices: ${data.prices?.length || 0}`);
  console.log(`candles: ${data.candles?.length || 0}`);
  console.log(`trades: ${data.trades?.length || 0}`);
});
