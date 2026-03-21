export declare class BinanceClient {
    private priceCallbacks;
    private pollInterval;
    getPrice(symbol?: string): Promise<number>;
    getKlines(symbol?: string, interval?: string, limit?: number): Promise<any[]>;
    get24hr(symbol?: string): Promise<{
        priceChange: number;
        priceChangePercent: number;
        volume: number;
    }>;
    startPriceUpdates(symbol?: string, intervalMs?: number): void;
    stopPriceUpdates(): void;
    onPrice(cb: (price: number) => void): () => void;
    getBalances(): Promise<{
        asset: string;
        free: number;
        locked: number;
    }[]>;
}
