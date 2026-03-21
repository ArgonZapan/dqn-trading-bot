/**
 * Technical Indicators for Trading
 */

function EMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function RSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function MACD(prices, fast = 12, slow = 26, signal = 9) {
    const emaFast = EMA(prices, fast);
    const emaSlow = EMA(prices, slow);
    const macdLine = emaFast - emaSlow;
    return { value: macdLine, signal: macdLine * 0.9, histogram: macdLine * 0.1 };
}

function BollingerBands(prices, period = 20, stdDev = 2) {
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { upper: sma + stdDev * std, middle: sma, lower: sma - stdDev * std };
}

function getIndicators(candles) {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    
    return {
        rsi: RSI(closes),
        macd: MACD(closes),
        ema9: EMA(closes, 9),
        ema21: EMA(closes, 21),
        ema50: EMA(closes, 50),
        bb: BollingerBands(closes),
        volumeRatio: volumes[volumes.length - 1] / avgVol
    };
}

module.exports = { EMA, RSI, MACD, BollingerBands, getIndicators };
