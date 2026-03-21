/**
 * DQN Agent - Rainbow-lite (Double DQN + PER + Dueling)
 */
import { State, Action, Experience, DQNAgentConfig } from '../types';
import { DQNModel } from '../models/DQNModel';
import { ReplayBuffer } from '../utils/ReplayBuffer';

export class DQNAgent {
  private config: DQNAgentConfig;
  private onlineNetwork: DQNModel;
  private targetNetwork: DQNModel;
  private replayBuffer: ReplayBuffer;
  private epsilon: number;
  private steps: number = 0;
  private episode: number = 0;
  private totalLoss: number = 0;
  private lossCount: number = 0;

  constructor(config: Partial<DQNAgentConfig> = {}) {
    this.config = {
      learningRate: config.learningRate || 0.0005,
      gamma: config.gamma || 0.99,
      epsilonStart: config.epsilonStart || 1.0,
      epsilonEnd: config.epsilonEnd || 0.01,
      epsilonDecay: config.epsilonDecay || 0.9995,
      replayBufferSize: config.replayBufferSize || 50000,
      batchSize: config.batchSize || 64,
      targetUpdateInterval: config.targetUpdateInterval || 1000,
      trainingInterval: config.trainingInterval || 4,
      useDoubleDQN: config.useDoubleDQN ?? true,
      useDuelingNetwork: config.useDuelingNetwork ?? true,
      usePER: config.usePER ?? true
    };
    this.epsilon = this.config.epsilonStart;
    const stateSize = 300 + 8;
    this.onlineNetwork = new DQNModel({ stateSize, actionSize: 3, learningRate: this.config.learningRate, useDueling: this.config.useDuelingNetwork });
    this.targetNetwork = new DQNModel({ stateSize, actionSize: 3, learningRate: this.config.learningRate, useDueling: this.config.useDuelingNetwork });
    this.replayBuffer = new ReplayBuffer(this.config.replayBufferSize);
    this.targetNetwork.copyFrom(this.onlineNetwork);
  }

  selectAction(state: State): Action {
    if (Math.random() < this.epsilon) return Math.floor(Math.random() * 3) as Action;
    const qValues = this.onlineNetwork.forward(this.stateToVector(state));
    let best: Action = 0, maxQ = qValues[0];
    for (let a = 1; a < 3; a++) if (qValues[a] > maxQ) { maxQ = qValues[a]; best = a as Action; }
    return best;
  }

  store(state: State, action: Action, reward: number, nextState: State, done: boolean): void {
    const exp: Experience = { state, action, reward, nextState, done, priority: this.config.usePER ? this.calcTD(state, action, reward, nextState, done) : undefined };
    this.replayBuffer.push(exp);
  }

  train(): number | null {
    if (!this.replayBuffer.isReady(this.config.batchSize)) return null;
    if (this.steps % this.config.trainingInterval !== 0) return null;
    const batch = this.replayBuffer.sample(this.config.batchSize);
    const loss = this._train(batch);
    this.totalLoss += loss;
    this.lossCount++;
    if (this.steps % this.config.targetUpdateInterval === 0) this.targetNetwork.copyFrom(this.onlineNetwork);
    this.epsilon = Math.max(this.config.epsilonEnd, this.epsilon * this.config.epsilonDecay);
    this.steps++;
    return loss;
  }

  private _train(batch: Experience[]): number {
    const samples: Array<{ states: number[]; targetQ: number[] }> = [];
    for (const exp of batch) {
      const sq = [...this.onlineNetwork.forward(this.stateToVector(exp.state))];
      const nq = this.targetNetwork.forward(this.stateToVector(exp.nextState));
      if (exp.done) sq[exp.action] = exp.reward;
      else {
        const ba = this.config.useDoubleDQN ? sq.indexOf(Math.max(...sq)) : nq.indexOf(Math.max(...nq));
        sq[exp.action] = exp.reward + this.config.gamma * nq[ba];
      }
      samples.push({ states: this.stateToVector(exp.state), targetQ: sq });
    }
    return this.onlineNetwork.train(samples);
  }

  private calcTD(state: State, action: Action, reward: number, nextState: State, done: boolean): number {
    const sq = this.onlineNetwork.forward(this.stateToVector(state));
    const nq = this.targetNetwork.forward(this.stateToVector(nextState));
    const td = done ? reward : reward + this.config.gamma * Math.max(...nq);
    return Math.abs(td - sq[action]) + 0.01;
  }

  private stateToVector(state: State): number[] {
    const vec = [...state.candles];
    vec.push(state.indicators.rsi / 100, state.indicators.macd.value, state.indicators.macd.signal, state.indicators.ema9, state.indicators.ema21, state.indicators.ema50, state.indicators.volumeRatio, state.position, state.unrealizedPnl, state.timeSinceTrade / 1000, state.btcRatio);
    return vec;
  }

  startEpisode(): void { this.episode++; }
  getMetrics() { return { epsilon: this.epsilon, episode: this.episode, steps: this.steps, bufferSize: this.replayBuffer.size(), avgLoss: this.lossCount > 0 ? this.totalLoss / this.lossCount : 0 }; }
  save(path: string): void { require('fs').writeFileSync(path, JSON.stringify({ weights: this.onlineNetwork.exportWeights(), config: this.config, epsilon: this.epsilon, episode: this.episode, steps: this.steps })); }
  load(path: string): void { const d = JSON.parse(require('fs').readFileSync(path, 'utf-8')); this.onlineNetwork.importWeights(d.weights); this.targetNetwork.copyFrom(this.onlineNetwork); this.epsilon = d.epsilon; this.episode = d.episode; this.steps = d.steps; }
}
