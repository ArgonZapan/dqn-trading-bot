/**
 * Strategy Selector - Automatic strategy recommendation based on market conditions
 * Analyzes volatility, trend, volume to recommend best strategy for current conditions
 */

class StrategySelector {
    constructor() {
        // Strategy performance tracking
        this.strategyPerformance = {
            trend: { wins: 0, losses: 0, total: 0 },
            momentum: { wins: 0, losses: 0, total: 0 },
            meanReversion: { wins: 0, losses: 0, total: 0 },
            macd: { wins: 0, losses: 0, total: 0 },
            scalping: { wins: 0, losses: 0, total: 0 },
            grid: { wins: 0, losses: 0, total: 0 }
        };
        
        // Market regime weights (learned from performance)
        this.regimeWeights = {
            trending: { trend: 1.5, momentum: 0.8, scalping: 0.5, grid: 0.6 },
            ranging: { trend: 0.5, momentum: 0.6, scalping: 1.2, grid: 1.5 },
            volatile: { trend: 0.6, momentum: 1.3, scalping: 1.4, grid: 1.8 },
            calm: { trend: 1.0, momentum: 1.0, scalping: 0.8, grid: 1.0 }
        };
    }

    /**
     * Analyze current market conditions
     * @param {Object} state - Current market state
     * @returns {Object} - {volatility, trend, volume, regime}
     */
    analyzeMarketConditions(state) {
        const closes = state.close || [];
        const volumes = state.volume || [];
        
        if (closes.length < 20) {
            return { regime: 'unknown', volatility: 'medium', trend: 'neutral', volume: 'normal' };
        }
        
        // Calculate volatility (ATR-based or std deviation)
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            returns.push((closes[i] - closes[i-1]) / closes[i-1]);
        }
        const avgReturn = returns.reduce((a,b) => a+b, 0) / returns.length;
        const stdDev = Math.sqrt(returns.reduce((a,b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length);
        
        // Volatility classification
        let volatility;
        if (stdDev > 0.03) volatility = 'high';
        else if (stdDev > 0.01) volatility = 'medium';
        else volatility = 'low';
        
        // Trend detection (using linear regression on recent prices)
        const recentCloses = closes.slice(-20);
        const trendStrength = this.calcTrendStrength(recentCloses);
        
        let trend;
        if (trendStrength > 0.7) trend = 'strong_up';
        else if (trendStrength > 0.3) trend = 'up';
        else if (trendStrength < -0.7) trend = 'strong_down';
        else if (trendStrength < -0.3) trend = 'down';
        else trend = 'neutral';
        
        // Volume analysis
        const recentVolume = volumes.slice(-5);
        const avgVolume = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
        const currentVolAvg = recentVolume.reduce((a,b) => a+b, 0) / recentVolume.length;
        const volumeRatio = currentVolAvg / (avgVolume || 1);
        
        let volume;
        if (volumeRatio > 2) volume = 'surge';
        else if (volumeRatio > 1.3) volume = 'high';
        else if (volumeRatio < 0.5) volume = 'low';
        else volume = 'normal';
        
        // Determine regime
        let regime = 'ranging';
        if (Math.abs(trendStrength) > 0.6) regime = 'trending';  // Strong trend, any volatility
        else if (volatility === 'high' && volumeRatio > 1.5) regime = 'volatile';
        else if (volatility === 'low' && volumeRatio < 0.7) regime = 'calm';
        else if (Math.abs(trendStrength) < 0.3) regime = 'ranging';
        
        return { volatility, trend, volume, regime, trendStrength, volumeRatio };
    }

    /**
     * Calculate trend strength using linear regression slope
     */
    calcTrendStrength(prices) {
        if (prices.length < 2) return 0;
        
        const n = prices.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = prices.reduce((a, b) => a + b, 0);
        const sumXY = prices.reduce((sum, y, x) => sum + x * y, 0);
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgPrice = sumY / n;
        
        // Normalize slope to -1 to 1 range
        return Math.max(-1, Math.min(1, slope * 1000 / avgPrice));
    }

    /**
     * Get recommended strategy for current conditions
     * @param {Object} state - Current market state
     * @param {Object} indicators - Technical indicators
     * @returns {Object} - {strategy, confidence, reason}
     */
    getRecommendation(state, indicators = {}) {
        const conditions = this.analyzeMarketConditions(state);
        
        // Start with regime weights
        let scores = {
            trend: this.regimeWeights[conditions.regime]?.trend || 1.0,
            momentum: this.regimeWeights[conditions.regime]?.momentum || 1.0,
            scalping: this.regimeWeights[conditions.regime]?.scalping || 1.0,
            grid: this.regimeWeights[conditions.regime]?.grid || 1.0,
            meanReversion: 0.8,
            macd: 0.7
        };
        
        // Adjust based on specific conditions
        // High volatility = avoid scalping, prefer grid/momentum
        if (conditions.volatility === 'high') {
            scores.scalping *= 0.7;
            scores.grid *= 1.3;
            scores.momentum *= 1.2;
        }
        
        // Low volatility = prefer scalping, mean reversion
        if (conditions.volatility === 'low') {
            scores.scalping *= 1.3;
            scores.meanReversion *= 1.2;
            scores.trend *= 0.8;
        }
        
        // Volume surge = good for scalping
        if (conditions.volume === 'surge') {
            scores.scalping *= 1.5;
        }
        
        // Strong trend = trend following works well
        if (conditions.trend.includes('strong')) {
            scores.trend *= 1.4;
            scores.momentum *= 1.1;
        }
        
        // Ranging = grid and scalping work
        if (conditions.regime === 'ranging') {
            scores.grid *= 1.3;
            scores.scalping *= 1.2;
            scores.trend *= 0.6;
        }
        
        // Apply historical performance adjustment
        Object.keys(scores).forEach(strat => {
            const perf = this.strategyPerformance[strat];
            if (perf && perf.total > 5) {
                const winRate = perf.wins / perf.total;
                scores[strat] *= (0.5 + winRate); // 0.5 to 1.5 multiplier based on win rate
            }
        });
        
        // Find best strategy
        let bestStrategy = 'trend';
        let bestScore = 0;
        
        Object.entries(scores).forEach(([strat, score]) => {
            if (score > bestScore) {
                bestScore = score;
                bestStrategy = strat;
            }
        });
        
        // Confidence based on score difference
        const sortedScores = Object.values(scores).sort((a, b) => b - a);
        const scoreDiff = sortedScores[0] - (sortedScores[1] || 0);
        let confidence;
        if (scoreDiff > 0.5) confidence = 'high';
        else if (scoreDiff > 0.2) confidence = 'medium';
        else confidence = 'low';
        
        return {
            strategy: bestStrategy,
            confidence,
            score: bestScore,
            conditions,
            allScores: scores,
            reason: this.getReason(bestStrategy, conditions)
        };
    }

    /**
     * Get human-readable reason for recommendation
     */
    getReason(strategy, conditions) {
        const reasons = {
            trend: `Strong trend detected (${conditions.trend}), trend following optimal`,
            momentum: `Momentum favorable in ${conditions.volatility} volatility`,
            scalping: `Volume ${conditions.volume}, scalping captures quick moves`,
            grid: `Market ${conditions.regime}, grid profits from range-bound action`,
            meanReversion: `Price oscillations favor mean reversion strategy`,
            macd: `MACD crossovers reliable in current regime`
        };
        return reasons[strategy] || 'Balanced strategy mix';
    }

    /**
     * Update strategy performance (call after each trade)
     */
    updatePerformance(strategy, won) {
        if (!this.strategyPerformance[strategy]) {
            this.strategyPerformance[strategy] = { wins: 0, losses: 0, total: 0 };
        }
        
        this.strategyPerformance[strategy].total++;
        if (won) {
            this.strategyPerformance[strategy].wins++;
        } else {
            this.strategyPerformance[strategy].losses++;
        }
    }

    /**
     * Get performance stats for all strategies
     */
    getStats() {
        const stats = {};
        Object.entries(this.strategyPerformance).forEach(([strat, data]) => {
            const winRate = data.total > 0 ? (data.wins / data.total * 100).toFixed(1) : 0;
            stats[strat] = {
                ...data,
                winRate
            };
        });
        return stats;
    }

    /**
     * Get best performing strategy historically
     */
    getBestHistoricalStrategy() {
        let best = { strategy: null, winRate: 0 };
        
        Object.entries(this.strategyPerformance).forEach(([strat, data]) => {
            if (data.total >= 5) { // Minimum sample size
                const winRate = data.wins / data.total;
                if (winRate > best.winRate) {
                    best = { strategy: strat, winRate };
                }
            }
        });
        
        return best;
    }
}

module.exports = StrategySelector;
