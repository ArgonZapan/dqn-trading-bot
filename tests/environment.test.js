/**
 * Environment Unit Tests
 */
const { describe, test, expect } = require('@jest/globals');

describe('TradingEnvironment', () => {
    let env;

    beforeAll(() => {
        const { TradingEnvironment } = require('../src/environment');
        // Generate mock candles
        const candles = Array.from({ length: 100 }, (_, i) => ({
            time: Date.now() - (100 - i) * 60000,
            open: 40000 + Math.sin(i / 10) * 1000,
            high: 40500 + Math.sin(i / 10) * 1000,
            low: 39500 + Math.sin(i / 10) * 1000,
            close: 40000 + Math.sin(i / 10) * 1000 + Math.random() * 100,
            volume: 100 + Math.random() * 50
        }));
        env = new TradingEnvironment('BTCUSDT', 30);
        env.reset(candles);
    });

    test('should initialize correctly', () => {
        expect(env.position).toBe(0);
        expect(env.capital).toBe(1000);
        expect(env.windowSize).toBe(30);
    });

    test('should return valid state vector', () => {
        const state = env.getState();
        expect(state).toBeInstanceOf(Array);
        expect(state.length).toBeGreaterThan(100); // State vector size
        expect(state.every(v => typeof v === 'number' && !isNaN(v))).toBe(true);
    });

    test('should open LONG position', () => {
        env.position = 0;
        const action = 1; // LONG
        const result = env.step(action);
        expect(result).toHaveProperty('reward');
        expect(result).toHaveProperty('done');
        expect(typeof result.reward).toBe('number');
    });

    test('should open SHORT position', () => {
        env.reset(env.candles);
        env.position = 0;
        const action = 2; // SHORT
        const result = env.step(action);
        expect(result).toHaveProperty('reward');
        expect(result).toHaveProperty('done');
    });

    test('should close position', () => {
        env.position = 1; // Set existing LONG
        env.entryPrice = env.currentPrice();
        const action = 0; // FLAT/CLOSE
        const result = env.step(action);
        expect(result).toHaveProperty('reward');
        expect(env.position).toBe(0);
    });

    test('should calculate reward correctly', () => {
        const { reward } = env.step(0);
        expect(typeof reward).toBe('number');
        expect(isFinite(reward)).toBe(true);
    });
});
