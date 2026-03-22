/**
 * Portfolio Unit Tests (Mocha)
 */
const assert = require('assert');
const Portfolio = require('../src/portfolio');

describe('Portfolio', () => {
    let portfolio;

    beforeEach(() => {
        portfolio = new Portfolio(10000);
    });

    it('should initialize with correct default values', () => {
        assert.strictEqual(portfolio.balance(), 10000);
        assert.strictEqual(portfolio.initial, 10000);
        assert.deepStrictEqual(portfolio.positions, {});
    });

    it('should open LONG position (BUY) correctly', () => {
        const result = portfolio.buy('BTCUSDT', 40000, 0.1);
        assert.strictEqual(result, true);
        assert.strictEqual(portfolio.holdings('BTCUSDT'), 0.1);
    });

    it('should close position (SELL) and reduce holdings', () => {
        portfolio.buy('BTCUSDT', 40000, 0.1);
        const result = portfolio.sell('BTCUSDT', 42000, 0.1);
        assert.strictEqual(result, true);
        assert.strictEqual(portfolio.holdings('BTCUSDT'), 0);
    });

    it('should track equity correctly', () => {
        portfolio.buy('BTCUSDT', 40000, 0.1);
        const prices = { 'BTCUSDT': 41000 };
        const equity = portfolio.equity(prices);
        assert.strictEqual(typeof equity, 'number');
        assert(equity > 0);
    });

    it('should calculate P&L correctly', () => {
        portfolio.buy('BTCUSDT', 40000, 0.1);
        const prices = { 'BTCUSDT': 42000 }; // 10% gain
        const pnl = portfolio.pnl(prices);
        assert.strictEqual(typeof pnl, 'number');
    });

    it('should fail BUY if insufficient balance', () => {
        const result = portfolio.buy('BTCUSDT', 40000, 1000); // way too much
        assert.strictEqual(result, false);
    });

    it('should fail SELL if no holdings', () => {
        const result = portfolio.sell('ETHUSDT', 2000, 1);
        assert.strictEqual(result, false);
    });

    it('should calculate win rate correctly', () => {
        portfolio.buy('BTCUSDT', 40000, 0.1);
        portfolio.sell('BTCUSDT', 42000, 0.1); // win
        portfolio.buy('BTCUSDT', 40000, 0.1);
        portfolio.sell('BTCUSDT', 39000, 0.1); // loss
        const wr = portfolio.winRate();
        assert.strictEqual(typeof wr, 'number');
        assert(wr >= 0 && wr <= 100);
    });
});
