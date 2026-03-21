/**
 * DQN Model - Simple neural network implementation
 */
export interface DQNModelConfig {
    stateSize: number;
    actionSize: number;
    learningRate: number;
    useDueling: boolean;
}
export declare class DQNModel {
    private stateSize;
    private actionSize;
    private learningRate;
    private weights;
    constructor(config: DQNModelConfig);
    private _initWeights;
    forward(state: number[]): number[];
    train(batch: Array<{
        states: number[];
        targetQ: number[];
    }>): number;
    copyFrom(other: DQNModel): void;
    exportWeights(): string;
    importWeights(data: string): void;
    getConfig(): DQNModelConfig;
}
