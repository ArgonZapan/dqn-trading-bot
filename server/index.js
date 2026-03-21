/**
 * DQN Trading Bot - Main Server
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
let metrics = { epsilon: 1.0, episode: 0, bufferSize: 0, loss: 0, tradesCount: 0 };

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

// Server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const u = req.url.split('?')[0];
    
    // API
    if (u === '/api/status') { res.end(JSON.stringify({ status: 'running', tradingActive, prices, portfolio, metrics, tradesCount: trades.length })); return; }
    if (u === '/api/prices') { res.end(JSON.stringify(prices)); return; }
    if (u === '/api/portfolio') { res.end(JSON.stringify(portfolio)); return; }
    if (u === '/api/metrics') { res.end(JSON.stringify(metrics)); return; }
    if (u === '/api/trades') { res.end(JSON.stringify(trades.slice(-20))); return; }
    
    if (u === '/api/trading/start') { tradingActive = true; res.end(JSON.stringify({ success: true })); return; }
    if (u === '/api/trading/stop') { tradingActive = false; res.end(JSON.stringify({ success: true })); return; }
    
    if (u === '/api/trading/execute') {
        // Execute trade (paper)
        const symbol = req.method === 'POST' ? 'BTC' : 'BTC';
        const price = prices.btc;
        if (tradingActive && price > 0) {
            const action = Math.random() > 0.5 ? 'BUY' : 'SELL';
            trades.push({ time: Date.now(), action, price, symbol });
            metrics.tradesCount++;
        }
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    // Static files
    res.setHeader('Content-Type', 'text/html');
    const fp = path.join(__dirname, '..', u === '/' ? 'client/index.html' : u);
    if (fs.existsSync(fp)) { res.end(fs.readFileSync(fp)); return; }
    res.writeHead(404); res.end('Not Found');
});

// Price updates
async function updatePrices() {
    try {
        const [btc, eth, sol] = await Promise.all([
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT'),
            fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        ]);
        prices = { btc: parseFloat(btc.price), eth: parseFloat(eth.price), sol: parseFloat(sol.price) };
    } catch(e) {}
}

// Simple trading logic (demo)
function tradingTick() {
    if (!tradingActive || prices.btc === 0) return;
    // Random demo trade
    if (Math.random() > 0.98) {
        const action = Math.random() > 0.5 ? 'BUY' : 'SELL';
        trades.push({ time: Date.now(), action, price: prices.btc, symbol: 'BTCUSDT' });
        if (action === 'BUY') {
            portfolio.btc += portfolio.usdt * 0.95 / prices.btc;
            portfolio.usdt *= 0.05;
        } else {
            portfolio.usdt += portfolio.btc * prices.btc * 0.995;
            portfolio.btc = 0;
        }
        metrics.tradesCount++;
    }
}

// Start
setInterval(updatePrices, 3000);
setInterval(tradingTick, 5000);
updatePrices();

server.listen(PORT, HOST, () => {
    const nets = require('os').networkInterfaces();
    for (const n of Object.keys(nets)) {
        for (const i of nets[n]) {
            if (i.family === 'IPv4' && !i.internal) {
                console.log(`DQN Bot: http://${i.address}:${PORT}`);
                break;
            }
        }
    }
});
