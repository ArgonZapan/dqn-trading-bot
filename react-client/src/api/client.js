// API client — wszystkie endpointy w jednym miejscu
const BASE = '';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }
  return res.json();
}

export const endpoints = {
  // Status
  status: () => api('/api/status'),

  // Training
  trainingStart: () => api('/api/training/start'),
  trainingStop: () => api('/api/training/stop'),
  trainingSave: () => api('/api/training/save'),
  trainingStatus: () => api('/api/training/status'),

  // Sentiment
  sentiment: (keyword = 'BTC') => api(`/api/sentiment?keyword=${keyword}`),

  // Paper Trading
  paperStatus: () => api('/api/paper-trading'),
  paperStart: () => api('/api/paper-trading/start'),
  paperStop: () => api('/api/paper-trading/stop'),
  paperReset: () => api('/api/paper-trading/reset'),
  paperHistory: () => api('/api/paper-trading/history'),
  paperClearHistory: () => api('/api/paper-trading/clear-history'),
  paperEquityCurve: () => api('/api/paper-trading/equity-curve'),
  paperTrades: () => api('/api/paper-trading/trades'),
  paperPerformance: () => api('/api/paper-trading/performance'),
  paperRegimeStats: () => api('/api/paper-trading/regime-stats'),
  selectStrategy: (id) => api(`/api/paper-trading/strategy?strategy=${id}`),
  setSLTP: (sl, tp) => api(`/api/paper-trading/sltp?stopLoss=${sl}&takeProfit=${tp}`),
  setGridParams: (size, count, spacing) =>
    api(`/api/paper-trading/grid-params?gridSize=${size}&gridCount=${count}&gridSpacing=${spacing}`),
  setScalpParams: (pt, sl, mv, mom, mh, tf) =>
    api(`/api/paper-trading/scalp-params?profitTarget=${pt}&stopLoss=${sl}&minVolume=${mv}&momentum=${mom}&maxHold=${mh}&timeframe=${tf}`),

  // Strategy Compare
  strategyCompare: () => api('/api/strategy/compare'),

  // Risk
  riskReport: () => api('/api/risk/report'),
  riskRewardStats: () => api('/api/risk-reward/stats'),

  // Portfolio
  portfolio: () => api('/api/portfolio'),
  portfolioHeatmap: () => api('/api/portfolio/heatmap'),

  // HTF
  htfTrend: () => api('/api/htf-trend'),

  // Attribution
  attribution: () => api('/api/attribution'),

  // Monte Carlo
  monteCarlo: () => api('/api/monte-carlo/quick'),

  // Rebalancer
  rebalancerStatus: () => api('/api/rebalancer/status'),
  rebalanceNow: () => api('/api/rebalancer/rebalance'),

  // Alerter
  alerterStatus: () => api('/api/alerter/status'),
  alerterTest: () => api('/api/alerter/test'),

  // Episodes
  episodeData: () => api('/api/episode-data'),
  episodeHistory: () => api('/api/episode-history'),

  // Optimizer
  optimizerStart: (config) => api('/api/optimizer/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }),
  optimizerStop: () => api('/api/optimizer/stop'),
  optimizerStatus: () => api('/api/optimizer/status'),
  optimizerResults: (top = 5) => api(`/api/optimizer/results?top=${top}`),
  optimizerApply: (params) => api('/api/optimizer/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }),

  // Live Trading
  liveStatus: () => api('/api/live-trading/status'),
  liveConfigCheck: () => api('/api/live-trading/config-check'),
  liveStats: () => api('/api/live-trading/stats'),
  liveToggle: (enabled) => api(`/api/live-trading/toggle?enabled=${enabled}`),
  liveOpenLong: () => api('/api/live-trading/open-long', { method: 'POST' }),
  liveOpenShort: () => api('/api/live-trading/open-short', { method: 'POST' }),
  liveClosePosition: () => api('/api/live-trading/close-position', { method: 'POST' }),
  liveReset: () => api('/api/live-trading/reset', { method: 'POST' }),
};

export default api;
