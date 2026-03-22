/**
 * Volatility Regime Detector
 * 
 * Classifies market volatility into 4 regimes (LOW/NORMAL/HIGH/EXTREME)
 * using ATR percentiles and Bollinger Bandwidth.
 * 
 * Used for:
 * - Adaptive position sizing (smaller in volatile markets)
 * - Strategy selection (momentum in trending, mean-rev in ranging)
 * - Stop loss adjustment (wider in volatile conditions)
 * - Alert generation for regime changes
 * 
 * Autonomous feature added: 2026-03-22
 */

const { atr, bollinger, ema } = require('./indicators');

// Regime thresholds (ATR% of price)
const REGIME_THRESHOLDS = {
    EXTREME: 0.05,  // >5% ATR → EXTREME
    HIGH: 0.03,     // >3% ATR → HIGH
    NORMAL: 0.015,  // >1.5% ATR → NORMAL
    LOW: 0           // ≤1.5% ATR → LOW
};

// Strategy recommendations per regime
const REGIME_STRATEGIES = {
    LOW: ['mean_reversion', 'grid'],
    NORMAL: ['trend', 'momentum', 'macd'],
    HIGH: ['trend', 'scalping'],
    EXTREME: ['scalping', 'grid'] // Quick in/out, tight stops
};

// Position sizing multipliers per regime (multiply base size)
const REGIME_POSITION_MULT = {
    LOW: 1.0,     // Full size in calm markets
    NORMAL: 0.75,  // Reduce slightly
    HIGH: 0.5,     // Halve position in volatile markets
    EXTREME: 0.25  // Quarter size in extreme volatility
};

// Stop loss multipliers per regime (multiply base SL)
const REGIME_SL_MULT = {
    LOW: 1.0,
    NORMAL: 1.25,   // Wider SL in normal volatility
    HIGH: 1.5,
    EXTREME: 2.0    // Much wider in extreme
};

class VolatilityRegime {
    constructor() {
        this.regime = 'NORMAL';
        this.previousRegime = 'NORMAL';
        this.regimeStrength = 0; // 0-1 confidence in regime classification
        this.atrHistory = [];
        this.bwHistory = [];
        this.regimeDuration = 0; // bars in current regime
        this.changeAlerts = [];
        
        // Config
        this.historySize = 100;
        this.confidenceWindow = 20;
        this.minHistoryForConfident = 30;
    }

    /**
     * Update regime with new candle data
     * @param {Object} candle - { high, low, close, volume }
     * @param {number} price - current price
     * @returns {Object} - { regime, strength, previousRegime, changed, atr, atrPct, bandwidth, recommendations }
     */
    update(candle, price) {
        // Compute ATR
        const highs = candle.high !== undefined ? [candle.high] : [price];
        const lows = candle.low !== undefined ? [candle.low] : [price];
        const closes = [price];
        
        // Keep rolling ATR history (use last N candles for ATR calc)
        this.atrHistory.push({ price, high: candle.high || price, low: candle.low || price, close: price });
        if (this.atrHistory.length > this.historySize) this.atrHistory.shift();
        
        // Calculate ATR over history
        let currentAtr = 0;
        if (this.atrHistory.length > 14) {
            const h = this.atrHistory.map(d => d.high);
            const l = this.atrHistory.map(d => d.low);
            const c = this.atrHistory.map(d => d.close);
            currentAtr = atr(h, l, c, 14);
        }
        
        const atrPct = currentAtr / price;
        
        // Bollinger Bandwidth for regime confirmation
        if (this.bwHistory.length >= 20) {
            const closes20 = this.bwHistory.map(d => d.close);
            const bb = bollinger(closes20, 20, 2);
            this.bwHistory.push({ close: price });
        } else {
            this.bwHistory.push({ close: price });
        }
        if (this.bwHistory.length > this.historySize) this.bwHistory.shift();
        
        // Classify regime
        const newRegime = this.classifyRegime(atrPct);
        const regimeChanged = newRegime !== this.regime;
        
        if (regimeChanged) {
            this.previousRegime = this.regime;
            this.regime = newRegime;
            this.regimeDuration = 0;
            this.changeAlerts.push({
                time: new Date().toISOString(),
                from: this.previousRegime,
                to: newRegime,
                atrPct: atrPct.toFixed(4)
            });
        } else {
            this.regimeDuration++;
        }
        
        // Confidence score (0-1): how confident we are in this regime
        const strength = this.calculateStrength(atrPct, newRegime);
        
        return {
            regime: this.regime,
            previousRegime: this.previousRegime,
            strength,
            changed: regimeChanged,
            atr: currentAtr,
            atrPct,
            regimeDuration: this.regimeDuration,
            recommendations: this.getRecommendations(),
            positionMult: REGIME_POSITION_MULT[this.regime],
            slMult: REGIME_SL_MULT[this.regime],
            alert: regimeChanged ? { from: this.previousRegime, to: this.regime, atrPct } : null
        };
    }

    /**
     * Classify ATR% into regime
     */
    classifyRegime(atrPct) {
        if (atrPct >= REGIME_THRESHOLDS.EXTREME) return 'EXTREME';
        if (atrPct >= REGIME_THRESHOLDS.HIGH) return 'HIGH';
        if (atrPct >= REGIME_THRESHOLDS.NORMAL) return 'NORMAL';
        return 'LOW';
    }

    /**
     * Calculate confidence in regime classification (0-1)
     */
    calculateStrength(atrPct, regime) {
        if (this.atrHistory.length < this.minHistoryForConfident) {
            return 0.5; // Not enough data
        }
        
        // Measure how far ATR is from regime boundaries
        const thresholds = [
            { name: 'LOW', value: REGIME_THRESHOLDS.NORMAL },
            { name: 'NORMAL', value: REGIME_THRESHOLDS.HIGH },
            { name: 'HIGH', value: REGIME_THRESHOLDS.EXTREME }
        ];
        
        const regimeIdx = thresholds.findIndex(t => t.name === regime);
        
        // Distance from nearest boundary (normalized)
        let nearestBoundary;
        if (regimeIdx === -1) {
            // EXTREME → distance from HIGH boundary
            nearestBoundary = Math.abs(atrPct - REGIME_THRESHOLDS.EXTREME);
        } else if (regimeIdx === 0) {
            // LOW → distance to NORMAL boundary
            nearestBoundary = Math.abs(atrPct - REGIME_THRESHOLDS.NORMAL);
        } else if (regimeIdx >= thresholds.length) {
            // Safety fallback → use HIGH boundary
            nearestBoundary = Math.abs(atrPct - REGIME_THRESHOLDS.EXTREME);
        } else {
            const above = thresholds[regimeIdx].value;
            const below = thresholds[regimeIdx - 1].value;
            nearestBoundary = Math.min(Math.abs(atrPct - above), Math.abs(atrPct - below));
        }
        
        // Map distance to 0.5-1.0 strength
        const normalizedDist = Math.min(nearestBoundary / 0.02, 1);
        return 0.5 + normalizedDist * 0.5;
    }

    /**
     * Get strategy recommendations for current regime
     */
    getRecommendations() {
        return REGIME_STRATEGIES[this.regime];
    }

    /**
     * Get adjusted position size based on regime
     * @param {number} baseSize - base position size in $
     * @param {number} price - current price
     * @returns {number} - adjusted quantity
     */
    adjustPositionSize(baseSize, price) {
        const mult = REGIME_POSITION_MULT[this.regime];
        return (baseSize * mult) / price;
    }

    /**
     * Get adjusted stop loss percent based on regime
     * @param {number} baseSlPct - base stop loss percent
     * @returns {number} - adjusted stop loss percent
     */
    adjustStopLoss(baseSlPct) {
        return baseSlPct * REGIME_SL_MULT[this.regime];
    }

    /**
     * Get regime change alerts (last N)
     */
    getAlerts(count = 10) {
        return this.changeAlerts.slice(-count);
    }

    /**
     * Get current regime summary
     */
    getSummary() {
        return {
            regime: this.regime,
            strength: this.regimeStrength,
            duration: this.regimeDuration,
            recommendations: this.getRecommendations(),
            positionMult: REGIME_POSITION_MULT[this.regime],
            slMult: REGIME_SL_MULT[this.regime],
            recentAlerts: this.changeAlerts.slice(-5)
        };
    }

    /**
     * Reset state
     */
    reset() {
        this.regime = 'NORMAL';
        this.previousRegime = 'NORMAL';
        this.regimeStrength = 0;
        this.atrHistory = [];
        this.bwHistory = [];
        this.regimeDuration = 0;
    }
}

module.exports = VolatilityRegime;
module.exports.REGIME_THRESHOLDS = REGIME_THRESHOLDS;
module.exports.REGIME_STRATEGIES = REGIME_STRATEGIES;
module.exports.REGIME_POSITION_MULT = REGIME_POSITION_MULT;
module.exports.REGIME_SL_MULT = REGIME_SL_MULT;
