/**
 * Paper Trading Engine
 * Simulates real trading with order book, spread, slippage
 */

class PaperTrading {
    constructor(initialBalance = 1000) {
        this.balance = initialBalance;
        this.initialBalance = initialBalance;
        this.position = null; // { side: 'LONG'|'SHORT', entryPrice, quantity, entryTime }
        this.trades = [];
        this.orders = []; // pending orders
        this.stats = { wins: 0, losses: 0, fees: 0 };
        
        // Order book simulation
        this.spread = 0.0005; // 0.05% spread
        this.slippage = 0.0002; // 0.02% slippage
        this.fee = 0.001; // 0.1% Binance fee
    }

    // Get simulated market price with spread
    getBidPrice(marketPrice) {
        return marketPrice * (1 - this.spread / 2);
    }

    getAskPrice(marketPrice) {
        return marketPrice * (1 + this.spread / 2);
    }

    // Place a market order
    placeOrder(side, quantity, marketPrice) {
        const price = side === 'LONG' ? this.getAskPrice(marketPrice) : this.getBidPrice(marketPrice);
        const slippagePrice = price * (1 + (Math.random() - 0.5) * this.slippage);
        const cost = slippagePrice * quantity;
        const feeCost = cost * this.fee;

        if (side === 'LONG') {
            if (cost + feeCost > this.balance) {
                return { success: false, reason: 'INSUFFICIENT_BALANCE' };
            }
            this.balance -= (cost + feeCost);
            this.position = {
                side: 'LONG',
                entryPrice: slippagePrice,
                quantity,
                entryTime: Date.now()
            };
            this.trades.push({
                type: 'OPEN',
                side,
                price: slippagePrice,
                quantity,
                fee: feeCost,
                time: Date.now()
            });
        } else { // SHORT
            // For short: you get money when opening
            this.balance += (cost - feeCost);
            this.position = {
                side: 'SHORT',
                entryPrice: slippagePrice,
                quantity,
                entryTime: Date.now()
            };
            this.trades.push({
                type: 'OPEN',
                side,
                price: slippagePrice,
                quantity,
                fee: feeCost,
                time: Date.now()
            });
        }

        this.stats.fees += feeCost;
        return { success: true, price: slippagePrice, fee: feeCost };
    }

    // Close position
    closePosition(marketPrice) {
        if (!this.position) {
            return { success: false, reason: 'NO_POSITION' };
        }

        const price = this.position.side === 'LONG' 
            ? this.getBidPrice(marketPrice) 
            : this.getAskPrice(marketPrice);
        const slippagePrice = price * (1 + (Math.random() - 0.5) * this.slippage);
        const value = slippagePrice * this.position.quantity;
        const feeCost = value * this.fee;

        let pnl = 0;
        if (this.position.side === 'LONG') {
            pnl = (slippagePrice - this.position.entryPrice) * this.position.quantity;
            this.balance += (value - feeCost);
        } else {
            pnl = (this.position.entryPrice - slippagePrice) * this.position.quantity;
            this.balance += (value - feeCost); // For short close, you pay the cost
        }

        const closed = {
            type: 'CLOSE',
            side: this.position.side,
            entryPrice: this.position.entryPrice,
            exitPrice: slippagePrice,
            quantity: this.position.quantity,
            pnl,
            fee: feeCost,
            time: Date.now()
        };

        this.trades.push(closed);
        this.stats.fees += feeCost;

        if (pnl > 0) this.stats.wins++;
        else this.stats.losses++;

        this.position = null;
        return { success: true, ...closed };
    }

    // Get current unrealized P&L
    getUnrealizedPnL(marketPrice) {
        if (!this.position) return 0;
        if (this.position.side === 'LONG') {
            return (marketPrice - this.position.entryPrice) * this.position.quantity;
        } else {
            return (this.position.entryPrice - marketPrice) * this.position.quantity;
        }
    }

    // Get total equity
    getEquity(marketPrice) {
        if (!this.position) return this.balance;
        const unrealized = this.getUnrealizedPnL(marketPrice);
        return this.balance + unrealized;
    }

    // Get stats
    getStats() {
        const totalTrades = this.stats.wins + this.stats.losses;
        return {
            balance: this.balance,
            equity: null, // needs market price
            position: this.position,
            totalTrades,
            winRate: totalTrades > 0 ? (this.stats.wins / totalTrades * 100).toFixed(1) + '%' : '0%',
            totalFees: this.stats.fees.toFixed(2),
            pnlPercent: ((this.balance - this.initialBalance) / this.initialBalance * 100).toFixed(2) + '%',
            wins: this.stats.wins,
            losses: this.stats.losses
        };
    }

    // Reset
    reset() {
        this.balance = this.initialBalance;
        this.position = null;
        this.trades = [];
        this.orders = [];
        this.stats = { wins: 0, losses: 0, fees: 0 };
    }
}

module.exports = PaperTrading;
