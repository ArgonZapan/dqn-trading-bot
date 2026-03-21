/**
 * MetricsCalculator - Portfolio performance metrics
 * Computes Sharpe ratio, max drawdown, win rate, etc.
 */
import { Trade } from '../types';
export interface PortfolioMetrics {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    totalPnlPercent: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    avgTradePnl: number;
    bestTrade: number;
    worstTrade: number;
    equityCurve: number[];
}
export declare function calculateMetrics(trades: Trade[], initialCapital?: number, riskFreeRate?: number): PortfolioMetrics;
export declare function formatMetrics(m: PortfolioMetrics): string;
