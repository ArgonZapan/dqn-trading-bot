/**
 * Multi-Timeframe (HTF) Filter Module
 * Extracts HTF trend calculation from server/index.js (originally in BinanceClient.ts)
 * Provides reusable functions for HTF trend detection in both paper and live trading.
 */

const BASE_URL = 'https://api.binance.com';

// ─── Internal helpers (duplicated from BinanceClient for standalone use) ───

function calcEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
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

// ─── Trend Detection ─────────────────────────────────────────────────────────

/**
 * Detect trend on a single timeframe from candles
 * @param {Array} candles - Array of {open, high, low, close, volume}
 * @returns {{ trend: string, rsi: number, ema200Dist: number, volumeRatio: number }}
 */
function detectTrend(candles) {
  if (!candles || candles.length < 200) {
    return { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1 };
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const ema200 = calcEMA(closes, 200);
  const currentClose = closes[closes.length - 1];
  const rsi = calcRSI(closes, 14);

  // EMA200 slope over last 20 candles
  const emaSlope = (closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20];

  let trend = 'neutral';
  if (currentClose > ema200 && emaSlope > 0.005) trend = 'bull';
  else if (currentClose < ema200 && emaSlope < -0.005) trend = 'bear';

  const volumeAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = volumeAvg > 0 ? volumes[volumes.length - 1] / volumeAvg : 1;

  return {
    trend,
    rsi,
    ema200Dist: ((currentClose - ema200) / ema200) * 100,
    volumeRatio
  };
}

/**
 * Detect H1 (1-hour) trend from RSI, EMA200 distance, and volume ratio
 * Convenience function for external callers that already have these values.
 */
function detectH1Trend(rsi, ema200Dist, volumeRatio) {
  return detectTrendFromMetrics(rsi, ema200Dist, volumeRatio);
}

/**
 * Detect H4 (4-hour) trend from RSI, EMA200 distance, and volume ratio
 */
function detectH4Trend(rsi, ema200Dist, volumeRatio) {
  return detectTrendFromMetrics(rsi, ema200Dist, volumeRatio);
}

/**
 * Internal: derive trend label from raw metric values
 */
function detectTrendFromMetrics(rsi, ema200Dist, volumeRatio) {
  // Use ema200Dist as proxy for trend: positive = above EMA200 (potential bull)
  // Volume ratio > 1.5 = surge (confirming move)
  if (ema200Dist > 1 && rsi > 50) return 'bull';
  if (ema200Dist < -1 && rsi < 55) return 'bear';
  if (ema200Dist < -2) return 'bear';
  if (ema200Dist > 2) return 'bull';
  return 'neutral';
}

// ─── HTF State ───────────────────────────────────────────────────────────────

let htfCache = {
  h1: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1, updatedAt: 0 },
  h4: { trend: 'neutral', rsi: 50, ema200Dist: 0, volumeRatio: 1, updatedAt: 0 }
};

const HTF_UPDATE_INTERVAL = 60000; // 60 seconds cache

/**
 * Fetch HTF state from Binance API (1H + 4H candles)
 * Uses cached values if updated within HTF_UPDATE_INTERVAL ms.
 */
async function fetchHTFState(symbol = 'BTCUSDT', forceRefresh = false) {
  const now = Date.now();

  // Return cached if fresh
  if (!forceRefresh &&
      htfCache.h1.updatedAt > 0 &&
      htfCache.h4.updatedAt > 0 &&
      now - htfCache.h1.updatedAt < HTF_UPDATE_INTERVAL &&
      now - htfCache.h4.updatedAt < HTF_UPDATE_INTERVAL) {
    return htfCache;
  }

  try {
    const [h1Trend, h4Trend] = await Promise.all([
      fetchCandles(symbol, '1h', 200),
      fetchCandles(symbol, '4h', 200)
    ]);

    if (h1Trend.length >= 200) {
      htfCache.h1 = { ...detectTrend(h1Trend), updatedAt: now };
    }
    if (h4Trend.length >= 200) {
      htfCache.h4 = { ...detectTrend(h4Trend), updatedAt: now };
    }
  } catch (e) {
    console.error('[mtfFilter] fetchHTFState error:', e.message);
  }

  return htfCache;
}

/**
 * Fetch raw candles from Binance
 */
async function fetchCandles(symbol, interval, limit = 200) {
  try {
    const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    return data.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      timestamp: parseInt(k[0])
    }));
  } catch (e) {
    console.error('[mtfFilter] fetchCandles error:', e.message);
    return [];
  }
}

/**
 * Get cached HTF state without API call
 */
function getCachedHTFState() {
  return htfCache;
}

/**
 * Apply HTF trend filter to a trading signal
 * Mirrors paperSignal HTF filtering logic from server/index.js
 *
 * @param {string} signal - Raw signal: 'BUY', 'SHORT', 'HOLD'
 * @param {string} strategy - 'trend' | 'momentum' | 'macd' | 'scalping' | 'grid'
 * @param {object} htf - { h1: {...}, h4: {...} } from fetchHTFState()
 * @param {object} ind - Local indicators { rsi, ema9, ema21, macd, bb }
 * @returns {string} Filtered signal: 'BUY', 'SHORT', or 'HOLD'
 */
function filterSignalWithHTF(signal, strategy, htf, ind = {}) {
  if (!htf || !htf.h4) return signal;
  const h4 = htf.h4.trend || 'neutral';
  const h1Rsi = htf.h1?.rsi || 50;

  if (strategy === 'grid') return signal; // Grid doesn't need HTF filter

  if (signal === 'BUY') {
    if (strategy === 'trend') {
      if (h4 === 'bear') return 'HOLD';
    } else if (strategy === 'momentum') {
      if (h4 === 'bear' && h1Rsi > 50) return 'HOLD';
    } else if (strategy === 'scalping') {
      if (h4 === 'bear') return 'HOLD';
    }
  }

  if (signal === 'SHORT') {
    if (strategy === 'trend') {
      if (h4 === 'bull') return 'HOLD';
    } else if (strategy === 'momentum') {
      if (h4 === 'bull' && h1Rsi < 50) return 'HOLD';
    } else if (strategy === 'scalping') {
      if (h4 === 'bull') return 'HOLD';
    }
  }

  return signal;
}

module.exports = {
  fetchHTFState,
  getCachedHTFState,
  detectTrend,
  detectH1Trend,
  detectH4Trend,
  filterSignalWithHTF
};
