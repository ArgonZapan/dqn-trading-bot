import { describe, test, expect, beforeEach, afterEach } from 'vitest';

const Agent = require('../../src/dqnAgent');

// Generate a minimal valid state with correct size (394 elements)
function generateFakeState(size = 59) {
  const candles = [];
  for (let i = 0; i < size; i++) {
    candles.push(1.0);
  }
  return {
    open: candles,
    high: candles,
    low: candles,
    close: candles,
    volume: candles,
    position: 0,
    positionFlat: 1,
    positionLong: 0,
    positionShort: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalPnl: 0,
    timeSinceTrade: 0,
    atrPct: 0.01,
    volatility: 0.01,
    riskLevel: 0,
    priceVsAvg: 0,
    recentReturns: [0, 0, 0, 0],
    sentiment: 0.5,
    predictionConfidence: 0,
  };
}

describe('DQN Agent', () => {
  let agent;

  beforeEach(() => {
    // Suppress model summary output
    const origLog = console.log;
    console.log = () => {};
    agent = new Agent(394, 4);
    console.log = origLog;
  });

  afterEach(() => {
    if (agent) agent.dispose();
  });

  test('act() returns 0, 1, 2, or 3', () => {
    agent.epsilon = 0; // Disable random exploration
    const state = generateFakeState();
    const action = agent.act(state);
    expect([0, 1, 2, 3]).toContain(action);
  });

  test('epsilon=0.9 returns random actions (mostly different)', () => {
    agent.epsilon = 0.9;
    const state = generateFakeState();
    const actions = new Set();
    for (let i = 0; i < 50; i++) {
      actions.add(agent.act(state));
    }
    // With 90% random, we should see at least 2 different actions in 50 tries
    expect(actions.size).toBeGreaterThanOrEqual(2);
  });

  test('epsilon=0.01 returns consistent action', () => {
    agent.epsilon = 0.01;
    const state = generateFakeState();
    const actions = [];
    for (let i = 0; i < 20; i++) {
      actions.push(agent.act(state));
    }
    // With very low epsilon, same state should produce same action most of the time
    const firstAction = actions[0];
    const sameCount = actions.filter((a) => a === firstAction).length;
    expect(sameCount).toBeGreaterThan(15); // At least 75% consistency
  });

  test('epsilon decays after training', async () => {
    agent.epsilon = 0.5;
    const initialEpsilon = agent.epsilon;

    // Fill buffer with enough data for replay
    const state = generateFakeState();
    const nextState = generateFakeState();
    for (let i = 0; i < agent.batchSize; i++) {
      agent.remember(state, 1, 0.01, nextState, false);
    }

    await agent.replay();
    expect(agent.epsilon).toBeLessThan(initialEpsilon);
  });

  test('replay() does not crash', async () => {
    const state = generateFakeState();
    const nextState = generateFakeState();

    // Fill buffer with enough samples
    for (let i = 0; i < agent.batchSize; i++) {
      agent.remember(state, i % 4, Math.random() * 0.1 - 0.05, nextState, i === agent.batchSize - 1);
    }

    // Should not throw
    const loss = await agent.replay();
    expect(typeof loss === 'number' || loss === null).toBe(true);
  });
});
