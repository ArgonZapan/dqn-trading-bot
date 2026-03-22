/**
 * DQN Trading Bot - Main Server with RL Training + Paper Trading
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const HOST = '0.0.0.0';

// Trade Journal
const tradeJournal = require('../src/tradeJournal');

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

// Paper trading equity curve tracking
let paperEquityCurve = [];  // [{time, equity, drawdown, price}]
const MAX_EQUITY_CURVE = 500; // keep last 500 data points

// Paper Trading Logger - separate log file for paper trades
const PAPER_LOG_FILE = path.join(__dirname, '..', 'paper-trades.log');
function paperLog(...args) {
    const msg = `[${new Date().toISOString()}] [PAPER] ${args.join(' ')}`;
    console.log(msg);
    try {
        fs.appendFileSync(PAPER_LOG_FILE, msg + '\n');
    } catch(e) {
        console.error('Paper log write failed:', e.message);
    }
}
let paperCandles = [];
let paperStrategy = 'trend';
let htfState = { h1: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 }, h4: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 } };
const HTF_UPDATE_INTERVAL = 60000; // Update HTF every 60s
let lastHtfUpdate = 0;
let paperPositionSize = 0.95;
let paperLastTradeTime = 0;
const PAPER_TRADE_COOLDOWN = 30000; // 30s between trades

// Grid Trading State
const gridStrategy = new GridStrategy();
let gridParams = {
    gridSize: parseFloat(process.env.GRID_SIZE) || 50,
    gridCount: parseInt(process.env.GRID_COUNT) || 5,
    gridSpacing: process.env.GRID_SPACING || 'absolute'
};
// Initialize grid params
gridStrategy.GRID_SIZE = gridParams.gridSize;
gridStrategy.GRID_COUNT = gridParams.gridCount;
gridStrategy.GRID_SPACING = gridParams.gridSpacing;

// Alert tracking state
let paperLastAlertBalance = 1000;
let paperPeakEquity = 1000;
let paperMaxDrawdownAlerted = 0; // track DD alert threshold (don't spam)

// ─── Live Trading State ─────────────────────────────────────────────────────
let liveTrader = null;
let liveTradingInterval = null;
let liveLastTradeTime = 0;
const LIVE_TRADE_COOLDOWN = 30000; // 30s between trades
const LIVE_LOG_FILE = path.join(__dirname, '..', 'live-trades.log');

function liveLog(...args) {
    const msg = `[${new Date().toISOString()}] [LIVE] ${args.join(' ')}`;
    console.log(msg);
    try { fs.appendFileSync(LIVE_LOG_FILE, msg + '\n'); } catch(e) {}
}

function getLiveTrader() {
    if (!liveTrader) {
        const apiKey = process.env.BINANCE_API_KEY || '';
        const apiSecret = process.env.BINANCE_API_SECRET || '';
        const LiveTrader = require('../src/services/LiveTrader').LiveTrader;
        liveTrader = new LiveTrader({
            apiKey,
            apiSecret,
            symbol: 'BTCUSDT',
            positionSize: 0.95,
            stopLossPercent: 2.0,
            takeProfitPercent: 4.0,
            testMode: true
        });
    }
    return liveTrader;
}

async function liveTradingStep() {
    if (!liveTrader || !liveTrader.isEnabled()) return;
    if (prices.btc === 0) return;
    await liveTrader.checkAndExecuteSLTP();
}


// Milestone alerts (every 5% P&L change)
const MILESTONE_STEP = 5; // %

// Notifier (Telegram)
let notifier = null;
function getNotifier() {
    if (!notifier) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            notifier = new (require('../src/notifier'))(token, chatId);
        }
    }
    return notifier;
}

// Alerter (Email/SMS)
let alerter = null;
function getAlerter() {
    if (!alerter) {
        alerter = new (require('../src/alerter'))({
            smtpHost: process.env.SMTP_HOST,
            smtpPort: process.env.SMTP_PORT,
            smtpUser: process.env.SMTP_USER,
            smtpPass: process.env.SMTP_PASS,
            alertEmail: process.env.ALERT_EMAIL,
            alertPhone: process.env.ALERT_PHONE,
            telegramToken: process.env.TELEGRAM_BOT_TOKEN,
            telegramChatId: process.env.TELEGRAM_CHAT_ID,
            twilioSid: process.env.TWILIO_ACCOUNT_SID,
            twilioToken: process.env.TWILIO_AUTH_TOKEN,
            twilioPhone: process.env.TWILIO_PHONE_NUMBER,
            alertEnabled: process.env.ALERT_ENABLED !== 'false',
            alertOnTrade: process.env.ALERT_ON_TRADE === 'true',
            alertOnProfit: parseFloat(process.env.ALERT_ON_PROFIT) || 5,
            alertOnLoss: parseFloat(process.env.ALERT_ON_LOSS) || 5,
            alertOnTrainingStart: process.env.ALERT_ON_TRAINING_START === 'true',
            alertOnTrainingEnd: process.env.ALERT_ON_TRAINING_END === 'true',
            alertOnTradeSize: parseFloat(process.env.ALERT_ON_TRADE_SIZE) || 10
        });
    }
    return alerter;
}

function sendPaperAlert(message) {
    const n = getNotifier();
    if (n) n.send(message);
}

// Paper trading milestone & DD alerts
async function checkPaperAlerts(currentEquity) {
    const n = getNotifier();
    const a = getAlerter();
    if (!n) return;

    const pnlPct = ((currentEquity - paperLastAlertBalance) / paperLastAlertBalance) * 100;
    const milestoneCount = Math.floor(currentEquity / 1000);
    const lastMilestone = Math.floor(paperLastAlertBalance / 1000);
    const newMilestone = Math.floor(currentEquity / 1000);

    // Balance milestone alert (every $1000 crossed)
    if (newMilestone > lastMilestone && newMilestone >= 1) {
        const emoji = currentEquity > paperLastAlertBalance ? '📈' : '📉';
        n.send(`${emoji} <b>Paper Trading Milestone!</b>\n💰 Balance: <code>$${currentEquity.toFixed(2)}</code>\n📊 Total P&L: <code>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</code>\n🏆 Milestone: $${newMilestone * 1000} passed!`);
        paperLastAlertBalance = currentEquity;
    }

    // Drawdown alert
    const peak = Math.max(paperPeakEquity, currentEquity);
    if (currentEquity < peak) paperPeakEquity = peak;
    const currentDD = paperPeakEquity > 0 ? ((paperPeakEquity - currentEquity) / paperPeakEquity) * 100 : 0;

    // Alert on DD thresholds: 5%, 10%, 15%, 20%...
    const ddThreshold = Math.floor(currentDD / 5) * 5;
    if (ddThreshold > paperMaxDrawdownAlerted && ddThreshold >= 5) {
        n.send(`⚠️ <b>Paper Trading - High Drawdown!</b>\n💰 Balance: <code>$${currentEquity.toFixed(2)}</code>\n📉 Drawdown: <code>${currentDD.toFixed(1)}%</code>\n📊 Peak: <code>$${paperPeakEquity.toFixed(2)}</code>`);
        paperMaxDrawdownAlerted = ddThreshold;
        // Send email alert for significant drawdown
        if (a && a.enabled && ddThreshold >= 10) {
            await a.drawdownAlert(currentDD, 10);
        }
    }
    // Reset DD alert when recovered
    if (currentDD < 2) paperMaxDrawdownAlerted = 0;
}

// Training episode milestone alerts
let lastAlertEpisodeBalance = 1000;
let lastAlertEpisode = 0;

async function checkEpisodeAlerts(episodeNum, endEquity, pnlPct, tradesCount) {
    const n = getNotifier();
    const a = getAlerter();
    if (!n) return;

    // Alert every 10 completed episodes with significant P&L
    if (episodeNum > lastAlertEpisode + 9) {
        const emoji = pnlPct >= 0 ? '🟢' : '🔴';
        n.send(`${emoji} <b>DQN Training Update</b>\n🎮 Episode: <code>#${episodeNum}</code>\n💰 Equity: <code>$${endEquity.toFixed(2)}</code>\n📈 P&L: <code>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</code>\n📊 Trades: ${tradesCount}`);
        lastAlertEpisode = episodeNum;
        lastAlertEpisodeBalance = endEquity;
        
        // Send email milestone alert
        if (a && a.enabled && episodeNum % 50 === 0) {
            await a.milestoneAlert(endEquity, tradesCount, pnlPct / 100);
        }
    }

    // Significant P&L milestone
    const milestone = Math.floor(pnlPct / MILESTONE_STEP);
    const lastMilestone = Math.floor(((lastAlertEpisodeBalance - 1000) / 1000) * 100 / MILESTONE_STEP);
    if (milestone > lastMilestone && Math.abs(pnlPct) >= MILESTONE_STEP) {
        n.send(`🎯 <b>Episode ${episodeNum} P&L Milestone!</b>\n💵 P&L: <code>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</code>\n💰 Equity: <code>$${endEquity.toFixed(2)}</code>`);
        lastAlertEpisodeBalance = endEquity;
    }
}

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
const Hyperopt = require('../src/hyperopt');
const { GridStrategy, backtestGridStrategy } = require('../src/strategies/gridStrategy');

const env = new Env('BTCUSDT', 59);
const agent = new Agent(300, 3);
const hyperopt = new Hyperopt();

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
    if (candles.length < 50) return { rsi: 50, ema9: 0, ema21: 0, macd: { value: 0, signal: 0, histogram: 0 }, bb: null };

    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, 14);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes);

    return { rsi, ema9, ema21, ema50, macd, bb };
}

function calcBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
        middle: sma,
        upper: sma + stdDev * std,
        lower: sma - stdDev * std
    };
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

// Paper trading signal - returns 'BUY', 'SELL' (close long/short), or 'HOLD'
function paperSignal(candles, ind, htf) {
    const last = candles[candles.length - 1];
    if (!last || !ind.ema9) return 'HOLD';
    
    if (paperStrategy === 'trend') {
        // BUY = uptrend confirmation, SHORT = downtrend confirmation
        // Only trade with HTF trend (4H) for higher probability setups
        const h4 = htf?.h4?.trend || 'neutral';
        if (ind.ema9 > ind.ema21 && last.close > ind.ema9) {
            // In HTF downtrend, don't BUY (or close longs faster)
            if (h4 === 'bear') return 'HOLD';
            return 'BUY';
        }
        if (ind.ema9 < ind.ema21 && last.close < ind.ema9) {
            // In HTF uptrend, don't SHORT
            if (h4 === 'bull') return 'HOLD';
            return 'SHORT';
        }
    } else if (paperStrategy === 'momentum') {
        // Use HTF RSI to filter - only buy oversold in bull trend, only short overbought in bear trend
        const h4 = htf?.h4?.trend || 'neutral';
        const h1Rsi = htf?.h1?.rsi || 50;
        if (ind.rsi < 30) {
            if (h4 === 'bear' && h1Rsi > 50) return 'HOLD'; // Weak bounce in HTF downtrend
            return 'BUY';
        }
        if (ind.rsi > 70) {
            if (h4 === 'bull' && h1Rsi < 50) return 'HOLD'; // Weak drop in HTF uptrend
            return 'SHORT';
        }
    } else if (paperStrategy === 'macd') {
        if (ind.macd.histogram > 0.5) return 'BUY';
        if (ind.macd.histogram < -0.5) return 'SHORT';
    } else if (paperStrategy === 'grid') {
        // Grid Trading Strategy - true grid-based approach
        // Generuje siatkę zleceń wokół aktualnej ceny
        const price = last.close;
        const hasPosition = paperTrading.positions.length > 0;
        const entryPrice = hasPosition ? paperTrading.positions[0].entryPrice : 0;
        
        // Użyj GridStrategy do wygenerowania poziomów
        const grid = gridStrategy.generateGrid(price, gridParams.gridSize, gridParams.gridCount);
        
        if (!hasPosition) {
            // Nie mamy pozycji - szukamy okazji do kupna
            // Kupujemy gdy cena zbliża się do poziomu buy
            for (const level of grid.buy) {
                const diff = Math.abs(price - level.price) / price;
                if (diff <= 0.005) { // W ramach 0.5% od poziomu
                    return 'BUY';
                }
            }
        } else {
            // Mamy pozycję - sprawdź czy sprzedać
            // Sprzedajemy gdy cena osiąga poziom sell z zyskiem
            for (const level of grid.sell) {
                const diff = Math.abs(price - level.price) / price;
                if (diff <= 0.005 && price > entryPrice) {
                    return 'SELL';
                }
            }
            
            // Stop loss - jeśli cena spadła o 2 gridy
            const stopPrice = entryPrice - (gridParams.gridSize * 2);
            if (price <= stopPrice) {
                return 'SELL';
            }
        }
        
        // Dodatkowa logika z Bollinger Bands gdy GridStrategy nie dała sygnału
        if (ind.bb && candles.length >= 20) {
            const bbLower = ind.bb.lower;
            const bbUpper = ind.bb.upper;
            const price = last.close;
            
            // Price near lower band = oversold = BUY
            if (price <= bbLower * 1.01 && !hasPosition) return 'BUY';
            // Price near upper band = overbought = SELL  
            if (price >= bbUpper * 0.99 && hasPosition) return 'SELL';
        }
    } else if (paperStrategy === 'scalping') {
        // Scalping: fast EMA crossover + RSI + volume confirmation + HTF trend filter
        if (candles.length < 20 || !ind.ema9 || !ind.ema21) return 'HOLD';
        
        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);
        const h4 = htf?.h4?.trend || 'neutral';
        const h1 = htf?.h1 || {};
        
        // Fast EMA crossover (EMA5 vs EMA21)
        const ema5 = calcEMA(closes, 5);
        const ema5Prev = calcEMA(closes.slice(0, -1), 5);
        const ema21 = ind.ema21;
        const ema21Prev = calcEMA(closes.slice(0, -1), 21);
        
        const emaCrossUp = ema5 > ema21 && ema5Prev <= ema21Prev;
        const emaCrossDown = ema5 < ema21 && ema5Prev >= ema21Prev;
        
        // Volume surge
        const avgVol = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
        const volSurge = volumes[volumes.length-1] > avgVol * 1.5;
        
        // RSI
        const rsi = ind.rsi || 50;
        
        // BUY: EMA cross up + RSI not overbought + volume + no HTF bear
        if (emaCrossUp && rsi < 65 && volSurge && h4 !== 'bear') return 'BUY';
        
        // SHORT: EMA cross down + RSI not oversold + no HTF bull
        if (emaCrossDown && rsi > 35 && h4 !== 'bull') return 'SHORT';
        
        // Quick bounces with HTF filter
        if (rsi < 25 && h4 !== 'bear') return 'BUY';
        if (rsi > 75 && h4 !== 'bull') return 'SHORT';
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

    // Max drawdown tracking - compute from closed trades cumulatively (don't mutate capital)
    let peak = 1000; // Start from initial capital
    let maxDD = 0;
    let maxDDPct = 0;
    let runningCapital = 1000;
    for (const t of closed) {
        runningCapital += t.pnl;
        if (runningCapital > peak) peak = runningCapital;
        const dd = peak - runningCapital;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; }
    }

    // Sharpe ratio (assuming risk-free rate = 0 for simplicity)
    // Sharpe = mean(return) / std(return) * sqrt(252) (annualized)
    let sharpeRatio = 0;
    if (closed.length > 1) {
        const returns = closed.map(t => t.pnl / 1000); // return relative to $1000 capital
        const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
        const stdReturn = Math.sqrt(variance);
        if (stdReturn > 0) {
            sharpeRatio = (meanReturn / stdReturn) * Math.sqrt(252); // annualized
        }
    }

    // Annualized return: assume 500 trades/day * 365 days, adjusted for actual trades
    // Or simpler: estimate trades per hour and project yearly
    let annualizedReturn = 0;
    if (closed.length > 0 && totalPnl !== 0) {
        const currentCapital = paperTrading.capital;
        const yearsRunning = Math.max(1, closed.length / 500); // rough estimate: 500 trades/year
        const totalReturn = ((currentCapital - 1000) / 1000); // total return fraction
        annualizedReturn = (Math.pow(1 + totalReturn, 1 / yearsRunning) - 1) * 100;
    }

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
        sharpeRatio,
        annualizedReturn,
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
    
    // Always record equity curve when paper trading is active
    const currentPrice = prices.btc;
    const posValue = paperPositionsValue();
    const totalEquity = paperFreeCapital() + posValue;
    const peakEquity = paperEquityCurve.length > 0
        ? Math.max(...paperEquityCurve.map(e => e.equity))
        : totalEquity;
    const drawdown = peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;
    
    paperEquityCurve.push({
        time: now,
        equity: totalEquity,
        drawdown,
        price: currentPrice
    });
    if (paperEquityCurve.length > MAX_EQUITY_CURVE) paperEquityCurve.shift();
    
    // Check for milestone/drawdown alerts
    checkPaperAlerts(totalEquity);
    
    if (now - paperLastTradeTime < PAPER_TRADE_COOLDOWN) return;
    
    // Fetch fresh candles
    const candles = await fetchCandles('BTCUSDT', '1m', 60);
    if (candles.length < 50) return;
    
    const ind = calcIndicators(candles);
    const signal = paperSignal(candles, ind, htfState);
    
    // Update unrealized P&L and check SL/TP + Trailing Stop
    let slTpTriggered = false;
    let slTpReason = '';
    const TRAILING_ACTIVATION = 1.0; // % profit before trailing activates
    const TRAILING_DISTANCE = 0.75; // % below peak price for trailing SL

    if (paperOpenPosition) {
        const pnl = paperOpenPosition.side === 'LONG'
            ? (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity
            : (paperOpenPosition.entryPrice - currentPrice) * paperOpenPosition.quantity;
        paperOpenPosition.pnl = pnl;
        paperOpenPosition.pnlPct = paperOpenPosition.side === 'LONG'
            ? ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100
            : ((paperOpenPosition.entryPrice - currentPrice) / paperOpenPosition.entryPrice) * 100;

        // ── Trailing Stop Logic ──────────────────────────────────────────────
        let trailingActive = false;
        if (!paperOpenPosition.peakPrice) paperOpenPosition.peakPrice = paperOpenPosition.entryPrice;

        if (paperOpenPosition.side === 'LONG') {
            if (currentPrice > paperOpenPosition.peakPrice) {
                paperOpenPosition.peakPrice = currentPrice;
            }
            const profitPct = ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100;
            if (profitPct >= TRAILING_ACTIVATION) {
                trailingActive = true;
                // Trail stop: keep SL at the greater of (static SL, peak - trail distance)
                const staticSL = paperOpenPosition.entryPrice * (1 - paperTrading.stopLoss / 100);
                const trailSL = paperOpenPosition.peakPrice * (1 - TRAILING_DISTANCE / 100);
                paperOpenPosition.trailingStop = Math.max(staticSL, trailSL);
                // Only update SL if new trailing SL is higher than current (for LONG, SL rises)
                if (paperOpenPosition.trailingStop > paperOpenPosition.stopLoss) {
                    const prevSL = paperOpenPosition.stopLoss;
                    paperOpenPosition.stopLoss = paperOpenPosition.trailingStop;
                    if (prevSL !== paperOpenPosition.trailingStop) {
                        paperLog(`📍 TRAIL SL updated: $${prevSL.toFixed(2)} → $${paperOpenPosition.trailingStop.toFixed(2)} (peak: $${paperOpenPosition.peakPrice.toFixed(2)})`);
                    }
                }
            }
        } else if (paperOpenPosition.side === 'SHORT') {
            if (currentPrice < paperOpenPosition.peakPrice || paperOpenPosition.peakPrice === paperOpenPosition.entryPrice) {
                paperOpenPosition.peakPrice = currentPrice;
            }
            const profitPct = ((paperOpenPosition.entryPrice - currentPrice) / paperOpenPosition.entryPrice) * 100;
            if (profitPct >= TRAILING_ACTIVATION) {
                trailingActive = true;
                const staticSL = paperOpenPosition.entryPrice * (1 + paperTrading.stopLoss / 100);
                const trailSL = paperOpenPosition.peakPrice * (1 + TRAILING_DISTANCE / 100);
                paperOpenPosition.trailingStop = Math.min(staticSL, trailSL);
                // For SHORT, SL decreases (moves lower toward entry)
                if (paperOpenPosition.trailingStop < paperOpenPosition.stopLoss) {
                    const prevSL = paperOpenPosition.stopLoss;
                    paperOpenPosition.stopLoss = paperOpenPosition.trailingStop;
                    if (prevSL !== paperOpenPosition.trailingStop) {
                        paperLog(`📍 TRAIL SL updated: $${prevSL.toFixed(2)} → $${paperOpenPosition.trailingStop.toFixed(2)} (trough: $${paperOpenPosition.peakPrice.toFixed(2)})`);
                    }
                }
            }
        }
        paperOpenPosition.trailingActive = trailingActive;

        // Check Stop Loss / Take Profit
        if (paperOpenPosition.side === 'LONG') {
            if (currentPrice <= paperOpenPosition.stopLoss) {
                slTpTriggered = true;
                slTpReason = trailingActive ? 'TSL' : 'SL'; // TSL = Trailing Stop Loss
            } else if (currentPrice >= paperOpenPosition.takeProfit) {
                slTpTriggered = true;
                slTpReason = 'TP';
            }
        } else if (paperOpenPosition.side === 'SHORT') {
            if (currentPrice >= paperOpenPosition.stopLoss) {
                slTpTriggered = true;
                slTpReason = trailingActive ? 'TSL' : 'SL';
            } else if (currentPrice <= paperOpenPosition.takeProfit) {
                slTpTriggered = true;
                slTpReason = 'TP';
            }
        }
    }

    // Execute trades (only if not SL/TP triggered)
    if (signal === 'BUY' && !paperOpenPosition) {
        // OPEN LONG
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
        console.log(`📈 PAPER LONG: ${qty.toFixed(6)} BTC @ $${currentPrice.toLocaleString()} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)}`);
        paperLog('OPEN LONG | Qty:', qty.toFixed(6), 'BTC | Entry: $' + currentPrice.toLocaleString(), '| SL: $' + sl.toFixed(2), '| TP: $' + tp.toFixed(2));
        // Trade alert
        getAlerter().tradeAlert('BUY', currentPrice, qty, 0, paperPositionSize * 100).catch(() => {});
    } else if (signal === 'SHORT' && !paperOpenPosition) {
        // OPEN SHORT - borrow and sell, profit from price drop
        const qty = (paperTrading.capital * paperPositionSize) / currentPrice;
        const fee = currentPrice * qty * 0.001;
        const sl = currentPrice * (1 + paperTrading.stopLoss / 100); // SL above entry for SHORT
        const tp = currentPrice * (1 - paperTrading.takeProfit / 100); // TP below entry for SHORT
        paperOpenPosition = {
            id: `paper_${now}`,
            side: 'SHORT',
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
        paperTrading.capital += qty * currentPrice - fee; // Receive USDT from short sale
        paperLastTradeTime = now;
        console.log(`📉 PAPER SHORT: ${qty.toFixed(6)} BTC @ $${currentPrice.toLocaleString()} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)}`);
        paperLog('OPEN SHORT | Qty:', qty.toFixed(6), 'BTC | Entry: $' + currentPrice.toLocaleString(), '| SL: $' + sl.toFixed(2), '| TP: $' + tp.toFixed(2));
        // Trade alert
        getAlerter().tradeAlert('SHORT', currentPrice, qty, 0, paperPositionSize * 100).catch(() => {});
    } else if ((signal === 'SELL' || slTpTriggered) && paperOpenPosition) {
        // CLOSE position (不管是 LONG 还是 SHORT)
        let pnl, exitValue;
        if (paperOpenPosition.side === 'LONG') {
            pnl = (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity;
            exitValue = paperOpenPosition.quantity * currentPrice;
        } else {
            // SHORT: profit when price goes DOWN
            pnl = (paperOpenPosition.entryPrice - currentPrice) * paperOpenPosition.quantity;
            exitValue = paperOpenPosition.quantity * currentPrice;
        }
        const exitFee = exitValue * 0.001;
        const netPnl = pnl - paperOpenPosition.fee - exitFee;

        const closed = {
            id: paperOpenPosition.id,
            side: paperOpenPosition.side,
            entryPrice: paperOpenPosition.entryPrice,
            exitPrice: currentPrice,
            quantity: paperOpenPosition.quantity,
            fee: paperOpenPosition.fee + exitFee,
            pnl: netPnl,
            pnlPct: ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100 * (paperOpenPosition.side === 'SHORT' ? -1 : 1),
            timestamp: now,
            entryTime: paperOpenPosition.entryTime,
            exitReason: slTpTriggered ? slTpReason : 'SIGNAL'
        };
        paperTrading.closedTrades.push(closed);
        
        // Return capital + P&L
        if (paperOpenPosition.side === 'LONG') {
            paperTrading.capital += exitValue - exitFee;
        } else {
            paperTrading.capital -= exitValue + exitFee; // Cover the borrowed asset
            paperTrading.capital += pnl - paperOpenPosition.fee - exitFee;
        }
        paperOpenPosition = null;
        paperTrading.positions = [];
        paperLastTradeTime = now;
        if (slTpTriggered) {
            console.log(`⚡ PAPER ${closed.side} ${slTpReason}: P&L $${netPnl.toFixed(2)} @ $${currentPrice.toLocaleString()}`);
            paperLog('CLOSE', closed.side, '| Exit:', '$' + currentPrice.toLocaleString(), '| P&L: $' + netPnl.toFixed(2), '| Reason:', slTpReason);
        } else {
            console.log(`📕 PAPER CLOSE ${closed.side}: P&L $${netPnl.toFixed(2)} @ $${currentPrice.toLocaleString()}`);
            paperLog('CLOSE', closed.side, '| Exit:', '$' + currentPrice.toLocaleString(), '| P&L: $' + netPnl.toFixed(2), '| Reason: SIGNAL');
        }
        updatePaperStats();
        // Record in Trade Journal
        const entry = tradeJournal.addTrade({
            entryTime: new Date(closed.entryTime).toISOString(),
            exitTime: new Date().toISOString(),
            symbol: 'BTCUSDT',
            direction: closed.side,
            strategy: paperStrategy,
            entryPrice: closed.entryPrice,
            exitPrice: closed.exitPrice,
            quantity: closed.quantity,
            pnlPercent: closed.pnlPct,
            pnlAbsolute: closed.pnl,
            commission: closed.fee,
            exitReason: closed.exitReason,
            isPaper: true
        });
        // Trade close alert with P&L
        getAlerter().tradeAlert(closed.side === 'LONG' ? 'SELL' : 'BUY', currentPrice, closed.quantity, closed.pnl, paperPositionSize * 100).catch(() => {});
        // Profit/loss threshold alerts
        const totalEquity = paperFreeCapital() + paperPositionsValue();
        if (closed.pnl > 0) {
            getAlerter().profitAlert(totalEquity, 1000, ((totalEquity - 1000) / 1000) * 100).catch(() => {});
        } else {
            getAlerter().lossAlert(totalEquity, 1000, ((totalEquity - 1000) / 1000) * 100).catch(() => {});
        }
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
    
    // Multi-timeframe HTF trend (for paper trading signal enhancement)
    if (url === '/api/htf-trend') {
        res.end(JSON.stringify(htfState));
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
            shortCount: e.shortCount || 0,
            coverCount: e.coverCount || 0,
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
            takeProfit: paperTrading.takeProfit,
            trailingActivation: TRAILING_ACTIVATION,
            trailingDistance: TRAILING_DISTANCE
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
        // Reset alert tracking
        paperLastAlertBalance = 1000;
        paperPeakEquity = 1000;
        paperMaxDrawdownAlerted = 0;
        lastAlertEpisodeBalance = 1000;
        lastAlertEpisode = 0;
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
            // Record in Trade Journal
            try {
                tradeJournal.addTrade({
                    id: paperOpenPosition.id,
                    symbol: 'BTCUSDT',
                    direction: 'LONG',
                    strategy: paperStrategy,
                    entryPrice: paperOpenPosition.entryPrice,
                    exitPrice: currentPrice,
                    quantity: paperOpenPosition.quantity,
                    pnlPercent: ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100,
                    pnlAbsolute: netPnl,
                    commission: paperOpenPosition.fee + exitFee,
                    exitReason: 'STOP_API',
                    entryTime: paperOpenPosition.entryTime,
                    exitTime: new Date().toISOString(),
                    isPaper: true
                });
            } catch(e) {}
            paperOpenPosition = null;
            paperTrading.positions = [];
        }
        paperTrading.enabled = false;
        updatePaperStats();
        console.log('📉 Paper Trading DISABLED');
        res.end(JSON.stringify({ success: true, enabled: false }));
        return;
    }

    // GET /api/paper-trading/status - zwraca czy paper trading jest włączony
    if (url === '/api/paper-trading/status') {
        res.end(JSON.stringify({
            enabled: paperTrading.enabled,
            capital: paperTrading.capital,
            stats: paperTrading.stats,
            stopLoss: paperTrading.stopLoss,
            takeProfit: paperTrading.takeProfit,
            strategy: paperStrategy
        }));
        return;
    }

    // POST /api/paper-trading/toggle - przełącza tryb
    if (url === '/api/paper-trading/toggle') {
        paperTrading.enabled = !paperTrading.enabled;
        if (paperTrading.enabled) {
            // Start paper trading - reset capital if fresh start
            if (paperTrading.capital === 0 || paperTrading.closedTrades.length === 0) {
                paperTrading.capital = 1000;
                paperTrading.positions = [];
                paperTrading.closedTrades = [];
                paperOpenPosition = null;
            }
            updatePaperStats();
            paperLog('Paper Trading ENABLED - Mode: ' + paperStrategy + ' | Capital: $' + paperTrading.capital.toFixed(2));
            console.log('📈 Paper Trading ENABLED via toggle');
        } else {
            // Stop - close open positions
            if (paperOpenPosition && prices.btc > 0) {
                const currentPrice = prices.btc;
                const pnl = paperOpenPosition.side === 'LONG'
                    ? (currentPrice - paperOpenPosition.entryPrice) * paperOpenPosition.quantity
                    : (paperOpenPosition.entryPrice - currentPrice) * paperOpenPosition.quantity;
                const exitFee = currentPrice * paperOpenPosition.quantity * 0.001;
                const netPnl = pnl - paperOpenPosition.fee - exitFee;
                paperTrading.closedTrades.push({
                    id: paperOpenPosition.id,
                    side: paperOpenPosition.side,
                    entryPrice: paperOpenPosition.entryPrice,
                    exitPrice: currentPrice,
                    quantity: paperOpenPosition.quantity,
                    fee: paperOpenPosition.fee + exitFee,
                    pnl: netPnl,
                    timestamp: Date.now(),
                    entryTime: paperOpenPosition.entryTime,
                    exitReason: 'MANUAL_CLOSE'
                });
                if (paperOpenPosition.side === 'LONG') {
                    paperTrading.capital += paperOpenPosition.quantity * currentPrice - exitFee;
                } else {
                    paperTrading.capital -= paperOpenPosition.quantity * currentPrice + exitFee;
                    paperTrading.capital += netPnl;
                }
                paperLog('Position closed on disable: ' + paperOpenPosition.side + ' | P&L: $' + netPnl.toFixed(2) + ' | Reason: MANUAL_CLOSE');
                // Record in Trade Journal (before clearing position)
                const closedEntry = {
                    entryTime: new Date(paperOpenPosition.entryTime).toISOString(),
                    exitTime: new Date().toISOString(),
                    symbol: 'BTCUSDT',
                    direction: paperOpenPosition.side,
                    strategy: paperStrategy,
                    entryPrice: paperOpenPosition.entryPrice,
                    exitPrice: currentPrice,
                    quantity: paperOpenPosition.quantity,
                    pnlPercent: ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100 * (paperOpenPosition.side === 'SHORT' ? -1 : 1),
                    pnlAbsolute: netPnl,
                    commission: paperOpenPosition.fee + exitFee,
                    exitReason: 'MANUAL_CLOSE',
                    isPaper: true
                };
                tradeJournal.addTrade(closedEntry);
                paperOpenPosition = null;
                paperTrading.positions = [];
            }
            updatePaperStats();
            paperLog('Paper Trading DISABLED');
            console.log('📉 Paper Trading DISABLED via toggle');
        }
        res.end(JSON.stringify({ success: true, enabled: paperTrading.enabled }));
        return;
    }
    
    // POST /api/paper-trading/reset - resetuje paper portfolio do początkowych wartości
    if (url === '/api/paper-trading/reset') {
        paperTrading.capital = 1000;
        paperTrading.positions = [];
        paperTrading.closedTrades = [];
        paperOpenPosition = null;
        paperEquityCurve = [];
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

    // Grid params API
    if (url === '/api/paper-trading/grid-params') {
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const gs = parseFloat(params.get('gridSize'));
        const gc = parseInt(params.get('gridCount'));
        const gsp = params.get('gridSpacing');
        
        if (!isNaN(gs) && gs > 0) {
            gridParams.gridSize = gs;
            gridStrategy.GRID_SIZE = gs;
        }
        if (!isNaN(gc) && gc > 0 && gc <= 20) {
            gridParams.gridCount = gc;
            gridStrategy.GRID_COUNT = gc;
        }
        if (gsp === 'percentage' || gsp === 'absolute') {
            gridParams.gridSpacing = gsp;
            gridStrategy.GRID_SPACING = gsp;
        }
        
        res.end(JSON.stringify({
            gridSize: gridParams.gridSize,
            gridCount: gridParams.gridCount,
            gridSpacing: gridParams.gridSpacing
        }));
        return;
    }
    
    if (url === '/api/paper-trading/strategy') {
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const strategy = params.get('strategy');
        if (strategy && ['trend', 'momentum', 'macd', 'grid', 'scalping'].includes(strategy)) {
            paperStrategy = strategy;
            res.end(JSON.stringify({ success: true, strategy: paperStrategy }));
        } else {
            res.end(JSON.stringify({ strategy: paperStrategy }));
        }
        return;
    }
    
    if (url === '/api/paper-trading/history') {
        // Return recent closed trades (last 50)
        const history = paperTrading.closedTrades.slice(-50).map(t => ({
            id: t.id,
            side: t.side,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            quantity: t.quantity,
            pnl: t.pnl,
            pnlPct: t.pnlPct,
            fee: t.fee,
            entryTime: t.entryTime,
            exitTime: t.timestamp,
            exitReason: t.exitReason,
            duration: t.timestamp - t.entryTime
        }));
        res.end(JSON.stringify({ trades: history, total: history.length }));
        return;
    }
    
    // Paper trading equity curve
    if (url === '/api/paper-trading/equity-curve') {
        res.end(JSON.stringify(paperEquityCurve));
        return;
    }
    
    // GET /api/paper-trading/performance - full performance summary
    if (url === '/api/paper-trading/performance') {
        updatePaperStats();
        const s = paperTrading.stats;
        // Enrich with avg profit per trade and best/worst trade
        const closed = paperTrading.closedTrades;
        const bestTrade = closed.length > 0 ? Math.max(...closed.map(t => t.pnl)) : 0;
        const worstTrade = closed.length > 0 ? Math.min(...closed.map(t => t.pnl)) : 0;
        const avgProfitPerTrade = closed.length > 0 ? s.totalPnl / closed.length : 0;
        res.json({
            totalTrades: s.totalTrades,
            winningTrades: s.winningTrades,
            losingTrades: s.losingTrades,
            winRate: s.winRate,
            totalPnl: s.totalPnl,
            totalFees: s.totalFees,
            avgProfitPerTrade,
            profitFactor: s.profitFactor,
            bestTrade,
            worstTrade,
            maxDrawdown: s.maxDrawdown,
            maxDrawdownPercent: s.maxDrawdownPercent,
            sharpeRatio: s.sharpeRatio,
            annualizedReturn: s.annualizedReturn,
            currentStreak: s.currentStreak,
            bestStreak: s.bestStreak,
            worstStreak: s.worstStreak,
            avgWin: s.avgWin,
            avgLoss: s.avgLoss,
            currentCapital: paperTrading.capital,
            equityPeak: paperEquityCurve.length > 0 ? Math.max(...paperEquityCurve.map(e => e.equity)) : 1000
        });
        return;
    }
    
    if (url === '/api/paper-trading/clear-history') {
        paperTrading.closedTrades = [];
        updatePaperStats();
        // Also clear paper trades from journal
        if (tradeJournal && tradeJournal.trades) {
            tradeJournal.trades = tradeJournal.trades.filter(t => !t.isPaper);
            tradeJournal.save();
        }
        res.end(JSON.stringify({ success: true }));
        return;
    }
    
    // GET /api/paper-trading/trades - returns last N paper trades from journal
    if (url === '/api/paper-trading/trades') {
        try {
            const result = tradeJournal.listTrades(1, 50, { isPaper: true });
            res.json(result);
        } catch(e) {
            res.json({ items: [], total: 0, error: e.message });
        }
        return;
    }
    
    // ─── Paper Trading Export ─────────────────────────────────────────────────
    
    // GET /api/paper-trading/export/csv - Export closed trades as CSV
    if (url === '/api/paper-trading/export/csv') {
        const closed = paperTrading.closedTrades;
        const header = 'ID,Side,Entry Price,Exit Price,Quantity,Entry Time,Exit Time,PNL,Fee,Duration (min)\n';
        const rows = closed.map(t => {
            const entry = t.entryPrice || t.price;
            const exit = t.exitPrice || t.price;
            const duration = t.exitTime ? Math.round((t.exitTime - t.entryTime) / 60000) : 0;
            return `${t.id},${t.side},${entry?.toFixed(2)},${exit?.toFixed(2)},${t.quantity?.toFixed(6)},${new Date(t.entryTime).toISOString()},${t.exitTime ? new Date(t.exitTime).toISOString() : ''},${t.pnl?.toFixed(2)},${t.fee?.toFixed(2)},${duration}`;
        }).join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="paper-trades-${Date.now()}.csv"`);
        res.end(csv);
        return;
    }
    
    // GET /api/paper-trading/export/json - Export full paper trading state
    if (url === '/api/paper-trading/export/json') {
        updatePaperStats();
        const exportData = {
            exportedAt: new Date().toISOString(),
            config: {
                strategy: paperStrategy,
                positionSize: paperPositionSize,
                stopLoss: paperTrading.stopLoss,
                takeProfit: paperTrading.takeProfit
            },
            stats: paperTrading.stats,
            equityCurve: paperEquityCurve,
            closedTrades: paperTrading.closedTrades,
            openPositions: paperTrading.positions,
            currentCapital: paperTrading.capital
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="paper-trading-${Date.now()}.json"`);
        res.end(JSON.stringify(exportData, null, 2));
        return;
    }
    
    // GET /api/paper-trading/export/equity-csv - Export equity curve as CSV
    if (url === '/api/paper-trading/export/equity-csv') {
        const header = 'Time,Equity,Drawdown,Drawdown %,Price\n';
        const rows = paperEquityCurve.map(e =>
            `${new Date(e.time).toISOString()},${e.equity?.toFixed(2)},${e.drawdown?.toFixed(2)},${e.drawdownPercent?.toFixed(2)},${e.price?.toFixed(2)}`
        ).join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="paper-equity-${Date.now()}.csv"`);
        res.end(csv);
        return;
    }
    
    // ─── Trade Journal ─────────────────────────────────────────────────────────
    
    // GET /api/trade-journal - list trades with pagination
    if (url.startsWith('/api/trade-journal')) {
        const urlParts = url.split('?');
        const query = new URLSearchParams(urlParts[1] || '');
        
        if (url === '/api/trade-journal/stats') {
            const filter = {};
            if (query.get('strategy')) filter.strategy = query.get('strategy');
            if (query.get('isPaper')) filter.isPaper = query.get('isPaper') === 'true';
            res.json(tradeJournal.getStats(filter));
            return;
        }
        
        if (url.startsWith('/api/trade-journal/detail/')) {
            const id = parseInt(url.split('/').pop());
            const trade = tradeJournal.trades.find(t => t.id === id);
            res.json(trade || { error: 'Trade not found' });
            return;
        }
        
        const page = parseInt(query.get('page')) || 1;
        const limit = parseInt(query.get('limit')) || 20;
        const filter = {};
        if (query.get('strategy')) filter.strategy = query.get('strategy');
        if (query.get('isPaper')) filter.isPaper = query.get('isPaper') === 'true';
        if (query.get('direction')) filter.direction = query.get('direction');
        if (query.get('minPnl')) filter.minPnl = parseFloat(query.get('minPnl'));
        if (query.get('maxPnl')) filter.maxPnl = parseFloat(query.get('maxPnl'));
        res.json(tradeJournal.listTrades(page, limit, filter));
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
            // Training start alert
            const a = getAlerter();
            a.trainingStartAlert(agent.episode, env.balance()).catch(() => {});
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
    
    // GET /api/alerter/test - test email/SMS alerts
    if (url === '/api/alerter/test') {
        const a = getAlerter();
        if (!a || (!a.enabled && !a.smsFallback)) {
            res.end(JSON.stringify({ success: false, message: 'Alerter not configured' }));
            return;
        }
        await a.test();
        res.end(JSON.stringify({ success: true, message: 'Test alert sent' }));
        return;
    }
    
    // GET /api/alerter/status - check alerter configuration
    if (url === '/api/alerter/status') {
        const a = getAlerter();
        res.end(JSON.stringify({
            emailEnabled: a.enabled,
            telegramFallback: a.smsFallback,
            smtpHost: a.smtpHost || null,
            alertEmail: a.alertEmail || null
        }));
        return;
    }
    
    // GET /api/alerts/config - get alert settings (no secrets)
    if (url === '/api/alerts/config' && method === 'GET') {
        const a = getAlerter();
        res.end(JSON.stringify(a.getConfig()));
        return;
    }
    
    // POST /api/alerts/config - update alert settings
    if (url === '/api/alerts/config' && method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const config = JSON.parse(body || '{}');
                const a = getAlerter();
                a.updateConfig(config);
                res.end(JSON.stringify({ success: true, config: a.getConfig() }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ─── Live Trading API ─────────────────────────────────────────────────────

    // GET /api/live-trading/status - get live trader status
    if (url === '/api/live-trading/status') {
        const lt = getLiveTrader();
        res.end(JSON.stringify(lt.getStatus()));
        return;
    }

    // POST /api/live-trading/start - start live trading (test or live mode)
    if (url === '/api/live-trading/start') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const testMode = data.testMode !== false;
                const lt = getLiveTrader();
                lt.configure({
                    apiKey: process.env.BINANCE_API_KEY || '',
                    apiSecret: process.env.BINANCE_API_SECRET || '',
                    symbol: data.symbol || 'BTCUSDT',
                    positionSize: data.positionSize || 0.95,
                    stopLossPercent: data.stopLoss || 2.0,
                    takeProfitPercent: data.takeProfit || 4.0,
                    testMode
                });
                await lt.enable(testMode);
                if (!liveTradingInterval) {
                    liveTradingInterval = setInterval(liveTradingStep, 3000);
                }
                liveLog(`Live trading STARTED (testMode=${testMode})`);
                const n = getNotifier();
                if (n) {
                    n.send(`🚀 <b>Live Trading ${testMode ? 'TEST' : 'LIVE'} Started!</b>\nSymbol: <code>${lt.getSymbol()}</code>\nMode: <code>${testMode ? 'TESTNET' : 'LIVE - REAL MONEY'}</code>`);
                }
                res.end(JSON.stringify({ success: true, status: lt.getStatus() }));
            } catch(e) {
                liveLog('Start failed:', e.message);
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // POST /api/live-trading/stop - stop live trading
    if (url === '/api/live-trading/stop') {
        const lt = getLiveTrader();
        // Close open positions
        const status = lt.getStatus();
        if (status.hasPosition) {
            await lt.closeLong('MANUAL_CLOSE');
            await lt.closeShort('MANUAL_CLOSE');
        }
        lt.disable();
        if (liveTradingInterval) { clearInterval(liveTradingInterval); liveTradingInterval = null; }
        liveLog('Live trading STOPPED');
        const n = getNotifier();
        if (n) n.send('🛑 <b>Live Trading Stopped</b>\nAll positions closed.');
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // GET /api/live-trading/stats - get trading stats
    if (url === '/api/live-trading/stats') {
        const lt = getLiveTrader();
        res.end(JSON.stringify(lt.getStats()));
        return;
    }

    // POST /api/live-trading/open-long - open a long position
    if (url === '/api/live-trading/open-long') {
        const lt = getLiveTrader();
        if (!lt.isEnabled()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Live trading not enabled' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = JSON.parse(body || '{}');
            const pos = await lt.openLong(data.quantity);
            if (pos) {
                liveLog(`OPEN LONG: ${pos.quantity.toFixed(6)} @ $${pos.entryPrice.toLocaleString()}`);
                const n = getNotifier();
                if (n) n.send(`📈 <b>Live LONG Opened</b>\nQty: <code>${pos.quantity.toFixed(6)}</code> BTC\nEntry: <code>$${pos.entryPrice.toLocaleString()}</code>\nSL: <code>$${pos.stopLoss.toFixed(2)}</code> | TP: <code>$${pos.takeProfit.toFixed(2)}</code>`);
                res.end(JSON.stringify({ success: true, position: pos }));
            } else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Failed to open position' }));
            }
        });
        return;
    }

    // POST /api/live-trading/close-long - close long position
    if (url === '/api/live-trading/close-long') {
        const lt = getLiveTrader();
        if (!lt.isEnabled()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Live trading not enabled' }));
            return;
        }
        const trade = await lt.closeLong('MANUAL');
        if (trade) {
            liveLog(`CLOSE LONG: P&L $${(trade.pnl || 0).toFixed(2)} @ $${trade.price.toLocaleString()}`);
            // Record in Trade Journal
            tradeJournal.addTrade({
                entryTime: new Date(trade.entryTime || Date.now() - 60000).toISOString(),
                exitTime: new Date().toISOString(),
                symbol: 'BTCUSDT',
                direction: 'LONG',
                strategy: 'live',
                entryPrice: trade.entryPrice,
                exitPrice: trade.price,
                quantity: trade.quantity,
                pnlPercent: trade.pnlPercent || 0,
                pnlAbsolute: trade.pnl || 0,
                commission: trade.commission || 0,
                exitReason: 'MANUAL_CLOSE',
                isPaper: false
            });
            const n = getNotifier();
            if (n) n.send(`📕 <b>Live LONG Closed</b>\nExit: <code>$${trade.price.toLocaleString()}</code>\nP&L: <code>${(trade.pnl || 0) >= 0 ? '+' : ''}$${(trade.pnl || 0).toFixed(2)}</code>`);
            res.end(JSON.stringify({ success: true, trade }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'No position to close' }));
        }
        return;
    }

    // POST /api/live-trading/open-short - open short position
    if (url === '/api/live-trading/open-short') {
        const lt = getLiveTrader();
        if (!lt.isEnabled()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Live trading not enabled' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = JSON.parse(body || '{}');
            const pos = await lt.openShort(data.quantity);
            if (pos) {
                liveLog(`OPEN SHORT: ${pos.quantity.toFixed(6)} @ $${pos.entryPrice.toLocaleString()}`);
                const n = getNotifier();
                if (n) n.send(`📉 <b>Live SHORT Opened</b>\nQty: <code>${pos.quantity.toFixed(6)}</code> BTC\nEntry: <code>$${pos.entryPrice.toLocaleString()}</code>\nSL: <code>$${pos.stopLoss.toFixed(2)}</code> | TP: <code>$${pos.takeProfit.toFixed(2)}</code>`);
                res.end(JSON.stringify({ success: true, position: pos }));
            } else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Failed to open position' }));
            }
        });
        return;
    }

    // POST /api/live-trading/close-short - close short position
    if (url === '/api/live-trading/close-short') {
        const lt = getLiveTrader();
        if (!lt.isEnabled()) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Live trading not enabled' }));
            return;
        }
        const trade = await lt.closeShort('MANUAL');
        if (trade) {
            liveLog(`CLOSE SHORT: P&L $${(trade.pnl || 0).toFixed(2)} @ $${trade.price.toLocaleString()}`);
            // Record in Trade Journal
            tradeJournal.addTrade({
                entryTime: new Date(trade.entryTime || Date.now() - 60000).toISOString(),
                exitTime: new Date().toISOString(),
                symbol: 'BTCUSDT',
                direction: 'SHORT',
                strategy: 'live',
                entryPrice: trade.entryPrice,
                exitPrice: trade.price,
                quantity: trade.quantity,
                pnlPercent: trade.pnlPercent || 0,
                pnlAbsolute: trade.pnl || 0,
                commission: trade.commission || 0,
                exitReason: 'MANUAL_CLOSE',
                isPaper: false
            });
            const n = getNotifier();
            if (n) n.send(`📗 <b>Live SHORT Closed</b>\nExit: <code>$${trade.price.toLocaleString()}</code>\nP&L: <code>${(trade.pnl || 0) >= 0 ? '+' : ''}$${(trade.pnl || 0).toFixed(2)}</code>`);
            res.end(JSON.stringify({ success: true, trade }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'No position to close' }));
        }
        return;
    }

    // POST /api/live-trading/configure - update live trading settings
    if (url === '/api/live-trading/configure') {
        const lt = getLiveTrader();
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                if (data.stopLoss) lt.setStopLoss(parseFloat(data.stopLoss));
                if (data.takeProfit) lt.setTakeProfit(parseFloat(data.takeProfit));
                if (data.trailingActivation) lt.setTrailingActivation(parseFloat(data.trailingActivation));
                if (data.trailingDistance) lt.setTrailingDistance(parseFloat(data.trailingDistance));
                if (data.positionSize) lt.setPositionSize(parseFloat(data.positionSize));
                if (data.symbol) lt.setSymbol(data.symbol);
                res.end(JSON.stringify({ success: true, status: lt.getStatus() }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid config' }));
            }
        });
        return;
    }

    // GET /api/live-trading/history - get closed trades history
    if (url === '/api/live-trading/history') {
        const lt = getLiveTrader();
        const stats = lt.getStats();
        res.end(JSON.stringify({ trades: stats.closedTrades, total: stats.stats.totalTrades }));
        return;
    }

    // POST /api/live-trading/reset - reset live trading state
    if (url === '/api/live-trading/reset') {
        const lt = getLiveTrader();
        lt.reset();
        liveLog('Live trading state RESET');
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // GET /api/live-trading/config-check - verify API keys are configured
    if (url === '/api/live-trading/config-check') {
        const apiKey = process.env.BINANCE_API_KEY || '';
        const apiSecret = process.env.BINANCE_API_SECRET || '';
        const configured = !!(apiKey && apiSecret);
        const lt = getLiveTrader();
        res.end(JSON.stringify({
            configured,
            hasApiKey: !!apiKey,
            hasApiSecret: !!apiSecret,
            isConfigured: lt.isConfigured(),
            isTestMode: lt.isTestMode(),
            isEnabled: lt.isEnabled()
        }));
        return;
    }
    
    // Hyperparameter Optimizer endpoints
    if (url === '/api/hyperparams' && req.method === 'GET') {
        res.end(JSON.stringify(hyperopt.getHyperparams()));
        return;
    }
    
    if (url === '/api/hyperparams' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const updated = hyperopt.update(data.hyperparams || {}, data.metrics || {});
                res.end(JSON.stringify({ success: true, hyperparams: updated }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        });
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
    
    // Calculate equity (total portfolio value including BTC holdings)
    const currentBalance = env.balance();
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
        // Capture episode number BEFORE starting next episode (startEpisode increments)
        const completedEpisode = agent.episode;

        // Save episode summary to history
        const endEquity = env.balance();
        const startEquity = episodeStartBalance;
        const pnlPercent = ((endEquity - startEquity) / startEquity) * 100;
        const completedTrades = [...episodeTrades];
        const maxDrawdown = episodeEquity.length > 0
            ? Math.max(...episodeEquity.map(e => e.drawdown))
            : 0;

        episodeHistory.push({
            episode: completedEpisode,
            steps: metrics.steps,
            startEquity,
            endEquity,
            pnlPercent,
            tradesCount: completedTrades.length,
            buyCount: completedTrades.filter(t => t.action === 'BUY').length,
            sellCount: completedTrades.filter(t => t.action === 'SELL').length,
            shortCount: completedTrades.filter(t => t.action === 'SHORT').length,
            coverCount: completedTrades.filter(t => t.action === 'COVER').length,
            maxDrawdown,
            finalEpsilon: agent.epsilon,
            timestamp: Date.now(),
            trades: completedTrades,
            prices: [...currentEpisodeSteps],
            equity: [...episodeEquity],
            epsilons: [...episodeEpsilons]
        });
        if (episodeHistory.length > MAX_HISTORY) episodeHistory.shift();

        // Send training update alert
        checkEpisodeAlerts(completedEpisode, endEquity, pnlPercent, completedTrades.length);
        
        // Training end alert with full stats
        const a = getAlerter();
        a.trainingEndAlert({
            episode: completedEpisode,
            equity: endEquity,
            pnlPct: pnlPercent,
            tradesCount: completedTrades.length,
            winRate: completedTrades.length > 0 ? (completedTrades.filter(t => t.pnl > 0).length / completedTrades.length) * 100 : 0,
            maxDrawdown,
            epsilon: agent.epsilon,
            duration: Date.now() - trainingStartTime
        }).catch(() => {});

        // Update hyperparameter optimizer with episode metrics
        const winCount = completedTrades.filter(t => t.action === 'BUY' && t.pnl > 0).length;
        const episodeHyperparams = {
            learningRate: agent.learningRate || 0.0005,
            gamma: agent.gamma || 0.99,
            epsilonDecay: agent.epsilonDecay || 0.995,
            epsilonMin: 0.01,
            batchSize: agent.batchSize || 32
        };
        const episodeMetrics = {
            reward: pnlPercent,
            winRate: completedTrades.length > 0 ? winCount / completedTrades.length : 0,
            drawdown: maxDrawdown,
            steps: metrics.steps,
            tradesCount: completedTrades.length
        };
        hyperopt.update(episodeHyperparams, episodeMetrics);

        // Reset episode tracking state BEFORE starting new episode
        episodeTrades = [];
        currentEpisodeSteps = [];
        episodeEpsilons = [];
        episodeEquity = [];
        episodeStartBalance = env.balance();

        // Start new episode (increments agent.episode)
        agent.startEpisode();
        metrics.steps = 0; // Reset step counter for new episode

        await saveModel();
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

// Update HTF (higher timeframe) trends - called every 60s
async function updateHtfTrends() {
    try {
        const { BinanceClient } = require('../dist/src/services/BinanceClient');
        const client = new BinanceClient();
        const [h1, h4] = await Promise.all([
            client.getHTFTrend('BTCUSDT', '1h'),
            client.getHTFTrend('BTCUSDT', '4h')
        ]);
        htfState = { h1, h4 };
    } catch (e) {
        console.error('HTF update failed:', e.message);
    }
}

// Routes
setInterval(updatePrices, 3000);
setInterval(trainingStep, 1000);
setInterval(paperTradingStep, 5000); // Paper trading check every 5s
setInterval(updateHtfTrends, HTF_UPDATE_INTERVAL);
updatePrices();
updateHtfTrends(); // Initial HTF load

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
