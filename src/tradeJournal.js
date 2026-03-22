/**
 * Trade Journal - Track all trades with detailed analytics
 * Persists to JSON file for restart resilience
 */

const fs = require('fs');
const path = require('path');

const JOURNAL_FILE = path.join(__dirname, '..', 'trade-journal.json');

class TradeJournal {
    constructor() {
        this.trades = [];
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(JOURNAL_FILE)) {
                const data = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
                this.trades = data.trades || [];
            }
        } catch (e) {
            console.log('[TradeJournal] No existing journal found, starting fresh');
            this.trades = [];
        }
    }

    save() {
        try {
            fs.writeFileSync(JOURNAL_FILE, JSON.stringify({ trades: this.trades, lastUpdate: new Date().toISOString() }, null, 2));
        } catch (e) {
            console.error('[TradeJournal] Save failed:', e.message);
        }
    }

    // Record a new trade
    addTrade(trade) {
        const entry = {
            id: this.trades.length + 1,
            entryTime: trade.entryTime || new Date().toISOString(),
            exitTime: trade.exitTime || null,
            symbol: trade.symbol || 'BTCUSDT',
            direction: trade.direction || 'LONG', // LONG or SHORT
            strategy: trade.strategy || 'unknown',
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice || null,
            quantity: trade.quantity || 0,
            pnlPercent: trade.pnlPercent || 0,
            pnlAbsolute: trade.pnlAbsolute || 0,
            commission: trade.commission || 0,
            holdingBars: trade.holdingBars || 0,
            exitReason: trade.exitReason || 'unknown', // SL, TP, SIGNAL, STOP_LOSS, TAKE_PROFIT, EMERGENCY
            episode: trade.episode || 0,
            isPaper: trade.isPaper !== undefined ? trade.isPaper : true,
            maxDrawdown: trade.maxDrawdown || 0,
            timestamp: Date.now()
        };

        this.trades.push(entry);
        this.save();
        return entry;
    }

    // Update an open trade (close it)
    closeTrade(tradeId, exitPrice, exitReason, exitTime) {
        const trade = this.trades.find(t => t.id === tradeId);
        if (trade) {
            trade.exitPrice = exitPrice;
            trade.exitTime = exitTime || new Date().toISOString();
            trade.exitReason = exitReason;
            
            if (trade.direction === 'LONG') {
                trade.pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
            } else {
                trade.pnlPercent = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
            }
            trade.pnlAbsolute = (trade.pnlPercent / 100) * trade.quantity * trade.entryPrice;
            trade.holdingBars = trade.holdingBars || 0;
            this.save();
        }
        return trade;
    }

    // Get aggregated stats
    getStats(filter = {}) {
        let filtered = [...this.trades];
        
        if (filter.strategy) filtered = filtered.filter(t => t.strategy === filter.strategy);
        if (filter.direction) filtered = filtered.filter(t => t.direction === filter.direction);
        if (filter.isPaper !== undefined) filtered = filtered.filter(t => t.isPaper === filter.isPaper);
        if (filter.episode) filtered = filtered.filter(t => t.episode === filter.episode);
        if (filter.startDate) filtered = filtered.filter(t => new Date(t.entryTime) >= new Date(filter.startDate));
        if (filter.endDate) filtered = filtered.filter(t => new Date(t.entryTime) <= new Date(filter.endDate));

        const closedTrades = filtered.filter(t => t.exitPrice !== null);
        const winningTrades = closedTrades.filter(t => t.pnlPercent > 0);
        const losingTrades = closedTrades.filter(t => t.pnlPercent <= 0);

        const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnlPercent || 0), 0);
        const totalCommission = closedTrades.reduce((sum, t) => sum + (t.commission || 0), 0);

        // Win rate by strategy
        const strategies = [...new Set(filtered.map(t => t.strategy))];
        const winRateByStrategy = {};
        strategies.forEach(s => {
            const sTrades = closedTrades.filter(t => t.strategy === s);
            const sWins = sTrades.filter(t => t.pnlPercent > 0).length;
            winRateByStrategy[s] = sTrades.length > 0 ? (sWins / sTrades.length * 100).toFixed(1) : 0;
        });

        // Duration stats
        const durations = closedTrades
            .filter(t => t.exitTime)
            .map(t => (new Date(t.exitTime) - new Date(t.entryTime)) / 1000 / 60); // minutes

        // Best and worst
        const sorted = [...closedTrades].sort((a, b) => b.pnlPercent - a.pnlPercent);

        return {
            totalTrades: closedTrades.length,
            openTrades: filtered.filter(t => t.exitPrice === null).length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length * 100).toFixed(2) : 0,
            avgPnl: closedTrades.length > 0 ? (totalPnl / closedTrades.length).toFixed(3) : 0,
            totalPnl: totalPnl.toFixed(2),
            totalCommission: totalCommission.toFixed(2),
            avgDuration: durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : 0,
            avgWin: winningTrades.length > 0 ? (winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length).toFixed(2) : 0,
            avgLoss: losingTrades.length > 0 ? (losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / losingTrades.length).toFixed(2) : 0,
            bestTrade: sorted.length > 0 ? { pnlPercent: sorted[0].pnlPercent, strategy: sorted[0].strategy, date: sorted[0].entryTime } : null,
            worstTrade: sorted.length > 0 ? { pnlPercent: sorted[sorted.length - 1].pnlPercent, strategy: sorted[sorted.length - 1].strategy, date: sorted[sorted.length - 1].entryTime } : null,
            winRateByStrategy,
            profitFactor: Math.abs(winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / (losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0) || 1)).toFixed(2),
            tradingDays: new Set(closedTrades.map(t => t.entryTime.split('T')[0])).size
        };
    }

    // List trades with pagination
    listTrades(page = 1, limit = 20, filter = {}) {
        let filtered = [...this.trades].sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
        
        if (filter.strategy) filtered = filtered.filter(t => t.strategy === filter.strategy);
        if (filter.direction) filtered = filtered.filter(t => t.direction === filter.direction);
        if (filter.isPaper !== undefined) filtered = filtered.filter(t => t.isPaper === filter.isPaper);
        if (filter.minPnl) filtered = filtered.filter(t => t.pnlPercent >= filter.minPnl);
        if (filter.maxPnl) filtered = filtered.filter(t => t.pnlPercent <= filter.maxPnl);

        const total = filtered.length;
        const start = (page - 1) * limit;
        const items = filtered.slice(start, start + limit).map(t => ({
            id: t.id,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            symbol: t.symbol,
            direction: t.direction,
            strategy: t.strategy,
            entryPrice: t.entryPrice ? parseFloat(t.entryPrice.toFixed(2)) : 0,
            exitPrice: t.exitPrice ? parseFloat(t.exitPrice.toFixed(2)) : null,
            pnlPercent: t.pnlPercent ? parseFloat(t.pnlPercent.toFixed(2)) : 0,
            pnlAbsolute: t.pnlAbsolute ? parseFloat(t.pnlAbsolute.toFixed(2)) : 0,
            commission: t.commission || 0,
            holdingBars: t.holdingBars || 0,
            exitReason: t.exitReason,
            isPaper: t.isPaper
        }));

        return { items, total, page, limit, pages: Math.ceil(total / limit) };
    }

    // Export all trades to CSV file
    exportToCsv(exportDir = '.') {
        const fs = require('fs');
        const fileName = `trade-journal-${Date.now()}.csv`;
        const filePath = path.join(exportDir, fileName);

        const headers = ['id', 'entryTime', 'exitTime', 'symbol', 'direction', 'strategy',
                         'entryPrice', 'exitPrice', 'quantity', 'pnlPercent', 'pnlAbsolute',
                         'commission', 'holdingBars', 'exitReason', 'episode', 'isPaper', 'maxDrawdown'];

        const rows = this.trades.map(t => [
            t.id,
            t.entryTime || '',
            t.exitTime || '',
            t.symbol || 'BTCUSDT',
            t.direction || 'LONG',
            t.strategy || 'unknown',
            t.entryPrice || 0,
            t.exitPrice || '',
            t.quantity || 0,
            (t.pnlPercent || 0).toFixed(3),
            (t.pnlAbsolute || 0).toFixed(2),
            (t.commission || 0).toFixed(4),
            t.holdingBars || 0,
            t.exitReason || '',
            t.episode || 0,
            t.isPaper !== undefined ? t.isPaper : true,
            (t.maxDrawdown || 0).toFixed(2)
        ].join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        fs.writeFileSync(filePath, csv, 'utf8');
        console.log(`[TradeJournal] Exported ${this.trades.length} trades to ${filePath}`);
        return filePath;
    }
}

// Export both named (class) and default (instance)
const journal = new TradeJournal();
module.exports = journal;
module.exports.TradeJournal = TradeJournal;
module.exports.exportJournal = (exportDir) => journal.exportToCsv(exportDir);
