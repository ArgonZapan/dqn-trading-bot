"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DQNAgent = void 0;
const DQNModel_1 = require("../models/DQNModel");
const ReplayBuffer_1 = require("../utils/ReplayBuffer");
class DQNAgent {
    constructor(config = {}) {
        this.steps = 0;
        this.episode = 0;
        this.totalLoss = 0;
        this.lossCount = 0;
        this.config = {
            learningRate: config.learningRate || 0.0005,
            gamma: config.gamma || 0.99,
            epsilonStart: config.epsilonStart || 1.0,
            epsilonEnd: config.epsilonEnd || 0.01,
            epsilonDecay: config.epsilonDecay || 0.9995,
            replayBufferSize: config.replayBufferSize || 50000,
            batchSize: config.batchSize || 64,
            targetUpdateInterval: config.targetUpdateInterval || 1000,
            trainingInterval: config.trainingInterval || 4,
            useDoubleDQN: config.useDoubleDQN ?? true,
            useDuelingNetwork: config.useDuelingNetwork ?? true,
            usePER: config.usePER ?? true
        };
        this.epsilon = this.config.epsilonStart;
        const stateSize = 300 + 8;
        this.onlineNetwork = new DQNModel_1.DQNModel({ stateSize, actionSize: 3, learningRate: this.config.learningRate, useDueling: this.config.useDuelingNetwork });
        this.targetNetwork = new DQNModel_1.DQNModel({ stateSize, actionSize: 3, learningRate: this.config.learningRate, useDueling: this.config.useDuelingNetwork });
        this.replayBuffer = new ReplayBuffer_1.ReplayBuffer(this.config.replayBufferSize);
        this.targetNetwork.copyFrom(this.onlineNetwork);
    }
    selectAction(state) {
        if (Math.random() < this.epsilon)
            return Math.floor(Math.random() * 3);
        const qValues = this.onlineNetwork.forward(this.stateToVector(state));
        let best = 0, maxQ = qValues[0];
        for (let a = 1; a < 3; a++)
            if (qValues[a] > maxQ) {
                maxQ = qValues[a];
                best = a;
            }
        return best;
    }
    store(state, action, reward, nextState, done) {
        const exp = { state, action, reward, nextState, done, priority: this.config.usePER ? this.calcTD(state, action, reward, nextState, done) : undefined };
        this.replayBuffer.push(exp);
    }
    train() {
        if (!this.replayBuffer.isReady(this.config.batchSize))
            return null;
        if (this.steps % this.config.trainingInterval !== 0)
            return null;
        const batch = this.replayBuffer.sample(this.config.batchSize);
        const loss = this._train(batch);
        this.totalLoss += loss;
        this.lossCount++;
        if (this.steps % this.config.targetUpdateInterval === 0)
            this.targetNetwork.copyFrom(this.onlineNetwork);
        this.epsilon = Math.max(this.config.epsilonEnd, this.epsilon * this.config.epsilonDecay);
        this.steps++;
        return loss;
    }
    _train(batch) {
        const samples = [];
        for (const exp of batch) {
            const sq = [...this.onlineNetwork.forward(this.stateToVector(exp.state))];
            const nq = this.targetNetwork.forward(this.stateToVector(exp.nextState));
            if (exp.done)
                sq[exp.action] = exp.reward;
            else {
                const ba = this.config.useDoubleDQN ? sq.indexOf(Math.max(...sq)) : nq.indexOf(Math.max(...nq));
                sq[exp.action] = exp.reward + this.config.gamma * nq[ba];
            }
            samples.push({ states: this.stateToVector(exp.state), targetQ: sq });
        }
        return this.onlineNetwork.train(samples);
    }
    calcTD(state, action, reward, nextState, done) {
        const sq = this.onlineNetwork.forward(this.stateToVector(state));
        const nq = this.targetNetwork.forward(this.stateToVector(nextState));
        const td = done ? reward : reward + this.config.gamma * Math.max(...nq);
        return Math.abs(td - sq[action]) + 0.01;
    }
    stateToVector(state) {
        const vec = [...state.candles];
        vec.push(state.indicators.rsi / 100, state.indicators.macd.value, state.indicators.macd.signal, state.indicators.ema9, state.indicators.ema21, state.indicators.ema50, state.indicators.volumeRatio, state.position, state.unrealizedPnl, state.timeSinceTrade / 1000, state.btcRatio);
        return vec;
    }
    startEpisode() { this.episode++; }
    getMetrics() { return { epsilon: this.epsilon, episode: this.episode, steps: this.steps, bufferSize: this.replayBuffer.size(), avgLoss: this.lossCount > 0 ? this.totalLoss / this.lossCount : 0 }; }
    save(path) { require('fs').writeFileSync(path, JSON.stringify({ weights: this.onlineNetwork.exportWeights(), config: this.config, epsilon: this.epsilon, episode: this.episode, steps: this.steps })); }
    load(path) { const d = JSON.parse(require('fs').readFileSync(path, 'utf-8')); this.onlineNetwork.importWeights(d.weights); this.targetNetwork.copyFrom(this.onlineNetwork); this.epsilon = d.epsilon; this.episode = d.episode; this.steps = d.steps; }
}
exports.DQNAgent = DQNAgent;
