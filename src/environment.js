/**
 * Trading Environment - RL interface
 * State, action, reward for DQN agent
 * Supports: FLAT (0), LONG (1), SHORT (2)
 */

const { atr } = require('./indicators');

class TradingEnvironment {
    constructor(pair = 'BTCUSDT', windowSize = 59) {
        this.pair = pair;
        this.windowSize = windowSize;
        this.candles = [];
        this.step = 0;
        // Position: 0=FLAT, 1=LONG, -1=SHORT
        this.position = 0;
        this.entryPrice = 0;
        this.capital = 1000;
        this.btc = 0;
        this.shortedBtc = 0;     // For SHORT positions
        this.trades = [];
        this.fee = 0.001;        // 0.1% Binance fee
        
        // Dynamic position sizing
        this.riskPercent = 0.02; // Risk 2% per trade
        this.maxPositionPct = 0.5; // Max 50% of capital
        this.useDynamicSizing = true;
        
        // Trailing stop
        this.trailingStopPct = 0.015; // 1.5% trailing stop
        this.highestPrice = 0;
        this.lowestPrice = Infinity;
        
        // Stop loss price
        this.stopLoss = 0;
        this.takeProfit = 0;
    }

    reset(candles) {
        this.candles = candles;
        this.step = this.windowSize;
        this.position = 0;
        this.entryPrice = 0;
        this.capital = 1000;
        this.btc = 0;
        this.shortedBtc = 0;
        this.trades = [];
        this.highestPrice = 0;
        this.lowestPrice = Infinity;
        this.stopLoss = 0;
        this.takeProfit = 0;
        return this.getState();
    }

    getState() {
        const window = this.candles.slice(
            Math.max(0, this.step - this.windowSize),
            this.step
        );
        const price = this.currentPrice();
        const avgPrice = window.reduce((a, c) => a + c.close, 0) / window.length;
        
        // Calculate ATR for dynamic sizing
        const highs = window.map(c => c.high);
        const lows = window.map(c => c.low);
        const closes = window.map(c => c.close);
        const currentAtr = atr(highs, lows, closes, 14) || 1;
        
        // Volatility-adjusted metrics
        const atrPct = currentAtr / price;
        const volatility = this.calculateVolatility(window);
        
        // Realized P&L from closed trades
        const realizedPnl = this.trades
            .filter(t => t.pnl !== undefined)
            .reduce((sum, t) => sum + t.pnl, 0);
        
        // Unrealized P&L
        let unrealizedPnl = 0;
        if (this.position === 1) {
            unrealizedPnl = (price - this.entryPrice) / this.entryPrice;
        } else if (this.position === -1) {
            unrealizedPnl = (this.entryPrice - price) / this.entryPrice;
        }
        
        return {
            // Normalized OHLCV
            open: window.map(c => c.open / price),
            high: window.map(c => c.high / price),
            low: window.map(c => c.low / price),
            close: window.map(c => c.close / price),
            volume: window.map(c => c.volume / this.avgVolume()),
            // Position info: encoded as categorical [FLAT=0, LONG=1, SHORT=2] for one-hot
            position: this.position,  // 0, 1, or -1
            positionFlat: this.position === 0 ? 1 : 0,
            positionLong: this.position === 1 ? 1 : 0,
            positionShort: this.position === -1 ? 1 : 0,
            // P&L metrics
            unrealizedPnl,
            realizedPnl: realizedPnl / this.capital,
            totalPnl: (realizedPnl + (this.position === 1 ? (price - this.entryPrice) * this.btc : this.position === -1 ? (this.entryPrice - price) * this.shortedBtc : 0)) / this.capital,
            // Trade timing
            timeSinceTrade: this.step - (this.trades.length > 0 ? this.trades[this.trades.length - 1].step : 0),
            // Volatility metrics (help agent adapt to market conditions)
            atrPct: Math.min(atrPct, 0.1), // Cap at 10%
            volatility: Math.min(volatility, 0.1),
            riskLevel: atrPct > 0.03 ? 1 : 0, // High/low volatility regime
            // Price momentum
            priceVsAvg: (price - avgPrice) / avgPrice,
            // Recent returns (momentum signal)
            recentReturns: this.getRecentReturns(window),
            // Drawdown from session peak
            peakCapital: this.peakCapital || 1000,
            drawdown: this.peakCapital > 0 ? Math.max(0, (this.peakCapital - this.balance(price)) / this.peakCapital) : 0
        };
    }
    
    getRecentReturns(window) {
        if (window.length < 5) return [0, 0, 0, 0];
        const returns = [];
        for (let i = Math.min(4, window.length - 1); i >= 0; i--) {
            const idx = window.length - 1 - i;
            if (idx > 0) {
                returns.push((window[idx].close - window[idx-1].close) / window[idx-1].close);
            } else {
                returns.push(0);
            }
        }
        return returns;
    }
    
    calculateVolatility(window) {
        if (window.length < 14) return 0;
        const returns = [];
        for (let i = 1; i < window.length; i++) {
            returns.push((window[i].close - window[i-1].close) / window[i-1].close);
        }
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    currentPrice() {
        return this.candles[this.step]?.close || 0;
    }

    avgVolume() {
        const window = this.candles.slice(
            Math.max(0, this.step - this.windowSize),
            this.step
        );
        return window.reduce((a, c) => a + c.volume, 0) / window.length || 1;
    }
    
    balance(price) {
        if (!price) price = this.currentPrice();
        if (this.position === 1) {
            return this.capital + this.btc * price;
        } else if (this.position === -1) {
            // For short: we owe the BTC, capital increases when price drops
            const shortPnl = (this.entryPrice - price) * this.shortedBtc;
            return this.capital + shortPnl;
        }
        return this.capital;
    }

    execute(action) {
        // action: 0=HOLD, 1=LONG, 2=SHORT, 3=CLOSE
        const price = this.currentPrice();
        const prevCapital = this.balance(price);
        const currentBalance = this.balance(price);
        
        // Track peak capital for drawdown
        if (!this.peakCapital || currentBalance > this.peakCapital) {
            this.peakCapital = currentBalance;
        }
        
        // Calculate ATR for position sizing
        const window = this.candles.slice(
            Math.max(0, this.step - this.windowSize),
            this.step
        );
        const highs = window.map(c => c.high);
        const lows = window.map(c => c.low);
        const closes = window.map(c => c.close);
        const currentAtr = atr(highs, lows, closes, 14) || (price * 0.02);
        
        // ─── Trailing Stop for LONG ───
        if (this.position === 1) {
            if (price > this.highestPrice) {
                this.highestPrice = price;
            }
            const trailingStop = this.highestPrice * (1 - this.trailingStopPct);
            const drawdown = (this.highestPrice - price) / this.highestPrice;
            
            // Trailing stop triggered (only if we're in profit)
            if (price <= trailingStop && this.highestPrice > this.entryPrice * 1.02) {
                action = 3; // Force close
            }
        }
        
        // ─── Trailing Stop for SHORT ───
        if (this.position === -1) {
            if (price < this.lowestPrice || this.lowestPrice === Infinity) {
                this.lowestPrice = price;
            }
            const trailingStop = this.lowestPrice * (1 + this.trailingStopPct);
            
            // Trailing stop triggered for short (price rises too much from trough)
            if (price >= trailingStop && this.lowestPrice < this.entryPrice * 0.98) {
                action = 3; // Force close
            }
        }
        
        // ─── Execute LONG ───
        if (action === 1 && this.position === 0) {
            // Dynamic position sizing based on ATR risk
            let positionPct = this.riskPercent;
            if (this.useDynamicSizing) {
                const atrDistance = currentAtr * 2;
                positionPct = Math.min(this.riskPercent / (atrDistance / price), this.maxPositionPct);
                positionPct = Math.max(positionPct, 0.05);
            }
            
            const tradeAmount = this.capital * Math.min(positionPct, this.maxPositionPct);
            this.btc = tradeAmount / price;
            this.capital -= tradeAmount;
            this.position = 1;
            this.entryPrice = price;
            this.highestPrice = price;
            this.stopLoss = price - (currentAtr * 2);
            this.takeProfit = price + (currentAtr * 4);
            this.trades.push({ 
                step: this.step, 
                action: 'BUY/LONG', 
                price, 
                positionPct: positionPct.toFixed(3),
                atr: currentAtr.toFixed(2),
                type: 'entry'
            });
        }
        // ─── Execute SHORT ───
        else if (action === 2 && this.position === 0) {
            // Dynamic position sizing for short
            let positionPct = this.riskPercent;
            if (this.useDynamicSizing) {
                const atrDistance = currentAtr * 2;
                positionPct = Math.min(this.riskPercent / (atrDistance / price), this.maxPositionPct);
                positionPct = Math.max(positionPct, 0.05);
            }
            
            // For short: borrow BTC, sell it, hope to buy back cheaper
            const tradeAmount = this.capital * Math.min(positionPct, this.maxPositionPct);
            this.shortedBtc = tradeAmount / price;  // Amount of BTC we're shorting
            this.capital += tradeAmount - (tradeAmount * this.fee); // Received from selling BTC
            this.position = -1;
            this.entryPrice = price;
            this.lowestPrice = price;
            this.stopLoss = price + (currentAtr * 2);  // Price rises = loss for short
            this.takeProfit = price - (currentAtr * 4);
            this.trades.push({ 
                step: this.step, 
                action: 'SELL/SHORT', 
                price, 
                positionPct: positionPct.toFixed(3),
                atr: currentAtr.toFixed(2),
                type: 'entry'
            });
        }
        // ─── CLOSE (any position) ───
        else if (action === 3) {
            if (this.position === 1) {
                // Close LONG
                const fees = price * this.btc * this.fee;
                const pnl = (price - this.entryPrice) * this.btc - fees;
                this.capital += this.btc * price - fees;
                const stopTriggered = price <= this.stopLoss;
                this.trades.push({ 
                    step: this.step, 
                    action: 'SELL/CLOSE', 
                    price, 
                    pnl,
                    fees,
                    exitType: stopTriggered ? 'stop_loss' : 'signal',
                    pnlPct: ((price - this.entryPrice) / this.entryPrice * 100).toFixed(2) + '%',
                    type: 'exit'
                });
                this.btc = 0;
            } else if (this.position === -1) {
                // Close SHORT: buy back BTC at current price
                const buybackCost = price * this.shortedBtc;
                const fees = buybackCost * this.fee;
                const pnl = (this.entryPrice - price) * this.shortedBtc - fees;
                this.capital -= buybackCost + fees; // Pay to buy back BTC
                this.capital += pnl; // Add P&L (can be negative)
                // Ensure capital doesn't go negative
                if (this.capital < 0) this.capital = 0;
                const stopTriggered = price >= this.stopLoss;
                this.trades.push({ 
                    step: this.step, 
                    action: 'BUY/COVER', 
                    price, 
                    pnl,
                    fees,
                    exitType: stopTriggered ? 'stop_loss' : 'signal',
                    pnlPct: ((this.entryPrice - price) / this.entryPrice * 100).toFixed(2) + '%',
                    type: 'exit'
                });
                this.shortedBtc = 0;
            }
            this.position = 0;
            this.entryPrice = 0;
            this.stopLoss = 0;
            this.takeProfit = 0;
        }
        
        this.step++;
        const newPrice = this.currentPrice();
        const newCapital = this.balance(newPrice);
        const reward = (newCapital - prevCapital) / prevCapital;
        const done = this.step >= this.candles.length - 1 || this.capital < 10;
        
        return { reward, done };
    }
    
    // Alias for execute() - compatibility with train.js
    step(action) {
        return this.execute(action);
    }
    
    // Get trades for chart visualization
    getTrades() {
        return this.trades;
    }
    
    // Get episode summary
    getSummary() {
        const closedTrades = this.trades.filter(t => t.pnl !== undefined);
        const wins = closedTrades.filter(t => t.pnl > 0).length;
        const losses = closedTrades.filter(t => t.pnl <= 0).length;
        const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const fees = closedTrades.reduce((sum, t) => sum + (t.fees || 0), 0);
        
        return {
            episode: this.step,
            finalCapital: this.balance(),
            totalTrades: closedTrades.length,
            wins,
            losses,
            winRate: closedTrades.length > 0 ? wins / closedTrades.length : 0,
            totalPnl,
            totalFees: fees,
            profitFactor: Math.abs(closedTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0) / (closedTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)||1)),
            longs: this.trades.filter(t => t.action.includes('LONG')).length,
            shorts: this.trades.filter(t => t.action.includes('SHORT')).length,
            stopLosses: closedTrades.filter(t => t.exitType === 'stop_loss').length
        };
    }
}

module.exports = TradingEnvironment;
