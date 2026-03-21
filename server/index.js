/**
 * DQN Trading Bot - Main Server with RL
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const HOST = '0.0.0.0';

// State
let prices = { btc: 0, eth: 0, sol: 0 };
let portfolio = { usdt: 1000, btc: 0, eth: 0, sol: 0 };
let trades = [];
let tradingActive = false;
let metrics = { epsilon: 1.0, episode: 0, bufferSize: 0, loss: 0, steps: 0 };

// RL Components
const Env = require('../src/environment');
const Agent = require('../src/dqnAgent');

const env = new Env('BTCUSDT', 60);
const agent = new Agent(300, 3);

// Fetch helper
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

// API Server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const url = req.url.split('?')[0];
    
    if (url === '/api/status') {
        res.end(JSON.stringify({ 
            status: 'running', 
            tradingActive,
            prices,
            portfolio,
            metrics: agent.getMetrics(),
            tradesCount: trades.length
        }));
        return;
    }
    
    if (url === '/api/prices') {
        res.end(JSON.stringify(prices));
        return;
    }
    
    if (url === '/api/portfolio') {
        res.end(JSON.stringify(portfolio));
        return;
    }
    
    if (url === '/api/metrics') {
        res.end(JSON.stringify(agent.getMetrics()));
        return;
    }
    
    if (url === '/api/trades') {
        res.end(JSON.stringify(trades.slice(-20)));
        return;
    }
    
    if (url === '/api/trading/start') {
        tradingActive = true;
        agent.startEpisode();
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    if (url === '/api/trading/stop') {
        tradingActive = false;
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    if (url === '/api/trading/execute') {
        // Manual trade
        executeTrade('manual');
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    // Static files
    res.setHeader('Content-Type', 'text/html');
    const fp = path.join(__dirname, '..', url === '/' ? 'client/index.html' : url);
    if (fs.existsSync(fp)) {
        res.end(fs.readFileSync(fp));
        return;
    }
    res.writeHead(404);
    res.end('Not Found');
});

// Trading logic
async function updatePrices() {
    try {
        const [btc, eth, sol] = await Promise.all([
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT'),
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        ]);
        prices = {
            btc: parseFloat(btc.price),
            eth: parseFloat(eth.price),
            sol: parseFloat(sol.price)
        };
    } catch (e) {}
}

function executeTrade(reason = 'agent') {
    if (!tradingActive || prices.btc === 0) return;
    
    const state = env.getState();
    const action = agent.act(state);
    
    if (action === 1) { // BUY
        const quantity = (portfolio.usdt * 0.95) / prices.btc;
        portfolio.btc += quantity;
        portfolio.usdt *= 0.05;
        trades.push({ time: Date.now(), action: 'BUY', price: prices.btc, quantity });
    } else if (action === 2) { // SELL
        if (portfolio.btc > 0) {
            const pnl = (prices.btc - trades[trades.length-1]?.price || prices.btc) * portfolio.btc;
            portfolio.usdt += portfolio.btc * prices.btc * 0.999; // after fee
            trades.push({ time: Date.now(), action: 'SELL', price: prices.btc, quantity: portfolio.btc, pnl });
            portfolio.btc = 0;
        }
    }
    
    // Store experience
    const newState = env.getState();
    const reward = (action === 1 || action === 2) ? 0.001 : 0;
    agent.remember(state, action, reward, newState, false);
    
    // Train
    const loss = agent.train();
    if (loss !== null) metrics.loss = loss;
    metrics.bufferSize = agent.buffer.size();
}

function tradingTick() {
    if (!tradingActive) return;
    executeTrade();
}

// Routes
setInterval(updatePrices, 3000);
setInterval(tradingTick, 5000);
updatePrices();

server.listen(PORT, HOST, () => {
    const nets = require('os').networkInterfaces();
    for (const n of Object.keys(nets)) {
        for (const i of nets[n]) {
            if (i.family === 'IPv4' && !i.internal) {
                console.log(`DQN Trading Bot: http://${i.address}:${PORT}`);
                break;
            }
        }
    }
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
