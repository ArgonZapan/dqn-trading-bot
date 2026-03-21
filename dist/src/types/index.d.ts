export type TradingPair = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT';
export type Action = 0 | 1 | 2;
export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
}
export interface Indicators {
    rsi: number;
    macd: {
        value: number;
        signal: number;
        histogram: number;
    };
    ema9: number;
    ema21: number;
    ema50: number;
    bb: {
        upper: number;
        middle: number;
        lower: number;
    };
    volumeRatio: number;
}
export interface State {
    candles: number[];
    indicators: Indicators;
    position: number;
    unrealizedPnl: number;
    timeSinceTrade: number;
    btcRatio: number;
}
export interface Experience {
    state: State;
    action: Action;
    reward: number;
    nextState: State;
    done: boolean;
    priority?: number;
}
export interface Trade {
    id: string;
    timestamp: number;
    pair: TradingPair;
    action: Action;
    price: number;
    quantity: number;
    pnl?: number;
    fees: number;
}
export interface DQNAgentConfig {
    learningRate: number;
    gamma: number;
    epsilonStart: number;
    epsilonEnd: number;
    epsilonDecay: number;
    replayBufferSize: number;
    batchSize: number;
    targetUpdateInterval: number;
    trainingInterval: number;
    useDoubleDQN: boolean;
    useDuelingNetwork: boolean;
    usePER: boolean;
}
export interface BacktestResult {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    trades: Trade[];
}
export interface ModelCheckpoint {
    episode: number;
    timestamp: number;
    epsilon: number;
    totalLoss: number;
    avgReward: number;
}
