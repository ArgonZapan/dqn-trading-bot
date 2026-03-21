/**
 * Replay Buffer with Prioritized Experience Replay (PER)
 */
import { Experience } from '../types';

export class ReplayBuffer {
  private buffer: Experience[] = [];
  private priorities: number[] = [];
  private capacity: number;
  private alpha: number = 0.6;
  private beta: number = 0.4;
  private betaIncrement: number = 0.001;
  private tree: number[] = [];
  private treeSize: number = 0;

  constructor(capacity: number = 50000) {
    this.capacity = capacity;
    this.treeSize = 2 * capacity - 1;
    this.tree = new Array(this.treeSize).fill(0);
  }

  push(exp: Experience): void {
    const priority = exp.priority || this.getMaxPriority();
    if (this.buffer.length < this.capacity) {
      this.buffer.push(exp);
    } else {
      this.buffer[this.buffer.length % this.capacity] = exp;
    }
    this.priorities.push(priority);
    if (this.priorities.length > this.capacity) this.priorities.shift();
    this.update(this.buffer.length - 1, priority);
  }

  sample(batchSize: number): Experience[] {
    const batch: Experience[] = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(this.buffer[this.sampleIndex()]);
    }
    this.beta = Math.min(1, this.beta + this.betaIncrement);
    return batch;
  }

  update(idx: number, priority: number): void {
    this.priorities[idx] = priority;
    const treeIdx = idx + this.capacity - 1;
    const diff = priority - this.tree[treeIdx];
    this.tree[treeIdx] = priority;
    this._propagate(treeIdx, diff);
  }

  size(): number { return this.buffer.length; }
  isReady(batchSize: number): boolean { return this.buffer.length >= batchSize; }

  private sampleIndex(): number {
    let idx = 0;
    let prefixSum = Math.random() * this.tree[0];
    while (idx < this.capacity - 1) {
      const left = 2 * idx + 1;
      if (prefixSum <= this.tree[left]) idx = left;
      else { prefixSum -= this.tree[left]; idx = left + 1; }
    }
    return idx - this.capacity + 1;
  }

  private getMaxPriority(): number { return Math.max(...this.tree.slice(this.capacity - 1), 1); }

  private _propagate(idx: number, diff: number): void {
    while (idx > 0) {
      idx = Math.floor((idx - 1) / 2);
      this.tree[idx] += diff;
    }
  }

  clear(): void { this.buffer = []; this.priorities = []; this.tree = new Array(this.treeSize).fill(0); }
}
