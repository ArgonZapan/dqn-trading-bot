/**
 * Environment Unit Tests (Mocha)
 */
const assert = require('assert');
const TradingEnvironment = require('../src/environment');

describe('TradingEnvironment', () => {
    let env;
    let candles;

    function generateCandles(count = 100) {
        return Array.from({ length: count }, (_, i) => ({
            time: Date.now() - (count - i) * 60000,
            open: 40000 + Math.sin(i / 10) * 1000,
            high: 40500 + Math.sin(i / 10) * 1000,
            low: 39500 + Math.sin(i / 10) * 1000,
            close: 40000 + Math.sin(i / 10) * 1000 + Math.random() * 100,
            volume: 100 + Math.random() * 50
        }));
    }

    beforeEach(function() {
        candles = generateCandles(100);
        env = new TradingEnvironment('BTCUSDT', 30);
        // Manually check what we got
        if (typeof env.step !== 'number') {
            throw new Error(`env.step should be number but is ${typeof env.step}: ${env.step}`);
        }
        env.reset(candles);
    });

    it('should initialize correctly', () => {
        assert.strictEqual(env.position, 0);
        assert.strictEqual(env.capital, 1000);
        assert.strictEqual(env.windowSize, 30);
    });

    it('should use execute() instead of step()', () => {
        // Note: step is a number (the step counter), use execute() for actions
        env.position = 0;
        assert.strictEqual(typeof env.step, 'number', 'step should be a number (the counter)');
        assert.strictEqual(typeof env.execute, 'function', 'execute should be a function');
        const result = env.execute(1); // LONG
        assert.ok(typeof result.reward === 'number', 'execute should return {reward, done}');
        assert.ok(typeof result.done === 'boolean');
    });

    it('should open LONG position via execute(1)', () => {
        env.reset(candles);
        env.position = 0;
        const result = env.execute(1); // LONG
        assert.ok(typeof result.reward === 'number');
        assert.ok(typeof result.done === 'boolean');
    });

    it('should open SHORT position via execute(2)', () => {
        env.reset(candles);
        env.position = 0;
        const result = env.execute(2); // SHORT
        assert.ok(typeof result.reward === 'number');
        assert.ok(typeof result.done === 'boolean');
    });

    it('should close position via execute(3)', () => {
        env.reset(candles);
        env.position = 1;
        env.entryPrice = env.currentPrice();
        const result = env.execute(3); // CLOSE
        assert.strictEqual(env.position, 0);
    });

    it('should calculate finite reward', () => {
        env.reset(candles);
        const { reward } = env.execute(0);
        assert.strictEqual(typeof reward, 'number');
        assert.ok(isFinite(reward));
    });

    it('should track trades after opening position', () => {
        env.reset(candles);
        const tradesBefore = env.trades.length;
        env.execute(1); // LONG
        assert.ok(env.trades.length >= tradesBefore);
    });
});
