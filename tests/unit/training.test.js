import { describe, test, expect, beforeEach, afterEach } from 'vitest';

const Environment = require('../../src/environment');
const Agent = require('../../src/dqnAgent');

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

describe('Training Step', () => {
  let env;
  let agent;
  const WINDOW_SIZE = 59;

  beforeEach(() => {
    const origLog = console.log;
    console.log = () => {};
    env = new Environment('BTCUSDT', WINDOW_SIZE);
    agent = new Agent(394, 4);
    console.log = origLog;
  });

  afterEach(() => {
    if (agent) agent.dispose();
  });

  test('140 steps then done=true', () => {
    // Total candles = 140 + WINDOW_SIZE + 1 = 200
    const totalCandles = WINDOW_SIZE + 141;
    const candles = generateCandles(totalCandles);
    env.reset(candles);

    let stepCount = 0;
    let done = false;

    while (!done) {
      const action = agent.act(env.getState());
      const result = env.execute(action);
      done = result.done;
      stepCount++;
      if (stepCount > 300) break; // Safety
    }

    // Should be done after ~140 steps (the agent advances step on each action)
    expect(done).toBe(true);
    expect(stepCount).toBeLessThanOrEqual(142); // Allow small tolerance
  });

  test('episode increments correctly', () => {
    const candles = generateCandles(WINDOW_SIZE + 10);
    env.reset(candles);

    expect(agent.episode).toBe(0);

    agent.startEpisode();
    expect(agent.episode).toBe(1);

    agent.startEpisode();
    expect(agent.episode).toBe(2);
  });

  test('trades are tracked', () => {
    const candles = generateCandles(WINDOW_SIZE + 30);
    env.reset(candles);

    // Execute a BUY
    env.execute(1);
    expect(env.trades.length).toBe(1);

    // Execute a CLOSE
    env.execute(3);
    expect(env.trades.length).toBe(2);

    // Verify trade structure
    const entry = env.trades.find((t) => t.type === 'entry');
    const exit = env.trades.find((t) => t.type === 'exit');
    expect(entry).toBeDefined();
    expect(exit).toBeDefined();
    expect(entry.action).toBe('BUY/LONG');
    expect(exit.action).toBe('SELL/CLOSE');
    expect(exit.pnl).toBeDefined();
  });

  test('metrics reset on episode end', () => {
    const candles = generateCandles(WINDOW_SIZE + 15);
    env.reset(candles);

    // Make some trades
    env.execute(1); // BUY
    env.execute(3); // CLOSE
    const firstTrades = env.trades.length;
    expect(firstTrades).toBeGreaterThan(0);

    // Reset for new episode
    const newCandles = generateCandles(WINDOW_SIZE + 15, 200);
    env.reset(newCandles);

    // Trades should be cleared
    expect(env.trades.length).toBe(0);
    expect(env.position).toBe(0);
    expect(env.capital).toBe(1000); // Reset to initial
    expect(env.step).toBe(WINDOW_SIZE);
  });
});
