/**
 * Risk Manager V2 - Position sizing, stop loss, drawdown protection
 * Autonomous feature added: 2026-03-22
 * 
 * Features:
 * - Kelly Criterion position sizing (full + fractional 25%)
 * - Volatility-adjusted sizing using ATR
 * - Dynamic stop loss based on volatility
 * - Drawdown protection with circuit breaker
 * - Win-rate aware position sizing
 */

class RiskManager {
    constructor() {
        // Position sizing
        this.maxPositionSize = 0.5; // Max 50% of capital
        this.minTradeSize = 10; // Min $10 trade
        this.kellyFraction = 0.25; // Fractional Kelly (25% for safety)
        
        // Risk limits
        this.maxDailyLoss = 0.03; // Max 3% daily loss
        this.maxDrawdown = 0.1; // Max 10% drawdown from peak
        this.maxConsecutiveLosses = 5; // Circuit breaker
        
        // Stop loss
        this.stopLossPercent = 0.02; // 2% stop loss
        this.takeProfitPercent = 0.05; // 5% take profit
        
        // ATR-based dynamic stops
        this.useDynamicStops = true;
        this.atrMultiplierSL = 2.0; // 2x ATR for stop loss
        this.atrMultiplierTP = 3.0; // 3x ATR for take profit
        
        // State
        this.peakBalance = 1000;
        this.dailyLoss = 0;
        this.lastTradeDate = null;
        this.consecutiveLosses = 0;
        
        // Historical stats for Kelly calculation
        this.winRate = 0.5;
        this.avgWin = 0;
        this.avgLoss = 0;
        this.totalTrades = 0;
        
        // Trading journal reference for stats
        this.journal = null;
    }
    
    /**
     * Set trading journal reference for stats
     */
    setJournal(journal) {
        this.journal = journal;
        this.updateStats();
    }
    
    /**
     * Update stats from trading journal
     */
    updateStats() {
        if (!this.journal) return;
        const stats = this.journal.getStats();
        if (stats.totalTrades > 0) {
            this.winRate = parseFloat(stats.winRate) / 100;
            this.avgWin = parseFloat(stats.avgWin) / 100;
            this.avgLoss = Math.abs(parseFloat(stats.avgLoss) / 100);
            this.totalTrades = stats.totalTrades;
        }
    }

    canTrade(balance, prices) {
        // Check daily loss limit
        const today = new Date().toDateString();
        if (this.lastTradeDate !== today) {
            this.dailyLoss = 0;
            this.lastTradeDate = today;
        }
        
        if (this.dailyLoss > this.maxDailyLoss) {
            return { canTrade: false, reason: 'daily_loss_limit', message: `Daily loss limit reached (${(this.maxDailyLoss * 100).toFixed(1)}%)` };
        }
        
        if (balance < this.minTradeSize) {
            return { canTrade: false, reason: 'balance_too_low', message: `Balance too low ($${balance.toFixed(2)})` };
        }
        
        // Circuit breaker check
        if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
            return { canTrade: false, reason: 'circuit_breaker', message: `Circuit breaker triggered (${this.consecutiveLosses} consecutive losses)` };
        }
        
        // Drawdown check
        const dd = this.drawdown(balance);
        if (dd > this.maxDrawdown) {
            return { canTrade: false, reason: 'max_drawdown', message: `Max drawdown exceeded (${(dd * 100).toFixed(1)}% > ${(this.maxDrawdown * 100).toFixed(1)}%)` };
        }
        
        return { canTrade: true };
    }

    /**
     * Calculate Kelly Criterion position size
     * Formula: f* = (bp - q) / b
     * Where: b = avgWin/avgLoss (win/loss ratio), p = win rate, q = 1 - p
     * 
     * @returns {number} Kelly percentage (0-1)
     */
    calculateKelly() {
        if (this.totalTrades < 10) {
            // Not enough data, use default
            return 0.1;
        }
        
        const p = this.winRate; // Win probability
        const q = 1 - p; // Loss probability
        
        if (this.avgLoss === 0 || this.avgWin === 0) {
            return 0.1;
        }
        
        const b = this.avgWin / this.avgLoss; // Win/loss ratio
        const kelly = (b * p - q) / b;
        
        // Clamp to reasonable bounds (0-50%)
        return Math.max(0, Math.min(0.5, kelly));
    }
    
    /**
     * Get recommended position size using Fractional Kelly
     * @returns {number} Position size as fraction of capital (0-1)
     */
    getKellyPositionSize() {
        const kelly = this.calculateKelly();
        const fractionalKelly = kelly * this.kellyFraction;
        
        // Cap at max position size
        return Math.min(fractionalKelly, this.maxPositionSize);
    }

    /**
     * Calculate position size in base currency
     * Uses Kelly Criterion with volatility adjustment
     * 
     * @param {number} balance - Current account balance
     * @param {number} price - Current asset price
     * @param {number} atr - ATR value for volatility adjustment (optional)
     * @returns {number} Quantity to trade
     */
    positionSize(balance, price, atr = null) {
        // Base Kelly sizing
        let kellySize = this.getKellyPositionSize();
        
        // Volatility adjustment using ATR
        if (atr && this.useDynamicStops && price > 0) {
            const atrPercent = atr / price;
            const typicalRange = atrPercent * this.atrMultiplierSL; // Stop loss distance in %
            
            // Scale down position in high volatility
            // If ATR > 2% of price, reduce position
            if (typicalRange > 0.03) { // > 3% stop distance
                kellySize *= 0.5; // Halve position in high vol
            } else if (typicalRange > 0.02) { // > 2% stop distance
                kellySize *= 0.75;
            }
        }
        
        // Calculate dollar amount
        const dollarAmount = balance * kellySize;
        
        // Ensure minimum trade size
        if (dollarAmount < this.minTradeSize) {
            return 0;
        }
        
        return dollarAmount / price;
    }

    /**
     * Calculate dynamic stop loss based on ATR
     * @param {number} entryPrice - Entry price
     * @param {number} atr - ATR value
     * @param {string} side - 'LONG' or 'SHORT'
     * @returns {object} { stopLoss, takeProfit } prices
     */
    calculateDynamicStops(entryPrice, atr, side = 'LONG') {
        if (!this.useDynamicStops || !atr) {
            // Use static percentages
            if (side === 'LONG') {
                return {
                    stopLoss: entryPrice * (1 - this.stopLossPercent),
                    takeProfit: entryPrice * (1 + this.takeProfitPercent)
                };
            } else {
                return {
                    stopLoss: entryPrice * (1 + this.stopLossPercent),
                    takeProfit: entryPrice * (1 - this.takeProfitPercent)
                };
            }
        }
        
        // ATR-based stops
        const slDistance = atr * this.atrMultiplierSL;
        const tpDistance = atr * this.atrMultiplierTP;
        
        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
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
    
    /**
     * Check stops with ATR-based dynamic levels
     */
    checkDynamicStopLoss(entryPrice, currentPrice, atr, side = 'LONG') {
        const { stopLoss, takeProfit } = this.calculateDynamicStops(entryPrice, atr, side);
        
        if (side === 'LONG') {
            if (currentPrice <= stopLoss) {
                return { stop: true, reason: 'stop_loss', exitPrice: stopLoss };
            }
            if (currentPrice >= takeProfit) {
                return { stop: true, reason: 'take_profit', exitPrice: takeProfit };
            }
        } else {
            if (currentPrice >= stopLoss) {
                return { stop: true, reason: 'stop_loss', exitPrice: stopLoss };
            }
            if (currentPrice <= takeProfit) {
                return { stop: true, reason: 'take_profit', exitPrice: takeProfit };
            }
        }
        
        return { stop: false };
    }

    recordLoss(amount) {
        this.dailyLoss += Math.abs(amount);
        this.consecutiveLosses++;
    }
    
    recordWin(amount) {
        this.consecutiveLosses = 0; // Reset on win
    }

    updatePeak(balance) {
        if (balance > this.peakBalance) {
            this.peakBalance = balance;
        }
    }

    drawdown(currentBalance) {
        if (this.peakBalance === 0) return 0;
        return (this.peakBalance - currentBalance) / this.peakBalance;
    }
    
    /**
     * Get risk report with all current metrics
     * @param {number} balance - Current balance
     * @param {number} atr - Current ATR (optional)
     * @returns {object} Risk metrics
     */
    getRiskReport(balance, atr = null) {
        const kelly = this.calculateKelly();
        const kellySize = this.getKellyPositionSize();
        const position = this.positionSize(balance, 1000, atr); // assuming BTC price ~1000 for calculation
        const dd = this.drawdown(balance);
        
        return {
            kellyFull: (kelly * 100).toFixed(2) + '%',
            kellyFractional: (kellySize * 100).toFixed(2) + '%',
            recommendedPositionSize: kellySize,
            currentDrawdown: (dd * 100).toFixed(2) + '%',
            consecutiveLosses: this.consecutiveLosses,
            dailyLoss: (this.dailyLoss * 100).toFixed(2) + '%',
            canTrade: this.canTrade(balance).canTrade,
            reason: this.canTrade(balance).reason || null,
            atrStopLoss: atr ? this.calculateDynamicStops(1000, atr).stopLoss.toFixed(2) : null,
            atrTakeProfit: atr ? this.calculateDynamicStops(1000, atr).takeProfit.toFixed(2) : null,
            stats: {
                winRate: (this.winRate * 100).toFixed(1) + '%',
                avgWin: (this.avgWin * 100).toFixed(2) + '%',
                avgLoss: (this.avgLoss * 100).toFixed(2) + '%',
                totalTrades: this.totalTrades
            }
        };
    }
    
    /**
     * Reset daily counters
     */
    resetDaily() {
        this.dailyLoss = 0;
        this.consecutiveLosses = 0;
    }
}

module.exports = RiskManager;
