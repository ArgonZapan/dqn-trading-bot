/**
 * Replay Buffer Health Monitor
 * Sledzi jakość treningu i wykrywa problemy z bufferem
 */

class BufferHealth {
    constructor() {
        // Rolling window for action distribution
        this.actionCounts = { 0: 0, 1: 0, 2: 0, 3: 0 }; // HOLD, LONG, SHORT, CLOSE
        this.actionWindow = 200; // ostatnie 200 próbek
        
        // TD error history for convergence detection
        this.tdErrors = [];
        this.tdErrorWindow = 500;
        
        // State diversity tracking
        this.stateHashes = new Map(); // discretized state -> count
        this.diversityWindow = 1000;
        
        // Priority statistics
        this.priorityHistory = [];
        
        // Episode stats
        this.episodeRewards = [];
        this.episodeLengths = [];
        
        // Last N samples for quick stats
        this.lastSamples = [];
        this.maxSamples = 500;
        
        // Buffer fill level
        this.bufferSize = 0;
        this.bufferCapacity = 10000;
    }
    
    /**
     * Record a sample from the buffer
     */
    recordSample(sample, tdError = null) {
        const state = sample.state;
        const action = sample.action;
        
        // Action distribution
        if (this.actionCounts[action] !== undefined) {
            this.actionCounts[action]++;
        }
        
        // State diversity (simple hash of close prices)
        if (state && state.close) {
            const hash = this._hashState(state.close);
            this.stateHashes.set(hash, (this.stateHashes.get(hash) || 0) + 1);
        }
        
        // TD error
        if (tdError !== null && !isNaN(tdError)) {
            this.tdErrors.push(Math.abs(tdError));
            if (this.tdErrors.length > this.tdErrorWindow) {
                this.tdErrors.shift();
            }
        }
        
        // Priority
        if (sample.priority !== undefined) {
            this.priorityHistory.push(sample.priority);
            if (this.priorityHistory.length > this.tdErrorWindow) {
                this.priorityHistory.shift();
            }
        }
        
        // Last samples
        this.lastSamples.push({ action, tdError, reward: sample.reward });
        if (this.lastSamples.length > this.maxSamples) {
            this.lastSamples.shift();
        }
    }
    
    /**
     * Record episode end
     */
    recordEpisode(totalReward, length) {
        this.episodeRewards.push(totalReward);
        this.episodeLengths.push(length);
        if (this.episodeRewards.length > 100) {
            this.episodeRewards.shift();
            this.episodeLengths.shift();
        }
    }
    
    /**
     * Update buffer size info
     */
    updateBufferSize(size, capacity) {
        this.bufferSize = size;
        this.bufferCapacity = capacity;
    }
    
    /**
     * Reset action counts (call at episode start)
     */
    resetActionCounts() {
        this.actionCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    }
    
    /**
     * Simple hash for state diversity (discretize close prices)
     */
    _hashState(closes) {
        if (!closes || closes.length === 0) return 'empty';
        // Use last 10 closes, discretize to 20 buckets
        const last10 = closes.slice(-10);
        return last10.map(c => Math.floor(c * 20) % 20).join(',');
    }
    
    /**
     * Calculate action entropy (higher = more diverse)
     */
    _entropy(counts) {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) return 0;
        let entropy = 0;
        for (const count of Object.values(counts)) {
            if (count > 0) {
                const p = count / total;
                entropy -= p * Math.log2(p);
            }
        }
        // Normalize to 0-1 (max entropy for 4 actions is log2(4) = 2)
        return entropy / 2;
    }
    
    /**
     * Get health status
     */
    getHealth() {
        const health = {
            bufferFill: this.bufferSize / this.bufferCapacity,
            actionEntropy: this._entropy(this.actionCounts),
            tdError: {
                mean: 0,
                std: 0,
                trend: 'STABLE',
                recentAvg: 0
            },
            diversity: {
                uniqueStates: this.stateHashes.size,
                coverage: 0 // % of possible states seen
            },
            priority: {
                mean: 0,
                std: 0
            },
            episode: {
                avgReward: 0,
                avgLength: 0,
                rewardTrend: 'STABLE',
                recentCount: 0
            },
            actionDistribution: { ...this.actionCounts },
            isHealthy: true,
            warnings: []
        };
        
        // TD Error stats
        if (this.tdErrors.length > 10) {
            const mean = this.tdErrors.reduce((a, b) => a + b, 0) / this.tdErrors.length;
            const variance = this.tdErrors.reduce((s, e) => s + Math.pow(e - mean, 2), 0) / this.tdErrors.length;
            health.tdError.mean = parseFloat(mean.toFixed(6));
            health.tdError.std = parseFloat(Math.sqrt(variance).toFixed(6));
            
            // Trend detection
            const recent = this.tdErrors.slice(-50);
            const older = this.tdErrors.slice(0, 50);
            if (recent.length > 10 && older.length > 10) {
                const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
                const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
                if (recentMean < olderMean * 0.9) health.tdError.trend = '📉 DECREASING (good)';
                else if (recentMean > olderMean * 1.1) health.tdError.trend = '📈 INCREASING (watch)';
                else health.tdError.trend = '➡️ STABLE';
            }
            
            health.tdError.recentAvg = parseFloat(
                (recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(6)
            );
        }
        
        // Priority stats
        if (this.priorityHistory.length > 10) {
            const mean = this.priorityHistory.reduce((a, b) => a + b, 0) / this.priorityHistory.length;
            const variance = this.priorityHistory.reduce((s, e) => s + Math.pow(e - mean, 2), 0) / this.priorityHistory.length;
            health.priority.mean = parseFloat(mean.toFixed(4));
            health.priority.std = parseFloat(Math.sqrt(variance).toFixed(4));
        }
        
        // Diversity
        health.diversity.uniqueStates = this.stateHashes.size;
        // Theoretical max states based on 20 buckets and 10 dims = 20^10, log scale
        health.diversity.coverage = Math.min(1, this.stateHashes.size / 100);
        
        // Episode stats
        if (this.episodeRewards.length > 0) {
            const last10 = this.episodeRewards.slice(-10);
            health.episode.avgReward = parseFloat((last10.reduce((a, b) => a + b, 0) / last10.length).toFixed(2));
            health.episode.avgLength = Math.round(this.episodeLengths.slice(-10).reduce((a, b) => a + b, 0) / last10.length);
            health.episode.recentCount = this.episodeRewards.length;
            
            // Reward trend
            if (this.episodeRewards.length >= 20) {
                const recent = this.episodeRewards.slice(-10);
                const older = this.episodeRewards.slice(-20, -10);
                const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
                const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
                if (recentMean > olderMean * 1.1) health.episode.rewardTrend = '📈 IMPROVING';
                else if (recentMean < olderMean * 0.9) health.episode.rewardTrend = '📉 DECLINING';
                else health.episode.rewardTrend = '➡️ STABLE';
            }
        }
        
        // Warnings
        if (health.bufferFill > 0.95) health.warnings.push('⚠️ Buffer nearly full - old experiences being overwritten');
        if (health.actionEntropy < 0.3) health.warnings.push('⚠️ Low action diversity - agent may be stuck');
        if (health.tdError.trend === '📈 INCREASING') health.warnings.push('⚠️ TD error increasing - training may be unstable');
        if (health.diversity.uniqueStates < 20) health.warnings.push('⚠️ Low state diversity - agent seeing same states repeatedly');
        
        // Overall health
        health.isHealthy = health.warnings.length === 0;
        
        return health;
    }
    
    /**
     * Get dashboard data
     */
    getDashboardData() {
        const h = this.getHealth();
        return {
            bufferFill: (h.bufferFill * 100).toFixed(1) + '%',
            actionEntropy: (h.actionEntropy * 100).toFixed(0) + '%',
            tdErrorMean: h.tdError.mean,
            tdErrorTrend: h.tdError.trend,
            tdErrorRecent: h.tdError.recentAvg,
            uniqueStates: h.diversity.uniqueStates,
            avgReward: h.episode.avgReward,
            rewardTrend: h.episode.rewardTrend,
            avgEpisodeLength: h.episode.avgLength,
            isHealthy: h.isHealthy,
            warnings: h.warnings,
            actions: h.actionDistribution,
            priorityStats: h.priority
        };
    }
    
    /**
     * Reset for new session
     */
    reset() {
        this.actionCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
        this.tdErrors = [];
        this.stateHashes.clear();
        this.priorityHistory = [];
        this.episodeRewards = [];
        this.episodeLengths = [];
        this.lastSamples = [];
    }
}

module.exports = { BufferHealth };
