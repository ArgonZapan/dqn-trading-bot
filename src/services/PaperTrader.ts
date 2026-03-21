/**
 * Paper Trading Mode - Simulated trading with real prices
 * Tracks positions, calculates P&L, win rate, drawdown
 */
import { Candle } from '../types';

export interface PaperPosition {
  id: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  entryTime: number;
  pnl: number;
  pnlPercent: number;
 Fees: number;
}

export interface PaperTrade {
  id: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
  pnl: number;
  timestamp: number;
}

export interface PaperTradingStats {
  enabled: boolean;
  capital: number;
  positions: PaperPosition[];
  closedTrades: PaperTrade[];
  stats: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    totalFees: number;
    profitFactor: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    avgWin: number;
    avgLoss: number;
    sharpeRatio: number;
    currentStreak: number;
    bestStreak: number;
    worstStreak: number;
  };
}

export class PaperTrader {
  private enabled: boolean = false;
  private capital: number = 1000;
  private positions: Map<string, PaperPosition> = new Map();
  private closedTrades: PaperTrade[] = [];
  private entryBalance: number = 1000;
  private peakBalance: number = 1000;
  private maxDrawdown: number = 0;
  private maxDrawdownPercent: number = 0;
  private feeRate: number = 0.001; // 0.1% Binance fee
  private trades: PaperTrade[] = [];

  // Strategy config
  private strategy: 'trend' | 'mean_reversion' | 'momentum' | 'macd' = 'trend';
  private positionSize: number = 0.95; // 95% of capital per trade

  constructor(initialCapital: number = 1000) {
    this.capital = initialCapital;
    this.entryBalance = initialCapital;
    this.peakBalance = initialCapital;
  }

  enable() {
    this.enabled = true;
    this.reset();
  }

  disable() {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset() {
    this.capital = this.entryBalance;
    this.positions.clear();
    this.closedTrades = [];
    this.trades = [];
    this.peakBalance = this.entryBalance;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
  }

  setStrategy(strategy: PaperTradingStats['stats'] extends string ? never : PaperTrader['strategy']) {
    this.strategy = strategy;
  }

  getStrategy(): string {
    return this.strategy;
  }

  setPositionSize(size: number) {
    this.positionSize = Math.max(0.1, Math.min(1, size));
  }

  /**
   * Execute a BUY (open LONG position)
   */
  buy(currentPrice: number): PaperTrade | null {
    if (!this.enabled || this.capital < 10) return null;
    
    // Close SHORT if exists
    if (this.positions.has('SHORT')) {
      this.closePosition('SHORT', currentPrice);
    }

    const quantity = (this.capital * this.positionSize) / currentPrice;
    const fee = currentPrice * quantity * this.feeRate;
    const totalCost = quantity * currentPrice + fee;

    if (totalCost > this.capital) return null;

    const trade: PaperTrade = {
      id: `trade_${Date.now()}_buy`,
      side: 'BUY',
      price: currentPrice,
      quantity,
      fee,
      pnl: 0,
      timestamp: Date.now()
    };

    this.trades.push(trade);
    this.capital -= totalCost;

    const position: PaperPosition = {
      id: 'LONG',
      side: 'LONG',
      entryPrice: currentPrice,
      quantity,
      entryTime: Date.now(),
      pnl: 0,
      pnlPercent: 0,
      Fees: fee
    };

    this.positions.set('LONG', position);
    this.updatePeak();
    return trade;
  }

  /**
   * Execute a SELL (close LONG position)
   */
  sell(currentPrice: number): PaperTrade | null {
    if (!this.enabled || !this.positions.has('LONG')) return null;
    return this.closePosition('LONG', currentPrice);
  }

  /**
   * Open SHORT position
   */
  short(currentPrice: number): PaperTrade | null {
    if (!this.enabled || this.capital < 10) return null;
    
    // Close LONG if exists
    if (this.positions.has('LONG')) {
      this.closePosition('LONG', currentPrice);
    }

    const notional = this.capital * this.positionSize;
    const quantity = notional / currentPrice;
    const fee = currentPrice * quantity * this.feeRate;
    const collateral = notional + fee;

    if (collateral > this.capital) return null;

    const trade: PaperTrade = {
      id: `trade_${Date.now()}_short`,
      side: 'SELL',
      price: currentPrice,
      quantity,
      fee,
      pnl: 0,
      timestamp: Date.now()
    };

    this.trades.push(trade);
    this.capital -= fee; // Only pay fee to open short

    const position: PaperPosition = {
      id: 'SHORT',
      side: 'SHORT',
      entryPrice: currentPrice,
      quantity,
      entryTime: Date.now(),
      pnl: 0,
      pnlPercent: 0,
      Fees: fee
    };

    this.positions.set('SHORT', position);
    return trade;
  }

  /**
   * Cover SHORT position
   */
  cover(currentPrice: number): PaperTrade | null {
    if (!this.enabled || !this.positions.has('SHORT')) return null;
    return this.closePosition('SHORT', currentPrice);
  }

  private closePosition(positionId: string, currentPrice: number): PaperTrade | null {
    const position = this.positions.get(positionId);
    if (!position) return null;

    const pnl = position.side === 'LONG'
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity;

    const exitFee = currentPrice * position.quantity * this.feeRate;
    const netPnl = pnl - position.Fees - exitFee;

    const trade: PaperTrade = {
      id: `trade_${Date.now()}_${position.side.toLowerCase()}_close`,
      side: position.side === 'LONG' ? 'SELL' : 'BUY',
      price: currentPrice,
      quantity: position.quantity,
      fee: exitFee,
      pnl: netPnl,
      timestamp: Date.now()
    };

    this.closedTrades.push(trade);
    this.trades.push(trade);

    // Update capital
    if (position.side === 'LONG') {
      this.capital += position.quantity * currentPrice - exitFee;
    } else {
      // Short: return collateral + pnl
      const collateral = position.quantity * position.entryPrice;
      this.capital += collateral + netPnl;
    }

    this.positions.delete(positionId);
    this.updatePeak();
    this.updateMaxDrawdown();

    return trade;
  }

  /**
   * Update unrealized P&L on open positions
   */
  updatePrices(currentPrice: number) {
    for (const [id, position] of this.positions) {
      if (position.side === 'LONG') {
        position.pnl = (currentPrice - position.entryPrice) * position.quantity;
        position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      } else {
        position.pnl = (position.entryPrice - currentPrice) * position.quantity;
        position.pnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
      }
    }
  }

  private updatePeak() {
    const total = this.getTotalBalance(this.positions.size > 0 ? 
      (Array.from(this.positions.values())[0].side === 'LONG' 
        ? Array.from(this.positions.values())[0].quantity * (Array.from(this.positions.values())[0].entryPrice)
        : 0) : 0);
    if (total > this.peakBalance) {
      this.peakBalance = total;
    }
  }

  private updateMaxDrawdown() {
    const current = this.getTotalBalance(0);
    const drawdown = this.peakBalance - current;
    const drawdownPercent = (drawdown / this.peakBalance) * 100;

    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
      this.maxDrawdownPercent = drawdownPercent;
    }
  }

  getTotalBalance(positionPrice: number = 0): number {
    let posValue = 0;
    if (this.positions.size > 0 && positionPrice > 0) {
      for (const p of this.positions.values()) {
        if (p.side === 'LONG') {
          posValue += p.quantity * positionPrice;
        } else {
          const collateral = p.quantity * p.entryPrice;
          posValue += collateral + p.pnl;
        }
      }
    }
    return this.capital + posValue;
  }

  getStats(): PaperTradingStats {
    const closed = this.closedTrades;
    const winning = closed.filter(t => t.pnl > 0);
    const losing = closed.filter(t => t.pnl <= 0);
    const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
    const totalFees = closed.reduce((sum, t) => sum + t.fee, 0);
    const winRate = closed.length > 0 ? (winning.length / closed.length) * 100 : 0;
    const avgWin = winning.length > 0 ? winning.reduce((s, t) => s + t.pnl, 0) / winning.length : 0;
    const avgLoss = losing.length > 0 ? losing.reduce((s, t) => s + t.pnl, 0) / losing.length : 0;
    const profitFactor = totalPnl > 0 && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : totalPnl > 0 ? Infinity : 0;

    // Sharpe ratio (simplified)
    const returns = closed.map(t => t.pnl / this.entryBalance);
    const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Streaks
    let currentStreak = 0;
    let bestStreak = 0;
    let worstStreak = 0;
    let streak = 0;

    for (const t of closed) {
      if (t.pnl > 0) {
        streak = streak > 0 ? streak + 1 : 1;
        bestStreak = Math.max(bestStreak, streak);
        worstStreak = Math.min(worstStreak, streak === 1 ? -1 : streak);
      } else {
        streak = streak < 0 ? streak - 1 : -1;
        worstStreak = Math.min(worstStreak, streak);
        bestStreak = Math.max(bestStreak, streak === -1 ? 1 : streak);
      }
    }
    currentStreak = streak;

    return {
      enabled: this.enabled,
      capital: this.capital,
      positions: Array.from(this.positions.values()),
      closedTrades: this.closedTrades.slice(-50),
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
        sharpeRatio,
        currentStreak,
        bestStreak,
        worstStreak
      }
    };
  }

  /**
   * Get signal from configured strategy
   */
  getSignal(candle: Candle, indicators: any): 'BUY' | 'SELL' | 'HOLD' {
    switch (this.strategy) {
      case 'trend':
        return this.trendSignal(candle, indicators);
      case 'mean_reversion':
        return this.meanReversionSignal(candle, indicators);
      case 'momentum':
        return this.momentumSignal(candle, indicators);
      case 'macd':
        return this.macdSignal(candle, indicators);
      default:
        return 'HOLD';
    }
  }

  private trendSignal(candle: Candle, ind: any): 'BUY' | 'SELL' | 'HOLD' {
    if (!ind.ema9 || !ind.ema21) return 'HOLD';
    if (ind.ema9 > ind.ema21 && candle.close > ind.ema9) return 'BUY';
    if (ind.ema9 < ind.ema21 && candle.close < ind.ema9) return 'SELL';
    return 'HOLD';
  }

  private meanReversionSignal(candle: Candle, ind: any): 'BUY' | 'SELL' | 'HOLD' {
    if (!ind.bb || !ind.rsi) return 'HOLD';
    if (candle.close < ind.bb.lower && ind.rsi < 30) return 'BUY';
    if (candle.close > ind.bb.upper && ind.rsi > 70) return 'SELL';
    return 'HOLD';
  }

  private momentumSignal(candle: Candle, ind: any): 'BUY' | 'SELL' | 'HOLD' {
    if (!ind.rsi) return 'HOLD';
    if (ind.rsi < 35) return 'BUY';
    if (ind.rsi > 65) return 'SELL';
    return 'HOLD';
  }

  private macdSignal(candle: Candle, ind: any): 'BUY' | 'SELL' | 'HOLD' {
    if (!ind.macd) return 'HOLD';
    if (ind.macd.histogram > 0 && ind.macd.value > ind.macd.signal) return 'BUY';
    if (ind.macd.histogram < 0 && ind.macd.value < ind.macd.signal) return 'SELL';
    return 'HOLD';
  }
}
