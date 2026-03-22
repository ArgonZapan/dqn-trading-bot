"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceClient = void 0;
/**
 * Binance Client - REST API
 */
const BASE_URL = 'https://api.binance.com';
class BinanceClient {
    constructor() {
        this.priceCallbacks = [];
        this.pollInterval = null;
    }
    async getPrice(symbol = 'BTCUSDT') {
        try {
            const r = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`);
            if (!r.ok)
                return 0;
            const d = await r.json();
            return parseFloat(d.price);
        }
        catch {
            return 0;
        }
    }
    async getKlines(symbol = 'BTCUSDT', interval = '5m', limit = 100) {
        try {
            const r = await fetch(`${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
            if (!r.ok)
                return [];
            const d = await r.json();
            return d.map((k) => ({ time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6] }));
        }
        catch {
            return [];
        }
    }
    async get24hr(symbol = 'BTCUSDT') {
        try {
            const r = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${symbol}`);
            if (!r.ok)
                return { priceChange: 0, priceChangePercent: 0, volume: 0 };
            const d = await r.json();
            return { priceChange: parseFloat(d.priceChange), priceChangePercent: parseFloat(d.priceChangePercent), volume: parseFloat(d.volume) };
        }
        catch {
            return { priceChange: 0, priceChangePercent: 0, volume: 0 };
        }
    }
    startPriceUpdates(symbol = 'BTCUSDT', intervalMs = 2000) {
        this.stopPriceUpdates();
        this.pollInterval = setInterval(async () => {
            const p = await this.getPrice(symbol);
            if (p > 0)
                this.priceCallbacks.forEach(cb => cb(p));
        }, intervalMs);
    }
    stopPriceUpdates() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }
    onPrice(cb) {
        this.priceCallbacks.push(cb);
        return () => { this.priceCallbacks = this.priceCallbacks.filter(x => x !== cb); };
    }
    async getBalances() {
        return [{ asset: 'USDT', free: 1000, locked: 0 }, { asset: 'BTC', free: 0, locked: 0 }];
    }
    /**
     * Get multiple timeframes of klines for multi-timeframe analysis
     * @param symbol Trading pair
     * @param intervals Array of intervals, e.g. ['5m', '1h', '4h']
     * @param limit Number of candles per timeframe
     */
    async getMultiTimeframeKlines(symbol = 'BTCUSDT', intervals = ['5m', '1h', '4h'], limit = 100) {
        const results = {};
        await Promise.all(intervals.map(async (interval) => {
            results[interval] = await this.getKlines(symbol, interval, limit);
        }));
        return results;
    }
    /**
     * Get HTF (higher timeframe) trend indicators without full candle data
     * Returns just the trend direction and key levels for the given interval
     */
    async getHTFTrend(symbol = 'BTCUSDT', interval = '1h') {
        const klines = await this.getKlines(symbol, interval, 200);
        if (klines.length < 200)
            return { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 };
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume);
        const ema200 = this.calcEMA(closes, 200);
        const currentClose = closes[closes.length - 1];
        const rsi = this.calcRSI(closes, 14);
        // Trend: compare EMA200 slope over last 20 candles
        const emaSlope = (closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20];
        let trend = 'neutral';
        if (currentClose > ema200 && emaSlope > 0.005)
            trend = 'bull';
        else if (currentClose < ema200 && emaSlope < -0.005)
            trend = 'bear';
        const volumeAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volumeRatio = volumes[volumes.length - 1] / volumeAvg;
        return {
            trend,
            rsi,
            ema200Dist: ((currentClose - ema200) / ema200) * 100,
            volumeRatio
        };
    }
    calcEMA(prices, period) {
        if (prices.length < period)
            return prices[prices.length - 1];
        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        return ema;
    }
    calcRSI(prices, period) {
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
}
exports.BinanceClient = BinanceClient;
