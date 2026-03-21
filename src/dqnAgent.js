/**
 * DQN Agent with TensorFlow.js
 */
const tf = require('@tensorflow/tfjs');

class DQNAgent {
    constructor(stateSize = 300, actionSize = 3) {
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

    act(state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.actionSize);
        }
        
        return tf.tidy(() => {
            const stateTensor = tf.tensor2d([state]);
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
        
        // Prepare data
        const states = batch.map(e => e.state);
        const nextStates = batch.map(e => e.nextState);
        const actions = batch.map(e => e.action);
        const rewards = batch.map(e => e.reward);
        const dones = batch.map(e => e.done ? 1 : 0);
        
        // Calculate target Q values (outside tidy to avoid async issues)
        const currentQsTensor = this.onlineModel.predict(tf.tensor2d(states));
        const nextQsTensor = this.targetModel.predict(tf.tensor2d(nextStates));
        
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
            tf.tensor2d(states),
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
            const prediction = this.onlineModel.predict(tf.tensor2d([state]));
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

    async save(path = './model') {
        await this.onlineModel.save(`file://${path}`);
        console.log(`💾 Model saved to ${path}`);
    }

    async load(path = './model') {
        this.onlineModel = await tf.loadLayersModel(`file://${path}`);
        this.updateTargetModel();
        console.log(`📂 Model loaded from ${path}`);
    }

    dispose() {
        this.onlineModel.dispose();
        this.targetModel.dispose();
    }
}

module.exports = DQNAgent;
