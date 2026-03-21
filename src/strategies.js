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

module.exports = { trendFollowing, meanReversion, momentum, macdCrossover };
