/**
 * DQN Agent - Rainbow-lite (Double DQN + PER + Dueling)
 */
import { State, Action, DQNAgentConfig } from '../types';
export declare class DQNAgent {
    private config;
    private onlineNetwork;
    private targetNetwork;
    private replayBuffer;
    private epsilon;
    private steps;
    private episode;
    private totalLoss;
    private lossCount;
    constructor(config?: Partial<DQNAgentConfig>);
    selectAction(state: State): Action;
    store(state: State, action: Action, reward: number, nextState: State, done: boolean): void;
    train(): number | null;
    private _train;
    private calcTD;
    private stateToVector;
    startEpisode(): void;
    getMetrics(): {
        epsilon: number;
        episode: number;
        steps: number;
        bufferSize: number;
        avgLoss: number;
    };
    save(path: string): void;
    load(path: string): void;
}
