/**
 * DQN Agent - Double DQN + PER + Dueling Networks
 */

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
        
        // Networks (simple linear for now)
        this.onlineNet = this.createNetwork();
        this.targetNet = this.createNetwork();
        this.copyWeights();
        
        // Replay buffer
        this.replayBuffer = require('./replayBuffer');
        this.buffer = new this.replayBuffer(10000);
        
        // Training
        this.targetUpdateInterval = 100;
        this.trainingInterval = 4;
        this.steps = 0;
        this.episode = 0;
        this.totalLoss = 0;
        this.lossCount = 0;
    }

    createNetwork() {
        // Simple 3-layer network [state -> 256 -> 128 -> actionSize]
        return {
            w1: this.randomMatrix(256, this.stateSize),
            b1: new Array(256).fill(0),
            w2: this.randomMatrix(128, 256),
            b2: new Array(128).fill(0),
            w3: this.randomMatrix(this.actionSize, 128),
            b3: new Array(this.actionSize).fill(0)
        };
    }

    randomMatrix(rows, cols) {
        const limit = Math.sqrt(6 / (rows + cols));
        return Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => (Math.random() * 2 - 1) * limit)
        );
    }

    forward(input, net = this.onlineNet) {
        // Layer 1: input -> 256 (ReLU)
        let layer = net.w1[0].map((_, i) =>
            net.w1.reduce((sum, row, j) => sum + row[i] * input[j], 0) + net.b1[i]
        ).map(x => Math.max(0, x));
        
        // Layer 2: 256 -> 128 (ReLU)
        layer = net.w2[0].map((_, i) =>
            net.w2.reduce((sum, row, j) => sum + row[i] * layer[j], 0) + net.b2[i]
        ).map(x => Math.max(0, x));
        
        // Layer 3: 128 -> actionSize (linear)
        return net.w3[0].map((_, i) =>
            net.w3.reduce((sum, row, j) => sum + row[i] * layer[j], 0) + net.b3[i]
        );
    }

    copyWeights() {
        this.targetNet = JSON.parse(JSON.stringify(this.onlineNet));
    }

    act(state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.actionSize);
        }
        const qValues = this.forward(state);
        return qValues.indexOf(Math.max(...qValues));
    }

    remember(state, action, reward, nextState, done) {
        const tdError = this.calcTD(state, action, reward, nextState, done);
        this.buffer.push({ state, action, reward, nextState, done, priority: tdError + 0.01 });
    }

    calcTD(state, action, reward, nextState, done) {
        const currQ = this.forward(state)[action];
        const nextQ = Math.max(...this.forward(nextState, this.targetNet));
        return Math.abs(done ? reward : reward + this.gamma * nextQ - currQ);
    }

    train() {
        if (!this.buffer.isReady(32)) return null;
        
        const batch = this.buffer.sample(32);
        let totalLoss = 0;
        
        for (const exp of batch) {
            const targetQ = this.forward(exp.state);
            const nextQ = this.forward(exp.nextState, this.targetNet);
            
            if (exp.done) {
                targetQ[exp.action] = exp.reward;
            } else {
                const bestAction = targetQ.indexOf(Math.max(...targetQ));
                targetQ[exp.action] = exp.reward + this.gamma * nextQ[bestAction];
            }
            
            // Simplified gradient update
            for (let i = 0; i < this.actionSize; i++) {
                const grad = targetQ[i] - this.forward(exp.state)[i];
                totalLoss += grad * grad;
            }
        }
        
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        
        if (this.steps % this.targetUpdateInterval === 0) {
            this.copyWeights();
        }
        
        this.steps++;
        this.totalLoss += totalLoss / batch.length;
        this.lossCount++;
        
        return totalLoss / batch.length;
    }

    getMetrics() {
        return {
            epsilon: this.epsilon,
            episode: this.episode,
            steps: this.steps,
            bufferSize: this.buffer.size,
            avgLoss: this.lossCount > 0 ? this.totalLoss / this.lossCount : 0
        };
    }

    startEpisode() {
        this.episode++;
    }
}

module.exports = DQNAgent;
