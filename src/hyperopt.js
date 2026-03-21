/**
 * Hyperparameter Optimizer - Adaptive Learning Rate & Epsilon Decay
 * 
 * Tracks performance metrics across episodes and adjusts hyperparameters
 * based on recent performance trends.
 */

class Hyperopt {
    constructor() {
        // Default hyperparameters
        this.hyperparams = {
            learningRate: 0.0005,
            gamma: 0.99,
            epsilonDecay: 0.995,
            epsilonMin: 0.01,
            batchSize: 32
        };

        // Performance tracking (rolling window)
        this.episodeMetrics = [];
        this.windowSize = 10; // Compare last N episodes
        
        // Performance snapshot
        this.performance = {
            avgReward: 0,
            winRate: 0,
            drawdown: 0,
            episodesTracked: 0
        };

        // Adaptation config
        this.lrConfig = {
            increaseThreshold: 0.05,   // Improve by 5% to increase LR
            decreaseThreshold: -0.05,  // Degrade by 5% to decrease LR
            lrIncreaseFactor: 1.05,    // +5% LR when improving
            lrDecreaseFactor: 0.90,    // -10% LR when degrading
            minLR: 0.00005,
            maxLR: 0.005
        };

        this.epsilonConfig = {
            decayIncreaseFactor: 1.005,  // Slow down decay (explore more)
            decayDecreaseFactor: 0.990,  // Speed up decay (exploit more)
            minDecay: 0.900,
            maxDecay: 0.999
        };

        // Logging
        this.suggestions = [];
    }

    /**
     * Update hyperparameters based on episode metrics
     * @param {Object} hyperparams - Current hyperparameters
     * @param {Object} metrics - Episode metrics { reward, winRate, drawdown, steps, tradesCount }
     * @returns {Object} - Adjusted hyperparameters
     */
    update(hyperparams, metrics) {
        // Store current hyperparameters
        this.hyperparams = { ...this.hyperparams, ...hyperparams };

        // Track episode
        this.episodeMetrics.push({
            reward: metrics.reward || 0,
            winRate: metrics.winRate || 0,
            drawdown: metrics.drawdown || 0,
            steps: metrics.steps || 0,
            tradesCount: metrics.tradesCount || 0,
            timestamp: Date.now()
        });

        // Keep only recent episodes in window
        if (this.episodeMetrics.length > this.windowSize * 2) {
            this.episodeMetrics.shift();
        }

        this.performance.episodesTracked = this.episodeMetrics.length;

        // Only adapt after collecting enough episodes
        if (this.episodeMetrics.length < 3) {
            this.performance.avgReward = metrics.reward || 0;
            this.performance.winRate = metrics.winRate || 0;
            this.performance.drawdown = metrics.drawdown || 0;
            return this.hyperparams;
        }

        // Calculate recent vs older performance
        const recent = this.episodeMetrics.slice(-this.windowSize);
        const older = this.episodeMetrics.slice(-this.windowSize * 2, -this.windowSize);
        
        const recentAvgReward = recent.reduce((s, m) => s + m.reward, 0) / recent.length;
        const olderAvgReward = older.length > 0 
            ? older.reduce((s, m) => s + m.reward, 0) / older.length 
            : recentAvgReward;

        const recentAvgWinRate = recent.reduce((s, m) => s + m.winRate, 0) / recent.length;
        const olderAvgWinRate = older.length > 0
            ? older.reduce((s, m) => s + m.winRate, 0) / older.length
            : recentAvgWinRate;

        const recentAvgDrawdown = recent.reduce((s, m) => s + m.drawdown, 0) / recent.length;

        // Update performance stats
        this.performance.avgReward = recentAvgReward;
        this.performance.winRate = recentAvgWinRate;
        this.performance.drawdown = recentAvgDrawdown;

        // Calculate relative change
        const rewardChange = olderAvgReward !== 0 
            ? (recentAvgReward - olderAvgReward) / Math.abs(olderAvgReward) 
            : 0;
        
        const winRateChange = olderAvgWinRate !== 0
            ? (recentAvgWinRate - olderAvgWinRate) / Math.abs(olderAvgWinRate)
            : 0;

        const combinedChange = (rewardChange + winRateChange) / 2;

        // Adaptive Learning Rate
        let lrSuggestion = null;
        if (combinedChange > this.lrConfig.increaseThreshold) {
            // Performance improving - increase learning rate slightly
            const newLR = Math.min(
                this.hyperparams.learningRate * this.lrConfig.lrIncreaseFactor,
                this.lrConfig.maxLR
            );
            lrSuggestion = `📈 LR: ${this.hyperparams.learningRate.toExponential(2)} → ${newLR.toExponential(2)} (performance +${(combinedChange * 100).toFixed(1)}%)`;
            this.hyperparams.learningRate = newLR;
        } else if (combinedChange < this.lrConfig.decreaseThreshold) {
            // Performance degrading - decrease learning rate
            const newLR = Math.max(
                this.hyperparams.learningRate * this.lrConfig.lrDecreaseFactor,
                this.lrConfig.minLR
            );
            lrSuggestion = `📉 LR: ${this.hyperparams.learningRate.toExponential(2)} → ${newLR.toExponential(2)} (performance ${(combinedChange * 100).toFixed(1)}%)`;
            this.hyperparams.learningRate = newLR;
        }

        // Adaptive Epsilon Decay based on exploration efficiency
        let epsilonSuggestion = null;
        
        // Exploration efficiency: check if recent episodes have lower win rate with similar rewards
        // (might indicate random exploration isn't helping)
        const explorationEfficiency = recentAvgWinRate > 0 && recentAvgReward > 0
            ? recentAvgWinRate / Math.sqrt(Math.abs(recentAvgReward) + 1)
            : 1;

        if (explorationEfficiency > 0.8 && recentAvgReward > olderAvgReward) {
            // Good exploration - can reduce epsilon faster (more exploitation)
            const newDecay = Math.max(
                this.hyperparams.epsilonDecay * this.epsilonConfig.decayDecreaseFactor,
                this.epsilonConfig.minDecay
            );
            epsilonSuggestion = `🔍 ε-Decay: ${this.hyperparams.epsilonDecay.toFixed(4)} → ${newDecay.toFixed(4)} (exploration efficient)`;
            this.hyperparams.epsilonDecay = newDecay;
        } else if (explorationEfficiency < 0.3 || recentAvgReward < olderAvgReward * 0.8) {
            // Poor exploration - slow down decay (more exploration)
            const newDecay = Math.min(
                this.hyperparams.epsilonDecay * this.epsilonConfig.decayIncreaseFactor,
                this.epsilonConfig.maxDecay
            );
            epsilonSuggestion = `🎯 ε-Decay: ${this.hyperparams.epsilonDecay.toFixed(4)} → ${newDecay.toFixed(4)} (needs more exploration)`;
            this.hyperparams.epsilonDecay = newDecay;
        }

        // Log suggestions
        if (lrSuggestion || epsilonSuggestion) {
            const suggestion = [
                `[Hyperopt] Episode ${this.episodeMetrics.length} | Reward: ${recentAvgReward.toFixed(2)} | WinRate: ${(recentAvgWinRate * 100).toFixed(1)}% | DD: ${recentAvgDrawdown.toFixed(2)}%`,
                lrSuggestion || 'LR: unchanged',
                epsilonSuggestion || 'ε-Decay: unchanged'
            ].join(' | ');
            
            this.suggestions.push({ timestamp: Date.now(), text: suggestion });
            if (this.suggestions.length > 50) this.suggestions.shift();
            
            console.log(suggestion);
        }

        return this.hyperparams;
    }

    /**
     * Get current hyperparameters
     */
    getHyperparams() {
        return {
            ...this.hyperparams,
            performance: { ...this.performance }
        };
    }

    /**
     * Reset optimizer state
     */
    reset() {
        this.episodeMetrics = [];
        this.performance = {
            avgReward: 0,
            winRate: 0,
            drawdown: 0,
            episodesTracked: 0
        };
        this.hyperparams = {
            learningRate: 0.0005,
            gamma: 0.99,
            epsilonDecay: 0.995,
            epsilonMin: 0.01,
            batchSize: 32
        };
        this.suggestions = [];
    }
}

module.exports = Hyperopt;
