/**
 * Trading Environment - RL interface
 * State, action, reward for DQN agent
 */

const { atr } = require('./indicators');

class TradingEnvironment {
    constructor(pair = 'BTCUSDT', windowSize = 59) {
        this.pair = pair;
        this.windowSize = windowSize;
        this.candles = [];
        this.step = 0;
        this.position = 0; // 0=FLAT, 1=LONG
        this.entryPrice = 0;
        this.capital = 1000;
        this.btc = 0;
        this.trades = [];
        this.fee = 0.001; // 0.1% Binance fee
        
        // Dynamic position sizing
        this.riskPercent = 0.02; // Risk 2% per trade
        this.maxPositionPct = 0.5; // Max 50% of capital
        this.useDynamicSizing = true;
        
        // Trailing stop
        this.trailingStopPct = 0.015; // 1.5% trailing stop
        this.highestPrice = 0;
    }

    reset(candles) {
        this.candles = candles;
        this.step = this.windowSize;
        this.position = 0;
        this.entryPrice = 0;
        this.capital = 1000;
        this.btc = 0;
        this.trades = [];
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
        
        return {
            // Normalized OHLCV
            open: window.map(c => c.open / price),
            high: window.map(c => c.high / price),
            low: window.map(c => c.low / price),
            close: window.map(c => c.close / price),
            volume: window.map(c => c.volume / this.avgVolume()),
            // Position info
            position: this.position,
            unrealizedPnl: this.position ? (price - this.entryPrice) / this.entryPrice : 0,
            timeSinceTrade: this.step - (this.trades.length > 0 ? this.trades[this.trades.length - 1].step : 0),
            // Volatility metrics (help agent adapt to market conditions)
            atrPct: Math.min(atrPct, 0.1), // Cap at 10%
            volatility: Math.min(volatility, 0.1),
            riskLevel: atrPct > 0.03 ? 1 : 0 // High/low volatility regime
        };
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

    execute(action) {
        const price = this.currentPrice();
        const prevCapital = this.balance();
        
        // Calculate ATR for position sizing
        const window = this.candles.slice(
            Math.max(0, this.step - this.windowSize),
            this.step
        );
        const highs = window.map(c => c.high);
        const lows = window.map(c => c.low);
        const closes = window.map(c => c.close);
        const currentAtr = atr(highs, lows, closes, 14) || (price * 0.02);
        
        // Check trailing stop when in position
        if (this.position === 1) {
            if (price > this.highestPrice) {
                this.highestPrice = price;
            }
            const trailingStop = this.highestPrice * (1 - this.trailingStopPct);
            const drawdown = (this.highestPrice - price) / this.highestPrice;
            
            // Trailing stop triggered
            if (price <= trailingStop && this.highestPrice > this.entryPrice * 1.02) {
                action = 2; // Force sell
            }
        }
        
        // Execute action
        if (action === 1 && this.position === 0) {
            // Dynamic position sizing based on ATR risk
            let positionPct = this.riskPercent;
            if (this.useDynamicSizing) {
                // Risk-based sizing: position = risk_amount / atr_distance
                const atrDistance = currentAtr * 2; // 2x ATR as stop distance
                positionPct = Math.min(this.riskPercent / (atrDistance / price), this.maxPositionPct);
                positionPct = Math.max(positionPct, 0.05); // Min 5%
            }
            
            const tradeAmount = this.capital * Math.min(positionPct, this.maxPositionPct);
            this.btc = tradeAmount / price;
            this.capital -= tradeAmount;
            this.position = 1;
            this.entryPrice = price;
            this.highestPrice = price;
            this.stopLoss = price - (currentAtr * 2); // 2x ATR stop
            this.trades.push({ 
                step: this.step, 
                action: 'BUY', 
                price, 
                positionPct: positionPct.toFixed(3),
                atr: currentAtr.toFixed(2)
            });
        } else if (action === 2 && this.position === 1) {
            // Check if stop loss triggered first
            const stopTriggered = price <= this.stopLoss;
            const pnl = (price - this.entryPrice) * this.btc;
            const fees = price * this.btc * this.fee;
            this.capital += this.btc * price - fees;
            this.trades.push({ 
                step: this.step, 
                action: 'SELL', 
                price, 
                pnl, 
                fees,
                exitType: stopTriggered ? 'stop_loss' : 'signal',
                unrealizedPnl: ((price - this.entryPrice) / this.entryPrice * 100).toFixed(2) + '%'
            });
            this.btc = 0;
            this.position = 0;
            this.entryPrice = 0;
        }
        
        this.step++;
        const newPrice = this.currentPrice();
        const newCapital = this.balance();
        const reward = (newCapital - prevCapital) / prevCapital;
        const done = this.step >= this.candles.length - 1 || this.capital < 10;
        
        return { reward, done };
    }

    balance() {
        return this.capital + this.btc * this.currentPrice();
    }
}

module.exports = TradingEnvironment;
