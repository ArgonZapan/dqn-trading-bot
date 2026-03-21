/**
 * DQN Trading Bot - Main Server with RL Training
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
let trainingActive = false;
let metrics = { epsilon: 1.0, episode: 0, bufferSize: 0, loss: 0, steps: 0, isTraining: false };
let lastModelSave = 0;

// Episode tracking for chart
let episodeTrades = [];
let currentEpisodeSteps = [];
let episodeEpsilons = [];
let episodeEquity = [];
let episodeStartBalance = 1000;

// Models directory
const MODELS_DIR = './models';
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// RL Components
const Env = require('../src/environment');
const Agent = require('../src/dqnAgent');

const env = new Env('BTCUSDT', 60);
const agent = new Agent(300, 3);

// Load last model if exists
async function loadLastModel() {
    try {
        const files = fs.readdirSync(MODELS_DIR).filter(f => f.startsWith('dqn-ep')).sort();
        if (files.length > 0) {
            const lastModel = files[files.length - 1];
            const modelPath = path.join(MODELS_DIR, lastModel);
            await agent.load(modelPath);
            const episodeNum = parseInt(lastModel.match(/dqn-ep(\d+)/)?.[1] || '0');
            agent.episode = episodeNum;
            console.log(`📂 Loaded model: ${lastModel}`);
            return true;
        }
    } catch(e) {
        console.log('No previous model found, starting fresh');
    }
    return false;
}

// Save model
async function saveModel() {
    const now = Date.now();
    if (now - lastModelSave < 10 * 60 * 1000) return; // Max every 10 min
    lastModelSave = now;
    
    const filename = `dqn-ep${agent.episode}.json`;
    const modelPath = path.join(MODELS_DIR, filename);
    await agent.save(modelPath);
    console.log(`💾 Model saved: ${filename}`);
}

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
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const url = req.url.split('?')[0];
    
    if (url === '/api/status') {
        res.end(JSON.stringify({ 
            status: 'running', 
            tradingActive,
            trainingActive,
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
        res.end(JSON.stringify({...agent.getMetrics(), isTraining: trainingActive}));
        return;
    }
    
    if (url === '/api/trades') {
        res.end(JSON.stringify(trades.slice(-20)));
        return;
    }
    
    if (url === '/api/episode-data') {
        res.end(JSON.stringify({
            prices: currentEpisodeSteps,
            trades: episodeTrades,
            epsilons: episodeEpsilons,
            equity: episodeEquity
        }));
        return;
    }
    
    // Training controls
    if (url === '/api/training/start') {
        if (!trainingActive) {
            trainingActive = true;
            agent.startEpisode();
            episodeTrades = [];
            currentEpisodeSteps = [];
            episodeEpsilons = [];
            console.log('▶ Training started');
        }
        res.end(JSON.stringify({ success: true, trainingActive }));
        return;
    }
    
    if (url === '/api/training/stop') {
        trainingActive = false;
        console.log('⏹ Training stopped');
        res.end(JSON.stringify({ success: true, trainingActive }));
        return;
    }
    
    if (url === '/api/training/save') {
        await saveModel();
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

// Training step
async function trainingStep() {
    if (!trainingActive) return;
    
    const state = env.getState();
    const action = agent.act(state);
    
    // Execute action in environment
    const { reward, done } = env.execute(action);
    const newState = env.getState();
    
    // Check for trade execution (BUY or SELL)
    const tradesAfter = env.trades;
    if (tradesAfter.length > episodeTrades.length) {
        const newTrade = tradesAfter[tradesAfter.length - 1];
        episodeTrades.push({
            step: metrics.steps,
            action: newTrade.action === 1 ? 'BUY' : 'SELL',
            price: newTrade.price,
            pnl: newTrade.pnl || 0,
            quantity: newTrade.quantity
        });
    }
    
    // Calculate equity
    const currentBalance = env.capital;
    episodeEquity.push({
        step: metrics.steps,
        equity: currentBalance,
        drawdown: ((episodeStartBalance - currentBalance) / episodeStartBalance) * 100
    });
    
    // Store experience
    agent.remember(state, action, reward, newState, done);
    
    // Train
    const loss = await agent.replay();
    if (loss !== null) metrics.loss = loss;
    
    // Track price and epsilon
    currentEpisodeSteps.push({ step: metrics.steps, price: prices.btc, time: Date.now() });
    episodeEpsilons.push({ step: metrics.steps, epsilon: agent.epsilon });
    
    // Episode end (every 100 steps)
    if (done || (metrics.steps > 0 && metrics.steps % 100 === 0)) {
        agent.startEpisode();
        await saveModel();
        episodeTrades = [];
        currentEpisodeSteps = [];
        episodeEpsilons = [];
        episodeEquity = [];
        episodeStartBalance = env.capital;
    }
    
    metrics.bufferSize = agent.buffer.length;
    metrics.steps++;
}

// Update prices
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

// Routes
setInterval(updatePrices, 3000);
setInterval(trainingStep, 1000); // Training tick every second
updatePrices();

// Load last model on start
loadLastModel();

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
