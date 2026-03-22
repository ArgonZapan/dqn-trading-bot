/**
 * DQN Trading Bot - Main Server with RL Training + Paper Trading
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const HOST = '0.0.0.0';

// Trailing stop defaults
const TRAILING_ACTIVATION = 1.0; // % profit before trailing activates
const TRAILING_DISTANCE = 0.75; // % below peak price for trailing SL

// Trade Journal
const tradeJournal = require('../src/tradeJournal');
const Rebalancer = require('../src/rebalancer');
const { sentimentAnalyzer } = require('../src/sentimentAnalyzer');
const VolatilityRegime = require('../src/volatilityRegime');
const { MLFeatures } = require('../src/mlFeatures');
const { calculateAttribution } = require('../src/attribution');
const RiskManager = require('../src/risk');
const { BufferHealth } = require('../src/bufferHealth');

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

// Per-regime stats: { LOW: {trades, wins, pnl}, NORMAL: {...}, HIGH: {...}, EXTREME: {...} }
let paperRegimeStats = {
    LOW: { trades: 0, wins: 0, pnl: 0 },
    NORMAL: { trades: 0, wins: 0, pnl: 0 },
    HIGH: { trades: 0, wins: 0, pnl: 0 },
    EXTREME: { trades: 0, wins: 0, pnl: 0 }
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
let paperCandles = { btc: [], eth: [], sol: [] };
let paperStrategy = 'trend';
let htfState = { h1: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 }, h4: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 } };

// ─── Volatility Regime State ────────────────────────────────────────────────
const REBALANCE_ASSETS = ['BTC', 'ETH', 'SOL'];
const REBALANCE_PAIRS = {
    BTC: { symbol: 'BTCUSDT', name: 'Bitcoin', allocation: 0.40, color: '#F7931A' },
    ETH: { symbol: 'ETHUSDT', name: 'Ethereum', allocation: 0.35, color: '#627EEA' },
    SOL: { symbol: 'SOLUSDT', name: 'Solana', allocation: 0.25, color: '#00FFA3' }
};
const paperVolRegime = new VolatilityRegime();  // Per-asset regime instances
const paperVolRegimes = {};  // { BTC: VolatilityRegime, ETH: VolatilityRegime, SOL: VolatilityRegime }
for (const asset of REBALANCE_ASSETS) {
    paperVolRegimes[asset] = new VolatilityRegime();
}
let paperVolAlertPending = null; // Buffered regime-change alert for Telegram
const HTF_UPDATE_INTERVAL = 60000; // Update HTF every 60s
let lastHtfUpdate = 0;
let paperPositionSize = 0.95;
let paperLastTradeTime = 0;
const PAPER_TRADE_COOLDOWN = 30000; // 30s between trades

// ─── Multi-Asset Portfolio Rebalancing ──────────────────────────────────────
let paperMultiPositions = {}; // { BTC: null|{side,entryPrice,quantity,fee,pnl,stopLoss,takeProfit,...}, ETH:..., SOL:... }
let paperAllocation = { BTC: 0.40, ETH: 0.35, SOL: 0.25 }; // Target allocation
let paperRebalanceEnabled = false;
let paperRebalanceThreshold = 0.05; // Trigger rebalance if any asset drifts >5% from target
let riskManager = new RiskManager(); // Kelly Criterion + dynamic stops
riskManager.setJournal(tradeJournal);

// Initialize multi positions
for (const asset of REBALANCE_ASSETS) paperMultiPositions[asset] = null;

function paperMultiPositionsValue() {
    let total = 0;
    for (const asset of REBALANCE_ASSETS) {
        const pos = paperMultiPositions[asset];
        const price = prices[asset.toLowerCase()] || 0;
        if (pos) {
            if (pos.side === 'LONG') total += pos.quantity * price;
            else total += pos.quantity * pos.entryPrice; // Short: use entry for notional
        }
    }
    return total;
}

function paperFreeCapital() {
    return paperTrading.capital;
}

function paperTotalEquity() {
    return paperFreeCapital() + paperMultiPositionsValue();
}

// Per-asset position value
function paperAssetPositionValue(asset) {
    const pos = paperMultiPositions[asset];
    if (!pos) return 0;
    const price = prices[asset.toLowerCase()] || 0;
    if (pos.side === 'LONG') return pos.quantity * price;
    return pos.quantity * pos.entryPrice; // SHORT notional
}

// Per-asset unrealized P&L
function paperAssetUnrealizedPnl(asset) {
    const pos = paperMultiPositions[asset];
    if (!pos) return 0;
    const price = prices[asset.toLowerCase()] || 0;
    if (pos.side === 'LONG') return (price - pos.entryPrice) * pos.quantity;
    return (pos.entryPrice - price) * pos.quantity;
}

async function paperRebalancingStep() {
    if (!paperTrading.enabled || !paperRebalanceEnabled) return;
    if (prices.btc === 0) return;
    const now = Date.now();
    if (now - paperLastTradeTime < PAPER_TRADE_COOLDOWN) return;

    const totalEquity = paperTotalEquity();
    if (totalEquity < 10) return;

    // Check rebalancing need
    let needsRebalance = false;
    for (const asset of REBALANCE_ASSETS) {
        const pos = paperMultiPositions[asset];
        const price = prices[asset.toLowerCase()] || 0;
        if (!pos && price > 0) {
            // No position - check if we should buy
            const targetValue = totalEquity * paperAllocation[asset];
            const currentValue = paperAssetPositionValue(asset);
            const drift = Math.abs(targetValue - currentValue) / totalEquity;
            if (drift > paperRebalanceThreshold) needsRebalance = true;
        }
    }

    // If we need to rebalance, close underweight positions and open overweight ones
    // For simplicity: evaluate each asset's signal independently
    for (const asset of REBALANCE_ASSETS) {
        const cfg = REBALANCE_PAIRS[asset];
        const symbol = cfg.symbol;
        const price = prices[asset.toLowerCase()] || 0;
        if (price === 0) continue;

        const pos = paperMultiPositions[asset];
        const candles = paperCandles[asset.toLowerCase()] || [];
        if (candles.length < 50) continue;

        const ind = calcIndicators(candles);
        const signal = paperSignal(candles, ind, htfState);

        if (!pos && signal === 'BUY') {
            // Open LONG on this asset
            const qty = (totalEquity * paperAllocation[asset] * paperPositionSize) / price;
            const fee = price * qty * 0.001;
            const sl = price * (1 - paperTrading.stopLoss / 100);
            const tp = price * (1 + paperTrading.takeProfit / 100);
            paperMultiPositions[asset] = {
                id: `paper_${now}_${asset}`,
                side: 'LONG',
                entryPrice: price,
                quantity: qty,
                fee,
                pnl: 0,
                pnlPct: 0,
                entryTime: now,
                stopLoss: sl,
                takeProfit: tp,
                peakPrice: price
            };
            paperTrading.capital -= qty * price + fee;
            paperLastTradeTime = now;
            console.log(`📈 PAPER MULTI ${asset} LONG: ${qty.toFixed(6)} @ $${price.toLocaleString()}`);
            paperLog('OPEN MULTI', asset, 'LONG | Qty:', qty.toFixed(6), '| Entry: $' + price.toLocaleString());
        } else if (!pos && signal === 'SHORT') {
            const qty = (totalEquity * paperAllocation[asset] * paperPositionSize) / price;
            const fee = price * qty * 0.001;
            const sl = price * (1 + paperTrading.stopLoss / 100);
            const tp = price * (1 - paperTrading.takeProfit / 100);
            paperMultiPositions[asset] = {
                id: `paper_${now}_${asset}`,
                side: 'SHORT',
                entryPrice: price,
                quantity: qty,
                fee,
                pnl: 0,
                pnlPct: 0,
                entryTime: now,
                stopLoss: sl,
                takeProfit: tp,
                peakPrice: price
            };
            paperTrading.capital += qty * price - fee;
            paperLastTradeTime = now;
            console.log(`📉 PAPER MULTI ${asset} SHORT: ${qty.toFixed(6)} @ $${price.toLocaleString()}`);
            paperLog('OPEN MULTI', asset, 'SHORT | Qty:', qty.toFixed(6), '| Entry: $' + price.toLocaleString());
        } else if (pos) {
            // Check SL/TP
            let triggered = false, reason = '';
            if (pos.side === 'LONG') {
                const pnl = (price - pos.entryPrice) * pos.quantity;
                pos.pnl = pnl;
                pos.pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
                if (pos.peakPrice < price) pos.peakPrice = price;
                const profitPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
                const TRAILING_ACTIVATION = 1.0;
                const TRAILING_DISTANCE = 0.75;
                if (profitPct >= TRAILING_ACTIVATION) {
                    const trailSL = pos.peakPrice * (1 - TRAILING_DISTANCE / 100);
                    const staticSL = pos.stopLoss;
                    if (trailSL > pos.stopLoss) {
                        pos.stopLoss = Math.max(pos.stopLoss, trailSL);
                    }
                }
                if (price <= pos.stopLoss) { triggered = true; reason = price <= pos.stopLoss ? 'SL' : 'TP'; }
                else if (price >= pos.takeProfit) { triggered = true; reason = 'TP'; }
            } else if (pos.side === 'SHORT') {
                const pnl = (pos.entryPrice - price) * pos.quantity;
                pos.pnl = pnl;
                pos.pnlPct = ((pos.entryPrice - price) / pos.entryPrice) * 100;
                if (pos.peakPrice > price) pos.peakPrice = price;
                const profitPct = ((pos.entryPrice - price) / pos.entryPrice) * 100;
                const TRAILING_ACTIVATION = 1.0;
                const TRAILING_DISTANCE = 0.75;
                if (profitPct >= TRAILING_ACTIVATION) {
                    const trailSL = pos.peakPrice * (1 + TRAILING_DISTANCE / 100);
                    if (trailSL < pos.stopLoss) {
                        pos.stopLoss = Math.min(pos.stopLoss, trailSL);
                    }
                }
                if (price >= pos.stopLoss) { triggered = true; reason = 'SL'; }
                else if (price <= pos.takeProfit) { triggered = true; reason = 'TP'; }
            }

            // Also check for reversal signal
            const hasSignalFlip = (signal === 'SHORT' && pos.side === 'LONG') || (signal === 'BUY' && pos.side === 'SHORT');

            if (triggered || hasSignalFlip) {
                let pnl, exitValue;
                if (pos.side === 'LONG') {
                    pnl = (price - pos.entryPrice) * pos.quantity;
                    exitValue = pos.quantity * price;
                } else {
                    pnl = (pos.entryPrice - price) * pos.quantity;
                    exitValue = pos.quantity * price;
                }
                const exitFee = exitValue * 0.001;
                const netPnl = pnl - pos.fee - exitFee;
                const closed = {
                    id: pos.id,
                    side: pos.side,
                    asset,
                    entryPrice: pos.entryPrice,
                    exitPrice: price,
                    quantity: pos.quantity,
                    fee: pos.fee + exitFee,
                    pnl: netPnl,
                    pnlPct: pos.pnlPct,
                    timestamp: now,
                    entryTime: pos.entryTime,
                    exitReason: triggered ? reason : 'REBALANCE_FLIP',
                    regime: paperVolRegimes[asset] ? paperVolRegimes[asset].getRegime() : paperVolRegime.getRegime()
                };
                paperTrading.closedTrades.push(closed);
                tradeJournal.addTrade({ ...closed, isPaper: true, direction: pos.side === 'LONG' ? 'LONG' : 'SHORT' });
                // Update per-regime stats
                const reg = closed.regime || 'NORMAL';
                if (paperRegimeStats[reg]) {
                    paperRegimeStats[reg].trades++;
                    if (netPnl > 0) paperRegimeStats[reg].wins++;
                    paperRegimeStats[reg].pnl += netPnl;
                }
                if (pos.side === 'LONG') {
                    paperTrading.capital += exitValue - exitFee;
                } else {
                    paperTrading.capital -= exitValue + exitFee;
                    paperTrading.capital += pnl - pos.fee - exitFee;
                }
                paperMultiPositions[asset] = null;
                paperLastTradeTime = now;
                console.log(`⚡ PAPER MULTI ${asset} ${pos.side} CLOSED: P&L $${netPnl.toFixed(2)} @ $${price.toLocaleString()} [${reason}]`);
                paperLog('CLOSE MULTI', asset, pos.side, '| Exit:', '$' + price.toLocaleString(), '| P&L: $' + netPnl.toFixed(2), '| Reason:', triggered ? reason : 'FLIP');
                updatePaperStats();
            }
        }
    }
}

// Grid Trading State - loaded after RL components to avoid initialization order issues
let gridStrategy = null;
let gridParams = {
    gridSize: parseFloat(process.env.GRID_SIZE) || 50,
    gridCount: parseInt(process.env.GRID_COUNT) || 5,
    gridSpacing: process.env.GRID_SPACING || 'absolute'
};

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

// Initialize grid strategy after require
gridStrategy = new GridStrategy();
gridStrategy.GRID_SIZE = gridParams.gridSize;
gridStrategy.GRID_COUNT = gridParams.gridCount;
gridStrategy.GRID_SPACING = gridParams.gridSpacing;

const env = new Env('BTCUSDT', 59);
const agent = new Agent(394, 3);
const hyperopt = new Hyperopt();
const bufferHealth = new BufferHealth();
const rebalancer = new Rebalancer({ enabled: false, threshold: 0.05 });
const mlFeatures = new MLFeatures();

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
    
    // Update rebalancer with current paper positions
    if (paperOpenPosition) {
        rebalancer.setPosition('paper_' + paperStrategy, paperOpenPosition.quantity, currentPrice);
    } else {
        rebalancer.setPosition('paper_' + paperStrategy, 0, currentPrice);
    }
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
    
    // ── Volatility Regime Update ─────────────────────────────────────────────
    const lastCandle = candles[candles.length - 1];
    const volState = paperVolRegime.update(lastCandle, currentPrice);
    
    // Buffer regime change alerts (send only once per transition)
    if (volState.alert && !paperVolAlertPending) {
        paperVolAlertPending = volState.alert;
    }
    
    // Flush alert at start of next cycle (avoid alert spam)
    if (paperVolAlertPending && now % 5000 < 100) {
        const alert = paperVolAlertPending;
        paperLog(`⚠️ VOLATILITY REGIME CHANGE: ${alert.from} → ${alert.to} (ATR: ${(alert.atrPct * 100).toFixed(3)}%)`);
        paperVolAlertPending = null;
    }
    
    // Regime-adjusted trading parameters
    const baseSL = paperTrading.stopLoss;    // e.g. 2.0%
    const baseTP = paperTrading.takeProfit;   // e.g. 4.0%
    const basePosSize = paperPositionSize;    // e.g. 0.95 (95% of capital)
    
    // Adjust SL/TP/position based on regime multipliers
    const adjSL = baseSL * volState.slMult;     // wider in volatile markets
    const adjTP = baseTP * volState.slMult;     // scale TP proportionally
    const adjPosSize = Math.min(basePosSize * volState.positionMult, 0.95); // reduce in volatile markets
    
    // ── Update unrealized P&L and check SL/TP + Trailing Stop
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
        const qty = (paperTrading.capital * adjPosSize) / currentPrice;
        const fee = currentPrice * qty * 0.001;
        const sl = currentPrice * (1 - adjSL / 100);
        const tp = currentPrice * (1 + adjTP / 100);
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
            takeProfit: tp,
            regimeAtEntry: volState.regime,   // Record regime at entry
            baseSLCorrection: adjSL / baseSL   // Ratio for dynamic re-adjustment
        };
        paperTrading.positions = [paperOpenPosition];
        paperTrading.capital -= qty * currentPrice + fee;
        paperLastTradeTime = now;
        console.log(`📈 PAPER LONG [${volState.regime}]: ${qty.toFixed(6)} BTC @ $${currentPrice.toLocaleString()} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)} | pos: ${(adjPosSize*100).toFixed(0)}%`);
        paperLog('OPEN LONG | Qty:', qty.toFixed(6), 'BTC | Entry: $' + currentPrice.toLocaleString(), '| SL: $' + sl.toFixed(2), '| TP: $' + tp.toFixed(2), '| Regime:', volState.regime);
        // Trade alert
        getAlerter().tradeAlert('BUY', currentPrice, qty, 0, adjPosSize * 100).catch(() => {});
    } else if (signal === 'SHORT' && !paperOpenPosition) {
        // OPEN SHORT - borrow and sell, profit from price drop
        const qty = (paperTrading.capital * adjPosSize) / currentPrice;
        const fee = currentPrice * qty * 0.001;
        const sl = currentPrice * (1 + adjSL / 100); // SL above entry for SHORT
        const tp = currentPrice * (1 - adjTP / 100); // TP below entry for SHORT
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
            takeProfit: tp,
            regimeAtEntry: volState.regime,
            baseSLCorrection: adjSL / baseSL
        };
        paperTrading.positions = [paperOpenPosition];
        paperTrading.capital += qty * currentPrice - fee; // Receive USDT from short sale
        paperLastTradeTime = now;
        console.log(`📉 PAPER SHORT [${volState.regime}]: ${qty.toFixed(6)} BTC @ $${currentPrice.toLocaleString()} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)} | pos: ${(adjPosSize*100).toFixed(0)}%`);
        paperLog('OPEN SHORT | Qty:', qty.toFixed(6), 'BTC | Entry: $' + currentPrice.toLocaleString(), '| SL: $' + sl.toFixed(2), '| TP: $' + tp.toFixed(2), '| Regime:', volState.regime);
        // Trade alert
        getAlerter().tradeAlert('SHORT', currentPrice, qty, 0, adjPosSize * 100).catch(() => {});
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
            exitReason: slTpTriggered ? slTpReason : 'SIGNAL',
            regime: paperVolRegime.getRegime(),
            regimeAtEntry: paperOpenPosition.regimeAtEntry || paperVolRegime.getRegime()
        };
        paperTrading.closedTrades.push(closed);
        tradeJournal.addTrade({ ...closed, isPaper: true, direction: paperOpenPosition.side });
        // Update per-regime stats
        const reg = closed.regime || 'NORMAL';
        if (paperRegimeStats[reg]) {
            paperRegimeStats[reg].trades++;
            if (netPnl > 0) paperRegimeStats[reg].wins++;
            paperRegimeStats[reg].pnl += netPnl;
        }
        
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

    // GET /api/portfolio/heatmap - Portfolio allocation heatmap
    if (url === '/api/portfolio/heatmap') {
        const totalEquity = paperFreeCapital() + paperMultiPositionsValue();
        const assets = [];
        let totalPnl = 0;

        // Free capital as USDT
        if (paperFreeCapital() > 0) {
            const changePct = 0; // No change for cash
            assets.push({
                symbol: 'USDT',
                value: paperFreeCapital(),
                allocation: (paperFreeCapital() / totalEquity) * 100,
                change: changePct,
                pnl: 0
            });
        }

        // Multi-asset positions
        for (const asset of REBALANCE_ASSETS) {
            const pos = paperMultiPositions[asset];
            const currentValue = paperAssetPositionValue(asset);
            const unrealizedPnl = paperAssetUnrealizedPnl(asset);
            const priceData = prices[REBALANCE_PAIRS[asset].symbol];

            if (currentValue > 0 || pos) {
                const entryValue = pos ? pos.entryPrice * pos.quantity : 0;
                const changePct = entryValue > 0 ? ((currentValue - entryValue) / entryValue) * 100 : 0;

                assets.push({
                    symbol: asset,
                    value: currentValue,
                    allocation: (currentValue / totalEquity) * 100,
                    change: parseFloat(changePct.toFixed(2)),
                    pnl: parseFloat(unrealizedPnl.toFixed(2))
                });
                totalPnl += unrealizedPnl;
            }
        }

        // Sort by allocation descending
        assets.sort((a, b) => b.allocation - a.allocation);

        res.end(JSON.stringify({
            assets,
            totalValue: totalEquity,
            totalPnl: parseFloat(totalPnl.toFixed(2)),
            totalPnlPercent: totalEquity > 0 ? parseFloat(((totalPnl / totalEquity) * 100).toFixed(2)) : 0
        }));
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
        const totalEquity = paperFreeCapital() + paperPositionsValue();
        res.end(JSON.stringify({
            enabled: paperTrading.enabled,
            capital: paperTrading.capital,
            equity: totalEquity,
            positions: paperTrading.positions,
            stats: paperTrading.stats,
            stopLoss: paperTrading.stopLoss,
            takeProfit: paperTrading.takeProfit,
            trailingActivation: TRAILING_ACTIVATION,
            trailingDistance: TRAILING_DISTANCE,
            // Volatility Regime
            volatilityRegime: paperVolRegime.getSummary(),
            // Multi-asset rebalancing
            rebalanceEnabled: paperRebalanceEnabled,
            rebalanceThreshold: paperRebalanceThreshold,
            allocation: paperAllocation,
            multiPositions: Object.fromEntries(
                REBALANCE_ASSETS.map(a => [
                    a,
                    paperMultiPositions[a] ? {
                        side: paperMultiPositions[a].side,
                        entryPrice: paperMultiPositions[a].entryPrice,
                        quantity: paperMultiPositions[a].quantity,
                        pnl: paperMultiPositions[a].pnl,
                        pnlPct: paperMultiPositions[a].pnlPct,
                        stopLoss: paperMultiPositions[a].stopLoss,
                        takeProfit: paperMultiPositions[a].takeProfit,
                        unrealizedPnl: paperAssetUnrealizedPnl(a),
                        currentValue: paperAssetPositionValue(a)
                    } : null
                ])
            )
        }));
        return;
    }
    
    if (url === '/api/paper-trading/start') {
        paperTrading.enabled = true;
        paperTrading.capital = 1000;
        paperTrading.positions = [];
        paperTrading.closedTrades = [];
        paperRegimeStats = {
            LOW: { trades: 0, wins: 0, pnl: 0 },
            NORMAL: { trades: 0, wins: 0, pnl: 0 },
            HIGH: { trades: 0, wins: 0, pnl: 0 },
            EXTREME: { trades: 0, wins: 0, pnl: 0 }
        };
        paperOpenPosition = null;
        // Reset multi-asset positions
        for (const asset of REBALANCE_ASSETS) paperMultiPositions[asset] = null;
        paperEquityCurve = [];
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
                timestamp: Date.now(),
                entryTime: paperOpenPosition.entryTime,
                exitReason: 'MANUAL_STOP',
                regime: paperVolRegime.getRegime()
            });
            // Record in Trade Journal
            try {
                tradeJournal.addTrade({
                    id: paperOpenPosition.id,
                    symbol: 'BTCUSDT',
                    direction: paperOpenPosition.side,
                    strategy: paperStrategy,
                    entryPrice: paperOpenPosition.entryPrice,
                    exitPrice: currentPrice,
                    quantity: paperOpenPosition.quantity,
                    pnlPercent: ((currentPrice - paperOpenPosition.entryPrice) / paperOpenPosition.entryPrice) * 100 * (paperOpenPosition.side === 'SHORT' ? -1 : 1),
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
        // Close all multi-asset positions on stop
        for (const asset of REBALANCE_ASSETS) {
            const pos = paperMultiPositions[asset];
            if (pos && prices[asset.toLowerCase()] > 0) {
                const price = prices[asset.toLowerCase()];
                let pnl, exitValue;
                if (pos.side === 'LONG') {
                    pnl = (price - pos.entryPrice) * pos.quantity;
                    exitValue = pos.quantity * price;
                    paperTrading.capital += exitValue - price * pos.quantity * 0.001;
                } else {
                    pnl = (pos.entryPrice - price) * pos.quantity;
                    exitValue = pos.quantity * price;
                    paperTrading.capital -= exitValue + price * pos.quantity * 0.001;
                    paperTrading.capital += pnl - pos.fee - price * pos.quantity * 0.001;
                }
                paperTrading.closedTrades.push({
                    id: pos.id, side: pos.side, asset,
                    entryPrice: pos.entryPrice, exitPrice: price,
                    quantity: pos.quantity,
                    fee: pos.fee + price * pos.quantity * 0.001,
                    pnl: pnl - pos.fee - price * pos.quantity * 0.001,
                    timestamp: Date.now(),
                    entryTime: pos.entryTime, exitReason: 'STOP_API',
                    regime: paperVolRegimes[asset] ? paperVolRegimes[asset].getRegime() : 'NORMAL'
                });
                try { tradeJournal.addTrade({ id: pos.id, symbol: asset, direction: pos.side, strategy: 'multi', entryPrice: pos.entryPrice, exitPrice: price, quantity: pos.quantity, pnlPercent: (pnl - pos.fee - price * pos.quantity * 0.001) / (pos.entryPrice * pos.quantity) * 100, pnlAbsolute: pnl - pos.fee - price * pos.quantity * 0.001, commission: pos.fee + price * pos.quantity * 0.001, exitReason: 'STOP_API', entryTime: pos.entryTime, exitTime: new Date().toISOString(), isPaper: true }); } catch(e) {}
                paperMultiPositions[asset] = null;
            }
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
                    exitReason: 'MANUAL_CLOSE',
                    regime: paperVolRegime.getRegime()
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
        for (const asset of REBALANCE_ASSETS) paperMultiPositions[asset] = null;
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

    // Scalp params API
    if (url === '/api/paper-trading/scalp-params') {
        const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const pt = parseFloat(params.get('profitTarget'));
        const sl = parseFloat(params.get('stopLoss'));
        const mv = parseFloat(params.get('minVolume'));
        const mom = parseInt(params.get('momentum'));
        const mh = parseInt(params.get('maxHold'));
        const tf = params.get('timeframe');

        if (!isNaN(pt) && pt > 0 && pt <= 10) paperTrading.scalpProfitTarget = pt;
        if (!isNaN(sl) && sl > 0 && sl <= 10) paperTrading.scalpStopLoss = sl;
        if (!isNaN(mv) && mv > 0) paperTrading.scalpMinVolume = mv;
        if (!isNaN(mom) && mom >= 0 && mom <= 100) paperTrading.scalpMomentum = mom;
        if (!isNaN(mh) && mh > 0) paperTrading.scalpMaxHold = mh;
        if (tf) paperTrading.scalpTimeframe = tf;

        res.end(JSON.stringify({
            success: true,
            profitTarget: paperTrading.scalpProfitTarget || 0.5,
            stopLoss: paperTrading.scalpStopLoss || 0.3,
            minVolume: paperTrading.scalpMinVolume || 1.5,
            momentum: paperTrading.scalpMomentum || 60,
            maxHold: paperTrading.scalpMaxHold || 900,
            timeframe: paperTrading.scalpTimeframe || '5m'
        }));
        return;
    }

    // POST /api/paper-trading/rebalance-config - configure multi-asset rebalancing
    if (url === '/api/paper-trading/rebalance-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                if (data.enabled !== undefined) paperRebalanceEnabled = !!data.enabled;
                if (data.threshold !== undefined) paperRebalanceThreshold = Math.max(0.01, Math.min(0.5, parseFloat(data.threshold)));
                if (data.allocation) {
                    // data.allocation = { BTC: 0.4, ETH: 0.35, SOL: 0.25 }
                    const total = Object.values(data.allocation).reduce((s, v) => s + Math.max(0, Math.min(1, parseFloat(v) || 0)), 0);
                    if (total > 0 && total <= 1.5) {
                        for (const asset of REBALANCE_ASSETS) {
                            if (data.allocation[asset] !== undefined) {
                                paperAllocation[asset] = Math.max(0.01, Math.min(1, parseFloat(data.allocation[asset]) || 0));
                            }
                        }
                    }
                }
                // Initialize candle history if enabling
                if (paperRebalanceEnabled && paperCandles.btc.length === 0) {
                    const syms = [['BTC','BTCUSDT'],['ETH','ETHUSDT'],['SOL','SOLUSDT']];
                    await Promise.all(syms.map(async ([asset, sym]) => {
                        const c = await fetchCandles(sym, '1m', 60);
                        if (c.length > 0) paperCandles[asset.toLowerCase()] = c;
                    }));
                }
                res.end(JSON.stringify({
                    enabled: paperRebalanceEnabled,
                    threshold: paperRebalanceThreshold,
                    allocation: paperAllocation,
                    assets: Object.fromEntries(REBALANCE_ASSETS.map(a => [a, REBALANCE_PAIRS[a]]))
                }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // GET /api/paper-trading/rebalance-status - get current rebalancing state
    if (url === '/api/paper-trading/rebalance-status') {
        const totalEquity = paperTotalEquity();
        const assetDetails = {};
        for (const asset of REBALANCE_ASSETS) {
            const cfg = REBALANCE_PAIRS[asset];
            const pos = paperMultiPositions[asset];
            const price = prices[asset.toLowerCase()] || 0;
            const currentValue = paperAssetPositionValue(asset);
            const unrealizedPnl = paperAssetUnrealizedPnl(asset);
            const targetValue = totalEquity * paperAllocation[asset];
            const drift = totalEquity > 0 ? ((currentValue / totalEquity) - paperAllocation[asset]) : 0;
            assetDetails[asset] = {
                name: cfg.name,
                color: cfg.color,
                targetAllocation: paperAllocation[asset],
                currentAllocation: totalEquity > 0 ? currentValue / totalEquity : 0,
                drift: drift,
                needsRebalance: Math.abs(drift) > paperRebalanceThreshold,
                position: pos ? {
                    side: pos.side,
                    entryPrice: pos.entryPrice,
                    currentPrice: price,
                    quantity: pos.quantity,
                    unrealizedPnl,
                    pnlPct: pos.pnlPct,
                    stopLoss: pos.stopLoss,
                    takeProfit: pos.takeProfit
                } : null
            };
        }
        res.end(JSON.stringify({
            enabled: paperRebalanceEnabled,
            threshold: paperRebalanceThreshold,
            totalEquity,
            capital: paperFreeCapital(),
            allocation: paperAllocation,
            assetDetails
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RISK/REWARD RATIO STATS
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Helper: calculate R/R for a position
    function calcRR(entry, sl, tp, side) {
        if (!entry || !sl || !tp) return null;
        if (side === 'SHORT') {
            // For shorts: SL is above entry, TP is below entry
            const risk = Math.abs(entry - sl) / entry;
            const reward = Math.abs(tp - entry) / entry;
            return risk > 0 ? reward / risk : null;
        } else {
            // For longs: SL is below entry, TP is above entry
            const risk = Math.abs(entry - sl) / entry;
            const reward = Math.abs(tp - entry) / entry;
            return risk > 0 ? reward / risk : null;
        }
    }
    
    // GET /api/risk-reward/stats - Risk/Reward statistics
    if (url === '/api/risk-reward/stats') {
        // --- Open positions from multi-asset paper trading ---
        const openPositions = [];
        for (const asset of REBALANCE_ASSETS) {
            const pos = paperMultiPositions[asset];
            if (pos && prices[asset.toLowerCase()] > 0) {
                const rr = calcRR(pos.entryPrice, pos.stopLoss, pos.takeProfit, pos.side);
                openPositions.push({
                    symbol: asset,
                    side: pos.side,
                    entry: pos.entryPrice,
                    sl: pos.stopLoss,
                    tp: pos.takeProfit,
                    rr: rr !== null ? Math.round(rr * 100) / 100 : null
                });
            }
        }
        // Also legacy single-asset position
        if (paperOpenPosition && prices.btc > 0) {
            const pos = paperOpenPosition;
            const rr = calcRR(pos.entryPrice, pos.stopLoss, pos.takeProfit, pos.side);
            const existing = openPositions.find(p => p.symbol === 'BTC');
            if (!existing) {
                openPositions.push({
                    symbol: 'BTC',
                    side: pos.side,
                    entry: pos.entryPrice,
                    sl: pos.stopLoss,
                    tp: pos.takeProfit,
                    rr: rr !== null ? Math.round(rr * 100) / 100 : null
                });
            }
        }
        
        // --- Historical R/R from closed trades ---
        const allClosed = paperTrading.closedTrades;
        const closedWithRR = [];
        for (const t of allClosed) {
            // Use stored sl/tp if available, otherwise try to reconstruct from % SL/TP
            let entry = t.entryPrice;
            let sl = t.stopLoss;
            let tp = t.takeProfit;
            let side = t.side;
            
            if (!sl || !tp) {
                // Reconstruct from closed trade pnl - try side+pnl to infer
                // We don't have exact SL/TP for trades without them stored
                // Only include trades where we have explicit SL/TP
                continue;
            }
            if (!entry || !side) continue;
            
            const rr = calcRR(entry, sl, tp, side);
            if (rr !== null) {
                closedWithRR.push({ ...t, rr });
            }
        }
        
        // Compute stats from closed trades
        let averageRR = null, bestRR = null, worstRR = null;
        if (closedWithRR.length > 0) {
            const rrs = closedWithRR.map(t => t.rr);
            averageRR = Math.round((rrs.reduce((a, b) => a + b, 0) / rrs.length) * 100) / 100;
            bestRR = Math.round(Math.max(...rrs) * 100) / 100;
            worstRR = Math.round(Math.min(...rrs) * 100) / 100;
        }
        
        // Win rate by R/R bucket
        const winRateByRR = { gt2: null, gt1: null, lt1: null };
        const buckets = { gt2: { wins: 0, total: 0 }, gt1: { wins: 0, total: 0 }, lt1: { wins: 0, total: 0 } };
        for (const t of closedWithRR) {
            let bucket;
            if (t.rr > 2) bucket = 'gt2';
            else if (t.rr >= 1) bucket = 'gt1';
            else bucket = 'lt1';
            buckets[bucket].total++;
            if (t.pnl > 0) buckets[bucket].wins++;
        }
        for (const [key, val] of Object.entries(buckets)) {
            winRateByRR[key] = val.total > 0 ? Math.round((val.wins / val.total) * 100) / 100 : null;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            openPositions,
            averageRR,
            bestRR,
            worstRR,
            winRateByRR,
            closedWithRRCount: closedWithRR.length
        }));
        return;
    }
    
    // Paper trading equity curve
    if (url === '/api/paper-trading/equity-curve') {
        res.end(JSON.stringify(paperEquityCurve));
        return;
    }

    // GET /api/sentiment - Market Sentiment dla dashboard
    if (url === '/api/sentiment') {
        const urlParts = req.url.split('?');
        const params = new URLSearchParams(urlParts[1] || '');
        const keyword = params.get('keyword') || 'BTC';
        // Async refresh and return
        sentimentAnalyzer.getCombinedSentiment(keyword).then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sentimentAnalyzer.getDashboardData()));
        }).catch(err => {
            console.error('[Sentiment] API error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }
    
    // GET /api/ml-insights - ML Insights dla dashboard
    if (url === '/api/ml-insights') {
        // Pobierz ostatnie ceny z candles
        const candles = paperCandles.btc.length > 0 ? paperCandles.btc : [];
        const prices = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);
        const insights = mlFeatures.getDashboardData(prices, volumes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(insights));
        return;
    }
    
    // GET /api/buffer-health - Replay Buffer Health Monitor
    if (url === '/api/buffer-health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bufferHealth.getDashboardData()));
        return;
    }
    
    // GET /api/sentiment/refresh - refresh sentiment data
    if (url.startsWith('/api/sentiment/refresh')) {
        const urlParts = req.url.split('?');
        const params = new URLSearchParams(urlParts[1] || '');
        const keyword = params.get('keyword') || 'BTC';
        sentimentAnalyzer.getCombinedSentiment(keyword).then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sentimentAnalyzer.getDashboardData()));
        }).catch(err => {
            console.error('[Sentiment] API error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
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
            equityPeak: paperEquityCurve.length > 0 ? Math.max(...paperEquityCurve.map(e => e.equity)) : 1000,
            // Per-regime breakdown
            regimeStats: paperRegimeStats
        }));
        return;
    }
    
    // GET /api/paper-trading/regime-stats - per-regime performance breakdown
    if (url === '/api/paper-trading/regime-stats') {
        const closed = paperTrading.closedTrades;
        // Build per-regime breakdown from closed trades
        const regimeMap = { LOW: [], NORMAL: [], HIGH: [], EXTREME: [] };
        closed.forEach(t => {
            const r = t.regime || 'NORMAL';
            if (regimeMap[r]) regimeMap[r].push(t);
        });
        const regimePerf = {};
        for (const [reg, trades] of Object.entries(regimeMap)) {
            if (trades.length === 0) {
                regimePerf[reg] = { trades: 0, wins: 0, pnl: 0, winRate: 0, avgPnl: 0 };
                continue;
            }
            const wins = trades.filter(t => t.pnl > 0).length;
            const totalPnl = trades.reduce((a, t) => a + (t.pnl || 0), 0);
            regimePerf[reg] = {
                trades: trades.length,
                wins,
                pnl: totalPnl,
                winRate: (wins / trades.length * 100).toFixed(1),
                avgPnl: (totalPnl / trades.length).toFixed(2),
                // Best/worst in this regime
                best: Math.max(...trades.map(t => t.pnl || 0)).toFixed(2),
                worst: Math.min(...trades.map(t => t.pnl || 0)).toFixed(2),
                // Exit reason breakdown
                exitReasons: trades.reduce((acc, t) => {
                    const rsn = t.exitReason || 'UNKNOWN';
                    acc[rsn] = (acc[rsn] || 0) + 1;
                    return acc;
                }, {})
            };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ regimeStats: paperRegimeStats, computedRegimePerf: regimePerf }));
        return;
    }
    
    if (url === '/api/paper-trading/clear-history') {
        paperTrading.closedTrades = [];
        paperRegimeStats = {
            LOW: { trades: 0, wins: 0, pnl: 0 },
            NORMAL: { trades: 0, wins: 0, pnl: 0 },
            HIGH: { trades: 0, wins: 0, pnl: 0 },
            EXTREME: { trades: 0, wins: 0, pnl: 0 }
        };
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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch(e) {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [], total: 0, error: e.message }));
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

    // ═══════════════════════════════════════════════════════════════════════════
    // REBALANCER — portfolio rebalancing across paper trading strategies
    // ═══════════════════════════════════════════════════════════════════════════

    if (url === '/api/rebalancer/status') {
        const status = rebalancer.getStatus();
        const totalEq = paperFreeCapital() + paperPositionsValue();
        const weights = rebalancer.getWeights(totalEq);
        const targetWeights = { ['paper_' + paperStrategy]: 1.0 };
        const drift = rebalancer.needsRebalance(targetWeights, totalEq);
        res.end(JSON.stringify({ ...status, currentWeights: weights, driftDetected: drift }));
        return;
    }

    if (url === '/api/rebalancer/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { enabled, threshold } = JSON.parse(body);
                if (typeof enabled === 'boolean') rebalancer.enabled = enabled;
                if (typeof threshold === 'number') rebalancer.threshold = threshold;
                res.end(JSON.stringify({ success: true, ...rebalancer.getStatus() }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MONTE CARLO — risk simulation API
    // ═══════════════════════════════════════════════════════════════════════════
    const MonteCarlo = require('../src/monteCarlo');

    // POST /api/monte-carlo/run — run a simulation
    if (url === '/api/monte-carlo/run' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const opts = JSON.parse(body || '{}');
                const simOptions = {
                    numSimulations: parseInt(opts.numSimulations) || 10000,
                    initialCapital: parseFloat(opts.initialCapital) || 1000,
                    tradesPerRun: parseInt(opts.tradesPerRun) || 50
                };

                // Use paper trading closed trades as basis
                const closed = paperTrading.closedTrades.filter(t => t.exitPrice != null || t.pnl !== undefined);
                const trades = closed.map(t => ({
                    pnlPercent: t.pnlPct !== undefined ? t.pnlPct : (t.pnl / (t.quantity * t.entryPrice || 1)) * 100,
                    exitPrice: t.exitPrice || t.price || 0
                }));

                if (trades.length < 5) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: `Need at least 5 closed trades (have ${trades.length}). Run paper trading first.` }));
                    return;
                }

                const result = MonteCarlo.runFromTradeData(trades, simOptions);
                global._monteCarloResult = result; // cache for summary/export

                // Auto-save result
                MonteCarlo.saveResults(result);
                console.log(`🎲 Monte Carlo: ${result.simulations} sims | ${trades.length} trades | Prob of loss: ${result.probabilityOfLoss}%`);
                res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, simulations: result.simulations, tradesUsed: trades.length, result }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // GET /api/monte-carlo/summary — formatted text summary
    if (url === '/api/monte-carlo/summary') {
        const r = global._monteCarloResult;
        if (!r) {
            res.end('No simulation run yet. POST to /api/monte-carlo/run first.');
            return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(MonteCarlo.formatSummary(r));
        return;
    }

    // GET /api/monte-carlo/export/json — export full results
    if (url === '/api/monte-carlo/export/json') {
        const r = global._monteCarloResult;
        if (!r) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'No simulation results. Run POST /api/monte-carlo/run first.' }));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="monte-carlo-${Date.now()}.json"`);
        res.end(JSON.stringify(r, null, 2));
        return;
    }

    // GET /api/monte-carlo/export/equity-csv — export sample equity curves as CSV
    if (url === '/api/monte-carlo/export/equity-csv') {
        const r = global._monteCarloResult;
        if (!r || !r.sampleEquityCurves || r.sampleEquityCurves.length === 0) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'No simulation results.' }));
            return;
        }
        // For CSV export we need to run a quick sim that returns per-simulation equity values
        // Instead, export the summary stats table
        const header = 'Metric,Value\n';
        const rows = [
            `Simulations,${r.simulations}`,
            `TradesPerRun,${r.tradesPerRun}`,
            `InitialCapital,$${r.initialCapital}`,
            `TerminalEquity_Mean,$${r.terminalEquity.mean}`,
            `TerminalEquity_Median,$${r.terminalEquity.median}`,
            `TerminalEquity_Std,$${r.terminalEquity.std}`,
            `TerminalEquity_P5,$${r.terminalEquity.p5}`,
            `TerminalEquity_P95,$${r.terminalEquity.p95}`,
            `VaR_95%,${r.var[95]}%`,
            `VaR_99%,${r.var[99]}%`,
            `CVaR_95%,${r.cvar[95]}%`,
            `CVaR_99%,${r.cvar[99]}%`,
            `ProbabilityOfLoss,${r.probabilityOfLoss}%`,
            `MaxDrawdown_Mean,${r.maxDrawdown.mean}%`,
            `MaxDrawdown_P95,${r.maxDrawdown.p95}%`,
            `MaxDrawdown_Worst,${r.maxDrawdown.worst}%`,
            `DrawdownProb_over5%,${r.drawdownProbabilities.over5}%`,
            `DrawdownProb_over10%,${r.drawdownProbabilities.over10}%`,
            `DrawdownProb_over20%,${r.drawdownProbabilities.over20}%`,
            `AvgSimulatedWinRate,${r.avgWinRate}%`,
            `RiskAdjustedReturn,${r.riskAdjustedReturn}`,
            `HistoricalWinRate,${r.returnStats.historicalWinRate}%`
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="monte-carlo-stats-${Date.now()}.csv"`);
        res.end(header + rows);
        return;
    }

    // GET /api/monte-carlo/quick — fast 1000-sim version using recent equity curve
    if (url === '/api/monte-carlo/quick') {
        const closed = paperEquityCurve.length > 0
            ? paperEquityCurve.map(e => ({ pnlPct: ((e.equity - paperEquityCurve[0].equity) / paperEquityCurve[0].equity) * 100, exitPrice: e.price }))
            : [];

        if (closed.length < 5) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Not enough equity curve data. Run paper trading first.' }));
            return;
        }

        const result = MonteCarlo.runFromTradeData(closed, { numSimulations: 1000, tradesPerRun: 30 });
        global._monteCarloResult = result;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, source: 'equityCurve', simulations: result.simulations, result }));
        return;
    }

    if (url === '/api/strategy/compare') {
        const { BinanceClient } = require('../src/services/BinanceClient');
        const client = new BinanceClient();
        const { trendFollowing, meanReversion, momentum, macdCrossover, scalping } = require('../src/strategies');
        const { GridStrategy } = require('../src/strategies/gridStrategy');

        const STRATS = [
            { id: 'trend',        name: '📈 Trend',        fn: (env) => trendFollowing(env, null) },
            { id: 'mean_reversion',name: '↔️ Mean Rev',    fn: (env) => meanReversion(env) },
            { id: 'momentum',      name: '💨 Momentum',    fn: (env) => momentum(env, null) },
            { id: 'macd',          name: '〰️ MACD',        fn: (env) => macdCrossover(env, null) },
            { id: 'scalping',      name: '⚡ Scalping',    fn: scalping },
            { id: 'grid',          name: '🔲 Grid',        fn: (env) => { const gs = new GridStrategy(); return gs.getAction(env.currentPrice(), env.position, env.entryPrice); } },
        ];

        const CANDLES = 300;   // lookback window
        const CAPITAL = 1000;
        const FEE = 0.001;

        async function runBacktest(strategyFn, pair = 'BTCUSDT', interval = '5m') {
            try {
                const klines = await client.getKlines(pair, interval, CANDLES);
                if (!klines || klines.length < 50) return null;

                const env = new (require('../src/environment'))(pair, 30);
                env.reset(klines);
                let pos = 0, entry = 0, qty = 0, cash = CAPITAL;
                let cashBeforeEntry = cash;
                const trades = [];

                while (true) {
                    const action = strategyFn(env);
                    const price = klines[env.step]?.close || 0;
                    if (!price) break;

                    if (action === 1 && pos === 0) {
                        // OPEN LONG
                        cashBeforeEntry = cash;
                        qty = (cash * 0.95) / price;
                        cash -= qty * price * (1 + FEE); // cost + entry fee
                        pos = 1; entry = price;
                    } else if (action === 2 && pos === 1) {
                        // CLOSE LONG
                        const proceeds = qty * price * (1 - FEE);
                        const pnl = proceeds - (cashBeforeEntry - cash); // actual P&L
                        cash = cashBeforeEntry + pnl;
                        trades.push({ pnl, side: 'LONG' });
                        qty = 0; pos = 0;
                    }

                    env.step++;
                    if (env.step >= klines.length - 1) break;
                }

                // Close open position
                if (pos === 1) {
                    const price = klines[klines.length - 1].close;
                    const proceeds = qty * price * (1 - FEE);
                    const pnl = proceeds - (cashBeforeEntry - cash);
                    cash = cashBeforeEntry + pnl;
                    trades.push({ pnl, side: 'LONG' });
                    qty = 0; pos = 0;
                }

                const finalEquity = cash;
                const totalPnl = finalEquity - CAPITAL;
                const pnlPct = (totalPnl / CAPITAL) * 100;
                const wins = trades.filter(t => t.pnl > 0);
                const losses = trades.filter(t => t.pnl <= 0);
                const winRate = trades.length > 0 ? wins.length / trades.length : 0;

                // Equity curve
                let equity = CAPITAL, peak = CAPITAL, maxDD = 0, maxDDPct = 0;
                const equityCurve = [];
                for (const t of trades) {
                    equity += t.pnl;
                    equityCurve.push(equity);
                    if (equity > peak) peak = equity;
                    const dd = peak - equity;
                    const ddPct = peak > 0 ? dd / peak * 100 : 0;
                    if (dd > maxDD) { maxDD = dd; maxDDPct = ddPct; }
                }

                // Sharpe (simplified)
                const returns = trades.map(t => t.pnl / CAPITAL);
                const avgR = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
                const stdR = returns.length > 1
                    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgR, 2), 0) / (returns.length - 1)) : 0;
                const sharpe = stdR > 0 ? (avgR * Math.sqrt(252)) / stdR : 0;

                // Sortino Ratio (downside deviation only)
                const negReturns = returns.filter(r => r < 0);
                const downStd = negReturns.length > 1
                    ? Math.sqrt(negReturns.reduce((s, r) => s + Math.pow(r - avgR, 2), 0) / (negReturns.length - 1)) : 0;
                const sortino = downStd > 0 ? (avgR * Math.sqrt(252)) / downStd : 0;

                // Calmar Ratio (annualized return / max drawdown)
                const annulReturn = pnlPct / 100;
                const maxDDPctSafe = maxDDPct > 0 ? maxDDPct / 100 : 0.001;
                const calmar = maxDDPctSafe > 0 ? annulReturn / maxDDPctSafe : 0;

                // Annualized Return (5m candles ≈ 288/day)
                const numDays = trades.length > 0 ? Math.max(trades.length / 288, 0.1) : 1;
                const annulReturnPct = (Math.pow(finalEquity / CAPITAL, 365 / numDays) - 1) * 100;

                const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
                const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
                const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

                return {
                    totalTrades: trades.length,
                    winningTrades: wins.length,
                    losingTrades: losses.length,
                    winRate: winRate * 100,
                    totalPnl: finalEquity - CAPITAL,
                    totalPnlPercent: pnlPct,
                    finalEquity,
                    maxDrawdown: maxDD,
                    maxDrawdownPercent: maxDDPct,
                    sharpeRatio: sharpe,
                    sortinoRatio: sortino,
                    calmarRatio: calmar,
                    annulReturnPct,
                    profitFactor: pf,
                    avgWin: wins.length ? grossWin / wins.length : 0,
                    avgLoss: losses.length ? grossLoss / losses.length : 0,
                    equityCurve
                };
            } catch (e) {
                console.error(`[StrategyCompare] ${strategyFn._name || 'unknown'}:`, e.message);
                return null;
            }
        }

        // Run all strategies in parallel
        Promise.all(STRATS.map(s => runBacktest(s.fn)))
            .then(results => {
                const comparison = STRATS.map((s, i) => ({
                    strategyId: s.id,
                    strategyName: s.name,
                    ...(results[i] || {
                        totalTrades: 0, winningTrades: 0, losingTrades: 0,
                        winRate: 0, totalPnl: 0, totalPnlPercent: 0,
                        finalEquity: CAPITAL, maxDrawdown: 0,
                        maxDrawdownPercent: 0, sharpeRatio: 0,
                        sortinoRatio: 0, calmarRatio: 0, annulReturnPct: 0,
                        profitFactor: 0, avgWin: 0, avgLoss: 0,
                        error: results[i] === null ? 'insufficient data' : 'failed'
                    })
                })).map(r => {
                    // Format numbers
                    r.totalPnl = parseFloat(r.totalPnl.toFixed(2));
                    r.totalPnlPercent = parseFloat(r.totalPnlPercent.toFixed(3));
                    r.maxDrawdown = parseFloat(r.maxDrawdown.toFixed(2));
                    r.maxDrawdownPercent = parseFloat(r.maxDrawdownPercent.toFixed(2));
                    r.sharpeRatio = parseFloat(r.sharpeRatio.toFixed(2));
                    r.sortinoRatio = parseFloat(r.sortinoRatio.toFixed(2));
                    r.calmarRatio = parseFloat(r.calmarRatio.toFixed(2));
                    r.annulReturnPct = parseFloat(r.annulReturnPct.toFixed(2));
                    r.profitFactor = parseFloat(r.profitFactor.toFixed(2));
                    r.avgWin = parseFloat(r.avgWin.toFixed(4));
                    r.avgLoss = parseFloat(r.avgLoss.toFixed(4));
                    r.finalEquity = parseFloat(r.finalEquity.toFixed(2));
                    r.winRate = parseFloat(r.winRate.toFixed(1));
                    return r;
                });

                // Rank strategies
                const byPnl = [...comparison].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
                byPnl.forEach((s, i) => s.rankPnl = i + 1);
                const bySharpe = [...comparison].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
                bySharpe.forEach((s, i) => s.rankSharpe = i + 1);
                const bySortino = [...comparison].sort((a, b) => b.sortinoRatio - a.sortinoRatio);
                bySortino.forEach((s, i) => s.rankSortino = i + 1);
                const byCalmar = [...comparison].sort((a, b) => b.calmarRatio - a.calmarRatio);
                byCalmar.forEach((s, i) => s.rankCalmar = i + 1);
                const byWinRate = [...comparison].sort((a, b) => b.winRate - a.winRate);
                byWinRate.forEach((s, i) => s.rankWinRate = i + 1);
                const byPF = [...comparison].sort((a, b) => b.profitFactor - a.profitFactor);
                byPF.forEach((s, i) => s.rankPF = i + 1);

                // Best overall (average rank across 6 metrics)
                comparison.forEach(s => {
                    s.avgRank = parseFloat(((s.rankPnl + s.rankSharpe + s.rankSortino + s.rankCalmar + s.rankWinRate + s.rankPF) / 6).toFixed(1));
                });
                comparison.sort((a, b) => a.avgRank - b.avgRank);

                res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ comparison, timestamp: new Date().toISOString() }));
            })
            .catch(e => {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
            });
        return;
    }

    // GET /api/backtest/scalping - Full scalping backtest with TP/SL/maxHoldTime
    if (url.startsWith('/api/backtest/scalping')) {
        const { BinanceClient } = require('../src/services/BinanceClient');
        const { backtestScalpingStrategy } = require('../src/strategies/scalpingStrategy');
        const urlParts = url.split('?');
        const query = new URLSearchParams(urlParts[1] || '');
        const pair = query.get('pair') || 'BTCUSDT';
        const interval = query.get('interval') || '5m';
        const candles = parseInt(query.get('candles')) || 300;
        const profitTarget = parseFloat(query.get('profitTarget')) || 0.5;
        const stopLoss = parseFloat(query.get('stopLoss')) || 0.3;
        const minVolume = parseFloat(query.get('minVolume')) || 1.5;
        const momentumThreshold = parseInt(query.get('momentumThreshold')) || 60;
        const maxHoldTime = parseInt(query.get('maxHoldTime')) || 900;
        const capital = parseFloat(query.get('capital')) || 1000;

        const client = new BinanceClient();
        client.getKlines(pair, interval, candles).then(klines => {
            if (!klines || klines.length < 50) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Insufficient klines data' }));
                return;
            }
            const result = backtestScalpingStrategy(klines, {
                profitTarget,
                stopLoss,
                minVolume,
                momentumThreshold,
                maxHoldTime,
                initialBalance: capital
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                strategy: 'scalping',
                pair,
                interval,
                params: { profitTarget, stopLoss, minVolume, momentumThreshold, maxHoldTime, initialBalance: capital },
                ...result
            }));
        }).catch(e => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        });
        return;
    }

    // GET /api/strategy/compare/chart - lightweight data for bar charts
    if (url === '/api/strategy/compare/chart') {
        const { BinanceClient } = require('../src/services/BinanceClient');
        const { trendFollowing, meanReversion, momentum, macdCrossover, scalping } = require('../src/strategies');
        const { GridStrategy } = require('../src/strategies/gridStrategy');

        const STRATS = [
            { id: 'trend',        name: '📈 Trend',        fn: (env) => trendFollowing(env, null) },
            { id: 'mean_reversion',name: '↔️ Mean Rev',    fn: (env) => meanReversion(env) },
            { id: 'momentum',      name: '💨 Momentum',    fn: (env) => momentum(env, null) },
            { id: 'macd',          name: '〰️ MACD',        fn: (env) => macdCrossover(env, null) },
            { id: 'scalping',      name: '⚡ Scalping',    fn: scalping },
            { id: 'grid',          name: '🔲 Grid',        fn: (env) => { const gs = new GridStrategy(); return gs.getAction(env.currentPrice(), env.position, env.entryPrice); } },
        ];

        const CAP = 1000;
        const CANDLES = 200;

        function runLightBacktest(strategyFn) {
            return new Promise(async (resolve) => {
                try {
                    const { BinanceClient } = require('../src/services/BinanceClient');
                    const client = new BinanceClient();
                    const klines = await client.getKlines('BTCUSDT', '5m', CANDLES);
                    if (!klines || klines.length < 50) { resolve(null); return; }

                    const env = new (require('../src/environment'))('BTCUSDT', 30);
                    env.reset(klines);
                    let pos = 0, entry = 0, qty = 0, cash = CAP;
                    let cashBeforeEntry = cash;

                    while (true) {
                        const action = strategyFn(env);
                        const price = klines[env.step]?.close || 0;
                        if (!price) break;
                        if (action === 1 && pos === 0) {
                            cashBeforeEntry = cash;
                            qty = (cash * 0.95) / price;
                            cash -= qty * price * 1.001;
                            pos = 1; entry = price;
                        } else if (action === 2 && pos === 1) {
                            const proceeds = qty * price * 0.999;
                            cash = cashBeforeEntry + (proceeds - (cashBeforeEntry - cash));
                            qty = 0; pos = 0;
                        }
                        env.step++;
                        if (env.step >= klines.length - 1) break;
                    }
                    if (pos === 1) {
                        const price = klines[klines.length - 1].close;
                        const proceeds = qty * price * 0.999;
                        cash = cashBeforeEntry + (proceeds - (cashBeforeEntry - cash));
                    }

                    const finalEquity = cash;
                    const equityCurve = [CAP, finalEquity]; // just 2 points for sparkline
                    resolve({ finalEquity, totalPnlPercent: ((finalEquity - CAP) / CAP) * 100, equityCurve });
                } catch (e) { resolve(null); }
            });
        }

        Promise.all(STRATS.map(s => runLightBacktest(s.fn))).then(results => {
            const chartData = STRATS.map((s, i) => {
                const r = results[i];
                if (!r) return { strategyId: s.id, strategyName: s.name, equityCurve: [] };
                return {
                    strategyId: s.id,
                    strategyName: s.name,
                    finalEquity: parseFloat(r.finalEquity.toFixed(2)),
                    pnlPct: parseFloat(r.totalPnlPercent.toFixed(3)),
                    equityCurve: r.equityCurve
                };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ chartData }));
        }).catch(e => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); });
        return;
    }
    
    // ─── Trade Journal ─────────────────────────────────────────────────────────

    // GET /api/attribution - P&L attribution breakdown
    if (url === '/api/attribution') {
        const attribution = calculateAttribution({ minTrades: 1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(attribution));
        return;
    }
    
    // GET /api/trade-journal - list trades with pagination
    if (url.startsWith('/api/trade-journal')) {
        const urlParts = url.split('?');
        const query = new URLSearchParams(urlParts[1] || '');
        
        if (url === '/api/trade-journal/stats') {
            const filter = {};
            if (query.get('strategy')) filter.strategy = query.get('strategy');
            if (query.get('isPaper')) filter.isPaper = query.get('isPaper') === 'true';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tradeJournal.getStats(filter)));
            return;
        }
        
        if (url.startsWith('/api/trade-journal/detail/')) {
            const id = parseInt(url.split('/').pop());
            const trade = tradeJournal.trades.find(t => t.id === id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(trade || { error: 'Trade not found' }));
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tradeJournal.listTrades(page, limit, filter)));
        return;
    }

    // GET /api/trade-journal/export - export trades as CSV
    if (url === '/api/trade-journal/export') {
        const { exportJournal } = require('../src/tradeJournal');
        const exportDir = process.env.JOURNAL_EXPORT_DIR || path.join(__dirname, '..', 'exports');
        const fs = require('fs');
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        const filePath = exportJournal(exportDir);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, file: filePath }));
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

    // ─── Risk Manager API ─────────────────────────────────────────────────────

    // GET /api/risk/report - get comprehensive risk report with Kelly Criterion
    if (url === '/api/risk/report') {
        const currentPrice = prices.btc || 1000;
        const report = riskManager.getRiskReport(paperTrading.capital, currentPrice * 0.01); // rough ATR estimate
        res.end(JSON.stringify(report));
        return;
    }

    // POST /api/risk/config - update risk parameters
    if (url === '/api/risk/config' && method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const config = JSON.parse(body || '{}');
                if (config.maxPositionSize !== undefined) riskManager.maxPositionSize = config.maxPositionSize;
                if (config.stopLossPercent !== undefined) riskManager.stopLossPercent = config.stopLossPercent;
                if (config.takeProfitPercent !== undefined) riskManager.takeProfitPercent = config.takeProfitPercent;
                if (config.kellyFraction !== undefined) riskManager.kellyFraction = config.kellyFraction;
                if (config.useDynamicStops !== undefined) riskManager.useDynamicStops = config.useDynamicStops;
                if (config.maxDailyLoss !== undefined) riskManager.maxDailyLoss = config.maxDailyLoss;
                if (config.maxDrawdown !== undefined) riskManager.maxDrawdown = config.maxDrawdown;
                if (config.maxConsecutiveLosses !== undefined) riskManager.maxConsecutiveLosses = config.maxConsecutiveLosses;
                if (config.atrMultiplierSL !== undefined) riskManager.atrMultiplierSL = config.atrMultiplierSL;
                if (config.atrMultiplierTP !== undefined) riskManager.atrMultiplierTP = config.atrMultiplierTP;
                if (tradeJournal) riskManager.setJournal(tradeJournal);
                res.end(JSON.stringify({ success: true, config: riskManager.getRiskReport(paperTrading.capital) }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // GET /api/risk/can-trade - check if trading is allowed
    if (url === '/api/risk/can-trade') {
        const result = riskManager.canTrade(paperTrading.capital);
        res.end(JSON.stringify(result));
        return;
    }

    // GET /api/risk/kelly - get Kelly Criterion recommendation
    if (url === '/api/risk/kelly') {
        const kelly = riskManager.calculateKelly();
        const fractional = riskManager.getKellyPositionSize();
        res.end(JSON.stringify({
            kelly: kelly,
            fractionalKelly: fractional,
            kellyPercent: (kelly * 100).toFixed(2) + '%',
            fractionalPercent: (fractional * 100).toFixed(2) + '%'
        }));
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
    
    // ─── Hyperparameter Grid Optimizer API ──────────────────────────────────────
    if (!global.optimizer) {
        const HyperparameterOptimizer = require('../src/optimizer');
        global.optimizer = new HyperparameterOptimizer();
    }
    
    // GET /api/optimizer/status - status optymalizacji
    if (url === '/api/optimizer/status') {
        res.end(JSON.stringify(global.optimizer.getStatus()));
        return;
    }
    
    // POST /api/optimizer/start - rozpocznij optymalizację
    if (url === '/api/optimizer/start' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const paramGrid = data.paramGrid || {
                    learningRate: [0.0001, 0.0005, 0.001, 0.005],
                    epsilon: [0.1, 0.3, 0.5],
                    gamma: [0.9, 0.95, 0.99],
                    batchSize: [32, 64, 128],
                    memorySize: [1000, 5000, 10000],
                    hiddenLayers: [[256, 128, 64], [512, 256, 128], [300, 200, 100]]
                };
                const iterations = data.iterations || null;
                
                if (global.optimizer.isRunning) {
                    res.writeHead(409);
                    res.end(JSON.stringify({ error: 'Optymalizacja już trwa', status: global.optimizer.getStatus() }));
                    return;
                }
                
                // Uruchom optymalizację asynchronicznie
                global.optimizer.optimize(paramGrid, iterations).then(result => {
                    console.log('🔬 Optymalizacja zakończona:', result);
                }).catch(err => {
                    console.error('Błąd optymalizacji:', err);
                });
                
                res.end(JSON.stringify({ success: true, message: 'Optymalizacja rozpoczęta', status: global.optimizer.getStatus() }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    // POST /api/optimizer/stop - zatrzymaj optymalizację
    if (url === '/api/optimizer/stop' && req.method === 'POST') {
        global.optimizer.stop();
        res.end(JSON.stringify({ success: true, message: 'Wysłano sygnał zatrzymania' }));
        return;
    }
    
    // GET /api/optimizer/results - wyniki najlepszych konfiguracji
    if (url === '/api/optimizer/results') {
        const urlParts = url.split('?');
        const params = new URLSearchParams(urlParts[1] || '');
        const top = parseInt(params.get('top')) || 5;
        const topResults = global.optimizer.getTopResults(top);
        res.end(JSON.stringify({
            results: topResults,
            bestParams: global.optimizer.bestParams,
            bestScore: global.optimizer.bestScore,
            totalEvaluated: global.optimizer.results.length
        }));
        return;
    }
    
    // POST /api/optimizer/apply-best - zaaplikuj najlepsze parametry do agenta
    if (url === '/api/optimizer/apply-best' && req.method === 'POST') {
        const best = global.optimizer.bestParams;
        if (!best) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Brak najlepszych parametrów. Uruchom najpierw optymalizację.' }));
            return;
        }
        
        // Aplikuj do agenta DQN
        if (agent) {
            agent.learningRate = best.learningRate;
            agent.gamma = best.gamma;
            agent.batchSize = best.batchSize;
            agent.epsilon = best.epsilon;
            agent.bufferSize = best.memorySize;
            console.log('🔧 Zaaplikowano najlepsze parametry:', best);
        }
        
        res.end(JSON.stringify({ success: true, appliedParams: best }));
        return;
    }
    
    // GET /api/optimizer/history - historia optymalizacji
    if (url === '/api/optimizer/history') {
        const historyFile = path.join(__dirname, '..', 'optimization-results.json');
        try {
            if (fs.existsSync(historyFile)) {
                const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                res.end(JSON.stringify(history));
            } else {
                res.end(JSON.stringify({ message: 'Brak historii optymalizacji' }));
            }
        } catch(e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
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
    
    // Track buffer health
    const flatState = agent.flattenState ? agent.flattenState(state) : state;
    bufferHealth.recordSample({ state: flatState, action, reward }, loss !== null ? Math.abs(loss) : null);
    bufferHealth.updateBufferSize(agent.buffer?.length || 0, 10000);
    
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

        // Update buffer health with episode data
        bufferHealth.recordEpisode(pnlPercent, metrics.steps);
        bufferHealth.resetActionCounts();
        
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
        // Update multi-asset candles for rebalancing (every 15s to reduce API load)
        if (paperRebalanceEnabled) {
            for (const asset of REBALANCE_ASSETS) {
                const sym = REBALANCE_PAIRS[asset].symbol;
                const candles = await fetchCandles(sym, '1m', 60);
                if (candles.length > 0) paperCandles[asset.toLowerCase()] = candles;
            }
        }
    } catch (e) {}
}

// Update HTF (higher timeframe) trends - called every 60s
async function updateHtfTrends() {
    try {
        const { BinanceClient } = require('../src/services/BinanceClient');
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
setInterval(paperRebalancingStep, 10000); // Multi-asset rebalancing every 10s
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
