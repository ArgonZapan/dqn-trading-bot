class Rebalancer {
    constructor(options = {}) {
        this.enabled = options.enabled || false;
        this.threshold = options.threshold || 0.05; // 5% drift triggers rebalance
        this.positions = {}; // strategy -> {quantity, value, weight}
    }
    
    setPosition(strategy, quantity, price) {
        this.positions[strategy] = { quantity, price, value: quantity * price };
    }
    
    getWeights(totalValue) {
        const weights = {};
        for (const [s, p] of Object.entries(this.positions)) {
            weights[s] = totalValue > 0 ? p.value / totalValue : 0;
        }
        return weights;
    }
    
    needsRebalance(targetWeights, totalValue) {
        const current = this.getWeights(totalValue);
        for (const [s, target] of Object.entries(targetWeights)) {
            const curr = current[s] || 0;
            if (Math.abs(curr - target) > this.threshold) return true;
        }
        return false;
    }
    
    rebalance(targetWeights, totalValue) {
        // Returns list of {strategy, action: 'BUY'|'SELL', quantity}
        const actions = [];
        const current = this.getWeights(totalValue);
        for (const [s, target] of Object.entries(targetWeights)) {
            const curr = current[s] || 0;
            const diff = (target - curr) * totalValue;
            if (Math.abs(diff) > 1) { // >$1 drift
                const price = this.positions[s]?.price || 0;
                if (price > 0) {
                    const qty = Math.abs(diff / price);
                    actions.push({ strategy: s, action: diff > 0 ? 'BUY' : 'SELL', quantity: qty, value: Math.abs(diff) });
                }
            }
        }
        return actions;
    }
    
    getStatus() {
        return { enabled: this.enabled, threshold: this.threshold, positions: this.positions };
    }
}
module.exports = Rebalancer;
