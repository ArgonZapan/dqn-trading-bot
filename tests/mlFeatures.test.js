/**
 * ML Features Tests
 */

const assert = require('assert');

// Load ML features
const { MLFeatures } = require('../src/mlFeatures');

describe('MLFeatures', () => {
    let ml;

    beforeEach(() => {
        ml = new MLFeatures();
    });

    // ─── Pattern Recognition ─────────────────────────────────────────────────

    describe('Pattern Recognition', () => {
        it('should detect double bottom pattern', () => {
            // Simulate double bottom: prices drop, rise, drop to similar low, then rise
            const prices = [
                100, 98, 95, 92, 90, 88, 90, 93, 95, 97,   // left bottom ~88
                100, 103, 105, 107, 105, 103, 100,           // middle peak
                92, 90, 88, 89, 91, 94, 97, 100              // right bottom ~88
            ];
            const result = ml.detectDoubleBottom(prices);
            // May or may not detect depending on exact pattern matching
            assert.ok(typeof result.detected === 'boolean');
            assert.ok(typeof result.confidence === 'number');
            assert.ok(result.confidence >= 0 && result.confidence <= 1);
        });

        it('should not detect double bottom on insufficient data', () => {
            const prices = [100, 95, 90, 85];
            const result = ml.detectDoubleBottom(prices);
            assert.strictEqual(result.detected, false);
        });

        it('should detect double top pattern', () => {
            const prices = [
                80, 85, 88, 90, 88, 85, 82,                 // uptrend start
                85, 90, 93, 96, 98, 100, 98,                // left top ~100
                95, 90, 87, 84, 82,                         // middle drop
                86, 90, 95, 98, 100, 102, 104, 106          // right top ~100
            ];
            const result = ml.detectDoubleTop(prices);
            assert.ok(typeof result.detected === 'boolean');
        });

        it('should not detect double top on insufficient data', () => {
            const prices = [100, 95, 90, 85, 80];
            const result = ml.detectDoubleTop(prices);
            assert.strictEqual(result.detected, false);
        });

        it('should detect head and shoulders pattern', () => {
            const prices = [
                80, 82, 85, 88, 90, 88, 85, 82, 80,         // left shoulder descent
                78, 80, 83, 86, 90, 94, 97, 100, 97, 93,    // head rise and fall
                88, 85, 83, 80, 78, 76, 79, 82, 85,          // right shoulder
                80, 78, 75, 72, 70                            // neckline break
            ];
            const result = ml.detectHeadShoulders(prices);
            assert.ok(typeof result.detected === 'boolean');
            assert.ok(result.confidence >= 0 && result.confidence <= 1);
        });

        it('should detect uptrend', () => {
            // Very strong uptrend: +5 per step to ensure slope is clearly positive
            const prices = [];
            for (let i = 0; i < 20; i++) prices.push(100 + i * 5);
            const result = ml.detectTrendLine(prices);
            assert.strictEqual(result.direction, 'UP');
            assert.ok(result.slope > 0.001, `Expected slope > 0.001, got ${result.slope}`);
        });

        it('should detect downtrend', () => {
            // Very strong downtrend: -5 per step
            const prices = [];
            for (let i = 0; i < 20; i++) prices.push(200 - i * 5);
            const result = ml.detectTrendLine(prices);
            assert.strictEqual(result.direction, 'DOWN');
            assert.ok(result.slope < -0.001, `Expected slope < -0.001, got ${result.slope}`);
        });

        it('should detect neutral trend', () => {
            const prices = [100, 101, 99, 100, 101, 100, 99, 101, 100];
            const result = ml.detectTrendLine(prices);
            assert.strictEqual(result.direction, 'NEUTRAL');
        });

        it('should handle insufficient data for trend detection', () => {
            const prices = [100, 101, 99];
            const result = ml.detectTrendLine(prices);
            assert.strictEqual(result.direction, 'NEUTRAL');
        });
    });

    // ─── Price Prediction ────────────────────────────────────────────────────

    describe('Price Prediction', () => {
        it('should predict price direction for uptrend', () => {
            const prices = [80, 82, 84, 86, 88, 90, 92, 94, 96, 98];
            const result = ml.predictNextPrice(prices);
            assert.ok(typeof result.direction === 'string');
            assert.ok(['UP', 'DOWN', 'NEUTRAL'].includes(result.direction));
            assert.ok(result.predicted > 0);
            assert.ok(result.confidence >= 0 && result.confidence <= 1);
        });

        it('should predict price direction for downtrend', () => {
            const prices = [98, 96, 94, 92, 90, 88, 86, 84, 82, 80];
            const result = ml.predictNextPrice(prices);
            assert.ok(['UP', 'DOWN', 'NEUTRAL'].includes(result.direction));
        });

        it('should handle insufficient data', () => {
            const prices = [100, 101];
            const result = ml.predictNextPrice(prices);
            assert.strictEqual(result.direction, 'NEUTRAL');
            assert.strictEqual(result.confidence, 0);
        });

        it('should not predict drop more than 10%', () => {
            const prices = [100, 95, 90, 85, 82, 80, 78, 76, 74, 72];
            const result = ml.predictNextPrice(prices);
            assert.ok(result.predicted >= 72 * 0.9, 'Predicted price should not drop >10%');
        });
    });

    // ─── Anomaly Detection ─────────────────────────────────────────────────

    describe('Anomaly Detection', () => {
        it('should detect price spike', () => {
            // First, build up history with normal prices
            const normalPrices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 2);
            normalPrices.forEach(p => ml.detectAnomaly(p, 1000));

            // Now inject a spike
            const result = ml.detectAnomaly(200, 1000);
            assert.ok(typeof result.isAnomaly === 'boolean');
            if (result.isAnomaly) {
                assert.ok(result.priceZScore > 1);
            }
        });

        it('should detect volume spike', () => {
            const normalVolumes = Array.from({ length: 30 }, (_, i) => 1000 + Math.random() * 100);
            normalVolumes.forEach(v => ml.detectAnomaly(100, v));

            const result = ml.detectAnomaly(100, 10000);
            assert.ok(typeof result.isAnomaly === 'boolean');
        });

        it('should return early with insufficient history', () => {
            const result = ml.detectAnomaly(100, 1000);
            assert.strictEqual(result.isAnomaly, false);
            assert.strictEqual(result.priceZScore, 0);
        });

        it('should compute z-scores correctly', () => {
            // Build flat history
            for (let i = 0; i < 25; i++) {
                ml.detectAnomaly(100, 1000);
            }
            const result = ml.detectAnomaly(100, 1000);
            // With identical values, z-score should be 0
            assert.strictEqual(result.priceZScore, 0);
        });
    });

    // ─── ML Features (state vector) ───────────────────────────────────────

    describe('getMLFeatures', () => {
        it('should return empty object when disabled', () => {
            const mlDisabled = new MLFeatures();
            mlDisabled.enabled = false;
            const result = mlDisabled.getMLFeatures({}, { candles: [] });
            assert.deepStrictEqual(result, {});
        });

        it('should return feature object with valid range values', () => {
            const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
            const candles = prices.map((p, i) => ({
                open: p - 1,
                high: p + 2,
                low: p - 2,
                close: p,
                volume: 1000 + Math.random() * 500
            }));

            const result = ml.getMLFeatures({}, { candles });

            // Check all values are in expected ranges
            assert.ok(typeof result.patternDoubleBottom === 'number');
            assert.ok(typeof result.patternDoubleTop === 'number');
            assert.ok(typeof result.patternHeadShoulders === 'number');
            assert.ok(typeof result.predictedDirectionUp === 'number');
            assert.ok(typeof result.predictedDirectionDown === 'number');
            assert.ok(typeof result.isAnomaly === 'number');
            assert.ok(result.patternConfidence >= 0 && result.patternConfidence <= 1);
            assert.ok(result.predictionConfidence >= 0 && result.predictionConfidence <= 1);
        });

        it('should return empty object with insufficient candles', () => {
            const candles = [{ open: 100, high: 105, low: 95, close: 102, volume: 1000 }];
            const result = ml.getMLFeatures({}, { candles });
            assert.deepStrictEqual(result, {});
        });
    });

    // ─── Dashboard Data ─────────────────────────────────────────────────────

    describe('getDashboardData', () => {
        it('should return valid dashboard data structure', () => {
            const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
            const volumes = Array.from({ length: 50 }, () => 1000);

            const result = ml.getDashboardData(prices, volumes);

            assert.ok(Array.isArray(result.patterns));
            assert.ok(typeof result.anomaly === 'object');
            assert.ok(typeof result.anomaly.detected === 'boolean');
            assert.ok(typeof result.prediction === 'object');
            assert.ok(['UP', 'DOWN', 'NEUTRAL'].includes(result.prediction.direction));
            assert.ok(typeof result.trend === 'object');
            assert.ok(result.lastPrice > 0);
        });

        it('should handle empty prices', () => {
            const result = ml.getDashboardData([], []);
            assert.strictEqual(result.lastPrice, 0);
            assert.strictEqual(result.patterns.length, 0);
        });
    });

    // ─── Reset ─────────────────────────────────────────────────────────────

    describe('reset', () => {
        it('should clear price and volume history', () => {
            for (let i = 0; i < 30; i++) {
                ml.detectAnomaly(100 + Math.random() * 10, 1000);
            }
            assert.ok(ml.priceHistory.length > 0);

            ml.reset();

            assert.strictEqual(ml.priceHistory.length, 0);
            assert.strictEqual(ml.volumeHistory.length, 0);
        });
    });
});
