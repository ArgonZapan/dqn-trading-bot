import { BacktestResult } from '../src/types';
export declare function runBacktest(pair: string, episodes?: number, startDate?: string, endDate?: string): Promise<BacktestResult>;
