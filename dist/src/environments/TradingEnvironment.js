"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingEnvironment = void 0;
class TradingEnvironment {
    constructor(pair = 'BTCUSDT', windowSize = 60) {
        this.candles = [];
        this.currentStep = 0;
        this.position = 0;
        this.entryPrice = 0;
        this.trades = [];
        this.capital = 1000;
        this.btcBalance = 0;
        this.pair = pair;
        this.windowSize = windowSize;
    }
    reset(candles) {
        this.candles = candles;
        this.currentStep = this.windowSize;
        this.position = 0;
        this.entryPrice = 0;
        this.trades = [];
        this.capital = 1000;
        this.btcBalance = 0;
        return this.getState();
    }
    getState() {
        const window = this.candles.slice(Math.max(0, this.currentStep - this.windowSize), this.currentStep);
        const indicators = this.calculateIndicators(window);
        const unrealizedPnl = this.position === 1 ? (this.candles[this.currentStep]?.close || 0) - this.entryPrice : 0;
        return {
            candles: this.normalizeCandles(window),
            indicators,
            position: this.position,
            unrealizedPnl: unrealizedPnl / this.capital,
            timeSinceTrade: this.getTimeSinceLastTrade(),
            btcRatio: this.btcBalance * this.getCurrentPrice() / this.capital
        };
    }
    step(action) {
        const currentPrice = this.getCurrentPrice();
        const prevBalance = this.getTotalBalance(currentPrice);
        if (action === 1 && this.position === 0) {
            const quantity = (this.capital * 0.95) / currentPrice;
            this.btcBalance += quantity;
            this.capital = this.capital * 0.95 - quantity * currentPrice * 0.001;
            this.position = 1;
            this.entryPrice = currentPrice;
        }
        else if (action === 2 && this.position === 1) {
            const pnl = (currentPrice - this.entryPrice) * this.btcBalance;
            const fees = currentPrice * this.btcBalance * 0.001;
            this.capital += this.btcBalance * currentPrice - fees;
            this.trades.push({ id: `trade_${Date.now()}`, timestamp: this.candles[this.currentStep]?.time, action, price: currentPrice, quantity: this.btcBalance, pnl, fees });
            this.btcBalance = 0;
            this.position = 0;
            this.entryPrice = 0;
        }
        this.currentStep++;
        const newBalance = this.getTotalBalance(this.getCurrentPrice());
        const reward = (newBalance - prevBalance) / this.capital;
        const done = this.currentStep >= this.candles.length - 1 || this.capital < 10;
        return { state: this.getState(), reward, done };
    }
    calculateIndicators(candles) {
        if (candles.length < 50)
            return { rsi: 50, macd: { value: 0, signal: 0, histogram: 0 }, ema9: 0, ema21: 0, ema50: 0, bb: { upper: 0, middle: 0, lower: 0 }, volumeRatio: 1 };
        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);
        return {
            rsi: this.calculateRSI(closes, 14),
            macd: this.calculateMACD(closes),
            ema9: this.calculateEMA(closes, 9),
            ema21: this.calculateEMA(closes, 21),
            ema50: this.calculateEMA(closes, 50),
            bb: this.calculateBB(closes, 20, 2),
            volumeRatio: volumes[volumes.length - 1] / (volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
        };
    }
    calculateRSI(prices, period) {
        if (prices.length < period + 1)
            return 50;
        let gains = 0, losses = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0)
                gains += diff;
            else
                losses -= diff;
        }
        const avgGain = gains / period, avgLoss = losses / period;
        if (avgLoss === 0)
            return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
    }
    calculateEMA(prices, period) {
        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < prices.length; i++)
            ema = prices[i] * k + ema * (1 - k);
        return ema;
    }
    calculateMACD(prices) {
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macdLine = ema12 - ema26;
        return { value: macdLine, signal: macdLine * 0.9, histogram: macdLine * 0.1 };
    }
    calculateBB(prices, period, stdDev) {
        const slice = prices.slice(-period);
        const sma = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
        const std = Math.sqrt(variance);
        return { upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std };
    }
    normalizeCandles(candles) {
        const result = [];
        for (const c of candles)
            result.push(c.open, c.high, c.low, c.close, c.volume);
        return result;
    }
    getCurrentPrice() { return this.candles[this.currentStep]?.close || 0; }
    getTotalBalance(price) { return this.capital + this.btcBalance * price; }
    getTimeSinceLastTrade() {
        if (this.trades.length === 0)
            return this.currentStep;
        return this.currentStep;
    }
    getTrades() { return this.trades; }
    getPosition() { return this.position; }
    getBalance() {
        const price = this.getCurrentPrice();
        return { capital: this.capital, btc: this.btcBalance, total: this.getTotalBalance(price) };
    }
}
exports.TradingEnvironment = TradingEnvironment;
