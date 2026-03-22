/**
 * Monte Carlo Simulation - Risk Analysis for DQN Trading Bot
 *
 * Stress-tests trading strategies by simulating thousands of equity curves
 * from historical trade distributions. Computes VaR, CVaR, drawdown probabilities,
 * and worst-case scenarios.
 *
 * Autonomous feature added: 2026-03-22
 */

const fs = require('fs');
const path = require('path');

/**
 * Run Monte Carlo simulation from trade history
 * @param {Object} journal - TradeJournal instance
 * @param {Object} options - Simulation options
 * @returns {Object} - Simulation results
 */
function runSimulation(journal, options = {}) {
    const {
        numSimulations = 10000,
        initialCapital = 1000,
        tradesPerRun = 50,
        confidenceLevels = [0.95, 0.99]
    } = options;

    const stats = journal.getStats();
    const trades = journal.listTrades(1, 1000, {}).items.filter(t => t.exitPrice !== null);

    if (trades.length < 5) {
        return {
            error: 'Need at least 5 closed trades for Monte Carlo simulation',
            simulations: 0
        };
    }

    // Extract return distribution from closed trades
    const returns = trades.map(t => t.pnlPercent / 100);

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(
        returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    );

    // Bootstrap trade sequence simulation
    const equityCurves = [];
    const terminalEquities = [];
    const maxDrawdowns = [];
    const tradeCountWins = [];

    for (let sim = 0; sim < numSimulations; sim++) {
        let equity = initialCapital;
        let peak = initialCapital;
        let maxDD = 0;
        let wins = 0;

        for (let i = 0; i < tradesPerRun; i++) {
            // Randomly sample from historical trades (with replacement)
            const sampledReturn = returns[Math.floor(Math.random() * returns.length)];
            equity *= (1 + sampledReturn);

            peak = Math.max(peak, equity);
            const drawdown = (peak - equity) / peak;
            maxDD = Math.max(maxDD, drawdown);

            if (sampledReturn > 0) wins++;
        }

        equityCurves.push({ sim, equity, maxDrawdown: maxDD * 100, wins });
        terminalEquities.push(equity);
        maxDrawdowns.push(maxDD * 100);
        tradeCountWins.push(wins);
    }

    // Sort for percentile calculations
    terminalEquities.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    // Calculate percentiles (handles edge cases for small arrays)
    const percentile = (arr, p) => {
        if (arr.length === 0) return 0;
        if (arr.length === 1) return arr[0];
        const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(p * arr.length) - 1));
        return arr[idx];
    };

    const result = {
        simulations: numSimulations,
        tradesPerRun,
        initialCapital,

        // Terminal equity statistics
        terminalEquity: {
            mean: (terminalEquities.reduce((a, b) => a + b, 0) / numSimulations).toFixed(2),
            median: percentile(terminalEquities, 0.5).toFixed(2),
            min: Math.min(...terminalEquities).toFixed(2),
            max: Math.max(...terminalEquities).toFixed(2),
            std: Math.sqrt(
                terminalEquities.reduce((sum, e) => sum + Math.pow(e - (terminalEquities.reduce((a, b) => a + b, 0) / numSimulations), 2), 0) / numSimulations
            ).toFixed(2),
            p5: percentile(terminalEquities, 0.05).toFixed(2),
            p10: percentile(terminalEquities, 0.10).toFixed(2),
            p25: percentile(terminalEquities, 0.25).toFixed(2),
            p75: percentile(terminalEquities, 0.75).toFixed(2),
            p90: percentile(terminalEquities, 0.90).toFixed(2),
            p95: percentile(terminalEquities, 0.95).toFixed(2),
            p99: percentile(terminalEquities, 0.99).toFixed(2)
        },

        // Return statistics
        returnStats: {
            mean: (meanReturn * 100).toFixed(3),
            std: (stdReturn * 100).toFixed(3),
            historicalTrades: trades.length,
            historicalWinRate: stats.winRate
        },

        // Max drawdown statistics
        maxDrawdown: {
            mean: (maxDrawdowns.reduce((a, b) => a + b, 0) / numSimulations).toFixed(2),
            median: percentile(maxDrawdowns, 0.5).toFixed(2),
            p95: percentile(maxDrawdowns, 0.95).toFixed(2),
            p99: percentile(maxDrawdowns, 0.99).toFixed(2),
            worst: Math.max(...maxDrawdowns).toFixed(2)
        },

        // Probability of loss
        probabilityOfLoss: ((terminalEquities.filter(e => e < initialCapital).length / numSimulations) * 100).toFixed(1),

        // Value at Risk (VaR)
        var: {
           95: ((initialCapital - percentile(terminalEquities, 0.05)) / initialCapital * 100).toFixed(2),
            99: ((initialCapital - percentile(terminalEquities, 0.01)) / initialCapital * 100).toFixed(2)
        },

        // Conditional VaR (Expected Shortfall)
        cvar: {
            95: ((initialCapital - terminalEquities.slice(0, Math.floor(numSimulations * 0.05)).reduce((a, b) => a + b, 0) / Math.floor(numSimulations * 0.05)) / initialCapital * 100).toFixed(2),
            99: ((initialCapital - terminalEquities.slice(0, Math.floor(numSimulations * 0.01)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(numSimulations * 0.01))) / initialCapital * 100).toFixed(2)
        },

        // Probability of hitting specific drawdown thresholds
        drawdownProbabilities: {
            over5: ((maxDrawdowns.filter(d => d > 5).length / numSimulations) * 100).toFixed(1),
            over10: ((maxDrawdowns.filter(d => d > 10).length / numSimulations) * 100).toFixed(1),
            over20: ((maxDrawdowns.filter(d => d > 20).length / numSimulations) * 100).toFixed(1),
            over30: ((maxDrawdowns.filter(d => d > 30).length / numSimulations) * 100).toFixed(1)
        },

        // Win rate distribution
        avgWinRate: (tradeCountWins.reduce((a, b) => a + b, 0) / numSimulations / tradesPerRun * 100).toFixed(1),

        // Risk-adjusted return (Sharpe-like)
        riskAdjustedReturn: ((meanReturn / (stdReturn || 0.001)) * Math.sqrt(tradesPerRun)).toFixed(3),

        // Sample equity curves (first 100 for viz)
        sampleEquityCurves: equityCurves.slice(0, 100).map(e => ({
            sim: e.sim,
            equity: parseFloat(e.equity.toFixed(2)),
            maxDrawdown: parseFloat(e.maxDrawdown.toFixed(2))
        })),

        // Worst scenarios
        worstScenarios: equityCurves
            .sort((a, b) => a.equity - b.equity)
            .slice(0, 10)
            .map(e => ({
                sim: e.sim,
                finalEquity: parseFloat(e.equity.toFixed(2)),
                returnPct: parseFloat(((e.equity / initialCapital - 1) * 100).toFixed(2)),
                maxDrawdown: parseFloat(e.maxDrawdown.toFixed(2)),
                wins: e.wins
            })),

        generatedAt: new Date().toISOString()
    };

    return result;
}

/**
 * Run simulation from raw trade data array
 * @param {Array} trades - Array of {pnlPercent} objects
 * @param {Object} options
 */
function runFromTradeData(trades, options = {}) {
    // Build a minimal journal-like interface
    const fakeJournal = {
        listTrades: (page, limit) => ({
            items: trades.filter(t => t.exitPrice !== null || t.pnlPercent !== undefined)
        }),
        getStats: () => ({ winRate: 0 })
    };

    // Extract pnlPercent if not present
    const normalizedTrades = trades.map(t => ({
        pnlPercent: t.pnlPercent !== undefined ? t.pnlPercent : (t.pnl ? t.pnl : 0),
        exitPrice: t.exitPrice || null
    }));

    return runSimulation(
        {
            listTrades: () => ({ items: normalizedTrades }),
            getStats: () => {
                const wins = normalizedTrades.filter(t => t.pnlPercent > 0).length;
                return { winRate: normalizedTrades.length > 0 ? (wins / normalizedTrades.length * 100).toFixed(1) : 0 };
            }
        },
        options
    );
}

/**
 * Save simulation results to file
 */
function saveResults(result, filepath = null) {
    filepath = filepath || path.join(__dirname, '..', 'monte-carlo-results.json');
    try {
        fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
        return filepath;
    } catch (e) {
        console.error('[MonteCarlo] Save failed:', e.message);
        return null;
    }
}

/**
 * Format results as readable summary
 */
function formatSummary(result) {
    if (result.error) return `❌ ${result.error}`;

    return `
📊 Monte Carlo Risk Analysis
═══════════════════════════════
Simulations: ${result.simulations.toLocaleString()} | Trades/run: ${result.tradesPerRun} | Capital: $${result.initialCapital}

📈 Terminal Equity
  Mean:   $${result.terminalEquity.mean}
  Median: $${result.terminalEquity.median}
  Std:    $${result.terminalEquity.std}
  Range:  $${result.terminalEquity.min} → $${result.terminalEquity.max}

  Percentiles:
    5%:  $${result.terminalEquity.p5}
    10%: $${result.terminalEquity.p10}
    25%: $${result.terminalEquity.p25}
    75%: $${result.terminalEquity.p75}
    90%: $${result.terminalEquity.p90}
    95%: $${result.terminalEquity.p95}
    99%: $${result.terminalEquity.p99}

⚠️ Risk Metrics
  VaR (95%):   ${result.var[95]}% (expected max loss at 95% confidence)
  VaR (99%):   ${result.var[99]}% (expected max loss at 99% confidence)
  CVaR (95%):  ${result.cvar[95]}% (expected loss in worst 5% cases)
  CVaR (99%):  ${result.cvar[99]}% (expected loss in worst 1% cases)
  Prob of Loss: ${result.probabilityOfLoss}%

📉 Drawdown Analysis
  Mean DD:    ${result.maxDrawdown.mean}%
  Median DD:  ${result.maxDrawdown.median}%
  95th pct:   ${result.maxDrawdown.p95}%
  99th pct:   ${result.maxDrawdown.p99}%
  Worst:      ${result.maxDrawdown.worst}%

  Drawdown Probabilities:
    >5%:  ${result.drawdownProbabilities.over5}%
    >10%: ${result.drawdownProbabilities.over10}%
    >20%: ${result.drawdownProbabilities.over20}%
    >30%: ${result.drawdownProbabilities.over30}%

🎯 Win Rate (simulated): ${result.avgWinRate}%
   Historical: ${result.returnStats.historicalTrades} trades, WR ${result.returnStats.historicalWinRate}%

⚡ Risk-Adjusted Return: ${result.riskAdjustedReturn}

🚨 Worst Scenarios:
${result.worstScenarios.map(s =>
    `  Sim #${s.sim}: $${s.finalEquity} (${s.returnPct > 0 ? '+' : ''}${s.returnPct}%) | DD: ${s.maxDrawdown}% | ${s.wins}/${result.tradesPerRun} wins`
).join('\n')}

Generated: ${result.generatedAt}
`.trim();
}

module.exports = {
    runSimulation,
    runFromTradeData,
    saveResults,
    formatSummary
};
