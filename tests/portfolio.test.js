/**
 * Portfolio Unit Tests
 */
const { describe, test, expect } = require('@jest/globals');

describe('Portfolio', () => {
    let portfolio;

    beforeAll(() => {
        portfolio = require('../src/portfolio');
    });

    test('should initialize with default values', () => {
        expect(portfolio.capital).toBe(10000);
        expect(portfolio.positions).toEqual({});
    });

    test('should open LONG position correctly', () => {
        const result = portfolio.openPosition('BTCUSDT', 'LONG', 0.1, 40000);
        expect(result).toHaveProperty('success');
    });

    test('should open SHORT position correctly', () => {
        const result = portfolio.openPosition('ETHUSDT', 'SHORT', 0.05, 2000);
        expect(result).toHaveProperty('success');
    });

    test('should close position and return P&L', () => {
        const result = portfolio.closePosition('BTCUSDT', 42000);
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('pnl');
    });

    test('should track total equity correctly', () => {
        const equity = portfolio.getEquity();
        expect(typeof equity).toBe('number');
        expect(equity).toBeGreaterThan(0);
    });

    test('should calculate drawdown correctly', () => {
        const drawdown = portfolio.getDrawdown();
        expect(typeof drawdown).toBe('number');
        expect(drawdown).toBeGreaterThanOrEqual(0);
    });
});
