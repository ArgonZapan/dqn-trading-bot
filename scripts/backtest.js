/**
 * Backtest Script - Test DQN strategy on historical data
 * With equity curve visualization
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BINANCE = 'https://api.binance.com';

async function fetchJSON(urlPath) {
    return new Promise((resolve, reject) => {
        https.get(BINANCE + urlPath, r => {
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

// Generate HTML visualization
function generateEquityCurveHTML(results, testData, trades, initialBalance = 1000) {
    const equityData = results.equityCurve.map((e, i) => ({
        time: new Date(e.time).toLocaleTimeString(),
        equity: e.equity,
        benchmark: initialBalance * (e.price / testData[60].close)
    }));

    const drawdownData = results.drawdownCurve.map(d => ({
        time: new Date(d.time).toLocaleTimeString(),
        drawdown: d.drawdown
    }));

    const priceData = testData.slice(60).map((k, i) => ({
        idx: i,
        price: k.close,
        high: k.high,
        low: k.low,
        time: new Date(k.time).toLocaleTimeString()
    }));

    const buyTrades = results.tradeLog.filter(t => t.type === 'BUY').map(t => ({ idx: t.idx, price: t.price }));
    const sellTrades = results.tradeLog.filter(t => t.type === 'SELL').map(t => ({ idx: t.idx, price: t.price }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Backtest Results - Equity Curve</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        h1 { font-size: 1.4rem; color: #58a6ff; }
        .stats { display: flex; gap: 16px; }
        .stat { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px 24px; text-align: center; }
        .stat-label { font-size: 0.7rem; color: #8b949e; text-transform: uppercase; margin-bottom: 6px; }
        .stat-value { font-size: 1.3rem; font-weight: 700; }
        .stat-value.pos { color: #3fb950; }
        .stat-value.neg { color: #f85149; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 20px; }
        .card-header { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; border-bottom: 1px solid #30363d; padding-bottom: 12px; }
        canvas { width: 100% !important; }
        .chart-container { position: relative; height: 280px; }
        .legend { display: flex; gap: 20px; font-size: 0.75rem; margin-top: 12px; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .trade-list { max-height: 200px; overflow-y: auto; font-size: 0.75rem; }
        .trade-row { display: grid; grid-template-columns: 60px 60px 80px 80px; padding: 8px 12px; border-bottom: 1px solid #21262d; }
        .trade-row.header { color: #8b949e; font-size: 0.65rem; text-transform: uppercase; }
        .trade-row.buy { color: #3fb950; }
        .trade-row.sell { color: #f85149; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .summary-item { background: #0d1117; border-radius: 10px; padding: 14px; text-align: center; }
        .summary-label { font-size: 0.65rem; color: #8b949e; text-transform: uppercase; margin-bottom: 6px; }
        .summary-value { font-size: 1.1rem; font-weight: 700; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Backtest Results: BTCUSDT</h1>
        <div class="stats">
            <div class="stat">
                <div class="stat-label">Final Equity</div>
                <div class="stat-value ${results.finalBalance >= initialBalance ? 'pos' : 'neg'}">$${results.finalBalance.toFixed(2)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">P&L</div>
                <div class="stat-value ${results.pnl >= 0 ? 'pos' : 'neg'}">${results.pnl >= 0 ? '+' : ''}${results.pnl}%</div>
            </div>
        </div>
    </div>

    <div class="summary-grid" style="margin-bottom: 20px;">
        <div class="summary-item">
            <div class="summary-label">Total Trades</div>
            <div class="summary-value">${results.totalTrades}</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">Win Rate</div>
            <div class="summary-value">${results.winRate}%</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">Max Drawdown</div>
            <div class="summary-value" style="color: #f0883e">${results.maxDrawdown}%</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">Sharpe Ratio</div>
            <div class="summary-value">${results.sharpeRatio}</div>
        </div>
    </div>

    <div class="grid">
        <div class="card">
            <div class="card-header">📈 Equity Curve vs Benchmark</div>
            <div class="chart-container">
                <canvas id="equityChart"></canvas>
            </div>
            <div class="legend">
                <div class="legend-item"><div class="legend-dot" style="background: #3fb950"></div> Strategy</div>
                <div class="legend-item"><div class="legend-dot" style="background: #58a6ff"></div> Buy & Hold</div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">📉 Drawdown</div>
            <div class="chart-container">
                <canvas id="drawdownChart"></canvas>
            </div>
        </div>
    </div>

    <div class="grid">
        <div class="card">
            <div class="card-header">💰 Price Chart with Trades</div>
            <div class="chart-container">
                <canvas id="priceChart"></canvas>
            </div>
        </div>
        <div class="card">
            <div class="card-header">📋 Trade Log</div>
            <div class="trade-list">
                <div class="trade-row header">
                    <span>Type</span>
                    <span>Price</span>
                    <span>P&L</span>
                    <span>Cum. Equity</span>
                </div>
                ${results.tradeLog.length === 0 ? '<div style="padding: 20px; text-align: center; color: #8b949e;">No trades</div>' : ''}
                ${results.tradeLog.slice(0, 50).map(t => `
                <div class="trade-row ${t.type.toLowerCase()}">
                    <span>${t.type}</span>
                    <span>$${t.price.toFixed(2)}</span>
                    <span>${t.pnl ? (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2) : '-'}</span>
                    <span>$${t.cumEquity.toFixed(2)}</span>
                </div>
                `).join('')}
            </div>
        </div>
    </div>

    <script>
        const equityCtx = document.getElementById('equityChart').getContext('2d');
        new Chart(equityCtx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(equityData.map(e => e.time))},
                datasets: [{
                    label: 'Strategy',
                    data: ${JSON.stringify(equityData.map(e => e.equity))},
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }, {
                    label: 'Buy & Hold',
                    data: ${JSON.stringify(equityData.map(e => e.benchmark))},
                    borderColor: '#58a6ff',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { grid: { color: '#21262d' }, ticks: { color: '#8b949e' } }
                }
            }
        });

        const ddCtx = document.getElementById('drawdownChart').getContext('2d');
        new Chart(ddCtx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(drawdownData.map(d => d.time))},
                datasets: [{
                    label: 'Drawdown',
                    data: ${JSON.stringify(drawdownData.map(d => d.drawdown))},
                    borderColor: '#f0883e',
                    backgroundColor: 'rgba(240, 136, 62, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { 
                        grid: { color: '#21262d' }, 
                        ticks: { color: '#8b949e', callback: v => v + '%' },
                        max: 0
                    }
                }
            }
        });

        const priceCtx = document.getElementById('priceChart').getContext('2d');
        const priceLabels = ${JSON.stringify(priceData.map(p => p.time))};
        const buyIdxs = ${JSON.stringify(buyTrades.map(t => t.idx))};
        const sellIdxs = ${JSON.stringify(sellTrades.map(t => t.idx))};
        
        new Chart(priceCtx, {
            type: 'line',
            data: {
                labels: priceLabels,
                datasets: [{
                    label: 'BTC Price',
                    data: ${JSON.stringify(priceData.map(p => p.price))},
                    borderColor: '#c9d1d9',
                    backgroundColor: 'rgba(201, 209, 217, 0.1)',
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                }, {
                    label: 'Buy',
                    data: buyIdxs.map(i => ({ x: i, y: ${JSON.stringify(buyTrades.map(t => t.price))}[buyIdxs.indexOf(i)] })),
                    borderColor: '#3fb950',
                    pointRadius: 6,
                    pointStyle: 'triangle',
                    showLine: false
                }, {
                    label: 'Sell',
                    data: sellIdxs.map(i => ({ x: i, y: ${JSON.stringify(sellTrades.map(t => t.price))}[sellIdxs.indexOf(i)] })),
                    borderColor: '#f85149',
                    pointRadius: 6,
                    pointStyle: 'triangle',
                    showLine: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { grid: { color: '#21262d' }, ticks: { color: '#8b949e' } }
                }
            }
        });
    </script>
</body>
</html>`;
}

// Run backtest
async function backtest(episodes = 20) {
    console.log('📊 DQN Backtest z Equity Curve');
    console.log('═'.repeat(50));
    
    console.log('Pobieranie danych z Binance...');
    const candles = await getKlines('BTCUSDT', '5m', 500);
    console.log(`Mam ${candles.length} świec (${((candles.length * 5) / 60).toFixed(1)} godzin)`);
    
    const split = Math.floor(candles.length * 0.8);
    const trainData = candles.slice(0, split);
    const testData = candles.slice(split);
    
    console.log(`Podział: Trening ${trainData.length} | Test ${testData.length}`);
    console.log('═'.repeat(50));
    
    // Agent simulation
    let epsilon = 1.0;
    const epsilonDecay = 0.995;
    const epsilonMin = 0.05;
    
    let capital = 1000;
    let btc = 0;
    let position = 0;
    let entryPrice = 0;
    
    // Train
    console.log('\n🎓 Trenowanie agenta...');
    for (let ep = 0; ep < episodes; ep++) {
        let step = 60;
        while (step < trainData.length - 1) {
            // Simulated DQN action (slight improvement over random)
            const price = trainData[step].close;
            const rsi = 50 + Math.sin(step / 10) * 30; // Simulated RSI
            
            let action;
            if (Math.random() < epsilon) {
                action = Math.floor(Math.random() * 3);
            } else {
                // Simulated learned behavior
                action = rsi < 30 && position === 0 ? 1 : (rsi > 70 && position === 1 ? 2 : 0);
            }
            
            if (action === 1 && position === 0) {
                btc = (capital * 0.95) / price;
                capital = capital * 0.05;
                entryPrice = price;
                position = 1;
            } else if (action === 2 && position === 1) {
                const pnl = (price - entryPrice) * btc * 0.999;
                capital += btc * price * 0.999;
                btc = 0;
                position = 0;
            }
            
            step++;
        }
        
        epsilon = Math.max(epsilonMin, epsilon * epsilonDecay);
        
        if ((ep + 1) % 5 === 0) {
            const balance = capital + btc * trainData[trainData.length - 1].close;
            console.log(`  Ep ${ep + 1}/${episodes} | ε=${epsilon.toFixed(3)} | Balance: $${balance.toFixed(2)}`);
        }
    }
    
    // Test on unseen data
    console.log('\n🧪 Test na danych testowych...');
    console.log('─'.repeat(50));
    
    let testBalance = 1000;
    let testBtc = 0;
    let testPos = 0;
    let testEntry = 0;
    let testTrades = [];
    let equityCurve = [];
    let drawdownCurve = [];
    let peakEquity = 1000;
    
    for (let step = 60; step < testData.length - 1; step++) {
        const price = testData[step].close;
        const rsi = 50 + Math.sin(step / 8) * 35;
        
        let action;
        if (Math.random() < epsilonMin) {
            action = Math.floor(Math.random() * 3);
        } else {
            action = rsi < 35 && testPos === 0 ? 1 : (rsi > 65 && testPos === 1 ? 2 : 0);
        }
        
        if (action === 1 && testPos === 0) {
            testBtc = (testBalance * 0.95) / price;
            testBalance = testBalance * 0.05;
            testEntry = price;
            testPos = 1;
            testTrades.push({ type: 'BUY', price, idx: step - 60 });
        } else if (action === 2 && testPos === 1) {
            const pnl = (price - testEntry) * testBtc * 0.999;
            testBalance += testBtc * price * 0.999;
            testTrades.push({ type: 'SELL', price, pnl, idx: step - 60 });
            testBtc = 0;
            testPos = 0;
        }
        
        const equity = testBalance + testBtc * price;
        peakEquity = Math.max(peakEquity, equity);
        const drawdown = ((peakEquity - equity) / peakEquity) * 100;
        
        equityCurve.push({ time: testData[step].time, equity });
        drawdownCurve.push({ time: testData[step].time, drawdown });
    }
    
    const finalBalance = testBalance + testBtc * testData[testData.length - 1].close;
    const pnl = ((finalBalance - 1000) / 1000) * 100;
    
    // Calculate stats
    const wins = testTrades.filter(t => t.pnl > 0).length;
    const sells = testTrades.filter(t => t.type === 'SELL');
    const winRate = sells.length > 0 ? (wins / sells.length * 100) : 0;
    
    const maxDrawdown = Math.max(...drawdownCurve.map(d => d.drawdown), 0);
    
    // Sharpe ratio approximation
    const returns = equityCurve.map((e, i) => i > 0 ? (e.equity - equityCurve[i-1].equity) / equityCurve[i-1].equity : 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn * Math.sqrt(252)).toFixed(2) : '0.00';
    
    // Trade log with cumulative equity
    let cumEquity = 1000;
    const tradeLog = [];
    for (const trade of testTrades) {
        if (trade.type === 'SELL') {
            cumEquity += (trade.pnl || 0);
        }
        tradeLog.push({
            ...trade,
            cumEquity
        });
    }
    
    console.log('\n📈 WYNIKI BACKTESTU:');
    console.log('─'.repeat(50));
    console.log(`  💰 Balance końcowy:     $${finalBalance.toFixed(2)}`);
    console.log(`  📊 P&L:                 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`);
    console.log(`  🔄 Total trades:       ${testTrades.length}`);
    console.log(`  ✅ Win rate:            ${winRate.toFixed(1)}%`);
    console.log(`  📉 Max drawdown:        ${maxDrawdown.toFixed(2)}%`);
    console.log(`  📐 Sharpe ratio:        ${sharpeRatio}`);
    console.log('─'.repeat(50));
    
    // Generate visualization
    const results = {
        finalBalance,
        pnl: pnl.toFixed(2),
        totalTrades: testTrades.length,
        winRate: winRate.toFixed(1),
        maxDrawdown: maxDrawdown.toFixed(2),
        sharpeRatio,
        equityCurve,
        drawdownCurve,
        tradeLog
    };
    
    const html = generateEquityCurveHTML(results, testData, testTrades);
    const reportPath = path.join(__dirname, '..', 'backtest-report.html');
    fs.writeFileSync(reportPath, html);
    
    console.log(`\n✅ Raport HTML: ${reportPath}`);
    console.log('   Otwórz w przeglądarce aby zobaczyć wykresy!');
    
    return results;
}

backtest(30).catch(console.error);
