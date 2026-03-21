/**
 * Replay Buffer for DQN Agent
 */

class ReplayBuffer {
    constructor(capacity = 10000) {
        this.capacity = capacity;
        this.buffer = [];
        this.priorities = new Float32Array(capacity);
        this.alpha = 0.6;
        this.beta = 0.4;
        this.betaIncrement = 0.001;
        this.tree = new Array(2 * capacity).fill(0);
        this.size = 0;
    }

    push(exp) {
        const priority = exp.priority || this.getMaxPriority();
        
        if (this.buffer.length < this.capacity) {
            this.buffer.push(exp);
        } else {
            this.buffer[this.size % this.capacity] = exp;
        }
        
        this.priorities[this.size % this.capacity] = priority;
        this.update(this.size % this.capacity, priority);
        this.size++;
    }

    sample(batchSize) {
        const batch = [];
        for (let i = 0; i < batchSize; i++) {
            batch.push(this.buffer[this.sampleIndex()]);
        }
        this.beta = Math.min(1, this.beta + this.betaIncrement);
        return batch;
    }

    update(idx, priority) {
        this.priorities[idx] = priority;
        const treeIdx = idx + this.capacity - 1;
        const diff = priority - this.tree[treeIdx];
        this.tree[treeIdx] = priority;
        this._propagate(treeIdx, diff);
    }

    sampleIndex() {
        let idx = 0;
        let prefixSum = Math.random() * this.tree[0];
        for (; idx < this.capacity - 1;) {
            const left = 2 * idx + 1;
            if (prefixSum <= this.tree[left]) {
                idx = left;
            } else {
                prefixSum -= this.tree[left];
                idx = left + 1;
            }
        }
        return idx - this.capacity + 1;
    }

    getMaxPriority() {
        return Math.max(...this.tree.slice(this.capacity - 1), 1);
    }

    _propagate(idx, diff) {
        while (idx > 0) {
            idx = Math.floor((idx - 1) / 2);
            this.tree[idx] += diff;
        }
    }

    isReady(batchSize) {
        return this.buffer.length >= batchSize;
    }
}

module.exports = ReplayBuffer;
