/**
 * Indicators Unit Tests (Mocha)
 */
const assert = require('assert');
const indicators = require('../src/indicators');

describe('TechnicalIndicators', () => {
    // Generate mock price data
    const closes = Array.from({ length: 100 }, (_, i) => 40000 + i * 10 + Math.random() * 100);
    const highs = Array.from({ length: 100 }, (_, i) => 40100 + i * 10 + Math.random() * 100);
    const lows = Array.from({ length: 100 }, (_, i) => 39900 + i * 10 + Math.random() * 100);

    it('RSI should return value between 0 and 100', () => {
        const rsi = indicators.rsi(closes, 14);
        assert(typeof rsi === 'number', 'RSI should be a number');
        assert(rsi >= 0 && rsi <= 100, `RSI should be 0-100, got ${rsi}`);
    });

    it('EMA should return positive number', () => {
        const ema = indicators.ema(closes, 20);
        assert(typeof ema === 'number', 'EMA should be a number');
        assert(ema > 0, `EMA should be positive, got ${ema}`);
    });

    it('MACD should return object with macd, signal and histogram', () => {
        const macd = indicators.macd(closes);
        assert(typeof macd.macd === 'number', 'MACD should have macd');
        assert(typeof macd.signal === 'number', 'MACD should have signal');
        assert(typeof macd.histogram === 'number', 'MACD should have histogram');
    });

    it('Bollinger Bands should return upper > middle > lower', () => {
        const bb = indicators.bollinger(closes, 20, 2);
        assert(bb.upper > bb.middle, 'upper should be > middle');
        assert(bb.middle > bb.lower, 'middle should be > lower');
    });

    it('ATR should return positive value', () => {
        const atrValue = indicators.atr(highs, lows, closes, 14);
        assert(typeof atrValue === 'number', 'ATR should be a number');
        assert(atrValue > 0, `ATR should be positive, got ${atrValue}`);
    });

    it('should handle insufficient data gracefully', () => {
        const shortCloses = closes.slice(0, 5);
        const rsi = indicators.rsi(shortCloses, 14);
        assert.strictEqual(rsi, 50, 'RSI should return 50 for insufficient data');
    });
});
