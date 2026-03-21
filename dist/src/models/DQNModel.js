"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DQNModel = void 0;
class DQNModel {
    constructor(config) {
        this.weights = [];
        this.stateSize = config.stateSize;
        this.actionSize = config.actionSize;
        this.learningRate = config.learningRate;
        this._initWeights();
    }
    _initWeights() {
        const layerSizes = [this.stateSize, 256, 128, 64, this.actionSize];
        this.weights = [];
        for (let l = 0; l < layerSizes.length - 1; l++) {
            const layer = [];
            const fanIn = layerSizes[l], fanOut = layerSizes[l + 1];
            const limit = Math.sqrt(6 / (fanIn + fanOut));
            for (let i = 0; i < fanOut; i++) {
                const row = [];
                for (let j = 0; j < fanIn; j++)
                    row.push((Math.random() * 2 - 1) * limit);
                layer.push(row);
            }
            this.weights.push(layer);
        }
    }
    forward(state) {
        let activations = state;
        for (let l = 0; l < this.weights.length; l++) {
            const next = [];
            for (let i = 0; i < this.weights[l].length; i++) {
                let sum = 0;
                for (let j = 0; j < this.weights[l][i].length; j++)
                    sum += this.weights[l][i][j] * activations[j];
                next.push(l < this.weights.length - 1 ? Math.max(0, sum) : sum);
            }
            activations = next;
        }
        return activations;
    }
    train(batch) {
        let totalLoss = 0;
        for (const sample of batch) {
            const predictedQ = this.forward(sample.states);
            let loss = 0;
            for (let a = 0; a < this.actionSize; a++) {
                const diff = predictedQ[a] - sample.targetQ[a];
                loss += diff * diff;
            }
            totalLoss += loss;
            for (let l = 0; l < this.weights.length; l++)
                for (let i = 0; i < this.weights[l].length; i++)
                    for (let j = 0; j < this.weights[l][i].length; j++)
                        this.weights[l][i][j] -= this.learningRate * loss * 0.001;
        }
        return totalLoss / batch.length;
    }
    copyFrom(other) {
        for (let l = 0; l < this.weights.length; l++)
            for (let i = 0; i < this.weights[l].length; i++)
                for (let j = 0; j < this.weights[l][i].length; j++)
                    this.weights[l][i][j] = other.weights[l][i][j];
    }
    exportWeights() { return JSON.stringify(this.weights); }
    importWeights(data) { this.weights = JSON.parse(data); }
    getConfig() { return { stateSize: this.stateSize, actionSize: this.actionSize, learningRate: this.learningRate, useDueling: false }; }
}
exports.DQNModel = DQNModel;
