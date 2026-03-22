/**
 * DQN Agent with TensorFlow.js
 */
const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

class DQNAgent {
    constructor(stateSize = 313, actionSize = 4) {  // 313: 60*5(OHLCV) + 5(volume) + position features(6) + pnl(5) + volatility(3) + misc(3) + returns(4) + sentiment(1)
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
     * Produces exactly stateSize (300) elements via padding if needed
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
        // Pad or truncate to exactly stateSize
        while (arrays.length < this.stateSize) {
            arrays.push(0);
        }
        return arrays.slice(0, this.stateSize);
    }

    act(state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.actionSize);
        }
        
        return tf.tidy(() => {
            const flat = this.flattenState(state);
            const stateTensor = tf.tensor2d([flat], [1, flat.length]);
            const prediction = this.onlineModel.predict(stateTensor);
            stateTensor.dispose();
            return prediction.argMax(1).dataSync()[0];
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
        const loss = this.onlineModel.trainOnBatch(
            tf.tensor2d(flatStates, [flatStates.length, flatStates[0].length]),
            tf.tensor2d(targetQs)
        );
        
        // Update epsilon
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        
        // Update target network periodically
        if (this.steps % this.targetUpdateFreq === 0) {
            this.updateTargetModel();
        }
        
        this.steps++;
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
            totalParams: this.onlineModel.countParams()
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
