"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBacktest = runBacktest;
/**
 * Backtest Engine
 */
const BinanceClient_1 = require("../src/services/BinanceClient");
const TradingEnvironment_1 = require("../src/environments/TradingEnvironment");
const DQNAgent_1 = require("../src/agents/DQNAgent");
const MetricsCalculator_1 = require("../src/utils/MetricsCalculator");
async function runBacktest(pair, episodes = 10, startDate, endDate) {
    const binance = new BinanceClient_1.BinanceClient();
    console.log(`📊 Running backtest for ${pair}...`);
    // Fetch data
    const klines = await binance.getKlines(pair, '5m', 500);
    if (klines.length < 100)
        throw new Error('Not enough data');
    // Split: 80% train, 20% test
    const splitIdx = Math.floor(klines.length * 0.8);
    const trainData = klines.slice(0, splitIdx);
    const testData = klines.slice(splitIdx);
    // Train agent
    const agent = new DQNAgent_1.DQNAgent({
        epsilonStart: 1.0,
        epsilonEnd: 0.1,
        epsilonDecay: 0.995,
        replayBufferSize: 10000,
        batchSize: 32,
    });
    const env = new TradingEnvironment_1.TradingEnvironment(pair, 60);
    console.log(`🎮 Training on ${trainData.length} candles...`);
    for (let ep = 0; ep < episodes; ep++) {
        let state = env.reset(trainData);
        let done = false;
        agent.startEpisode();
        while (!done) {
            const action = agent.selectAction(state);
            const { state: ns, reward, done: d } = env.step(action);
            agent.store(state, action, reward, ns, d);
            agent.train();
            state = ns;
            done = d;
        }
        if (ep % 5 === 0) {
            const m = agent.getMetrics();
            console.log(`Episode ${ep}/${episodes} | ε=${m.epsilon.toFixed(3)} | buffer=${m.bufferSize}`);
        }
    }
    // Test on unseen data
    console.log(`🧪 Testing on ${testData.length} candles...`);
    const testEnv = new TradingEnvironment_1.TradingEnvironment(pair, 60);
    let testState = testEnv.reset(testData);
    let done = false;
    while (!done) {
        const action = agent.selectAction(testState);
        const { state: ns, done: d } = testEnv.step(action);
        testState = ns;
        done = d;
    }
    const balance = testEnv.getBalance();
    const trades = testEnv.getTrades();
    // Compute full metrics
    const metrics = (0, MetricsCalculator_1.calculateMetrics)(trades, 1000);
    const result = {
        totalTrades: metrics.totalTrades,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        winRate: metrics.winRate,
        totalPnl: metrics.totalPnl,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        trades
    };
    console.log(`\n✅ Backtest Results for ${pair}:`);
    console.log(`   Balance: $${balance.total.toFixed(2)}`);
    console.log(`   P&L: $${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPercent >= 0 ? '+' : ''}${metrics.totalPnlPercent.toFixed(2)}%)`);
    console.log(`   Max Drawdown: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`   Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
    console.log(`   Trades: ${trades.length} | Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`);
    console.log(`   Profit Factor: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}`);
    return result;
}
// Run if called directly
if (require.main === module) {
    const pair = process.argv[2] || 'BTCUSDT';
    runBacktest(pair, 20)
        .then(r => { console.log('\nDone!'); process.exit(0); })
        .catch(e => { console.error('Error:', e); process.exit(1); });
}
