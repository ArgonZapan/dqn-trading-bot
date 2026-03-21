"use strict";
/**
 * MetricsCalculator - Portfolio performance metrics
 * Computes Sharpe ratio, max drawdown, win rate, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMetrics = calculateMetrics;
exports.formatMetrics = formatMetrics;
function calculateMetrics(trades, initialCapital = 1000, riskFreeRate = 0.02 // 2% annual
) {
    if (trades.length === 0) {
        return {
            totalTrades: 0, winningTrades: 0, losingTrades: 0,
            winRate: 0, totalPnl: 0, totalPnlPercent: 0,
            maxDrawdown: 0, maxDrawdownPercent: 0, sharpeRatio: 0,
            avgWin: 0, avgLoss: 0, profitFactor: 0,
            avgTradePnl: 0, bestTrade: 0, worstTrade: 0,
            equityCurve: [initialCapital]
        };
    }
    // Build equity curve from trades
    let equity = initialCapital;
    const equityCurve = [equity];
    const tradePnls = [];
    let wins = 0, losses = 0;
    let totalWin = 0, totalLoss = 0;
    let bestTrade = 0, worstTrade = 0;
    for (const trade of trades) {
        const pnl = trade.pnl || 0;
        equity += pnl;
        equityCurve.push(equity);
        tradePnls.push(pnl);
        if (pnl > 0) {
            wins++;
            totalWin += pnl;
        }
        else {
            losses++;
            totalLoss += Math.abs(pnl);
        }
        if (pnl > bestTrade)
            bestTrade = pnl;
        if (pnl < worstTrade)
            worstTrade = pnl;
    }
    const totalTrades = trades.length;
    const winningTrades = wins;
    const losingTrades = losses;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const totalPnl = equity - initialCapital;
    const totalPnlPercent = (totalPnl / initialCapital) * 100;
    const avgWin = wins > 0 ? totalWin / wins : 0;
    const avgLoss = losses > 0 ? totalLoss / losses : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;
    const avgTradePnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
    // Max drawdown
    let peak = initialCapital;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    for (const eq of equityCurve) {
        if (eq > peak)
            peak = eq;
        const dd = peak - eq;
        const ddPercent = peak > 0 ? (dd / peak) * 100 : 0;
        if (dd > maxDrawdown) {
            maxDrawdown = dd;
            maxDrawdownPercent = ddPercent;
        }
    }
    // Sharpe ratio (simplified: based on trade PnLs, annualized)
    // Assuming ~105120 5-min candles per year (5min * 60 * 24 * 365)
    // With ~500 candles per backtest, scale returns accordingly
    const returns = tradePnls.map(p => p / initialCapital);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
    // Annualize: scale by sqrt(252 trading days) if using daily data, or proper scaling for 5min
    // For 5-min candles with 500 candles: ~4.17 days of data
    // Sharpe = (avgReturn - riskFreeRate/252) / stdReturn * sqrt(252)
    const annualizationFactor = Math.sqrt(252); // daily trading days
    const sharpeRatio = stdReturn > 0
        ? ((avgReturn - riskFreeRate / 252) / stdReturn) * annualizationFactor
        : 0;
    return {
        totalTrades, winningTrades, losingTrades,
        winRate, totalPnl, totalPnlPercent,
        maxDrawdown, maxDrawdownPercent, sharpeRatio,
        avgWin, avgLoss, profitFactor,
        avgTradePnl, bestTrade, worstTrade,
        equityCurve
    };
}
function formatMetrics(m) {
    const lines = [
        `📊 <b>Portfolio Metrics</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `💰 P&L: ${m.totalPnl >= 0 ? '+' : ''}$${m.totalPnl.toFixed(2)} (${m.totalPnlPercent >= 0 ? '+' : ''}${m.totalPnlPercent.toFixed(2)}%)`,
        `📉 Max DD: $${m.maxDrawdown.toFixed(2)} (${m.maxDrawdownPercent.toFixed(2)}%)`,
        `📈 Sharpe: ${m.sharpeRatio.toFixed(2)}`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Trades: ${m.totalTrades} | Win: ${m.winRate >= 0 ? '+' : ''}${(m.winRate * 100).toFixed(1)}%`,
        `Avg Trade: $${m.avgTradePnl.toFixed(2)} | PF: ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`,
        `Best: $${m.bestTrade.toFixed(2)} | Worst: $${m.worstTrade.toFixed(2)}`,
        `Avg Win: $${m.avgWin.toFixed(2)} | Avg Loss: $${m.avgLoss.toFixed(2)}`,
    ];
    return lines.join('\n');
}
