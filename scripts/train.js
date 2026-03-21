/**
 * Training Script - Train DQN Agent on historical data
 */

const https = require('https');

const BINANCE = 'https://api.binance.com';

// Fetch candles
function fetchCandles(symbol, interval, limit) {
    return new Promise((resolve, reject) => {
        const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        https.get(url, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.map(k => ({
                        time: k[0],
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5])
                    })));
                } catch(e) { reject(e); }
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Load modules
const Env = require('../src/environment');
const Agent = require('../src/dqnAgent');

async function train() {
    console.log('🤖 DQN Training');
    console.log('================\n');
    
    // Fetch data
    console.log('📥 Fetching BTCUSDT 5m candles...');
    const candles = await fetchCandles('BTCUSDT', '5m', 500);
    console.log(`✅ Got ${candles.length} candles\n`);
    
    // Train/test split
    const split = Math.floor(candles.length * 0.8);
    const trainData = candles.slice(0, split);
    const testData = candles.slice(split);
    console.log(`📊 Train: ${trainData.length} | Test: ${testData.length}\n`);
    
    // Init
    const env = new Env('BTCUSDT', 60);
    const agent = new Agent(300, 3);
    
    // Training
    console.log('🚀 Training (50 episodes)...\n');
    for (let ep = 0; ep < 50; ep++) {
        env.reset(trainData);
        agent.startEpisode();
        
        let totalReward = 0;
        let done = false;
        
        while (!done) {
            const state = env.getState();
            const action = agent.act(state);
            const { reward, done: d } = env.step(action);
            agent.remember(state, action, reward, env.getState(), d);
            agent.replay();
            totalReward += reward;
            done = d;
        }
        
        if (ep % 10 === 0) {
            const balance = env.balance();
            const m = agent.getMetrics();
            console.log(`Ep ${ep}/50 | ε=${m.epsilon.toFixed(3)} | Balance: $${balance.toFixed(2)}`);
        }
    }
    
    // Test
    console.log('\n🧪 Testing on unseen data...');
    env.reset(testData);
    let testDone = false;
    while (!testDone) {
        const state = env.getState();
        const action = agent.act(state);
        const { done } = env.step(action);
        testDone = done;
    }
    
    const finalBalance = env.balance();
    const pnl = ((finalBalance - 1000) / 1000 * 100).toFixed(2);
    
    console.log(`\n📈 Results:`);
    console.log(`   Final Balance: $${finalBalance.toFixed(2)}`);
    console.log(`   P&L: ${pnl}%`);
    console.log(`   Trades: ${env.trades.length}`);
    
    // Save
    console.log('\n💾 Agent ready for deployment!');
    console.log('   Run: node server/index.js\n');
}

train().catch(console.error);
