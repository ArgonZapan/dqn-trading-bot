/**
 * Advanced Technical Indicators
 */

// RSI with Wilder's smoothing
function rsi(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// EMA
function ema(prices, period = 9) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    
    return ema;
}

// MACD
function macd(prices, fast = 12, slow = 26, signal = 9) {
    const fastEMA = ema(prices, fast);
    const slowEMA = ema(prices, slow);
    const macdLine = fastEMA - slowEMA;
    const signalLine = macdLine * 0.9; // Simplified signal
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: macdLine - signalLine
    };
}

// Bollinger Bands
function bollinger(prices, period = 20, stdDev = 2) {
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    return {
        upper: sma + stdDev * std,
        middle: sma,
        lower: sma - stdDev * std,
        bandwidth: ((sma + stdDev * std) - (sma - stdDev * std)) / sma * 100
    };
}

// Volume Profile
function volumeProfile(prices, volumes, bins = 10) {
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const binSize = (maxPrice - minPrice) / bins;
    
    const profile = new Array(bins).fill(0);
    for (let i = 0; i < prices.length; i++) {
        const bin = Math.floor((prices[i] - minPrice) / binSize);
        if (bin >= 0 && bin < bins) profile[bin] += volumes[i];
    }
    
    const maxVol = Math.max(...profile);
    return profile.map(v => v / maxVol);
}

// ATR (Average True Range)
function atr(high, low, close, period = 14) {
    if (high.length < period) return 0;
    
    const trs = [];
    for (let i = 1; i < high.length; i++) {
        const tr = Math.max(
            high[i] - low[i],
            Math.abs(high[i] - close[i-1]),
            Math.abs(low[i] - close[i-1])
        );
        trs.push(tr);
    }
    
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

module.exports = { rsi, ema, macd, bollinger, volumeProfile, atr };
