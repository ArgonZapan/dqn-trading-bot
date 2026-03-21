/**
 * Portfolio Tracker - Track holdings and P&L
 */

class Portfolio {
    constructor(initialBalance = 1000) {
        this.initial = initialBalance;
        this.cash = initialBalance;
        this.positions = {};
        this.trades = [];
        this.history = [];
    }

    buy(symbol, price, quantity, fee = 0.001) {
        const cost = price * quantity * (1 + fee);
        if (cost > this.cash) return false;
        
        this.cash -= cost;
        this.positions[symbol] = (this.positions[symbol] || 0) + quantity;
        this.trades.push({ time: Date.now(), action: 'BUY', symbol, price, quantity, cost, fee: price * quantity * fee });
        this.history.push({ time: Date.now(), type: 'BUY', symbol, price, quantity });
        return true;
    }

    sell(symbol, price, quantity, fee = 0.001) {
        if (!this.positions[symbol] || this.positions[symbol] < quantity) return false;
        
        const revenue = price * quantity * (1 - fee);
        this.cash += revenue;
        this.positions[symbol] -= quantity;
        if (this.positions[symbol] === 0) delete this.positions[symbol];
        
        this.trades.push({ time: Date.now(), action: 'SELL', symbol, price, quantity, revenue, fee: price * quantity * fee });
        this.history.push({ time: Date.now(), type: 'SELL', symbol, price, quantity });
        return true;
    }

    holdings(symbol) {
        return this.positions[symbol] || 0;
    }

    balance() {
        return this.cash;
    }

    equity(prices) {
        let equity = this.cash;
        for (const [sym, qty] of Object.entries(this.positions)) {
            equity += (prices[sym] || 0) * qty;
        }
        return equity;
    }

    pnl(currentPrices) {
        return this.equity(currentPrices) - this.initial;
    }

    pnlPercent(currentPrices) {
        return (this.pnl(currentPrices) / this.initial * 100;
    }

    winRate() {
        if (this.trades.length === 0) return 0;
        const sells = this.trades.filter(t => t.action === 'SELL');
        if (sells.length === 0) return 0;
        const wins = sells.filter(t => t.revenue > t.cost);
        return wins.length / sells.length * 100;
    }

    tradesCount() {
        return this.trades.length;
    }

    reset() {
        this.cash = this.initial;
        this.positions = {};
        this.trades = [];
        this.history = [];
    }
}

module.exports = Portfolio;
