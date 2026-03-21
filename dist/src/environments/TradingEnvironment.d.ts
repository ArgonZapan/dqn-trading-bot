/**
 * Trading Environment - RL environment for trading
 */
import { Candle, Action, State, Indicators } from '../types';
export declare class TradingEnvironment {
    private candles;
    private currentStep;
    private position;
    private entryPrice;
    private trades;
    private capital;
    private btcBalance;
    readonly windowSize: number;
    readonly pair: string;
    constructor(pair?: string, windowSize?: number);
    reset(candles: Candle[]): State;
    getState(): State;
    step(action: Action): {
        state: State;
        reward: number;
        done: boolean;
    };
    calculateIndicators(candles: Candle[]): Indicators;
    private calculateRSI;
    private calculateEMA;
    private calculateMACD;
    private calculateBB;
    private normalizeCandles;
    private getCurrentPrice;
    private getTotalBalance;
    private getTimeSinceLastTrade;
    getTrades(): any[];
    getPosition(): number;
    getBalance(): {
        capital: number;
        btc: number;
        total: number;
    };
}
