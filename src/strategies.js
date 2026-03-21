/**
 * Trading Strategies - Different DQN-based strategies
 */

// Strategy 1: Trend Following
const trendFollowing = (env, agent) => {
    const state = env.getState();
    const trend = state.close[state.close.length-1] - state.close[0];
    const action = trend > 0 ? 1 : (trend < 0 ? 2 : 0);
    return action;
};

// Strategy 2: Mean Reversion
const meanReversion = (env) => {
    const state = env.getState();
    const prices = state.close;
    const mean = prices.reduce((a,b) => a+b) / prices.length;
    const current = prices[prices.length-1];
    
    if (current < mean * 0.98) return 1; // BUY when below mean
    if (current > mean * 1.02) return 2; // SELL when above mean
    return 0; // HOLD
};

// Strategy 3: Momentum
const momentum = (env, agent) => {
    const state = env.getState();
    const rsi = state.rsi;
    
    if (rsi < 30) return 1; // Oversold - BUY
    if (rsi > 70) return 2; // Overbought - SELL
    return 0; // HOLD
};

// Strategy 4: MACD Crossover
const macdCrossover = (env, agent) => {
    const state = env.getState();
    const macd = state.macd;
    const signal = state.macdSignal;
    
    if (macd > signal && macd < 0) return 1; // MACD crosses up - BUY
    if (macd < signal && macd > 0) return 2; // MACD crosses down - SELL
    return 0; // HOLD
};

// Strategy 5: Scalping (fast EMA + RSI + volume)
const scalping = (env, agent) => {
    const state = env.getState();
    const closes = state.close;
    const volumes = state.volume;
    
    // Not enough data
    if (closes.length < 20) return 0;
    
    // Fast EMA (5) vs Slow EMA (20)
    const ema5 = calcEMA(closes, 5);
    const ema20 = calcEMA(closes, 20);
    const ema5Prev = calcEMA(closes.slice(0, -1), 5);
    const ema20Prev = calcEMA(closes.slice(0, -1), 20);
    
    // RSI (9-period for scalping)
    const rsi = state.rsi || calcRSI(closes, 9);
    
    // Volume surge (2x average)
    const avgVol = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const volSurge = volumes[volumes.length-1] > avgVol * 1.5;
    
    // EMA crossover signal
    const emaCrossUp = ema5 > ema20 && ema5Prev <= ema20Prev;
    const emaCrossDown = ema5 < ema20 && ema5Prev >= ema20Prev;
    
    // BUY: EMA cross up + RSI not overbought + volume confirmation
    if (emaCrossUp && rsi < 65 && volSurge) return 1;
    
    // SELL: EMA cross down + RSI not oversold
    if (emaCrossDown && rsi > 35) return 2;
    
    // Quick profit: RSI extreme + trend against
    if (rsi < 25) return 1; // Oversold - quick bounce
    if (rsi > 75) return 2; // Overbought - quick drop
    
    return 0; // HOLD
};

// Helper: EMA calculation
const calcEMA = (data, period) => {
    if (data.length < period) return data[data.length-1];
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a,b) => a+b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
};

// Helper: RSI calculation
const calcRSI = (data, period = 14) => {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i] - data[i-1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

module.exports = { trendFollowing, meanReversion, momentum, macdCrossover, scalping };
