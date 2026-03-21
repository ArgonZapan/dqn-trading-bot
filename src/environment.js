/**
 * Trading Environment - RL interface
 * State, action, reward for DQN agent
 */

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
            timeSinceTrade: this.step - (this.trades.length > 0 ? this.trades[this.trades.length - 1].step : 0)
        };
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
        
        // Execute action
        if (action === 1 && this.position === 0) {
            // BUY
            this.btc = (this.capital * 0.95) / price;
            this.capital = this.capital * 0.05;
            this.position = 1;
            this.entryPrice = price;
            this.trades.push({ step: this.step, action: 'BUY', price });
        } else if (action === 2 && this.position === 1) {
            // SELL
            const pnl = (price - this.entryPrice) * this.btc;
            const fees = price * this.btc * this.fee;
            this.capital += this.btc * price - fees;
            this.trades.push({ step: this.step, action: 'SELL', price, pnl, fees });
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
