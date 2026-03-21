/**
 * DQN Model - Simple neural network implementation
 */
export interface DQNModelConfig { stateSize: number; actionSize: number; learningRate: number; useDueling: boolean; }

export class DQNModel {
  private stateSize: number;
  private actionSize: number;
  private learningRate: number;
  private weights: number[][][] = [];

  constructor(config: DQNModelConfig) {
    this.stateSize = config.stateSize;
    this.actionSize = config.actionSize;
    this.learningRate = config.learningRate;
    this._initWeights();
  }

  private _initWeights(): void {
    const layerSizes = [this.stateSize, 256, 128, 64, this.actionSize];
    this.weights = [];
    for (let l = 0; l < layerSizes.length - 1; l++) {
      const layer: number[][] = [];
      const fanIn = layerSizes[l], fanOut = layerSizes[l + 1];
      const limit = Math.sqrt(6 / (fanIn + fanOut));
      for (let i = 0; i < fanOut; i++) {
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) row.push((Math.random() * 2 - 1) * limit);
        layer.push(row);
      }
      this.weights.push(layer);
    }
  }

  forward(state: number[]): number[] {
    let activations = state;
    for (let l = 0; l < this.weights.length; l++) {
      const next: number[] = [];
      for (let i = 0; i < this.weights[l].length; i++) {
        let sum = 0;
        for (let j = 0; j < this.weights[l][i].length; j++) sum += this.weights[l][i][j] * activations[j];
        next.push(l < this.weights.length - 1 ? Math.max(0, sum) : sum);
      }
      activations = next;
    }
    return activations;
  }

  train(batch: Array<{ states: number[]; targetQ: number[] }>): number {
    let totalLoss = 0;
    for (const sample of batch) {
      const predictedQ = this.forward(sample.states);
      let loss = 0;
      for (let a = 0; a < this.actionSize; a++) {
        const diff = predictedQ[a] - sample.targetQ[a];
        loss += diff * diff;
      }
      totalLoss += loss;
      for (let l = 0; l < this.weights.length; l++)
        for (let i = 0; i < this.weights[l].length; i++)
          for (let j = 0; j < this.weights[l][i].length; j++)
            this.weights[l][i][j] -= this.learningRate * loss * 0.001;
    }
    return totalLoss / batch.length;
  }

  copyFrom(other: DQNModel): void {
    for (let l = 0; l < this.weights.length; l++)
      for (let i = 0; i < this.weights[l].length; i++)
        for (let j = 0; j < this.weights[l][i].length; j++)
          this.weights[l][i][j] = other.weights[l][i][j];
  }

  exportWeights(): string { return JSON.stringify(this.weights); }
  importWeights(data: string): void { this.weights = JSON.parse(data); }
  getConfig(): DQNModelConfig { return { stateSize: this.stateSize, actionSize: this.actionSize, learningRate: this.learningRate, useDueling: false }; }
}
