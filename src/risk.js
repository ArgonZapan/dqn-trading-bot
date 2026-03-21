/**
 * Risk Manager - Position sizing, stop loss, drawdown protection
 */

class RiskManager {
    constructor() {
        // Position sizing
        this.maxPositionSize = 0.5; // Max 50% of capital
        this.minTradeSize = 10; // Min $10 trade
        
        // Risk limits
        this.maxDailyLoss = 0.03; // Max 3% daily loss
        this.maxDrawdown = 0.1; // Max 10% drawdown from peak
        
        // Stop loss
        this.stopLossPercent = 0.02; // 2% stop loss
        this.takeProfitPercent = 0.05; // 5% take profit
        
        // State
        this.peakBalance = 1000;
        this.dailyLoss = 0;
        this.lastTradeDate = null;
    }

    canTrade(balance, prices) {
        // Check daily loss limit
        const today = new Date().toDateString();
        if (this.lastTradeDate !== today) {
            this.dailyLoss = 0;
            this.lastTradeDate = today;
        }
        
        if (this.dailyLoss > this.maxDailyLoss) {
            return { canTrade: false, reason: 'daily_loss_limit' };
        }
        
        if (balance < this.minTradeSize) {
            return { canTrade: false, reason: 'balance_too_low' };
        }
        
        return { canTrade: true };
    }

    positionSize(balance, price) {
        return Math.min(
            balance * this.maxPositionSize,
            balance * 0.1 // Default 10% Kelly criterion placeholder
        ) / price;
    }

    checkStopLoss(entryPrice, currentPrice, position) {
        const loss = (entryPrice - currentPrice) / entryPrice;
        if (loss > this.stopLossPercent) {
            return { stop: true, reason: 'stop_loss' };
        }
        const profit = (currentPrice - entryPrice) / entryPrice;
        if (profit > this.takeProfitPercent) {
            return { stop: true, reason: 'take_profit' };
        }
        return { stop: false };
    }

    recordLoss(amount) {
        this.dailyLoss += amount;
    }

    updatePeak(balance) {
        if (balance > this.peakBalance) {
            this.peakBalance = balance;
        }
    }

    drawdown(currentBalance) {
        return (this.peakBalance - currentBalance) / this.peakBalance;
    }
}

module.exports = RiskManager;
