import { describe, test, expect, beforeEach } from 'vitest';

const Environment = require('../../src/environment');

// Generate fake candles for testing
function generateCandles(count, basePrice = 100) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const price = basePrice + i * 0.5;
    candles.push({
      open: price,
      high: price + 2,
      low: price - 2,
      close: price + 0.5,
      volume: 1000 + i * 10,
    });
  }
  return candles;
}

describe('Environment', () => {
  let env;
  const WINDOW_SIZE = 59;

  beforeEach(() => {
    env = new Environment('BTCUSDT', WINDOW_SIZE);
    const candles = generateCandles(200, 100);
    env.reset(candles);
  });

  test('BUY creates position', () => {
    // action 1 = LONG
    const { reward, done } = env.execute(1);
    expect(env.position).toBe(1);
    expect(env.btc).toBeGreaterThan(0);
    expect(env.entryPrice).toBeGreaterThan(0);
    // entryPrice is from the candle at step (before increment), currentPrice is next candle
    const priceDiff = Math.abs(env.entryPrice - env.currentPrice());
    expect(priceDiff).toBeLessThan(1); // Adjacent candles are close
    expect(env.trades.length).toBe(1);
    expect(env.trades[0].action).toBe('BUY/LONG');
  });

  test('SELL closes position', () => {
    // Enter LONG first
    env.execute(1);
    expect(env.position).toBe(1);

    // action 3 = CLOSE
    env.execute(3);
    expect(env.position).toBe(0);
    expect(env.btc).toBe(0);
    expect(env.entryPrice).toBe(0);

    // Should have entry + exit trades
    const exitTrade = env.trades.find((t) => t.type === 'exit');
    expect(exitTrade).toBeDefined();
    expect(exitTrade.action).toBe('SELL/CLOSE');
  });

  test('HOLD does nothing', () => {
    const posBefore = env.position;
    const btcBefore = env.btc;
    const capitalBefore = env.capital;
    const tradesBefore = env.trades.length;

    env.execute(0); // HOLD

    expect(env.position).toBe(posBefore);
    expect(env.btc).toBe(btcBefore);
    expect(env.capital).toBe(capitalBefore);
    expect(env.trades.length).toBe(tradesBefore);
  });

  test('Cannot BUY twice', () => {
    env.execute(1); // First BUY
    expect(env.position).toBe(1);

    const btcAfterFirst = env.btc;
    env.execute(1); // Second BUY - should be ignored
    expect(env.position).toBe(1);
    expect(env.btc).toBe(btcAfterFirst); // no additional BTC purchased
  });

  test('Cannot SELL without position', () => {
    expect(env.position).toBe(0);

    // CLOSE action (3) with no position should not crash
    const { reward, done } = env.execute(3);
    expect(env.position).toBe(0);
    expect(env.trades.length).toBe(0); // No trades created
  });

  test('Episode ends after enough steps', () => {
    const candles = generateCandles(WINDOW_SIZE + 5, 100); // Small dataset
    env.reset(candles);

    let done = false;
    let steps = 0;
    while (!done && steps < 20) {
      const result = env.execute(0); // HOLD
      done = result.done;
      steps++;
    }

    expect(done).toBe(true);
    expect(steps).toBeLessThanOrEqual(6);
  });

  test('PnL is calculated correctly', () => {
    // Buy at current price
    env.execute(1);
    const entryPrice = env.entryPrice;

    // Advance a few steps (price rises)
    for (let i = 0; i < 3; i++) {
      env.execute(0);
    }

    const currentPrice = env.currentPrice();
    // Unrealized PnL
    const state = env.getState();
    expect(state.unrealizedPnl).toBeCloseTo(
      (currentPrice - entryPrice) / entryPrice,
      5
    );

    // Close position
    env.execute(3);
    const exitTrade = env.trades.find((t) => t.type === 'exit');
    expect(exitTrade).toBeDefined();
    // PnL = (exitPrice - entryPrice) * btc - fees
    expect(exitTrade.pnl).toBeDefined();
    expect(exitTrade.pnlPct).toBeDefined();
  });

  test('Trailing stop closes position', () => {
    // Enter LONG
    env.execute(1);
    expect(env.position).toBe(1);

    const entryPrice = env.entryPrice;

    // Create candles: first rise significantly (so highestPrice > entryPrice * 1.02),
    // then drop enough to trigger trailing stop (price <= highestPrice * 0.985)
    const highPrice = entryPrice * 1.10; // 10% above entry
    const trailingTrigger = highPrice * 0.98; // Well below trailing stop threshold

    const testCandles = [];
    // First WINDOW_SIZE candles at entry level
    for (let i = 0; i < WINDOW_SIZE + 5; i++) {
      testCandles.push({
        open: entryPrice,
        high: entryPrice + 2,
        low: entryPrice - 2,
        close: entryPrice,
        volume: 1000,
      });
    }
    // Then candles that rise to highPrice
    for (let i = 0; i < 10; i++) {
      const p = entryPrice + (highPrice - entryPrice) * (i / 9);
      testCandles.push({
        open: p,
        high: p + 2,
        low: p - 2,
        close: p,
        volume: 1000,
      });
    }
    // Then drop below trailing stop
    for (let i = 0; i < 30; i++) {
      testCandles.push({
        open: trailingTrigger,
        high: trailingTrigger + 1,
        low: trailingTrigger - 1,
        close: trailingTrigger,
        volume: 1000,
      });
    }

    env.reset(testCandles);
    env.execute(1); // Enter LONG

    let steps = 0;
    while (env.position === 1 && steps < 80) {
      env.execute(0); // HOLD while trailing stop might trigger
      steps++;
    }

    // Trailing stop should have closed the position
    expect(env.position).toBe(0);
  });
});
