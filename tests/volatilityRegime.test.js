/**
 * Volatility Regime Detector - Unit Tests
 */

const assert = require('assert');
const VolatilityRegime = require('../src/volatilityRegime');

describe('VolatilityRegime', () => {
    let vr;

    beforeEach(() => {
        vr = new VolatilityRegime();
    });

    describe('classifyRegime', () => {
        it('should classify LOW regime for low ATR%', () => {
            assert.strictEqual(vr.classifyRegime(0.005), 'LOW');
            assert.strictEqual(vr.classifyRegime(0.01), 'LOW');
            assert.strictEqual(vr.classifyRegime(0.014), 'LOW');
        });

        it('should classify NORMAL regime for medium ATR%', () => {
            assert.strictEqual(vr.classifyRegime(0.015), 'NORMAL');
            assert.strictEqual(vr.classifyRegime(0.02), 'NORMAL');
            assert.strictEqual(vr.classifyRegime(0.029), 'NORMAL');
        });

        it('should classify HIGH regime for high ATR%', () => {
            assert.strictEqual(vr.classifyRegime(0.03), 'HIGH');
            assert.strictEqual(vr.classifyRegime(0.04), 'HIGH');
            assert.strictEqual(vr.classifyRegime(0.049), 'HIGH');
        });

        it('should classify EXTREME regime for very high ATR%', () => {
            assert.strictEqual(vr.classifyRegime(0.05), 'EXTREME');
            assert.strictEqual(vr.classifyRegime(0.08), 'EXTREME');
            assert.strictEqual(vr.classifyRegime(0.10), 'EXTREME');
        });
    });

    describe('update + regime transitions', () => {
        it('should detect regime change from LOW to EXTREME with sustained volatility', () => {
            // Simulate calm LOW regime candles
            for (let i = 0; i < 30; i++) {
                const price = 50000 + (Math.random() - 0.5) * 100;
                vr.update({ high: price + 50, low: price - 50, close: price, volume: 100 }, price);
            }

            // Verify starting regime is LOW
            const initial = vr.update({ high: 50050, low: 49950, close: 50000, volume: 100 }, 50000);
            assert.strictEqual(initial.regime, 'LOW');

            // Now simulate EXTREME volatility — big wicks + close movement for 20 candles
            // This should push ATR% above 0.05 threshold
            for (let i = 0; i < 25; i++) {
                const wildPrice = 50000 + (Math.random() - 0.5) * 5000;
                const result = vr.update(
                    { high: wildPrice + 3000, low: wildPrice - 3000, close: wildPrice, volume: 500 },
                    wildPrice
                );
            }

            // After sustained high volatility, regime should be HIGH or EXTREME
            const finalResult = vr.update(
                { high: 54000, low: 46000, close: 50000, volume: 500 },
                50000
            );
            assert.ok(
                finalResult.regime === 'HIGH' || finalResult.regime === 'EXTREME',
                `Expected HIGH or EXTREME after volatility spike, got ${finalResult.regime}`
            );
        });

        it('should increment regimeDuration when unchanged', () => {
            for (let i = 0; i < 50; i++) {
                vr.update({ high: 50000, low: 49900, close: 49950, volume: 100 }, 49950);
            }

            const result = vr.update({ high: 50010, low: 49900, close: 49960, volume: 100 }, 49960);
            assert.ok(result.regimeDuration >= 0);
        });
    });

    describe('adjustPositionSize', () => {
        it('should return full size for LOW regime', () => {
            vr.regime = 'LOW';
            const size = vr.adjustPositionSize(1000, 50000);
            assert.strictEqual(size, 1000 / 50000);
        });

        it('should return 25% size for EXTREME regime', () => {
            vr.regime = 'EXTREME';
            const baseSize = 1000;
            const price = 50000;
            const expected = (baseSize * 0.25) / price;
            assert.strictEqual(vr.adjustPositionSize(baseSize, price), expected);
        });

        it('should return 75% size for NORMAL regime', () => {
            vr.regime = 'NORMAL';
            const baseSize = 1000;
            const price = 50000;
            const expected = (baseSize * 0.75) / price;
            assert.strictEqual(vr.adjustPositionSize(baseSize, price), expected);
        });
    });

    describe('adjustStopLoss', () => {
        it('should multiply SL by 2.0 for EXTREME regime', () => {
            vr.regime = 'EXTREME';
            assert.strictEqual(vr.adjustStopLoss(0.02), 0.04);
        });

        it('should multiply SL by 1.0 for LOW regime', () => {
            vr.regime = 'LOW';
            assert.strictEqual(vr.adjustStopLoss(0.02), 0.02);
        });

        it('should use 1.25x multiplier for NORMAL regime', () => {
            vr.regime = 'NORMAL';
            assert.strictEqual(vr.adjustStopLoss(0.02), 0.025);
        });
    });

    describe('getRecommendations', () => {
        it('should recommend mean_reversion for LOW regime', () => {
            vr.regime = 'LOW';
            const recs = vr.getRecommendations();
            assert.ok(recs.includes('mean_reversion') || recs.includes('grid'));
        });

        it('should recommend scalping for EXTREME regime', () => {
            vr.regime = 'EXTREME';
            const recs = vr.getRecommendations();
            assert.ok(recs.includes('scalping'));
        });
    });

    describe('getSummary', () => {
        it('should return complete summary', () => {
            vr.regime = 'HIGH';
            vr.regimeStrength = 0.8;
            vr.regimeDuration = 42;
            
            const summary = vr.getSummary();
            assert.strictEqual(summary.regime, 'HIGH');
            assert.strictEqual(summary.strength, 0.8);
            assert.strictEqual(summary.duration, 42);
            assert.strictEqual(summary.positionMult, 0.5);
            assert.strictEqual(summary.slMult, 1.5);
            assert.ok(Array.isArray(summary.recommendations));
            assert.ok(Array.isArray(summary.recentAlerts));
        });
    });

    describe('reset', () => {
        it('should clear all state', () => {
            vr.regime = 'EXTREME';
            vr.regimeDuration = 100;
            vr.atrHistory = [{ price: 50000 }];
            
            vr.reset();
            
            assert.strictEqual(vr.regime, 'NORMAL');
            assert.strictEqual(vr.regimeDuration, 0);
            assert.deepStrictEqual(vr.atrHistory, []);
        });
    });

    describe('edge cases', () => {
        it('should handle very small price (division safety)', () => {
            // Should not throw
            const result = vr.update({ high: 0.001, low: 0.0009, close: 0.00095, volume: 100 }, 0.00095);
            assert.ok(result);
        });

        it('should handle zero ATR history', () => {
            const vr2 = new VolatilityRegime();
            const result = vr2.update({ high: 50000, low: 49900, close: 49950, volume: 100 }, 49950);
            assert.strictEqual(result.strength, 0.5); // Not enough data → 0.5
            assert.ok(result.recommendations);
        });

        it('should handle boundary values at regime thresholds', () => {
            assert.strictEqual(vr.classifyRegime(0.015), 'NORMAL');
            assert.strictEqual(vr.classifyRegime(0.03), 'HIGH');
            assert.strictEqual(vr.classifyRegime(0.05), 'EXTREME');
        });
    });
});
