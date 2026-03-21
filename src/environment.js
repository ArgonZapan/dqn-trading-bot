/**
 * Trading Environment - RL interface
 */

class TradingEnvironment {
    constructor(pair = 'BTCUSDT', windowSize = 60) {
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
        const window = this.candles.slice(Math.max(0, this.step - this.windowSize), this.step);
        return {
            candles: window.map(c => [c.open, c.high, c.low, c.close, c.volume]).flat(),
            position: this.position,
            unrealizedPnl: this.position ? (this.currentPrice() - this.entryPrice) / this.entryPrice : 0,
            timeSinceTrade: this.step - (this.trades.length > 0 ? this.trades[this.trades.length - 1].step : 0)
        };
    }

    currentPrice() {
        return this.candles[this.step]?.close || 0;
    }

    step(action) {
        const price = this.currentPrice();
        const prevBalance = this.balance();

        // Execute action
        if (action === 1 && this.position === 0) {
            // BUY
            const quantity = (this.capital * 0.95) / price; // 95% of capital, 0.1% fee
            this.btc = quantity;
            this.capital = this.capital * 0.05;
            this.position = 1;
            this.entryPrice = price;
            this.trades.push({ step: this.step, action: 'BUY', price, quantity });
        } else if (action === 2 && this.position === 1) {
            // SELL
            const pnl = (price - this.entryPrice) * this.btc;
            const fees = price * this.btc * this.fee;
            this.capital += this.btc * price - fees;
            this.trades.push({ step: this.step, action: 'SELL', price, quantity: this.btc, pnl, fees });
            this.btc = 0;
            this.position = 0;
            this.entryPrice = 0;
        }

        this.step++;
        const reward = (this.balance() - prevBalance) / prevBalance;
        const done = this.step >= this.candles.length - 1 || this.capital < 10;

        return { reward, done };
    }

    balance() {
        return this.capital + this.btc * this.currentPrice();
    }
}

module.exports = TradingEnvironment;
