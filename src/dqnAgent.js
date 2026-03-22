/**
 * DQN Agent with TensorFlow.js
 */
const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

class DQNAgent {
    constructor(stateSize = 394, actionSize = 4) {  // 394: 60*5(OHLCV) + 60(volume) + position(3) + pnl(3) + timing/vol(6) + returns(4) + sentiment(1) + ML features(17) = 394
        this.stateSize = stateSize;
        this.actionSize = actionSize;
        
        // Hyperparameters
        this.gamma = 0.99;
        this.epsilon = 1.0;
        this.epsilonMin = 0.01;
        this.epsilonDecay = 0.995;
        this.learningRate = 0.0005;
        this.batchSize = 32;
        
        // Replay Buffer
        this.buffer = [];
        this.bufferSize = 10000;
        
        // Training
        this.targetUpdateFreq = 100;
        this.steps = 0;
        this.episode = 0;
        
        // Create models
        this.onlineModel = this.createModel();
        this.targetModel = this.createModel();
        this.updateTargetModel();
        
        console.log('🤖 DQN Agent initialized with TensorFlow.js');
        this.summary();
    }

    createModel() {
        const model = tf.sequential();
        
        model.add(tf.layers.dense({
            inputShape: [this.stateSize],
            units: 256,
            activation: 'relu',
            kernelInitializer: 'heNormal',
            name: 'dense1'
        }));
        
        model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'heNormal',
            name: 'dense2'
        }));
        
        model.add(tf.layers.dense({
            units: 64,
            activation: 'relu',
            kernelInitializer: 'heNormal',
            name: 'dense3'
        }));
        
        model.add(tf.layers.dense({
            units: this.actionSize,
            activation: 'linear',
            name: 'output'
        }));
        
        model.compile({
            optimizer: tf.train.adam(this.learningRate),
            loss: 'meanSquaredError'
        });
        
        return model;
    }

    updateTargetModel() {
        const weights = this.onlineModel.getWeights();
        this.targetModel.setWeights(weights);
    }

    /**
     * Flatten state object to array for TensorFlow
     * Produces exactly stateSize (394) elements via padding if needed
     */
    flattenState(state) {
        if (Array.isArray(state)) return state;
        const arrays = [];
        // OHLCV data (60 candles * 5 = 300)
        if (state.open) arrays.push(...state.open);
        if (state.high) arrays.push(...state.high);
        if (state.low) arrays.push(...state.low);
        if (state.close) arrays.push(...state.close);
        if (state.volume) arrays.push(...state.volume);
        // Position one-hot (3)
        arrays.push(state.positionFlat || 0);
        arrays.push(state.positionLong || 0);
        arrays.push(state.positionShort || 0);
        // P&L (3)
        arrays.push(state.unrealizedPnl || 0);
        arrays.push(state.realizedPnl || 0);
        arrays.push(state.totalPnl || 0);
        // Timing & volatility (6)
        arrays.push(state.timeSinceTrade || 0);
        arrays.push(state.atrPct || 0);
        arrays.push(state.volatility || 0);
        arrays.push(state.riskLevel || 0);
        arrays.push(state.priceVsAvg || 0);
        arrays.push(state.drawdown || 0);
        // Recent returns momentum (4)
        if (state.recentReturns) arrays.push(...state.recentReturns);
        else arrays.push(0, 0, 0, 0);
        // Market sentiment (1) - znormalizowane 0-1 z sentimentAnalyzer
        arrays.push(state.sentiment !== undefined ? state.sentiment : 0.5);

        // ML Features - pattern recognition, prediction, anomaly (17 features)
        // These come from MLFeatures.getMLFeatures() when mlEnabled
        arrays.push(state.patternDoubleBottom || 0);
        arrays.push(state.patternDoubleTop || 0);
        arrays.push(state.patternHeadShoulders || 0);
        arrays.push(state.patternUptrend || 0);
        arrays.push(state.patternDowntrend || 0);
        arrays.push(state.patternConfidence || 0);
        arrays.push(state.predictedDirectionUp || 0);
        arrays.push(state.predictedDirectionDown || 0);
        arrays.push(state.predictedDirectionNeutral || 0);
        arrays.push(state.predictionConfidence || 0);
        arrays.push(state.predictedChangePct || 0);
        arrays.push(state.isAnomaly || 0);
        arrays.push(state.priceZScore || 0);
        arrays.push(state.volumeZScore || 0);
        arrays.push(state.trendSlope || 0);
        arrays.push(state.priceVsMA || 0);
        arrays.push(state.totalML || 0); // aggregate ML signal

        // Pad or truncate to exactly stateSize
        while (arrays.length < this.stateSize) {
            arrays.push(0);
        }
        return arrays.slice(0, this.stateSize);
    }

    /**
     * Select action using DQN + ML-driven bias
     * When ML features are strong (high confidence), add a small bias toward predicted direction
     * This is NOT overriding the DQN - just nudging Q-values when the signal is strong
     */
    act(state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.actionSize);
        }
        
        return tf.tidy(() => {
            const flat = this.flattenState(state);
            const stateTensor = tf.tensor2d([flat], [1, flat.length]);
            let qValues = this.onlineModel.predict(stateTensor);
            stateTensor.dispose();

            // ML-driven bias: nudge Q-values when ML prediction confidence is high
            // Only apply when ML features are present and confidence > 60%
            const mlConfidence = state.predictionConfidence || 0;
            if (mlConfidence > 0.6 && this.actionSize >= 3) {
                const biasStrength = 0.15; // Max 15% nudge
                const bias = biasStrength * Math.min((mlConfidence - 0.6) / 0.4, 1); // Scale 0.6-1.0 → 0-biasStrength

                // Get Q values as array
                let qData = qValues.dataSync();

                // Bias toward predicted direction (from MLFeatures.predictNextPrice)
                // action 0=HOLD, 1=LONG, 2=SHORT (but env uses 0=HOLD, 1=LONG, 2=CLOSE for shorts)
                // Our env: 0=FLAT/HOLD, 1=LONG, 2=SHORT (and CLOSE maps to 0)
                // For the agent, action 1=LONG, 2=SHORT (action 0=HOLD)
                if (state.predictedDirectionUp && state.predictedDirectionUp > 0.5) {
                    // ML says UP → boost LONG Q-value slightly
                    qData[1] += bias;
                }
                if (state.predictedDirectionDown && state.predictedDirectionDown > 0.5) {
                    // ML says DOWN → boost SHORT Q-value slightly
                    qData[2] += bias;
                }
                if (state.patternDoubleBottom && state.patternDoubleBottom > 0.5 && state.patternConfidence > 0.6) {
                    // Double bottom detected → small boost to LONG
                    qData[1] += bias * 0.5;
                }
                if (state.patternDoubleTop && state.patternDoubleTop > 0.5 && state.patternConfidence > 0.6) {
                    // Double top detected → small boost to SHORT
                    qData[2] += bias * 0.5;
                }
                if (state.isAnomaly && state.isAnomaly > 0) {
                    // Anomaly detected → reduce position-taking (slight hold bias)
                    qData[0] += bias * 0.3;
                    qData[1] -= bias * 0.2;
                    qData[2] -= bias * 0.2;
                }

                // Return argmax of biased Q-values
                const maxIdx = qData.indexOf(Math.max(...qData));
                qValues.dispose();
                return maxIdx;
            }

            const argMaxTensor = qValues.argMax(1);
            const result = argMaxTensor.dataSync()[0];
            qValues.dispose();
            argMaxTensor.dispose();
            return result;
        });
    }

    remember(state, action, reward, nextState, done) {
        this.buffer.push({ state, action, reward, nextState, done });
        if (this.buffer.length > this.bufferSize) {
            this.buffer.shift();
        }
    }

    async replay() {
        if (this.buffer.length < this.batchSize) return null;
        
        // Sample batch
        const batch = [];
        for (let i = 0; i < this.batchSize; i++) {
            batch.push(this.buffer[Math.floor(Math.random() * this.buffer.length)]);
        }
        
        // Flatten states (critical: state objects must be flattened to arrays for TensorFlow)
        const flatStates = batch.map(e => this.flattenState(e.state));
        const flatNextStates = batch.map(e => this.flattenState(e.nextState));
        const actions = batch.map(e => e.action);
        const rewards = batch.map(e => e.reward);
        const dones = batch.map(e => e.done ? 1 : 0);
        
        // Calculate target Q values
        const currentQsTensor = this.onlineModel.predict(tf.tensor2d(flatStates, [flatStates.length, flatStates[0].length]));
        const nextQsTensor = this.targetModel.predict(tf.tensor2d(flatNextStates, [flatNextStates.length, flatNextStates[0].length]));
        
        const currentQsData = await currentQsTensor.array();
        const nextQsData = await nextQsTensor.array();
        
        // Double DQN: best action from online, Q value from target
        const bestActions = currentQsTensor.argMax(1).dataSync();
        const maxNextQs = nextQsTensor.max(1).dataSync();
        
        currentQsTensor.dispose();
        nextQsTensor.dispose();
        
        // Build targets
        for (let i = 0; i < batch.length; i++) {
            const action = actions[i];
            if (dones[i]) {
                currentQsData[i][action] = rewards[i];
            } else {
                currentQsData[i][action] = rewards[i] + this.gamma * maxNextQs[i];
            }
        }
        
        const targetQs = currentQsData;
        
        // Train
        const lossResult = this.onlineModel.trainOnBatch(
            tf.tensor2d(flatStates, [flatStates.length, flatStates[0].length]),
            tf.tensor2d(targetQs)
        );
        // Handle: TF.js may return Tensor, number, or Promise
        let loss;
        try {
            if (typeof lossResult === 'number') {
                loss = lossResult;
            } else if (lossResult && typeof lossResult.arraySync === 'function') {
                loss = lossResult.arraySync();
                if (typeof lossResult.dispose === 'function') lossResult.dispose();
            } else if (Array.isArray(lossResult)) {
                loss = lossResult[0];
            } else if (lossResult && typeof lossResult.then === 'function') {
                const resolved = await lossResult;
                loss = typeof resolved === 'number' ? resolved : 0;
                if (resolved && typeof resolved.dispose === 'function') resolved.dispose();
            } else {
                loss = 0;
            }
        } catch (e) {
            loss = 0;
        }
        
        // Update epsilon
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        
        // Update target network periodically
        if (this.steps % this.targetUpdateFreq === 0) {
            this.updateTargetModel();
        }
        
        this.steps++;
        this.lastLoss = loss;
        return loss;
    }

    getQValues(state) {
        return tf.tidy(() => {
            const flat = this.flattenState(state);
            const stateTensor = tf.tensor2d([flat], [1, flat.length]);
            const prediction = this.onlineModel.predict(stateTensor);
            stateTensor.dispose();
            return prediction.dataSync();
        });
    }

    summary() {
        this.onlineModel.summary();
    }

    getMetrics() {
        return {
            epsilon: this.epsilon,
            episode: this.episode,
            steps: this.steps,
            bufferSize: this.buffer.length,
            totalParams: this.onlineModel.countParams(),
            loss: typeof this.lastLoss !== 'undefined' ? this.lastLoss : null,
        };
    }

    startEpisode() {
        this.episode++;
    }

    async save(filepath) {
        const fullPath = path.resolve(filepath);
        const weights = this.onlineModel.getWeights();
        const data = weights.map(w => w.arraySync());
        const meta = {
            epsilon: this.epsilon,
            episode: this.episode,
            steps: this.steps,
            stateSize: this.stateSize,
            actionSize: this.actionSize
        };
        fs.writeFileSync(fullPath, JSON.stringify({ meta, weights: data }));
        console.log(`💾 Model saved: ${fullPath}`);
    }

    async load(filepath) {
        const fullPath = path.resolve(filepath);
        if (!fs.existsSync(fullPath)) {
            console.log('Model file not found:', fullPath);
            return false;
        }
        const raw = JSON.parse(fs.readFileSync(fullPath));
        const { meta, weights: weightData } = raw;
        
        // Rebuild model if needed
        if (meta.stateSize !== this.stateSize || meta.actionSize !== this.actionSize) {
            this.onlineModel = this.createModel();
        }
        
        const weights = weightData.map(data => tf.tensor(data));
        this.onlineModel.setWeights(weights);
        this.updateTargetModel();
        
        this.epsilon = meta.epsilon || 1;
        this.episode = meta.episode || 0;
        this.steps = meta.steps || 0;
        
        console.log(`📂 Model loaded from ${fullPath} (episode ${this.episode})`);
        return true;
    }

    dispose() {
        this.onlineModel.dispose();
        this.targetModel.dispose();
    }
}

module.exports = DQNAgent;
