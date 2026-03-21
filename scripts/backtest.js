/**
 * Backtest Script - Test DQN strategy on historical data
 */

const https = require('https');

const BINANCE = 'https://api.binance.com';

async function fetchJSON(path) {
    return new Promise((resolve, reject) => {
        https.get(BINANCE + path, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch(e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function getKlines(symbol, interval = '5m', limit = 500) {
    const data = await fetchJSON(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
    }));
}

// Simple backtest
async function backtest(episodes = 20) {
    console.log('📊 DQN Backtest');
    console.log('Pobieranie danych...');
    
    const candles = await getKlines('BTCUSDT', '5m', 500);
    console.log(`Mam ${candles.length} świec`);
    
    // Split: 80% train, 20% test
    const split = Math.floor(candles.length * 0.8);
    const trainData = candles.slice(0, split);
    const testData = candles.slice(split);
    
    console.log(`Trening: ${trainData.length} | Test: ${testData.length}`);
    
    // Simple agent (random for demo)
    let epsilon = 1.0;
    const epsilonDecay = 0.995;
    const epsilonMin = 0.01;
    
    let capital = 1000;
    let btc = 0;
    let trades = [];
    let position = 0;
    
    // Training loop
    console.log('Trenowanie...');
    for (let ep = 0; ep < episodes; ep++) {
        let step = 60;
        while (step < trainData.length - 1) {
            // Epsilon-greedy
            const action = Math.random() < epsilon 
                ? Math.floor(Math.random() * 3) 
                : Math.floor(Math.random() * 3); // Random for demo
            
            const price = trainData[step].close;
            
            if (action === 1 && position === 0) {
                btc = (capital * 0.95) / price;
                capital = capital * 0.05;
                position = 1;
            } else if (action === 2 && position === 1) {
                const pnl = (price - trades[trades.length-1]?.price || price) * btc;
                capital += btc * price * 0.999;
                trades.push({ action: 'SELL', price, pnl });
                btc = 0;
                position = 0;
            }
            
            step++;
        }
        
        epsilon = Math.max(epsilonMin, epsilon * epsilonDecay);
        
        if (ep % 5 === 0) {
            const balance = capital + btc * trainData[step-1].close;
            console.log(`Ep ${ep}/${episodes} | ε=${epsilon.toFixed(3)} | Balance: $${balance.toFixed(2)}`);
        }
    }
    
    // Test
    console.log('\n🧪 Test na danych testowych...');
    let testBalance = 1000;
    let testBtc = 0;
    let testTrades = [];
    let testPos = 0;
    
    for (let step = 60; step < testData.length - 1; step++) {
        const action = Math.random() < epsilonMin ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 3);
        const price = testData[step].close;
        
        if (action === 1 && testPos === 0) {
            testBtc = (testBalance * 0.95) / price;
            testBalance = testBalance * 0.05;
            testPos = 1;
        } else if (action === 2 && testPos === 1) {
            testBalance += testBtc * price * 0.999;
            testTrades.push({ price });
            testBtc = 0;
            testPos = 0;
        }
    }
    
    const finalBalance = testBalance + testBtc * testData[testData.length-1].close;
    const pnl = ((finalBalance - 1000) / 1000 * 100).toFixed(2);
    
    console.log('\n📈 WYNIKI:');
    console.log(`Balance końcowy: $${finalBalance.toFixed(2)}`);
    console.log(`P&L: ${pnl}%`);
    console.log(`Trades: ${testTrades.length}`);
    
    const wins = testTrades.filter(t => t.price > 0).length;
    const winRate = testTrades.length > 0 ? (wins / testTrades.length * 100).toFixed(1) : 0;
    console.log(`Win rate: ${winRate}%`);
    console.log(`Max drawdown: --`);
    
    return { finalBalance, pnl, trades: testTrades.length, winRate };
}

backtest(20).catch(console.error);
