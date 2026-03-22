/**
 * API Endpoints Tests
 * Wymaga uruchomionego serwera na porcie 3000.
 * Używa native fetch (Node 18+) + Mocha (istniejący test runner).
 */
const assert = require('assert');

const BASE = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function get(path) {
    const res = await fetch(`${BASE}${path}`);
    const data = await res.json();
    return { status: res.status, data };
}

async function post(path, body) {
    const opts = { method: 'POST' };
    if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json();
    return { status: res.status, data };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('API Endpoints', function () {
    this.timeout(10000);

    // ── Status & Core ─────────────────────────────────────────────────────

    describe('GET /api/status', function () {
        it('returns running status with metrics', async function () {
            const { data } = await get('/api/status');
            assert.strictEqual(data.status, 'running');
            assert.ok(data.metrics, 'metrics should be defined');
            assert.strictEqual(typeof data.metrics.epsilon, 'number');
            assert.strictEqual(typeof data.metrics.episode, 'number');
            assert.strictEqual(typeof data.metrics.steps, 'number');
            assert.strictEqual(typeof data.metrics.bufferSize, 'number');
        });

        it('includes trading and training flags', async function () {
            const { data } = await get('/api/status');
            assert.strictEqual(typeof data.tradingActive, 'boolean');
            assert.strictEqual(typeof data.trainingActive, 'boolean');
        });

        it('includes prices object', async function () {
            const { data } = await get('/api/status');
            assert.ok(data.prices, 'prices should be defined');
            assert.strictEqual(typeof data.prices.btc, 'number');
            assert.strictEqual(typeof data.prices.eth, 'number');
            assert.strictEqual(typeof data.prices.sol, 'number');
        });
    });

    describe('GET /api/prices', function () {
        it('returns BTC, ETH, SOL prices as numbers', async function () {
            const { data } = await get('/api/prices');
            assert.strictEqual(typeof data.btc, 'number');
            assert.strictEqual(typeof data.eth, 'number');
            assert.strictEqual(typeof data.sol, 'number');
            assert.ok(data.btc > 0, 'BTC price should be > 0');
        });
    });

    describe('GET /api/portfolio', function () {
        it('returns portfolio with USDT, BTC, ETH, SOL', async function () {
            const { data } = await get('/api/portfolio');
            assert.strictEqual(typeof data.usdt, 'number');
            assert.strictEqual(typeof data.btc, 'number');
            assert.strictEqual(typeof data.eth, 'number');
            assert.strictEqual(typeof data.sol, 'number');
        });
    });

    describe('GET /api/metrics', function () {
        it('returns training metrics with isTraining flag', async function () {
            const { data } = await get('/api/metrics');
            assert.strictEqual(typeof data.isTraining, 'boolean');
            assert.strictEqual(typeof data.trainingDurationMs, 'number');
            assert.strictEqual(typeof data.epsilon, 'number');
            assert.strictEqual(typeof data.episode, 'number');
        });
    });

    // ── Episode Data ──────────────────────────────────────────────────────

    describe('GET /api/episode-data', function () {
        it('returns currentEp and prevEp objects', async function () {
            const { data } = await get('/api/episode-data');
            assert.ok(data.currentEp, 'currentEp should be defined');
            assert.ok(data.prevEp, 'prevEp should be defined');
            assert.ok(Array.isArray(data.currentEp.candles), 'currentEp.candles should be array');
            assert.ok(Array.isArray(data.currentEp.trades), 'currentEp.trades should be array');
            assert.ok(Array.isArray(data.currentEp.equity), 'currentEp.equity should be array');
        });

        it('includes legacy fields for backward compatibility', async function () {
            const { data } = await get('/api/episode-data');
            assert.ok(Array.isArray(data.prices), 'legacy prices array');
            assert.ok(Array.isArray(data.trades), 'legacy trades array');
            assert.ok(Array.isArray(data.epsilons), 'legacy epsilons array');
            assert.ok(Array.isArray(data.equity), 'legacy equity array');
            assert.strictEqual(typeof data.episode, 'number');
        });
    });

    describe('GET /api/episode-history', function () {
        it('returns an array of episode summaries', async function () {
            const { data } = await get('/api/episode-history');
            assert.ok(Array.isArray(data), 'should be an array');
            if (data.length > 0) {
                const ep = data[0];
                assert.strictEqual(typeof ep.episode, 'number');
                assert.strictEqual(typeof ep.steps, 'number');
                assert.strictEqual(typeof ep.pnlPercent, 'number');
                assert.strictEqual(typeof ep.tradesCount, 'number');
            }
        });
    });

    // ── Training Controls ─────────────────────────────────────────────────

    describe('POST /api/training/stop', function () {
        it('stops training and returns success', async function () {
            const { data } = await post('/api/training/stop');
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.trainingActive, false);
        });
    });

    describe('POST /api/training/start', function () {
        it('starts training and returns success', async function () {
            const { data } = await post('/api/training/start');
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.trainingActive, true);
        });

        afterEach(async function () {
            // Clean up: stop training after start test
            await post('/api/training/stop');
        });
    });

    describe('GET /api/training/status', function () {
        it('returns training status', async function () {
            const { data } = await get('/api/training/status');
            assert.strictEqual(typeof data.isTraining, 'boolean');
            assert.strictEqual(typeof data.trainingDurationMs, 'number');
            assert.strictEqual(typeof data.episode, 'number');
            assert.strictEqual(typeof data.epsilon, 'number');
        });
    });

    describe('POST /api/training/save', function () {
        it('saves model and returns success', async function () {
            const { data } = await post('/api/training/save');
            assert.strictEqual(data.success, true);
        });
    });

    // ── Paper Trading ─────────────────────────────────────────────────────

    describe('GET /api/paper-trading', function () {
        it('returns paper trading state', async function () {
            const { data } = await get('/api/paper-trading');
            assert.strictEqual(typeof data.enabled, 'boolean');
            assert.strictEqual(typeof data.capital, 'number');
            assert.strictEqual(typeof data.equity, 'number');
            assert.ok(data.stats, 'stats should be defined');
            assert.strictEqual(typeof data.stopLoss, 'number');
            assert.strictEqual(typeof data.takeProfit, 'number');
            assert.ok(data.volatilityRegime, 'volatilityRegime should be defined');
        });
    });

    describe('POST /api/paper-trading/start', function () {
        it('enables paper trading', async function () {
            const { data } = await post('/api/paper-trading/start');
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.enabled, true);
        });
    });

    describe('POST /api/paper-trading/stop', function () {
        it('disables paper trading', async function () {
            const { data } = await post('/api/paper-trading/stop');
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.enabled, false);
        });
    });

    describe('POST /api/paper-trading/reset', function () {
        it('resets paper portfolio', async function () {
            const { data } = await post('/api/paper-trading/reset');
            assert.strictEqual(data.success, true);
        });
    });

    describe('GET /api/paper-trading/status', function () {
        it('returns paper trading status', async function () {
            const { data } = await get('/api/paper-trading/status');
            assert.strictEqual(typeof data.enabled, 'boolean');
            assert.strictEqual(typeof data.capital, 'number');
            assert.strictEqual(typeof data.strategy, 'string');
        });
    });

    describe('GET /api/paper-trading/history', function () {
        it('returns trade history', async function () {
            const { data } = await get('/api/paper-trading/history');
            assert.ok(Array.isArray(data.trades), 'trades should be array');
            assert.strictEqual(typeof data.total, 'number');
        });
    });

    describe('GET /api/paper-trading/performance', function () {
        it('returns performance summary', async function () {
            const { data } = await get('/api/paper-trading/performance');
            assert.strictEqual(typeof data.totalTrades, 'number');
            assert.strictEqual(typeof data.winRate, 'number');
            assert.strictEqual(typeof data.totalPnl, 'number');
            assert.strictEqual(typeof data.sharpeRatio, 'number');
            assert.ok(data.regimeStats, 'regimeStats should be defined');
        });
    });

    describe('GET /api/paper-trading/equity-curve', function () {
        it('returns equity curve array', async function () {
            const { data } = await get('/api/paper-trading/equity-curve');
            assert.ok(Array.isArray(data), 'should be array');
        });
    });

    describe('GET /api/paper-trading/strategy', function () {
        it('returns current strategy', async function () {
            const { data } = await get('/api/paper-trading/strategy');
            assert.strictEqual(typeof data.strategy, 'string');
        });
    });

    describe('GET /api/paper-trading/regime-stats', function () {
        it('returns regime stats', async function () {
            const { data } = await get('/api/paper-trading/regime-stats');
            assert.ok(data.regimeStats, 'regimeStats should be defined');
            assert.ok(data.computedRegimePerf, 'computedRegimePerf should be defined');
        });
    });

    // ── HTF Trend ─────────────────────────────────────────────────────────

    describe('GET /api/htf-trend', function () {
        it('returns h1 and h4 trend states', async function () {
            const { data } = await get('/api/htf-trend');
            assert.ok(data.h1, 'h1 should be defined');
            assert.ok(data.h4, 'h4 should be defined');
            assert.strictEqual(typeof data.h1.trend, 'string');
            assert.strictEqual(typeof data.h4.trend, 'string');
        });
    });

    // ── Hyperparams ───────────────────────────────────────────────────────

    describe('GET /api/hyperparams', function () {
        it('returns hyperparameters', async function () {
            const { data } = await get('/api/hyperparams');
            assert.ok(data, 'should return data');
            // hyperopt returns hyperparams object
        });
    });

    describe('POST /api/hyperparams', function () {
        it('updates hyperparameters', async function () {
            const { data } = await post('/api/hyperparams', {
                hyperparams: { learningRate: 0.001 },
                metrics: { reward: 1.5 }
            });
            assert.strictEqual(data.success, true);
            assert.ok(data.hyperparams, 'should return updated hyperparams');
        });
    });

    // ── Risk Manager ──────────────────────────────────────────────────────

    describe('GET /api/risk/report', function () {
        it('returns risk report', async function () {
            const { data } = await get('/api/risk/report');
            assert.ok(data, 'should return risk report');
        });
    });

    describe('GET /api/risk/can-trade', function () {
        it('returns can-trade check', async function () {
            const { data } = await get('/api/risk/can-trade');
            assert.ok(data, 'should return can-trade data');
        });
    });

    describe('GET /api/risk/kelly', function () {
        it('returns Kelly Criterion data', async function () {
            const { data } = await get('/api/risk/kelly');
            assert.strictEqual(typeof data.kelly, 'number');
            assert.strictEqual(typeof data.fractionalKelly, 'number');
            assert.strictEqual(typeof data.kellyPercent, 'string');
            assert.strictEqual(typeof data.fractionalPercent, 'string');
        });
    });

    // ── Risk/Reward ───────────────────────────────────────────────────────

    describe('GET /api/risk-reward/stats', function () {
        it('returns risk/reward statistics', async function () {
            const { data } = await get('/api/risk-reward/stats');
            assert.ok(Array.isArray(data.openPositions), 'openPositions should be array');
            assert.ok(data.winRateByRR, 'winRateByRR should be defined');
        });
    });

    // ── Trade Journal ─────────────────────────────────────────────────────

    describe('GET /api/trade-journal', function () {
        it('returns paginated trade list', async function () {
            const { data } = await get('/api/trade-journal?page=1&limit=5');
            assert.ok(data.items !== undefined || Array.isArray(data), 'should have items or be array');
        });
    });

    // ── Attribution ───────────────────────────────────────────────────────

    describe('GET /api/attribution', function () {
        it('returns attribution data', async function () {
            const { data } = await get('/api/attribution');
            assert.ok(data, 'should return attribution data');
        });
    });

    // ── Alerter ───────────────────────────────────────────────────────────

    describe('GET /api/alerter/status', function () {
        it('returns alerter configuration', async function () {
            const { data } = await get('/api/alerter/status');
            assert.strictEqual(typeof data.emailEnabled, 'boolean');
        });
    });

    // ── Live Trading ──────────────────────────────────────────────────────

    describe('GET /api/live-trading/status', function () {
        it('returns live trader status', async function () {
            const { data } = await get('/api/live-trading/status');
            assert.ok(data, 'should return status');
        });
    });

    describe('GET /api/live-trading/config-check', function () {
        it('returns API key configuration check', async function () {
            const { data } = await get('/api/live-trading/config-check');
            assert.strictEqual(typeof data.configured, 'boolean');
            assert.strictEqual(typeof data.hasApiKey, 'boolean');
            assert.strictEqual(typeof data.hasApiSecret, 'boolean');
        });
    });

    // ── Optimizer ─────────────────────────────────────────────────────────

    describe('GET /api/optimizer/status', function () {
        it('returns optimizer status', async function () {
            const { data } = await get('/api/optimizer/status');
            assert.ok(data, 'should return optimizer status');
        });
    });

    describe('GET /api/optimizer/results', function () {
        it('returns optimization results', async function () {
            const { data } = await get('/api/optimizer/results');
            assert.ok(data.results !== undefined, 'should have results');
        });
    });

    // ── Monte Carlo ───────────────────────────────────────────────────────

    describe('GET /api/monte-carlo/summary', function () {
        it('returns text summary (or "no simulation" message)', async function () {
            const res = await fetch(`${BASE}/api/monte-carlo/summary`);
            const text = await res.text();
            assert.ok(text.length > 0, 'should return non-empty text');
        });
    });

    // ── Portfolio Heatmap ─────────────────────────────────────────────────

    describe('GET /api/portfolio/heatmap', function () {
        it('returns portfolio allocation heatmap', async function () {
            const { data } = await get('/api/portfolio/heatmap');
            assert.ok(Array.isArray(data.assets), 'assets should be array');
            assert.strictEqual(typeof data.totalValue, 'number');
        });
    });

    // ── Rebalancer ────────────────────────────────────────────────────────

    describe('GET /api/rebalancer/status', function () {
        it('returns rebalancer status', async function () {
            const { data } = await get('/api/rebalancer/status');
            assert.ok(data, 'should return rebalancer status');
        });
    });

    // ── Sentiment ─────────────────────────────────────────────────────────

    describe('GET /api/sentiment', function () {
        it('returns sentiment data (may take time for API calls)', async function () {
            this.timeout(15000);
            const { data } = await get('/api/sentiment?keyword=BTC');
            assert.ok(data, 'should return sentiment data');
        });
    });

    // ── ML Insights ───────────────────────────────────────────────────────

    describe('GET /api/ml-insights', function () {
        it('returns ML insights', async function () {
            const { data } = await get('/api/ml-insights');
            assert.ok(data, 'should return ML insights');
        });
    });

    // ── Buffer Health ─────────────────────────────────────────────────────

    describe('GET /api/buffer-health', function () {
        it('returns buffer health data', async function () {
            const { data } = await get('/api/buffer-health');
            assert.ok(data, 'should return buffer health');
        });
    });
});
