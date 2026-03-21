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
}
exports.BinanceClient = BinanceClient;
