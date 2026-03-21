"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Training Script
 */
const BinanceClient_1 = require("../src/services/BinanceClient");
const TradingEnvironment_1 = require("../src/environments/TradingEnvironment");
const DQNAgent_1 = require("../src/agents/DQNAgent");
async function train() {
    console.log('🚀 DQN Training...');
    const binance = new BinanceClient_1.BinanceClient();
    const agent = new DQNAgent_1.DQNAgent({});
    console.log('📥 Fetching data...');
    const klines = await binance.getKlines('BTCUSDT', '5m', 500);
    console.log(`   Got ${klines.length} candles`);
    if (klines.length < 100) {
        console.error('❌ Not enough data');
        process.exit(1);
    }
    const episodes = 50;
    const env = new TradingEnvironment_1.TradingEnvironment('BTCUSDT', 60);
    console.log(`\n🎮 Training ${episodes} episodes...`);
    for (let ep = 0; ep < episodes; ep++) {
        let state = env.reset(klines);
        let totalReward = 0, done = false;
        agent.startEpisode();
        while (!done) {
            const action = agent.selectAction(state);
            const { state: ns, reward, done: d } = env.step(action);
            agent.store(state, action, reward, ns, d);
            const loss = agent.train();
            totalReward += reward;
            state = ns;
            done = d;
        }
        if (ep % 10 === 0) {
            const m = agent.getMetrics();
            console.log(`Episode ${ep.toString().padStart(3)} | ε=${m.epsilon.toFixed(4)} | loss=${m.avgLoss.toFixed(6)} | buffer=${m.bufferSize}`);
        }
    }
    console.log('\n💾 Saving model...');
    agent.save('./models/dqn-model.json');
    const m = agent.getMetrics();
    console.log(`\n✅ Done! Episodes: ${m.episode} | ε: ${m.epsilon.toFixed(4)} | Buffer: ${m.bufferSize}`);
}
train().catch(console.error);
