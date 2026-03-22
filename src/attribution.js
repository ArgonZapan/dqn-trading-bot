/**
 * Portfolio Performance Attribution
 * 
 * Breaks down P&L by:
 * - Strategy (trend, mean_reversion, momentum, scalping, grid, macd)
 * - Asset (BTC, ETH, SOL)
 * - Direction (LONG, SHORT)
 * - Time period (daily breakdown)
 * 
 * Useful for understanding what's actually driving returns.
 * 
 * Autonomous feature added: 2026-03-22
 */

const tradeJournal = require('./tradeJournal');

/**
 * Calculate attribution from trade journal
 */
function calculateAttribution(options = {}) {
    const {
        startDate = null,
        endDate = null,
        minTrades = 1
    } = options;

    const filter = {};
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;

    const allTrades = tradeJournal.listTrades(1, 10000, filter).items;
    const closedTrades = allTrades.filter(t => t.exitPrice !== null);

    if (closedTrades.length < minTrades) {
        return { error: `Need at least ${minTrades} trades for attribution analysis`, trades: 0 };
    }

    // ─── By Strategy ───────────────────────────────────────────
    const strategies = [...new Set(closedTrades.map(t => t.strategy || 'unknown'))];
    const byStrategy = {};
    
    for (const strat of strategies) {
        const stratTrades = closedTrades.filter(t => (t.strategy || 'unknown') === strat);
        const wins = stratTrades.filter(t => t.pnlPercent > 0);
        const losses = stratTrades.filter(t => t.pnlPercent <= 0);
        const totalPnl = stratTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
        const totalAbsPnl = stratTrades.reduce((sum, t) => sum + Math.abs(t.pnlPercent || 0), 0);
        
        byStrategy[strat] = {
            trades: stratTrades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: stratTrades.length > 0 ? (wins.length / stratTrades.length * 100).toFixed(1) : 0,
            totalPnl: totalPnl.toFixed(2),
            avgPnl: stratTrades.length > 0 ? (totalPnl / stratTrades.length).toFixed(3) : 0,
            avgWin: wins.length > 0 ? (wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length).toFixed(2) : 0,
            avgLoss: losses.length > 0 ? (losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length).toFixed(2) : 0,
            profitFactor: Math.abs(totalPnl > 0 ? totalPnl / (totalAbsPnl - totalPnl || 1) : 0).toFixed(2),
            largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnlPercent)).toFixed(2) : 0,
            largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnlPercent)).toFixed(2) : 0,
            avgDuration: stratTrades.filter(t => t.exitTime).length > 0
                ? (stratTrades.filter(t => t.exitTime)
                    .reduce((sum, t) => sum + (new Date(t.exitTime) - new Date(t.entryTime)) / 1000 / 60, 0) 
                    / stratTrades.filter(t => t.exitTime).length).toFixed(1)
                : 0,
            totalPnlAbs: Math.abs(totalPnl).toFixed(2),
            pnlContribution: 0 // filled below
        };
    }

    // P&L contribution % per strategy
    const totalPnlAll = closedTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
    for (const strat of Object.keys(byStrategy)) {
        byStrategy[strat].pnlContribution = totalPnlAll !== 0
            ? ((parseFloat(byStrategy[strat].totalPnl) / totalPnlAll) * 100).toFixed(1)
            : 0;
    }

    // ─── By Asset ──────────────────────────────────────────────
    const assets = [...new Set(closedTrades.map(t => t.symbol || 'BTCUSDT'))];
    const byAsset = {};

    for (const asset of assets) {
        const assetTrades = closedTrades.filter(t => (t.symbol || 'BTCUSDT') === asset);
        const wins = assetTrades.filter(t => t.pnlPercent > 0);
        const totalPnl = assetTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
        
        byAsset[asset] = {
            trades: assetTrades.length,
            wins: wins.length,
            winRate: assetTrades.length > 0 ? (wins.length / assetTrades.length * 100).toFixed(1) : 0,
            totalPnl: totalPnl.toFixed(2),
            avgPnl: assetTrades.length > 0 ? (totalPnl / assetTrades.length).toFixed(3) : 0,
            pnlContribution: totalPnlAll !== 0 ? ((totalPnl / totalPnlAll) * 100).toFixed(1) : 0
        };
    }

    // ─── By Direction ──────────────────────────────────────────
    const directions = [...new Set(closedTrades.map(t => t.direction || 'LONG'))];
    const byDirection = {};

    for (const dir of directions) {
        const dirTrades = closedTrades.filter(t => (t.direction || 'LONG') === dir);
        const wins = dirTrades.filter(t => t.pnlPercent > 0);
        const totalPnl = dirTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
        
        byDirection[dir] = {
            trades: dirTrades.length,
            wins: wins.length,
            winRate: dirTrades.length > 0 ? (wins.length / dirTrades.length * 100).toFixed(1) : 0,
            totalPnl: totalPnl.toFixed(2),
            avgPnl: dirTrades.length > 0 ? (totalPnl / dirTrades.length).toFixed(3) : 0,
            pnlContribution: totalPnlAll !== 0 ? ((totalPnl / totalPnlAll) * 100).toFixed(1) : 0
        };
    }

    // ─── By Day ────────────────────────────────────────────────
    const byDay = {};
    for (const trade of closedTrades) {
        if (!trade.exitTime) continue;
        const day = trade.exitTime.split('T')[0];
        if (!byDay[day]) {
            byDay[day] = { trades: 0, pnl: 0, wins: 0, losses: 0 };
        }
        byDay[day].trades++;
        byDay[day].pnl += trade.pnlPercent || 0;
        if (trade.pnlPercent > 0) byDay[day].wins++;
        else byDay[day].losses++;
    }

    const dailyBreakdown = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, data]) => ({
            day,
            trades: data.trades,
            pnl: data.pnl.toFixed(2),
            wins: data.wins,
            losses: data.losses,
            winRate: data.trades > 0 ? (data.wins / data.trades * 100).toFixed(0) : 0,
            isPositive: data.pnl >= 0
        }));

    // ─── By Exit Reason ───────────────────────────────────────
    const exitReasons = [...new Set(closedTrades.map(t => t.exitReason || 'unknown'))];
    const byExitReason = {};

    for (const reason of exitReasons) {
        const reasonTrades = closedTrades.filter(t => (t.exitReason || 'unknown') === reason);
        const wins = reasonTrades.filter(t => t.pnlPercent > 0);
        const totalPnl = reasonTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
        
        byExitReason[reason] = {
            trades: reasonTrades.length,
            wins: wins.length,
            winRate: reasonTrades.length > 0 ? (wins.length / reasonTrades.length * 100).toFixed(1) : 0,
            totalPnl: totalPnl.toFixed(2),
            avgPnl: reasonTrades.length > 0 ? (totalPnl / reasonTrades.length).toFixed(3) : 0,
            pnlContribution: totalPnlAll !== 0 ? ((totalPnl / totalPnlAll) * 100).toFixed(1) : 0
        };
    }

    // ─── Best & Worst ─────────────────────────────────────────
    const sorted = [...closedTrades].sort((a, b) => b.pnlPercent - a.pnlPercent);
    const bestTrade = sorted.length > 0 ? {
        pnlPercent: sorted[0].pnlPercent.toFixed(2),
        strategy: sorted[0].strategy,
        direction: sorted[0].direction,
        entryTime: sorted[0].entryTime
    } : null;
    const worstTrade = sorted.length > 0 ? {
        pnlPercent: sorted[sorted.length - 1].pnlPercent.toFixed(2),
        strategy: sorted[sorted.length - 1].strategy,
        direction: sorted[sorted.length - 1].direction,
        entryTime: sorted[sorted.length - 1].entryTime
    } : null;

    // ─── Consecutive Wins/Losses Streaks ───────────────────────
    let currentStreak = 0;
    let bestWinStreak = 0;
    let bestLossStreak = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    const sortedByTime = [...closedTrades].sort((a, b) => 
        new Date(a.exitTime || a.entryTime) - new Date(b.exitTime || b.entryTime)
    );

    for (const trade of sortedByTime) {
        if (trade.pnlPercent > 0) {
            tempWinStreak++;
            tempLossStreak = 0;
            bestWinStreak = Math.max(bestWinStreak, tempWinStreak);
        } else {
            tempLossStreak++;
            tempWinStreak = 0;
            bestLossStreak = Math.max(bestLossStreak, tempLossStreak);
        }
    }

    return {
        summary: {
            totalTrades: closedTrades.length,
            totalPnl: totalPnlAll.toFixed(2),
            avgPnl: closedTrades.length > 0 ? (totalPnlAll / closedTrades.length).toFixed(3) : 0,
            winRate: closedTrades.length > 0 ? (closedTrades.filter(t => t.pnlPercent > 0).length / closedTrades.length * 100).toFixed(1) : 0,
            bestWinStreak,
            worstLossStreak: bestLossStreak,
            profitFactor: calculateProfitFactor(closedTrades),
            tradingDays: Object.keys(byDay).length,
            dateRange: {
                start: closedTrades.length > 0 ? closedTrades.reduce((min, t) => 
                    t.entryTime < min ? t.entryTime : min, closedTrades[0].entryTime) : null,
                end: closedTrades.length > 0 ? closedTrades.reduce((max, t) => 
                    t.exitTime && t.exitTime > max ? t.exitTime : max, closedTrades[0].exitTime || '') : null
            }
        },
        byStrategy,
        byAsset,
        byDirection,
        byExitReason,
        dailyBreakdown: dailyBreakdown.slice(-30), // Last 30 days
        bestTrade,
        worstTrade,
        generatedAt: new Date().toISOString()
    };
}

function calculateProfitFactor(trades) {
    const wins = trades.filter(t => t.pnlPercent > 0).reduce((sum, t) => sum + t.pnlPercent, 0);
    const losses = Math.abs(trades.filter(t => t.pnlPercent <= 0).reduce((sum, t) => sum + t.pnlPercent, 0));
    return losses > 0 ? (wins / losses).toFixed(2) : wins > 0 ? '∞' : '0';
}

/**
 * Format attribution as readable text
 */
function formatAttribution(attr) {
    if (attr.error) return `❌ ${attr.error}`;

    const s = attr.summary;
    let text = `📊 Performance Attribution\n${'═'.repeat(40)}\n`;
    text += `Trades: ${s.totalTrades} | P&L: ${s.totalPnl}% | Win Rate: ${s.winRate}%\n`;
    text += `Days: ${s.tradingDays} | Profit Factor: ${s.profitFactor}\n`;
    text += `${'─'.repeat(40)}\n`;
    text += `📈 BY STRATEGY\n`;
    text += `${'─'.repeat(40)}\n`;
    
    const sortedStrats = Object.entries(attr.byStrategy)
        .sort(([,a], [,b]) => parseFloat(b.totalPnl) - parseFloat(a.totalPnl));
    
    for (const [strat, data] of sortedStrats) {
        const sign = parseFloat(data.totalPnl) >= 0 ? '+' : '';
        const contrib = data.pnlContribution > 0 ? ` (${data.pnlContribution}%)` : '';
        text += `  ${strat.padEnd(15)} ${data.trades}tr ${sign}${data.totalPnl}% WR${data.winRate}% ${contrib}\n`;
    }
    
    if (Object.keys(attr.byAsset).length > 1) {
        text += `${'─'.repeat(40)}\n`;
        text += `💰 BY ASSET\n`;
        text += `${'─'.repeat(40)}\n`;
        for (const [asset, data] of Object.entries(attr.byAsset)) {
            const sign = parseFloat(data.totalPnl) >= 0 ? '+' : '';
            text += `  ${asset.padEnd(10)} ${data.trades}tr ${sign}${data.totalPnl}%\n`;
        }
    }
    
    if (attr.bestTrade) {
        text += `${'─'.repeat(40)}\n`;
        text += `🏆 Best: ${attr.bestTrade.pnlPercent}% (${attr.bestTrade.strategy})\n`;
        text += `💀 Worst: ${attr.worstTrade.pnlPercent}% (${attr.worstTrade.strategy})\n`;
    }
    
    return text;
}

module.exports = { calculateAttribution, formatAttribution };
