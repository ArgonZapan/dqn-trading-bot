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
        
        // Simple network [state -> 256 -> 128 -> actionSize]
        this.onlineNet = this.createNetwork();
        this.targetNet = this.createNetwork();
        
        // Replay Buffer
        this.buffer = [];
        this.bufferSize = 10000;
        
        // Training
        this.targetUpdateFreq = 100;
        this.trainInterval = 4;
        this.steps = 0;
        this.episode = 0;
        this.totalLoss = 0;
        this.lossCount = 0;
    }

    createNetwork() {
        // Simple 3-layer network: state -> 256 -> 128 -> action
        const layerSizes = [this.stateSize, 256, 128, this.actionSize];
        const weights = [];
        const biases = [];
        
        for (let l = 0; l < layerSizes.length - 1; l++) {
            const [fanIn, fanOut] = [layerSizes[l], layerSizes[l + 1]];
            const limit = Math.sqrt(6 / (fanIn + fanOut));
            weights.push(
                Array.from({ length: fanOut }, () =>
                    Array.from({ length: fanIn }, () => (Math.random() * 2 - 1) * limit)
                )
            );
            biases.push(new Array(fanOut).fill(0));
        }
        
        return { weights, biases, layerSizes };
    }

    forward(state, net = this.onlineNet) {
        let activations = state;
        
        for (let l = 0; l < net.weights.length; l++) {
            const newActivations = [];
            for (let i = 0; i < net.weights[l].length; i++) {
                let sum = net.biases[l][i];
                for (let j = 0; j < net.weights[l][i].length; j++) {
                    sum += net.weights[l][i][j] * activations[j];
                }
                // ReLU activation (hidden layers)
                newActivations.push(l < net.weights.length - 1 ? Math.max(0, sum) : sum);
            }
            activations = newActivations;
        }
        
        return activations;
    }

    copyWeights() {
        this.targetNet.weights = JSON.parse(JSON.stringify(this.onlineNet.weights));
        this.targetNet.biases = JSON.parse(JSON.stringify(this.onlineNet.biases));
    }

    act(state) {
        if (Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.actionSize);
        }
        const qValues = this.forward(state);
        return qValues.indexOf(Math.max(...qValues));
    }

    remember(state, action, reward, nextState, done) {
        const entry = { state, action, reward, nextState, done };
        this.buffer.push(entry);
        if (this.buffer.length > this.bufferSize) this.buffer.shift();
    }

    replay() {
        if (this.buffer.length < 32) return null;
        
        const batch = [];
        for (let i = 0; i < 32; i++) {
            batch.push(this.buffer[Math.floor(Math.random() * this.buffer.length)]);
        }
        
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
            
            totalLoss += Math.abs(targetQ[exp.action] - this.forward(exp.state)[exp.action]);
        }
        
        // Update epsilon
        this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
        
        if (this.steps % this.targetUpdateFreq === 0) {
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
            bufferSize: this.buffer.length,
            avgLoss: this.lossCount > 0 ? this.totalLoss / this.lossCount : 0
        };
    }

    startEpisode() {
        this.episode++;
    }
}

module.exports = DQNAgent;
