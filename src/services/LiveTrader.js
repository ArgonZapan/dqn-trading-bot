/**
 * Live Trading Module - Real Binance API integration
 * Requires BINANCE_API_KEY and BINANCE_API_SECRET in .env
 *
 * WARNING: Real money at risk. Use with caution.
 * Paper trading is recommended before going live.
 */

const BASE_URL = 'https://api.binance.com';

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

    this.enabled = false;
    this.mode = 'paper';
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

  onPrice(cb) {
    this.priceCallbacks.push(cb);
    return () => { this.priceCallbacks = this.priceCallbacks.filter(x => x !== cb); };
  }

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
      this.closedTrades.push(trade);
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

    trade.pnl = (this.currentPrice - pos.entryPrice) * pos.quantity;
    this.positions.delete('LONG');
    return trade;
  }

  async openShort(quantity) {
    if (!this.enabled || this.positions.has('SHORT')) return null;
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

    trade.pnl = (pos.entryPrice - this.currentPrice) * pos.quantity;
    this.positions.delete('SHORT');
    return trade;
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
    this.closedTrades.push(trade);
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
    this.closedTrades.push(trade);
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
    this.startPriceUpdates();
  }

  disable() {
    this.enabled = false;
    this.mode = 'paper';
    this.stopPriceUpdates();
  }

  reset() {
    this.positions.clear();
    this.closedTrades = [];
    this.capital = this.baseCapital;
    this.peakBalance = this.baseCapital;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
  }

  getStats() {
    const closed = this.closedTrades;
    const winning = closed.filter(t => (t.pnl || 0) > 0);
    const losing = closed.filter(t => (t.pnl || 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalFees = closed.reduce((s, t) => s + t.fee, 0);
    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const avgWin = winning.length > 0 ? winning.reduce((s, t) => s + (t.pnl || 0), 0) / winning.length : 0;
    const avgLoss = losing.length > 0 ? losing.reduce((s, t) => s + (t.pnl || 0), 0) / losing.length : 0;
    const profitFactor = totalPnl > 0 && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : totalPnl > 0 ? Infinity : 0;

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
        sharpeRatio: 0,
        currentStreak,
        bestStreak,
        worstStreak
      }
    };
  }

  getStatus() {
    // Include trailing stop info for open positions
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
      position: positionDetail
    };
  }
}

module.exports = { LiveTrader };
