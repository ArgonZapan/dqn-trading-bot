"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplayBuffer = void 0;
class ReplayBuffer {
    constructor(capacity = 50000) {
        this.buffer = [];
        this.priorities = [];
        this.alpha = 0.6;
        this.beta = 0.4;
        this.betaIncrement = 0.001;
        this.tree = [];
        this.treeSize = 0;
        this.capacity = capacity;
        this.treeSize = 2 * capacity - 1;
        this.tree = new Array(this.treeSize).fill(0);
    }
    push(exp) {
        const priority = exp.priority || this.getMaxPriority();
        if (this.buffer.length < this.capacity) {
            this.buffer.push(exp);
        }
        else {
            this.buffer[this.buffer.length % this.capacity] = exp;
        }
        this.priorities.push(priority);
        if (this.priorities.length > this.capacity)
            this.priorities.shift();
        this.update(this.buffer.length - 1, priority);
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
    size() { return this.buffer.length; }
    isReady(batchSize) { return this.buffer.length >= batchSize; }
    sampleIndex() {
        let idx = 0;
        let prefixSum = Math.random() * this.tree[0];
        while (idx < this.capacity - 1) {
            const left = 2 * idx + 1;
            if (prefixSum <= this.tree[left])
                idx = left;
            else {
                prefixSum -= this.tree[left];
                idx = left + 1;
            }
        }
        return idx - this.capacity + 1;
    }
    getMaxPriority() { return Math.max(...this.tree.slice(this.capacity - 1), 1); }
    _propagate(idx, diff) {
        while (idx > 0) {
            idx = Math.floor((idx - 1) / 2);
            this.tree[idx] += diff;
        }
    }
    clear() { this.buffer = []; this.priorities = []; this.tree = new Array(this.treeSize).fill(0); }
}
exports.ReplayBuffer = ReplayBuffer;
