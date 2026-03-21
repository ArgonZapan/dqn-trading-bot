/**
 * Replay Buffer with Prioritized Experience Replay (PER)
 */
import { Experience } from '../types';
export declare class ReplayBuffer {
    private buffer;
    private priorities;
    private capacity;
    private alpha;
    private beta;
    private betaIncrement;
    private tree;
    private treeSize;
    constructor(capacity?: number);
    push(exp: Experience): void;
    sample(batchSize: number): Experience[];
    update(idx: number, priority: number): void;
    size(): number;
    isReady(batchSize: number): boolean;
    private sampleIndex;
    private getMaxPriority;
    private _propagate;
    clear(): void;
}
