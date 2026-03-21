/**
 * Backtest Engine
 */
import { BinanceClient } from '../src/services/BinanceClient';
import { TradingEnvironment } from '../src/environments/TradingEnvironment';
import { DQNAgent } from '../src/agents/DQNAgent';
import { BacktestResult } from '../src/types';

export async function runBacktest(
    pair: string,
    episodes: number = 10,
    startDate?: string,
    endDate?: string
): Promise<BacktestResult> {
    const binance = new BinanceClient();
    
    console.log(`📊 Running backtest for ${pair}...`);
    
    // Fetch data
    const klines = await binance.getKlines(pair, '5m', 500);
    if (klines.length < 100) throw new Error('Not enough data');
    
    // Split: 80% train, 20% test
    const splitIdx = Math.floor(klines.length * 0.8);
    const trainData = klines.slice(0, splitIdx);
    const testData = klines.slice(splitIdx);
    
    // Train agent
    const agent = new DQNAgent({
        epsilonStart: 1.0,
        epsilonEnd: 0.1,
        epsilonDecay: 0.995,
        replayBufferSize: 10000,
        batchSize: 32,
    });
    
    const env = new TradingEnvironment(pair, 60);
    
    console.log(`🎮 Training on ${trainData.length} candles...`);
    for (let ep = 0; ep < episodes; ep++) {
        const state = env.reset(trainData);
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
    const testEnv = new TradingEnvironment(pair, 60);
    const testState = testEnv.reset(testData);
    let done = false;
    
    while (!done) {
        const action = agent.selectAction(testState);
        const { state: ns, done: d } = testEnv.step(action);
        testState = ns;
        done = d;
    }
    
    const balance = testEnv.getBalance();
    const trades = testEnv.getTrades();
    const wins = trades.filter((t: any) => (t.pnl || 0) > 0).length;
    
    const result: BacktestResult = {
        totalTrades: trades.length,
        winningTrades: wins,
        losingTrades: trades.length - wins,
        winRate: trades.length > 0 ? wins / trades.length : 0,
        totalPnl: balance.total - 1000,
        maxDrawdown: 0,
        sharpeRatio: 0,
        trades
    };
    
    console.log(`\n✅ Backtest Results for ${pair}:`);
    console.log(`   Balance: $${balance.total.toFixed(2)}`);
    console.log(`   P&L: $${result.totalPnl.toFixed(2)}`);
    console.log(`   Trades: ${trades.length}`);
    console.log(`   Win Rate: ${(result.winRate * 100).toFixed(1)}%`);
    
    return result;
}

// Run if called directly
if (require.main === module) {
    const pair = process.argv[2] || 'BTCUSDT';
    runBacktest(pair, 20)
        .then(r => { console.log('\nDone!'); process.exit(0); })
        .catch(e => { console.error('Error:', e); process.exit(1); });
}
