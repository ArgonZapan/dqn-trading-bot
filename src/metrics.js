/**
 * Metrics - Track performance
 */

class Metrics {
    constructor() {
        this.reset();
    }

    reset() {
        this.trades = 0;
        this.wins = 0;
        this.losses = 0;
        this.startTime = Date.now();
        this.peakBalance = 1000;
        this.currentBalance = 1000;
        this.epsilon = 1.0;
        this.bufferSize = 0;
        this.loss = 0;
    }

    trade(action, price, quantity, pnl) {
        this.trades++;
        if (pnl > 0) this.wins++;
        if (pnl < 0) this.losses++;
        this.currentBalance += pnl || 0;
        if (this.currentBalance > this.peakBalance) this.peakBalance = this.currentBalance;
    }

    update(agentMetrics) {
        if (agentMetrics) {
            this.epsilon = agentMetrics.epsilon || this.epsilon;
            this.bufferSize = agentMetrics.bufferSize || this.bufferSize;
            this.loss = agentMetrics.avgLoss || this.loss;
        }
    }

    uptime() {
        return Date.now() - this.startTime;
    }

    winRate() {
        return this.trades > 0 ? this.wins / this.trades * 100 : 0;
    }

    drawdown() {
        return (this.peakBalance - this.currentBalance) / this.peakBalance * 100;
    }

    summary() {
        return {
            trades: this.trades,
            wins: this.wins,
            losses: this.losses,
            winRate: this.winRate().toFixed(1) + '%',
            balance: '$' + this.currentBalance.toFixed(2),
            peakBalance: '$' + this.peakBalance.toFixed(2),
            drawdown: this.drawdown().toFixed(2) + '%',
            epsilon: this.epsilon.toFixed(3),
            bufferSize: this.bufferSize,
            loss: this.loss?.toFixed(6) || '-',
            uptime: this.uptime() + 'ms'
        };
    }
}

module.exports = new Metrics();
