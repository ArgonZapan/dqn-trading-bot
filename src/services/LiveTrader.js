/**
 * Live Trading Module - Real Binance API integration
 * Requires BINANCE_API_KEY and BINANCE_API_SECRET in .env
 *
 * WARNING: Real money at risk. Use with caution.
 * Paper trading is recommended before going live.
 */

const BASE_URL = 'https://api.binance.com';
const { fetchHTFState, filterSignalWithHTF } = require('../mtfFilter');

/**
 * Create HMAC-SHA256 signature for Binance API
 */
async function hmacSign(queryString, secret) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret)
    .update(queryString)
    .digest('hex');
}

/**
 * Build signed query string for Binance API
 */
async function buildSignedParams(params, apiSecret) {
  const timestamp = Date.now();
  const queryParams = { ...params, timestamp };
  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const signature = await hmacSign(queryString, apiSecret);
  return `${queryString}&signature=${signature}`;
}

/**
 * LiveTrader - Real order execution on Binance
 */
class LiveTrader {
  constructor(config) {
    this.apiKey = '';
    this.apiSecret = '';
    this.symbol = 'BTCUSDT';
    this.positionSize = 0.95;
    this.stopLossPercent = 2.0;
    this.takeProfitPercent = 4.0;
    this.trailingActivation = 1.0;  // % profit before trailing activates
    this.trailingDistance = 0.75;     // % below peak (LONG) / above trough (SHORT)
    this.testMode = true;

    // Safety controls
    this.maxDailyLoss = 5.0;          // % of session-start capital to stop for the day
    this.maxDrawdownLimit = 10.0;    // % peak equity drawdown -> emergency close
    this.maxTradesPerDay = 20;        // max trades per calendar day
    this.emergencyStopActive = false;
    this.sessionStartCapital = 1000;
    this.dailyTradeCount = 0;
    this.dailyStartDate = null;
    this.dailyPnL = 0

    this.enabled = false;
    this.mode = 'paper';
    this.strategy = 'trend';        // 'trend' | 'momentum' | 'macd' | 'scalping' | 'grid'
    this.autoTrading = false;       // Auto-open positions based on HTF-filtered signals
    this.autoTradingInterval = null;
    this.htfState = { h1: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 }, h4: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 } };
    this.htfUpdateInterval = null;
    this.positions = new Map();
    this.closedTrades = [];

    this.capital = 0;
    this.baseCapital = 1000;
    this.feeRate = 0.001;
    this.peakBalance = 1000;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;

    this.priceInterval = null;
    this.currentPrice = 0;
    this.priceCallbacks = [];

    if (config) this.configure(config);
  }

  configure(config) {
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.apiSecret) this.apiSecret = config.apiSecret;
    if (config.symbol) this.symbol = config.symbol;
    if (config.positionSize) this.positionSize = config.positionSize;
    if (config.stopLossPercent) this.stopLossPercent = config.stopLossPercent;
    if (config.takeProfitPercent) this.takeProfitPercent = config.takeProfitPercent;
    if (config.trailingActivation) this.trailingActivation = config.trailingActivation;
    if (config.trailingDistance) this.trailingDistance = config.trailingDistance;
    if (config.testMode !== undefined) this.testMode = config.testMode;
    if (config.strategy) this.strategy = config.strategy;
    if (config.autoTrading !== undefined) {
      if (config.autoTrading) this.startAutoTrading();
      else this.stopAutoTrading();
    }
    if (config.maxDailyLoss) this.maxDailyLoss = Math.max(0.1, Math.min(50, config.maxDailyLoss));
    if (config.maxDrawdownLimit) this.maxDrawdownLimit = Math.max(0.1, Math.min(100, config.maxDrawdownLimit));
    if (config.maxTradesPerDay) this.maxTradesPerDay = Math.max(1, config.maxTradesPerDay);
  }

  checkAllowance() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStartDate !== today) {
      this.dailyStartDate = today;
      this.dailyTradeCount = 0;
      this.dailyPnL = 0;
    }
    if (this.emergencyStopActive) {
      return { allowed: false, reason: 'EMERGENCY_STOP' };
    }
    if (this.dailyTradeCount >= this.maxTradesPerDay) {
      return { allowed: false, reason: 'MAX_TRADES_PER_DAY', limit: this.maxTradesPerDay };
    }
    const dailyLossPct = this.sessionStartCapital > 0
      ? (this.dailyPnL / this.sessionStartCapital) * 100 : 0;
    if (dailyLossPct <= -this.maxDailyLoss) {
      return { allowed: false, reason: 'MAX_DAILY_LOSS', loss: dailyLossPct, limit: this.maxDailyLoss };
    }
    if (this.maxDrawdownLimit > 0 && this.maxDrawdownPercent >= this.maxDrawdownLimit) {
      return { allowed: false, reason: 'MAX_DRAWDOWN', dd: this.maxDrawdownPercent, limit: this.maxDrawdownLimit };
    }
    return { allowed: true };
  }

  async triggerEmergencyStop(reason) {
    if (this.emergencyStopActive) return;
    this.emergencyStopActive = true;
    this.stopAutoTrading();
    console.error('[LiveTrader] EMERGENCY STOP: ' + reason);
    if (this.positions.has('LONG')) await this.closeLong('EMERGENCY');
    if (this.positions.has('SHORT')) await this.closeShort('EMERGENCY');
    this.enabled = false;
    this.stopHTFUpdates();
    this.stopPriceUpdates();
  }

  resetEmergencyStop() {
    this.emergencyStopActive = false;
    this.dailyTradeCount = 0;
    this.dailyPnL = 0;
    this.dailyStartDate = new Date().toISOString().slice(0, 10);
  }

  setSafetyLimits(opts) {
    if (opts.maxDailyLoss !== undefined) this.maxDailyLoss = Math.max(0.1, Math.min(50, opts.maxDailyLoss));
    if (opts.maxDrawdownLimit !== undefined) this.maxDrawdownLimit = Math.max(0.1, Math.min(100, opts.maxDrawdownLimit));
    if (opts.maxTradesPerDay !== undefined) this.maxTradesPerDay = Math.max(1, opts.maxTradesPerDay);
  }

  isConfigured() { return !!(this.apiKey && this.apiSecret); }
  isTestMode() { return this.testMode; }
  isEnabled() { return this.enabled; }
  getMode() { return this.mode; }
  getSymbol() { return this.symbol; }

  setSymbol(symbol) { this.symbol = symbol; }
  setStopLoss(percent) { this.stopLossPercent = Math.max(0.1, Math.min(50, percent)); }
  setTakeProfit(percent) { this.takeProfitPercent = Math.max(0.1, Math.min(100, percent)); }
  setTrailingActivation(pct) { this.trailingActivation = Math.max(0.1, Math.min(20, pct)); }
  setTrailingDistance(pct) { this.trailingDistance = Math.max(0.1, Math.min(10, pct)); }
  setPositionSize(size) { this.positionSize = Math.max(0.01, Math.min(1.0, size)); }
  setStrategy(strategy) { this.strategy = strategy; }

  startAutoTrading(intervalMs = 10000) {
    this.stopAutoTrading();
    this.autoTrading = true;
    this.autoTradingInterval = setInterval(async () => {
      await this.autoTradingStep();
    }, intervalMs);
    console.log(`[LiveTrader] Auto-trading ON (${this.strategy}, every ${intervalMs}ms)`);
  }

  stopAutoTrading() {
    if (this.autoTradingInterval) { clearInterval(this.autoTradingInterval); this.autoTradingInterval = null; }
    this.autoTrading = false;
  }

  isAutoTrading() { return this.autoTrading; }

  // ─── Local indicator calculation ─────────────────────────────────────────

  calcEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  async calculateIndicators() {
    const candles = await this.fetchCandles(this.symbol, '1m', 100);
    if (candles.length < 21) return null;
    const closes = candles.map(c => c.close);
    const ind = {
      ema9: this.calcEMA(closes, 9),
      ema21: this.calcEMA(closes, 21),
      rsi: this.calcRSI(closes, 14)
    };
    // Add EMA5 for scalping
    if (candles.length >= 5) {
      ind.ema5 = this.calcEMA(closes, 5);
      ind.ema5Prev = this.calcEMA(closes.slice(0, -1), 5);
    }
    ind.ema21Prev = this.calcEMA(closes.slice(0, -1), 21);
    return ind;
  }

  async fetchCandles(symbol, interval, limit = 100) {
    try {
      const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const r = await fetch(url);
      if (!r.ok) return [];
      const data = await r.json();
      return data.map(k => ({
        open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]),
        volume: parseFloat(k[5]), timestamp: parseInt(k[0])
      }));
    } catch { return []; }
  }

  // ─── Auto-trading: evaluate signal and open positions ────────────────────

  /**
   * Close existing position before flipping direction
   * Returns the closed trade if a position was closed, null otherwise
   */
  async closeExistingPositionBeforeFlip(targetSide) {
    const hasLong = this.positions.has('LONG');
    const hasShort = this.positions.has('SHORT');
    if (!hasLong && !hasShort) return null;

    // If we already have the target side, do nothing
    if ((targetSide === 'BUY' && hasLong) || (targetSide === 'SHORT' && hasShort)) return null;

    // Close the opposite position before flipping
    if (targetSide === 'BUY' && hasShort) {
      const price = await this.getCurrentPrice(this.symbol);
      console.log(`[LiveTrader] Flipping SHORT→LONG @ $${price.toLocaleString()}`);
      return await this.closeShort('FLIP');
    }
    if (targetSide === 'SHORT' && hasLong) {
      const price = await this.getCurrentPrice(this.symbol);
      console.log(`[LiveTrader] Flipping LONG→SHORT @ $${price.toLocaleString()}`);
      return await this.closeLong('FLIP');
    }
    return null;
  }

  async autoTradingStep(strategy) {
    if (!this.enabled) return null;
    if (this.strategy === 'grid') return null;
    const check = this.checkAllowance();
    if (!check.allowed) {
      console.log('[LiveTrader] Safety block: ' + check.reason + ' - skip');
      return null;
    }
    const candles = await this.fetchCandles(this.symbol, '1m', 100);
    if (candles.length < 21) return null;
    const ind = await this.calculateIndicators();
    if (!ind) return null;

    // Generate raw signal
    let rawSignal = await this.generateSignal(candles, ind);
    if (rawSignal === 'HOLD') return null;

    // Apply HTF filter
    const signal = filterSignalWithHTF(rawSignal, this.strategy, this.htfState, ind);
    if (signal === 'HOLD') return null;

    // Close existing position if flipping direction
    if (signal === 'BUY' || signal === 'SHORT') {
      await this.closeExistingPositionBeforeFlip(signal);
    }

    // Open position only if no position exists after flip check
    if (this.positions.size > 0) return null;

    if (signal === 'BUY') {
      const pos = await this.openLong();
      if (pos) console.log(`[LiveTrader] HTF-filtered BUY signal → LONG opened @ $${pos.entryPrice.toLocaleString()} (H4: ${this.htfState.h4.trend})`);
      return pos;
    }
    if (signal === 'SHORT') {
      const pos = await this.openShort();
      if (pos) console.log(`[LiveTrader] HTF-filtered SHORT signal → SHORT opened @ $${pos.entryPrice.toLocaleString()} (H4: ${this.htfState.h4.trend})`);
      return pos;
    }
    return null;
  }

  // ─── Generate trading signal (mirrors paperSignal logic) ──────────────────

  async generateSignal(candles, ind) {
    if (!candles || candles.length < 21 || !ind || !ind.ema9) return 'HOLD';
    const last = candles[candles.length - 1];

    if (this.strategy === 'trend') {
      if (ind.ema9 > ind.ema21 && last.close > ind.ema9) return 'BUY';
      if (ind.ema9 < ind.ema21 && last.close < ind.ema9) return 'SHORT';
    } else if (this.strategy === 'momentum') {
      if (ind.rsi < 30) return 'BUY';
      if (ind.rsi > 70) return 'SHORT';
    } else if (this.strategy === 'macd') {
      // Quick MACD proxy: ema9 > ema21 = bull momentum
      if (ind.ema9 > ind.ema21 * 1.001) return 'BUY';
      if (ind.ema9 < ind.ema21 * 0.999) return 'SHORT';
    } else if (this.strategy === 'scalping') {
      if (candles.length < 20 || !ind.ema5) return 'HOLD';
      const emaCrossUp = ind.ema5 > ind.ema21 && ind.ema5Prev <= ind.ema21Prev;
      const emaCrossDown = ind.ema5 < ind.ema21 && ind.ema5Prev >= ind.ema21Prev;
      const rsi = ind.rsi || 50;
      if (emaCrossUp && rsi < 65 && this.htfState.h4.trend !== 'bear') return 'BUY';
      if (emaCrossDown && rsi > 35 && this.htfState.h4.trend !== 'bull') return 'SHORT';
      if (rsi < 25 && this.htfState.h4.trend !== 'bear') return 'BUY';
      if (rsi > 75 && this.htfState.h4.trend !== 'bull') return 'SHORT';
    }
    // grid: no signal generation (price-level triggered)
    return 'HOLD';
  }

  onPrice(cb) {
    this.priceCallbacks.push(cb);
    return () => { this.priceCallbacks = this.priceCallbacks.filter(x => x !== cb); };
  }

  async startHTFUpdates() {
    this.stopHTFUpdates();
    // Initial fetch
    this.htfState = await fetchHTFState(this.symbol);
    // Update every 60s
    this.htfUpdateInterval = setInterval(async () => {
      this.htfState = await fetchHTFState(this.symbol);
    }, 60000);
  }

  stopHTFUpdates() {
    if (this.htfUpdateInterval) { clearInterval(this.htfUpdateInterval); this.htfUpdateInterval = null; }
  }

  getHTFState() { return this.htfState; }

  startPriceUpdates() {
    this.stopPriceUpdates();
    this.priceInterval = setInterval(async () => {
      const price = await this.getCurrentPrice(this.symbol);
      if (price > 0) {
        this.currentPrice = price;
        this.updateUnrealizedPnL();
        this.priceCallbacks.forEach(cb => cb(price));
      }
    }, 2000);
  }

  stopPriceUpdates() {
    if (this.priceInterval) { clearInterval(this.priceInterval); this.priceInterval = null; }
  }

  async getCurrentPrice(symbol = 'BTCUSDT') {
    try {
      const r = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`);
      if (!r.ok) return 0;
      const d = await r.json();
      return parseFloat(d.price);
    } catch { return 0; }
  }

  async fetchBalances() {
    if (this.testMode) {
      return [{ asset: 'USDT', free: this.capital || 1000, locked: 0 }, { asset: 'BTC', free: 0, locked: 0 }];
    }
    try {
      const params = await buildSignedParams({ symbol: this.symbol }, this.apiSecret);
      const r = await fetch(`${BASE_URL}/api/v3/account?${params}`, {
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.balances || []).map(b => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked)
      }));
    } catch { return []; }
  }

  async marketBuy(quantity) {
    if (!this.enabled) return null;
    if (this.testMode) return this.simulateBuy(quantity, this.currentPrice);

    try {
      const params = await buildSignedParams({
        symbol: this.symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity: quantity.toFixed(6)
      }, this.apiSecret);

      const r = await fetch(`${BASE_URL}/api/v3/order`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body: new URLSearchParams(params)
      });

      const d = await r.json();
      if (!r.ok || d.code) { console.error('Market buy failed:', d); return null; }

      const price = parseFloat(d.fills?.[0]?.price || this.currentPrice.toString());
      const fee = parseFloat(d.commission || '0');
      const trade = {
        id: `live_${d.orderId}_buy`,
        orderId: d.orderId,
        side: 'BUY',
        symbol: this.symbol,
        price,
        quantity,
        fee,
        timestamp: Date.now()
      };
      // Entry leg: stored separately, not in closedTrades yet
      this.capital -= quantity * price + fee;
      return trade;
    } catch (e) { console.error('Market buy error:', e.message); return null; }
  }

  async marketSell(quantity) {
    if (!this.enabled) return null;
    if (this.testMode) return this.simulateSell(quantity, this.currentPrice);

    try {
      const params = await buildSignedParams({
        symbol: this.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: quantity.toFixed(6)
      }, this.apiSecret);

      const r = await fetch(`${BASE_URL}/api/v3/order`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body: new URLSearchParams(params)
      });

      const d = await r.json();
      if (!r.ok || d.code) { console.error('Market sell failed:', d); return null; }

      const price = parseFloat(d.fills?.[0]?.price || this.currentPrice.toString());
      const fee = parseFloat(d.commission || '0');
      const trade = {
        id: `live_${d.orderId}_sell`,
        orderId: d.orderId,
        side: 'SELL',
        symbol: this.symbol,
        price,
        quantity,
        fee,
        timestamp: Date.now()
      };
      this.closedTrades.push(trade);
      this.capital += quantity * price - fee;
      return trade;
    } catch (e) { console.error('Market sell error:', e.message); return null; }
  }

  async openLong(quantity) {
    if (!this.enabled || this.positions.has('LONG')) return null;
    const check = this.checkAllowance();
    if (!check.allowed) { console.log('[LiveTrader] Safety block openLong: ' + check.reason); return null; }
    const qty = quantity || (this.capital * this.positionSize) / this.currentPrice;
    if (qty * this.currentPrice > this.capital) { console.warn('Insufficient capital'); return null; }

    const trade = await this.marketBuy(qty);
    if (!trade) return null;

    const sl = this.currentPrice * (1 - this.stopLossPercent / 100);
    const tp = this.currentPrice * (1 + this.takeProfitPercent / 100);

    const position = {
      id: `live_${Date.now()}`,
      side: 'LONG',
      symbol: this.symbol,
      quantity: qty,
      entryPrice: this.currentPrice,
      stopLoss: sl,
      takeProfit: tp,
      orderId: trade.orderId,
      slOrderId: 0,
      tpOrderId: 0,
      entryTime: Date.now(),
      peakPrice: this.currentPrice,
      trailingStop: sl,
      trailingActive: false
    };

    if (!this.testMode) {
      const slOrder = await this.placeStopLoss('LONG', qty, sl);
      const tpOrder = await this.placeTakeProfit('LONG', qty, tp);
      position.slOrderId = slOrder?.orderId || 0;
      position.tpOrderId = tpOrder?.orderId || 0;
    }

    this.positions.set('LONG', position);
    return position;
  }

  async closeLong(reason = 'MANUAL') {
    const pos = this.positions.get('LONG');
    if (!pos) return null;

    if (!this.testMode && (pos.slOrderId || pos.tpOrderId)) {
      await this.cancelOrder(pos.slOrderId);
      await this.cancelOrder(pos.tpOrderId);
    }

    const trade = await this.marketSell(pos.quantity);
    if (!trade) return null;

    const pnl = (this.currentPrice - pos.entryPrice) * pos.quantity - trade.fee;
    const exitTrade = {
      id: `live_${Date.now()}_close_long`,
      orderId: 0,
      side: 'CLOSE_LONG',
      symbol: this.symbol,
      entryPrice: pos.entryPrice,
      exitPrice: this.currentPrice,
      quantity: pos.quantity,
      fee: trade.fee,
      pnl,
      exitReason: reason,
      exitTime: Date.now(),
      timestamp: Date.now()
    };
    this.closedTrades.push(exitTrade);
    this.dailyTradeCount++;
    this.dailyPnL += pnl;
    this.updatePeak();
    this.positions.delete('LONG');
    return exitTrade;
  }

  async openShort(quantity) {
    if (!this.enabled || this.positions.has('SHORT')) return null;
    const check = this.checkAllowance();
    if (!check.allowed) { console.log('[LiveTrader] Safety block openShort: ' + check.reason); return null; }
    const qty = quantity || (this.capital * this.positionSize) / this.currentPrice;

    if (this.testMode) return this.simulateShort(qty);

    const trade = await this.marketSell(qty);
    if (!trade) return null;

    const sl = this.currentPrice * (1 + this.stopLossPercent / 100);
    const tp = this.currentPrice * (1 - this.takeProfitPercent / 100);

    const position = {
      id: `live_${Date.now()}`,
      side: 'SHORT',
      symbol: this.symbol,
      quantity: qty,
      entryPrice: this.currentPrice,
      stopLoss: sl,
      takeProfit: tp,
      orderId: trade.orderId,
      slOrderId: 0,
      tpOrderId: 0,
      entryTime: Date.now(),
      peakPrice: this.currentPrice,
      trailingStop: sl,
      trailingActive: false
    };

    this.positions.set('SHORT', position);
    return position;
  }

  async closeShort(reason = 'MANUAL') {
    const pos = this.positions.get('SHORT');
    if (!pos) return null;

    if (!this.testMode && (pos.slOrderId || pos.tpOrderId)) {
      await this.cancelOrder(pos.slOrderId);
      await this.cancelOrder(pos.tpOrderId);
    }

    const trade = await this.marketBuy(pos.quantity);
    if (!trade) return null;

    const pnl = (pos.entryPrice - this.currentPrice) * pos.quantity - trade.fee;
    const exitTrade = {
      id: `live_${Date.now()}_close_short`,
      orderId: 0,
      side: 'CLOSE_SHORT',
      symbol: this.symbol,
      entryPrice: pos.entryPrice,
      exitPrice: this.currentPrice,
      quantity: pos.quantity,
      fee: trade.fee,
      pnl,
      exitReason: reason,
      exitTime: Date.now(),
      timestamp: Date.now()
    };
    this.closedTrades.push(exitTrade);
    this.dailyTradeCount++;
    this.dailyPnL += pnl;
    this.updatePeak();
    this.positions.delete('SHORT');
    return exitTrade;
  }

  async placeStopLoss(side, quantity, price) {
    if (this.testMode) return null;
    try {
      const params = await buildSignedParams({
        symbol: this.symbol,
        side: side === 'LONG' ? 'SELL' : 'BUY',
        type: 'STOP_LOSS_LIMIT',
        quantity: quantity.toFixed(6),
        stopPrice: price.toFixed(2),
        price: price.toFixed(2),
        timeInForce: 'GTC'
      }, this.apiSecret);

      const r = await fetch(`${BASE_URL}/api/v3/order`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body: new URLSearchParams(params)
      });
      return await r.json();
    } catch { return null; }
  }

  async placeTakeProfit(side, quantity, price) {
    if (this.testMode) return null;
    try {
      const params = await buildSignedParams({
        symbol: this.symbol,
        side: side === 'LONG' ? 'SELL' : 'BUY',
        type: 'TAKE_PROFIT_LIMIT',
        quantity: quantity.toFixed(6),
        stopPrice: price.toFixed(2),
        price: price.toFixed(2),
        timeInForce: 'GTC'
      }, this.apiSecret);

      const r = await fetch(`${BASE_URL}/api/v3/order`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body: new URLSearchParams(params)
      });
      return await r.json();
    } catch { return null; }
  }

  async cancelOrder(orderId) {
    if (this.testMode || !orderId) return true;
    try {
      const params = await buildSignedParams({ symbol: this.symbol, orderId: orderId.toString() }, this.apiSecret);
      const r = await fetch(`${BASE_URL}/api/v3/order`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body: new URLSearchParams(params)
      });
      return r.ok;
    } catch { return false; }
  }

  // Simulation methods (test mode)
  simulateBuy(quantity, price) {
    const fee = quantity * price * this.feeRate;
    const trade = {
      id: `test_${Date.now()}_buy`,
      orderId: 0, side: 'BUY', symbol: this.symbol,
      price, quantity, fee, timestamp: Date.now()
    };
    // Entry leg: stored separately, not in closedTrades yet
    this.capital -= quantity * price + fee;
    return trade;
  }

  simulateSell(quantity, price) {
    const fee = quantity * price * this.feeRate;
    const trade = {
      id: `test_${Date.now()}_sell`,
      orderId: 0, side: 'SELL', symbol: this.symbol,
      price, quantity, fee, timestamp: Date.now()
    };
    // Entry leg: stored separately, not in closedTrades yet
    this.capital += quantity * price - fee;
    return trade;
  }

  simulateShort(quantity) {
    const entryPrice = this.currentPrice;
    const fee = quantity * entryPrice * this.feeRate;
    this.capital += quantity * entryPrice - fee;

    const position = {
      id: `test_${Date.now()}`,
      side: 'SHORT', symbol: this.symbol, quantity,
      entryPrice,
      stopLoss: entryPrice * (1 + this.stopLossPercent / 100),
      takeProfit: entryPrice * (1 - this.takeProfitPercent / 100),
      orderId: 0, slOrderId: 0, tpOrderId: 0, entryTime: Date.now(),
      peakPrice: entryPrice,
      trailingStop: entryPrice * (1 + this.stopLossPercent / 100),
      trailingActive: false
    };
    this.positions.set('SHORT', position);
    return position;
  }

  updateUnrealizedPnL() {
    // Update position markers for price movement
  }

  updatePeak() {
    const equity = this.getTotalEquity();
    if (equity > this.peakBalance) {
      this.peakBalance = equity;
    }
    const drawdown = this.peakBalance - equity;
    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
    }
    if (this.peakBalance > 0) {
      this.maxDrawdownPercent = (drawdown / this.peakBalance) * 100;
    }
  }

  getUnrealizedPnL() {
    let pnl = 0;
    for (const [, pos] of this.positions) {
      const currentValue = pos.quantity * this.currentPrice;
      const entryValue = pos.quantity * pos.entryPrice;
      if (pos.side === 'LONG') pnl += currentValue - entryValue;
      else pnl += entryValue - currentValue;
    }
    return pnl;
  }

  getTotalEquity() { return this.capital + this.getUnrealizedPnL(); }

  async checkAndExecuteSLTP() {
    if (!this.enabled || !this.currentPrice) return;
    for (const [, pos] of this.positions) {
      // ── Trailing Stop Logic ──────────────────────────────────────────────
      if (!pos.peakPrice) pos.peakPrice = pos.entryPrice;

      if (pos.side === 'LONG') {
        // Update peak price when price goes up
        if (this.currentPrice > pos.peakPrice) {
          pos.peakPrice = this.currentPrice;
        }
        const profitPct = ((this.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (profitPct >= this.trailingActivation) {
          pos.trailingActive = true;
          // Trail stop: greater of (static SL, peak - trail distance)
          const staticSL = pos.entryPrice * (1 - this.stopLossPercent / 100);
          const trailSL = pos.peakPrice * (1 - this.trailingDistance / 100);
          const newTrailingStop = Math.max(staticSL, trailSL);
          // For LONG, trailing stop only moves UP (in price)
          if (newTrailingStop > pos.trailingStop) {
            const prevSL = pos.trailingStop;
            pos.trailingStop = newTrailingStop;
            // In live mode, cancel old SL order and place new one
            if (!this.testMode && pos.slOrderId) {
              await this.cancelOrder(pos.slOrderId);
              const newSLOrder = await this.placeStopLoss('LONG', pos.quantity, pos.trailingStop);
              pos.slOrderId = newSLOrder?.orderId || 0;
            }
            console.log(`📍 TRAIL SL updated: $${prevSL.toFixed(2)} → $${pos.trailingStop.toFixed(2)} (peak: $${pos.peakPrice.toFixed(2)})`);
          }
        }
      } else if (pos.side === 'SHORT') {
        // Update peak (trough) price when price goes down
        if (this.currentPrice < pos.peakPrice || pos.peakPrice === pos.entryPrice) {
          pos.peakPrice = this.currentPrice;
        }
        const profitPct = ((pos.entryPrice - this.currentPrice) / pos.entryPrice) * 100;
        if (profitPct >= this.trailingActivation) {
          pos.trailingActive = true;
          // Trail stop: lesser of (static SL, trough + trail distance)
          const staticSL = pos.entryPrice * (1 + this.stopLossPercent / 100);
          const trailSL = pos.peakPrice * (1 + this.trailingDistance / 100);
          const newTrailingStop = Math.min(staticSL, trailSL);
          // For SHORT, trailing stop only moves DOWN (in price)
          if (newTrailingStop < pos.trailingStop) {
            const prevSL = pos.trailingStop;
            pos.trailingStop = newTrailingStop;
            // In live mode, cancel old SL order and place new one
            if (!this.testMode && pos.slOrderId) {
              await this.cancelOrder(pos.slOrderId);
              const newSLOrder = await this.placeStopLoss('SHORT', pos.quantity, pos.trailingStop);
              pos.slOrderId = newSLOrder?.orderId || 0;
            }
            console.log(`📍 TRAIL SL updated: $${prevSL.toFixed(2)} → $${pos.trailingStop.toFixed(2)} (trough: $${pos.peakPrice.toFixed(2)})`);
          }
        }
      }

      // ── SL/TP Trigger Check ───────────────────────────────────────────────
      let triggered = false, reason = '';
      if (pos.side === 'LONG') {
        if (pos.trailingActive && this.currentPrice <= pos.trailingStop) {
          triggered = true; reason = 'TSL';
        } else if (!pos.trailingActive && this.currentPrice <= pos.stopLoss) {
          triggered = true; reason = 'SL';
        }
        if (this.currentPrice >= pos.takeProfit) { triggered = true; reason = 'TP'; }
      } else if (pos.side === 'SHORT') {
        if (pos.trailingActive && this.currentPrice >= pos.trailingStop) {
          triggered = true; reason = 'TSL';
        } else if (!pos.trailingActive && this.currentPrice >= pos.stopLoss) {
          triggered = true; reason = 'SL';
        }
        if (this.currentPrice <= pos.takeProfit) { triggered = true; reason = 'TP'; }
      }
      if (triggered) {
        console.log(`⚡ ${pos.side} ${reason} triggered @ $${this.currentPrice.toLocaleString()}`);
        if (pos.side === 'LONG') await this.closeLong(reason);
        else await this.closeShort(reason);
      }
    }
  }

  async enable(testMode = true) {
    this.testMode = testMode;
    if (!this.isConfigured()) throw new Error('API keys not configured');
    const balances = await this.fetchBalances();
    const usdtBalance = balances.find(b => b.asset === 'USDT');
    this.capital = usdtBalance ? usdtBalance.free : 0;
    this.baseCapital = this.capital || 1000;
    this.peakBalance = this.capital || 1000;
    this.enabled = true;
    this.mode = testMode ? 'paper' : 'live';
    this.positions.clear();
    this.closedTrades = [];
    this.sessionStartCapital = this.capital || 1000;
    this.dailyTradeCount = 0;
    this.dailyPnL = 0;
    this.dailyStartDate = new Date().toISOString().slice(0, 10);
    this.emergencyStopActive = false;
    await this.startHTFUpdates();
    this.startPriceUpdates();
  }

  disable() {
    this.enabled = false;
    this.stopAutoTrading();
    this.stopHTFUpdates();
    this.stopPriceUpdates();
  }

  reset() {
    this.positions.clear();
    this.closedTrades = [];
    this.capital = this.baseCapital;
    this.peakBalance = this.baseCapital;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
    this.htfState = { h1: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 }, h4: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 } };
    this.stopAutoTrading();
    this.dailyTradeCount = 0;
    this.dailyPnL = 0;
    this.dailyStartDate = new Date().toISOString().slice(0, 10);
    this.emergencyStopActive = false;
  }

  getStats() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStartDate !== today) {
      this.dailyStartDate = today;
      this.dailyTradeCount = 0;
      this.dailyPnL = 0;
    }
    const closed = this.closedTrades;
    const winning = closed.filter(t => (t.pnl || 0) > 0);
    const losing = closed.filter(t => (t.pnl || 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalFees = closed.reduce((s, t) => s + t.fee, 0);
    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const avgWin = winning.length > 0 ? winning.reduce((s, t) => s + (t.pnl || 0), 0) / winning.length : 0;
    const avgLoss = losing.length > 0 ? losing.reduce((s, t) => s + (t.pnl || 0), 0) / losing.length : 0;
    const profitFactor = totalPnl > 0 && avgLoss !== 0 ? Math.min(Math.abs(avgWin / avgLoss), 99) : totalPnl > 0 ? 99 : 0;

    let currentStreak = 0, bestStreak = 0, worstStreak = 0, streak = 0;
    for (const t of closed) {
      if ((t.pnl || 0) > 0) {
        streak = streak > 0 ? streak + 1 : 1;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = streak < 0 ? streak - 1 : -1;
        worstStreak = Math.min(worstStreak, streak);
      }
    }
    currentStreak = streak;

    return {
      enabled: this.enabled,
      mode: this.mode,
      symbol: this.symbol,
      capital: this.capital,
      positions: Array.from(this.positions.values()),
      closedTrades: closed.slice(-50),
      stats: {
        totalTrades: closed.length,
        winningTrades: winning.length,
        losingTrades: losing.length,
        winRate,
        totalPnl,
        totalFees,
        profitFactor,
        maxDrawdown: this.maxDrawdown,
        maxDrawdownPercent: this.maxDrawdownPercent,
        avgWin,
        avgLoss,
        currentStreak,
        bestStreak,
        worstStreak
      },
      safety: {
        emergencyStopActive: this.emergencyStopActive,
        sessionStartCapital: this.sessionStartCapital,
        dailyPnL: this.dailyPnL,
        dailyPnLPct: this.sessionStartCapital > 0 ? (this.dailyPnL / this.sessionStartCapital) * 100 : 0,
        dailyTradeCount: this.dailyTradeCount,
        maxDailyLoss: this.maxDailyLoss,
        maxDrawdownLimit: this.maxDrawdownLimit
      }
    };
  }

  getStatus() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStartDate !== today) {
      this.dailyStartDate = today;
      this.dailyTradeCount = 0;
      this.dailyPnL = 0;
    }
    const safetyStatus = {
      emergencyStopActive: this.emergencyStopActive,
      maxDailyLoss: this.maxDailyLoss,
      maxDrawdownLimit: this.maxDrawdownLimit,
      maxTradesPerDay: this.maxTradesPerDay,
      sessionStartCapital: this.sessionStartCapital,
      dailyPnL: this.dailyPnL,
      dailyPnLPct: this.sessionStartCapital > 0 ? (this.dailyPnL / this.sessionStartCapital) * 100 : 0,
      dailyTradeCount: this.dailyTradeCount,
      allowance: this.checkAllowance()
    };
    let positionDetail = null;
    if (this.positions.size > 0) {
      const pos = Array.from(this.positions.values())[0];
      positionDetail = {
        side: pos.side,
        entryPrice: pos.entryPrice,
        quantity: pos.quantity,
        currentSL: pos.trailingActive ? pos.trailingStop : pos.stopLoss,
        currentTP: pos.takeProfit,
        trailingActive: pos.trailingActive,
        trailingStop: pos.trailingStop,
        peakPrice: pos.peakPrice,
        unrealizedPnl: this.getUnrealizedPnL()
      };
    }
    return {
      enabled: this.enabled,
      mode: this.mode,
      testMode: this.testMode,
      symbol: this.symbol,
      capital: this.capital,
      equity: this.getTotalEquity(),
      unrealizedPnl: this.getUnrealizedPnL(),
      hasPosition: this.positions.size > 0,
      currentPrice: this.currentPrice,
      stopLossPct: this.stopLossPercent,
      takeProfitPct: this.takeProfitPercent,
      trailingActivation: this.trailingActivation,
      trailingDistance: this.trailingDistance,
      positionSize: this.positionSize,
      strategy: this.strategy,
      autoTrading: this.autoTrading,
      htfState: {
        h1: this.htfState.h1,
        h4: this.htfState.h4
      },
      position: positionDetail,
      recentTrades: this.closedTrades.slice(-20).map(t => ({
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        exitTime: t.exitTime,
        exitReason: t.exitReason
      })),
      lastTradeSide: this.positions.size > 0 ? Array.from(this.positions.values())[0].side : null,
      safety: safetyStatus
    };
  }
}

module.exports = { LiveTrader };
