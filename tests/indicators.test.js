/**
 * Indicators Unit Tests
 */
const { describe, test, expect } = require('@jest/globals');

describe('TechnicalIndicators', () => {
    // Generate mock OHLCV data
    const candles = Array.from({ length: 100 }, (_, i) => ({
        time: Date.now() - (100 - i) * 60000,
        open: 40000 + i * 10 + Math.random() * 100,
        high: 40100 + i * 10 + Math.random() * 100,
        low: 39900 + i * 10 + Math.random() * 100,
        close: 40000 + i * 10 + Math.random() * 100,
        volume: 100 + Math.random() * 50
    }));

    const indicators = require('../src/indicators');

    test('RSI should return value between 0 and 100', () => {
        const rsi = indicators.rsi(candles, 14);
        expect(typeof rsi).toBe('number');
        expect(rsi).toBeGreaterThanOrEqual(0);
        expect(rsi).toBeLessThanOrEqual(100);
    });

    test('EMA should return positive number', () => {
        const ema = indicators.ema(candles, 20);
        expect(typeof ema).toBe('number');
        expect(ema).toBeGreaterThan(0);
    });

    test('MACD should return object with signal and histogram', () => {
        const macd = indicators.macd(candles);
        expect(macd).toHaveProperty('macd');
        expect(macd).toHaveProperty('signal');
        expect(macd).toHaveProperty('histogram');
    });

    test('Bollinger Bands should return object with upper, middle, lower', () => {
        const bb = indicators.bb(candles, 20, 2);
        expect(bb).toHaveProperty('upper');
        expect(bb).toHaveProperty('middle');
        expect(bb).toHaveProperty('lower');
        expect(bb.upper).toBeGreaterThan(bb.middle);
        expect(bb.middle).toBeGreaterThan(bb.lower);
    });

    test('ATR should return positive value', () => {
        const atrValue = indicators.atr(candles, 14);
        expect(typeof atrValue).toBe('number');
        expect(atrValue).toBeGreaterThan(0);
    });

    test('should handle insufficient data gracefully', () => {
        const shortCandles = candles.slice(0, 5);
        const rsi = indicators.rsi(shortCandles, 14);
        expect(rsi).toBe(50); // Default when not enough data
    });
});
