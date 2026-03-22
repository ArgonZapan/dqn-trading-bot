/**
 * Monte Carlo Simulation - Unit Tests
 */

const assert = require('assert');
const { runFromTradeData, formatSummary } = require('../src/monteCarlo');

describe('Monte Carlo Simulation', () => {

    it('should return error for insufficient trades', () => {
        const result = runFromTradeData([
            { pnlPercent: 1.5, exitPrice: 100 },
            { pnlPercent: -0.5, exitPrice: 99 }
        ]);
        assert.ok(result.error);
    });

    it('should run simulation with 10+ trades', () => {
        const trades = [
            { pnlPercent: 2.5, exitPrice: 102.5 },
            { pnlPercent: -1.2, exitPrice: 98.8 },
            { pnlPercent: 3.1, exitPrice: 103.1 },
            { pnlPercent: 0.8, exitPrice: 100.8 },
            { pnlPercent: -2.0, exitPrice: 98.0 },
            { pnlPercent: 1.5, exitPrice: 101.5 },
            { pnlPercent: 4.2, exitPrice: 104.2 },
            { pnlPercent: -0.7, exitPrice: 99.3 },
            { pnlPercent: 2.0, exitPrice: 102.0 },
            { pnlPercent: 1.0, exitPrice: 101.0 }
        ];
        const result = runFromTradeData(trades, { numSimulations: 1000, tradesPerRun: 10 });
        assert.ok(!result.error);
        assert.equal(result.simulations, 1000);
        assert.equal(result.tradesPerRun, 10);
        assert.ok(result.terminalEquity);
        assert.ok(result.maxDrawdown);
        assert.ok(result.var);
        assert.ok(result.probabilityOfLoss !== undefined);
    });

    it('should calculate correct percentile rankings', () => {
        const trades = [
            { pnlPercent: 5, exitPrice: 105 },
            { pnlPercent: 3, exitPrice: 103 },
            { pnlPercent: -2, exitPrice: 98 },
            { pnlPercent: 1, exitPrice: 101 },
            { pnlPercent: 4, exitPrice: 104 },
            { pnlPercent: -1, exitPrice: 99 },
            { pnlPercent: 2, exitPrice: 102 }
        ];
        const result = runFromTradeData(trades, { numSimulations: 500, tradesPerRun: 20 });
        // Median should be roughly around mean
        assert.ok(parseFloat(result.terminalEquity.median) >= 0);
        assert.ok(result.terminalEquity.p5 <= result.terminalEquity.p95, 'p5 should be <= p95');
        assert.ok(result.terminalEquity.p10 <= result.terminalEquity.p90, 'p10 should be <= p90');
    });

    it('should compute VaR and CVaR correctly', () => {
        const trades = [
            { pnlPercent: 10, exitPrice: 110 },
            { pnlPercent: -5, exitPrice: 95 },
            { pnlPercent: 8, exitPrice: 108 },
            { pnlPercent: 3, exitPrice: 103 },
            { pnlPercent: -2, exitPrice: 98 },
            { pnlPercent: 6, exitPrice: 106 },
            { pnlPercent: -8, exitPrice: 92 },
            { pnlPercent: 4, exitPrice: 104 },
            { pnlPercent: 2, exitPrice: 102 },
            { pnlPercent: -3, exitPrice: 97 }
        ];
        const result = runFromTradeData(trades, { numSimulations: 1000, tradesPerRun: 20 });
        assert.ok(result.var[95] !== undefined);
        assert.ok(result.cvar[95] !== undefined);
        // VaR 99% should be >= VaR 95%
        assert.ok(parseFloat(result.var[99]) >= parseFloat(result.var[95]));
    });

    it('should format summary without errors', () => {
        const trades = Array.from({ length: 15 }, (_, i) => ({
            pnlPercent: (Math.random() - 0.4) * 10,
            exitPrice: 100 + (Math.random() - 0.4) * 10
        }));
        const result = runFromTradeData(trades, { numSimulations: 100 });
        const summary = formatSummary(result);
        assert.ok(summary.includes('Monte Carlo'));
        assert.ok(summary.includes('Simulations:'));
    });

    it('should handle all-winning or all-losing trades', () => {
        const winningTrades = Array.from({ length: 10 }, () => ({
            pnlPercent: 2, exitPrice: 102
        }));
        const result = runFromTradeData(winningTrades, { numSimulations: 100 });
        assert.equal(result.probabilityOfLoss, '0.0');

        const losingTrades = Array.from({ length: 10 }, () => ({
            pnlPercent: -2, exitPrice: 98
        }));
        const result2 = runFromTradeData(losingTrades, { numSimulations: 100 });
        assert.equal(result2.probabilityOfLoss, '100.0');
    });

    it('should compute drawdown probabilities correctly', () => {
        const trades = Array.from({ length: 20 }, () => ({
            pnlPercent: (Math.random() - 0.5) * 10,
            exitPrice: 100
        }));
        const result = runFromTradeData(trades, { numSimulations: 500 });
        assert.ok(result.drawdownProbabilities);
        assert.ok(result.drawdownProbabilities.over5 !== undefined);
        assert.ok(result.drawdownProbabilities.over10 !== undefined);
    });
});
