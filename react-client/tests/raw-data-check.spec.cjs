const { test } = require('@playwright/test');
const BASE = 'http://localhost:5173';

test('sprawdź surowe dane ticków', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  
  const data = await page.evaluate(async () => {
    const res = await fetch('http://localhost:3000/api/episode-data');
    return res.json();
  });
  
  console.log('=== currentEp (raw steps) ===');
  console.log(`total steps: ${data.currentEp?.steps?.length || 0}`);
  if (data.currentEp?.steps?.length > 0) {
    // Show first 5 and last 5
    const steps = data.currentEp.steps;
    console.log('first 5:');
    steps.slice(0, 5).forEach(s => console.log(`  step=${s.step} time=${s.time} price=${s.price} action=${s.action}`));
    console.log('last 5:');
    steps.slice(-5).forEach(s => console.log(`  step=${s.step} time=${s.time} price=${s.price} action=${s.action}`));
    
    // Time span
    const span = (steps[steps.length-1].time - steps[0].time) / 1000;
    console.log(`time span: ${span}s`);
    
    // Unique prices
    const prices = [...new Set(steps.map(s => s.price))];
    console.log(`unique prices: ${prices.length}`);
    
    // Actions with trades
    const withAction = steps.filter(s => s.action && s.action !== 'HOLD');
    console.log(`steps with action: ${withAction.length}`);
  }
  
  console.log('\n=== prevEp (raw steps) ===');
  console.log(`total steps: ${data.prevEp?.steps?.length || 0}`);
  if (data.prevEp?.steps?.length > 0) {
    const steps = data.prevEp.steps;
    const span = (steps[steps.length-1].time - steps[0].time) / 1000;
    console.log(`time span: ${span}s`);
    console.log('first 3:', steps.slice(0, 3).map(s => `step=${s.step} price=${s.price}`).join(', '));
    console.log('last 3:', steps.slice(-3).map(s => `step=${s.step} price=${s.price}`).join(', '));
  }
});
