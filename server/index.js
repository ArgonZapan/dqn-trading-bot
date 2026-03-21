/**
 * DQN Trading Bot - Main Server with RL Training + Paper Trading
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
let trainingStartTime = 0;
let metrics = { epsilon: 1.0, episode: 0, bufferSize: 0, loss: 0, steps: 0, isTraining: false };
let lastModelSave = 0;

// Paper Trading State
let paperTrading = {
    enabled: false,
    capital: 1000,
    positions: [],
    closedTrades: [],
    stopLoss: 2.0,   // % below entry for SL
    takeProfit: 4.0,  // % above entry for TP
    stats: {
        totalTrades: 0, winningTrades: 0, losingTrades: 0,
        winRate: 0, totalPnl: 0, totalFees: 0,
        profitFactor: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
        avgWin: 0, avgLoss: 0, sharpeRatio: 0,
        currentStreak: 0, bestStreak: 0, worstStreak: 0
    }
};
let paperCandles = [];
let paperStrategy = 'trend';
let paperPositionSize = 0.95;
let paperLastTradeTime = 0;
const PAPER_TRADE_COOLDOWN = 30000; // 30s between trades

// Model persistence config
const MODEL_SAVE_INTERVAL_MS = parseInt(process.env.MODEL_SAVE_INTERVAL_MS || '600000'); // 10 min default

// Episode tracking for chart
let episodeTrades = [];
let currentEpisodeSteps = [];
let episodeEpsilons = [];
let episodeEquity = [];
let episodeStartBalance = 1000;

// Episode history (completed episodes)
let episodeHistory = [];
const MAX_HISTORY = 50;

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
    if (now - lastModelSave < MODEL_SAVE_INTERVAL_MS) return;
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

// Fetch Binance klines (candles)
async function fetchCandles(symbol = 'BTCUSDT', interval = '1m', limit = 100) {
    try {
        const data = await fetchJSON(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        );
        return data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    } catch (e) {
        return [];
    }
}

// Simple technical indicators
function calcIndicators(candles) {
    if (candles.length < 50) return { rsi: 50, ema9: 0, ema21: 0, macd: { value: 0, signal: 0, histogram: 0 } };
    
    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, 14);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const macd = calcMACD(closes);
    
    return { rsi, ema9, ema21, ema50, macd };
}

function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i-1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calcEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
    const emaFast = calcEMA(prices, fast);
    const emaSlow = calcEMA(prices, slow);
    const macdLine = emaFast - emaSlow;
    // Simplified - just return current values
    return { value: macdLine, signal: macdLine * 0.9, histogram: macdLine * 0.1 };
}

// Paper trading signal
function paperSignal(candles, ind) {
    const last = candles[candles.length - 1];
    if (!last || !ind.ema9) return 'HOLD';
    
    if (paperStrategy === 'trend') {
        if (ind.ema9 > ind.ema21 && last.close > ind.ema9) return 'BUY';
        if (ind.ema9 < ind.ema21 && last.close < ind.ema9) return 'SELL';
    } else if (paperStrategy === 'momentum') {
        if (ind.rsi < 35) return 'BUY';
        if (ind.rsi > 65) return 'SELL';
    } else if (paperStrategy === 'macd') {
        if (ind.macd.histogram > 0) return 'BUY';
        if (ind.macd.histogram < 0) return 'SELL';
    }
    return 'HOLD';
}

// Update paper trading stats
function updatePaperStats() {
    const closed = paperTrading.closedTrades;
    const winning = closed.filter(t => t.pnl > 0);
    const losing = closed.filter(t => t.pnl <= 0);
    const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
    const totalFees = closed.reduce((s, t) => s + t.fee, 0);
    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const avgWin = winning.length > 0 ? winning.reduce((s, t) => s + t.pnl, 0) / winning.length : 0;
    const avgLoss = losing.length > 0 ? losing.reduce((s, t) => s + t.pnl, 0) / losing.length : 0;
    const profitFactor = totalPnl > 0 && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : totalPnl > 0 ? Infinity : 0;

    // Max drawdown
    let peak = paperTrading.capital;
    let maxDD = 0;
    let maxDDPct = 0;
    for (const t of closed) {
        paperTrading.capital += t.pnl;
        if (paperTrading.capital > peak) peak = paperTrading.capital;
        const dd = peak - paperTrading.capital;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; }
    }
    // Reset capital to current balance
    paperTrading.capital = paperPositionsValue() + paperFreeCapital();

    paperTrading.stats = {
        totalTrades: closed.length,
        winningTrades: winning.length,
        losingTrades: losing.length,
        winRate,
        totalPnl,
        totalFees,
        profitFactor,
        maxDrawdown: maxDD,
        maxDrawdownPercent: maxDDPct,
        avgWin,
        avgLoss,
        sharpeRatio: 0,
        currentStreak: calcStreak(closed, 'current'),
        bestStreak: calcStreak(closed, 'best'),
        worstStreak: calcStreak(closed, 'worst')
    };
}

function calcStreak(trades, type) {
    let streak = 0, best = 0, worst = 0, current = 0;
    for (const t of trades) {
        if (t.pnl > 0) {
            streak = streak > 0 ? streak + 1 : 1;
            best = Math.max(best, streak);
        } else {
            streak = streak < 0 ? streak - 1 : -1;
            worst = Math.min(worst, streak);
        }
    }
    current = streak;
    if (type === 'current') return current;
    if (type === 'best') return best;
    return worst;
}

function paperPositionsValue() {
    return paperTrading.positions.reduce((s, p) => {
        if (p.side === 'LONG') return s + p.quantity * prices.btc;
        return s;
    }, 0);
}

function paperFreeCapital() {
    return paperTrading.capital;
}

// Paper trading loop
let paperOpenPosition = null; // null | { side, entryPrice, quantity }

async function paperTradingStep() {
    if (!paperTrading.enabled) return;
    if (prices.btc === 0) return;
    
    const now = Date.now();
    if (now - paperLastTradeTime < PAPER_TRADE_COOLDOWN) return;
    
    // Fetch fresh candles
    const candles = await fetchCandles('BTCUSDT', '1m', 60);
    if (candles.length < 50) return;
    
    const ind = calcIndicators(candles);
    const signal = paperSignal(candles, ind);
    const currentPrice = prices.btc;
    
    // Update unrealized P&L and check SL/TP
    let slTpTriggered = false;
    let slTpReason = '';
    if (paperOpenPosition) {
        const pnl = paperOpenPosition.side === 'LONG'
            ? (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity
            : (paperOpenPosition.entryPrice - currentPrice) * paperOpenPosition.quantity;
        paperOpenPosition.pnl = pnl;
        paperOpenPosition.pnlPct = ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100;

        // Check Stop Loss / Take Profit
        if (paperOpenPosition.side === 'LONG') {
            if (currentPrice <= paperOpenPosition.stopLoss) {
                slTpTriggered = true;
                slTpReason = 'SL';
            } else if (currentPrice >= paperOpenPosition.takeProfit) {
                slTpTriggered = true;
                slTpReason = 'TP';
            }
        } else if (paperOpenPosition.side === 'SHORT') {
            if (currentPrice >= paperOpenPosition.stopLoss) {
                slTpTriggered = true;
                slTpReason = 'SL';
            } else if (currentPrice <= paperOpenPosition.takeProfit) {
                slTpTriggered = true;
                slTpReason = 'TP';
            }
        }
    }

    // Execute trades (only if not SL/TP triggered)
    if (signal === 'BUY' && !paperOpenPosition) {
        const qty = (paperTrading.capital * paperPositionSize) / currentPrice;
        const fee = currentPrice * qty * 0.001;
        const sl = currentPrice * (1 - paperTrading.stopLoss / 100);
        const tp = currentPrice * (1 + paperTrading.takeProfit / 100);
        paperOpenPosition = {
            id: `paper_${now}`,
            side: 'LONG',
            entryPrice: currentPrice,
            quantity: qty,
            fee,
            pnl: 0,
            pnlPct: 0,
            entryTime: now,
            stopLoss: sl,
            takeProfit: tp
        };
        paperTrading.positions = [paperOpenPosition];
        paperTrading.capital -= qty * currentPrice + fee;
        paperLastTradeTime = now;
        console.log(`📈 PAPER BUY: ${qty.toFixed(6)} BTC @ $${currentPrice.toLocaleString()} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)}`);
    } else if ((signal === 'SELL' || slTpTriggered) && paperOpenPosition) {
        const pnl = (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity;
        const exitFee = currentPrice * paperOpenPosition.quantity * 0.001;
        const netPnl = pnl - paperOpenPosition.fee - exitFee;

        const closed = {
            id: paperOpenPosition.id,
            side: 'BUY',
            price: currentPrice,
            quantity: paperOpenPosition.quantity,
            fee: exitFee,
            pnl: netPnl,
            timestamp: now,
            exitReason: slTpTriggered ? slTpReason : 'SIGNAL'
        };
        paperTrading.closedTrades.push(closed);
        paperTrading.capital += paperOpenPosition.quantity * currentPrice - exitFee;
        paperOpenPosition = null;
        paperTrading.positions = [];
        paperLastTradeTime = now;
        if (slTpTriggered) {
            console.log(`⚡ PAPER ${slTpReason}: P&L $${netPnl.toFixed(2)} @ $${currentPrice.toLocaleString()}`);
        } else {
            console.log(`📉 PAPER SELL: P&L $${netPnl.toFixed(2)}`);
        }
        updatePaperStats();
    }
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
        const trainingDuration = trainingActive ? Date.now() - trainingStartTime : 0;
        res.end(JSON.stringify({...agent.getMetrics(), isTraining: trainingActive, trainingDurationMs: trainingDuration }));
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

    // Episode history (completed episodes summary)
    if (url === '/api/episode-history') {
        // Return without full trades array to keep response small
        const summary = episodeHistory.map(e => ({
            episode: e.episode,
            steps: e.steps,
            startEquity: e.startEquity,
            endEquity: e.endEquity,
            pnlPercent: e.pnlPercent,
            tradesCount: e.tradesCount,
            buyCount: e.buyCount,
            sellCount: e.sellCount,
            maxDrawdown: e.maxDrawdown,
            finalEpsilon: e.finalEpsilon,
            timestamp: e.timestamp
        }));
        res.end(JSON.stringify(summary));
        return;
    }

    if (url === '/api/episode-history/detail') {
        const urlParts = url.split('?');
        const params = new URLSearchParams(urlParts[1]);
        const ep = parseInt(params.get('episode'));
        const entry = episodeHistory.find(e => e.episode === ep);
        if (entry) {
            res.end(JSON.stringify(entry));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Episode not found' }));
        }
        return;
    }
    
    // Paper Trading endpoints
    if (url === '/api/paper-trading') {
        res.end(JSON.stringify({
            enabled: paperTrading.enabled,
            capital: paperTrading.capital,
            positions: paperTrading.positions,
            stats: paperTrading.stats,
            stopLoss: paperTrading.stopLoss,
            takeProfit: paperTrading.takeProfit
        }));
        return;
    }
    
    if (url === '/api/paper-trading/start') {
        paperTrading.enabled = true;
        paperTrading.capital = 1000;
        paperTrading.positions = [];
        paperTrading.closedTrades = [];
        paperOpenPosition = null;
        updatePaperStats();
        console.log('📈 Paper Trading ENABLED');
        res.end(JSON.stringify({ success: true, enabled: true }));
        return;
    }
    
    if (url === '/api/paper-trading/stop') {
        // Close open positions at market
        if (paperOpenPosition && prices.btc > 0) {
            const currentPrice = prices.btc;
            const pnl = (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity;
            const exitFee = currentPrice * paperOpenPosition.quantity * 0.001;
            const netPnl = pnl - paperOpenPosition.fee - exitFee;
            paperTrading.capital += paperOpenPosition.quantity * currentPrice - exitFee;
            paperTrading.closedTrades.push({
                id: paperOpenPosition.id,
                side: 'BUY',
                price: currentPrice,
                quantity: paperOpenPosition.quantity,
                fee: exitFee,
                pnl: netPnl,
                timestamp: Date.now()
            });
            paperOpenPosition = null;
            paperTrading.positions = [];
        }
        paperTrading.enabled = false;
        updatePaperStats();
        console.log('📉 Paper Trading DISABLED');
        res.end(JSON.stringify({ success: true, enabled: false }));
        return;
    }
    
    if (url === '/api/paper-trading/reset') {
        paperTrading.capital = 1000;
        paperTrading.positions = [];
        paperTrading.closedTrades = [];
        paperOpenPosition = null;
        updatePaperStats();
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (url === '/api/paper-trading/sltp') {
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const sl = parseFloat(params.get('stopLoss'));
        const tp = parseFloat(params.get('takeProfit'));
        if (!isNaN(sl) && sl > 0 && sl <= 50) paperTrading.stopLoss = sl;
        if (!isNaN(tp) && tp > 0 && tp <= 100) paperTrading.takeProfit = tp;
        res.end(JSON.stringify({
            stopLoss: paperTrading.stopLoss,
            takeProfit: paperTrading.takeProfit
        }));
        return;
    }
    
    if (url === '/api/paper-trading/strategy') {
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const strategy = params.get('strategy');
        if (strategy && ['trend', 'momentum', 'macd'].includes(strategy)) {
            paperStrategy = strategy;
            res.end(JSON.stringify({ success: true, strategy: paperStrategy }));
        } else {
            res.end(JSON.stringify({ strategy: paperStrategy }));
        }
        return;
    }
    
    // Training controls
    if (url === '/api/training/start') {
        if (!trainingActive) {
            trainingActive = true;
            trainingStartTime = Date.now();
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
    
    // Episode end (every 100 steps) — save to history before reset
    if (done || (metrics.steps > 0 && metrics.steps % 100 === 0)) {
        // Save episode summary to history
        const endEquity = env.capital;
        const startEquity = episodeStartBalance;
        const pnlPercent = ((endEquity - startEquity) / startEquity) * 100;
        const completedTrades = [...episodeTrades];
        const maxDrawdown = episodeEquity.length > 0
            ? Math.max(...episodeEquity.map(e => e.drawdown))
            : 0;

        episodeHistory.push({
            episode: agent.episode,
            steps: metrics.steps,
            startEquity,
            endEquity,
            pnlPercent,
            tradesCount: completedTrades.length,
            buyCount: completedTrades.filter(t => t.action === 'BUY').length,
            sellCount: completedTrades.filter(t => t.action === 'SELL').length,
            maxDrawdown,
            finalEpsilon: agent.epsilon,
            timestamp: Date.now(),
            trades: completedTrades
        });
        if (episodeHistory.length > MAX_HISTORY) episodeHistory.shift();

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
setInterval(trainingStep, 1000);
setInterval(paperTradingStep, 5000); // Paper trading check every 5s
updatePrices();

// Load last model on start
loadLastModel();

// Auto-save model every MODEL_SAVE_INTERVAL_MS (10 min default)
setInterval(async () => {
    if (agent.episode > 0) {
        const now = Date.now();
        if (now - lastModelSave >= MODEL_SAVE_INTERVAL_MS) {
            await saveModel();
            console.log(`⏰ Auto-save triggered at episode ${agent.episode}`);
        }
    }
}, MODEL_SAVE_INTERVAL_MS);

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
