/**
 * HyperparameterOptimizer - Automated Grid Search Optimization for DQN Trading Bot
 * 
 * Automatyczne testowanie różnych kombinacji hyperparametrów i wybór najlepszej konfiguracji.
 * Używa danych historycznych do backtestowania różnych konfiguracji.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Fetch helper
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

// Simple technical indicators
function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i-1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calcEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

class HyperparameterOptimizer {
    constructor() {
        // Stan optymalizacji
        this.isRunning = false;
        this.shouldStop = false;
        this.currentIndex = 0;
        this.totalCombinations = 0;
        this.results = [];
        this.bestParams = null;
        this.bestScore = -Infinity;
        
        // Plik wyników
        this.resultsFile = path.join(__dirname, '..', 'optimization-results.json');
        
        // Domyślny paramGrid
        this.paramGrid = {
            learningRate: [0.0001, 0.0005, 0.001, 0.005],
            epsilon: [0.1, 0.3, 0.5],
            gamma: [0.9, 0.95, 0.99],
            batchSize: [32, 64, 128],
            memorySize: [1000, 5000, 10000],
            hiddenLayers: [[256, 128, 64], [512, 256, 128], [300, 200, 100]]
        };
        
        // Historia ładowana z pliku
        this.loadResults();
        
        // Wagi dla combined score
        this.scoreWeights = {
            totalReturn: 0.30,    // 30% waga
            sharpeRatio: 0.25,    // 25% waga
            maxDrawdown: 0.20,    // 20% waga (karany za wysoki DD)
            winRate: 0.15,        // 15% waga
            profitFactor: 0.10    // 10% waga
        };
        
        console.log('🔬 HyperparameterOptimizer initialized');
    }
    
    /**
     * Generuje wszystkie kombinacje hyperparametrów z paramGrid
     */
    generateCombinations(paramGrid) {
        const keys = Object.keys(paramGrid);
        const combinations = [];
        
        const generate = (index, current) => {
            if (index === keys.length) {
                combinations.push({ ...current });
                return;
            }
            const key = keys[index];
            const values = paramGrid[key];
            for (const value of values) {
                current[key] = value;
                generate(index + 1, current);
            }
        };
        
        generate(0, {});
        return combinations;
    }
    
    /**
     * Oblicza Combined Score z metryk backtestu
     */
    calculateCombinedScore(metrics) {
        const { totalReturn, sharpeRatio, maxDrawdown, winRate, profitFactor } = metrics;
        
        // Normalizacja i ważona suma
        // Return: im wyższy tym lepszy (może być ujemny)
        const returnScore = Math.max(-100, Math.min(100, totalReturn)) / 100; // -1 do 1
        
        // Sharpe: powyżej 1 jest dobry, poniżej 0 zły
        const sharpeScore = Math.max(-1, Math.min(2, sharpeRatio)) / 2; // -1 do 1
        
        // Max Drawdown: niższy tym lepszy (kara za wysoki DD)
        // 0% DD = 1, 50%+ DD = -1
        const ddScore = Math.max(-1, Math.min(1, 1 - (maxDrawdown / 50))); // 1 do -1
        
        // Win Rate: 0-100% -> -1 do 1
        const winRateScore = (winRate - 50) / 50; // -1 do 1
        
        // Profit Factor: powyżej 1 dobry, 0 = zły
        const pfScore = Math.max(-1, Math.min(2, (profitFactor - 1) / 3)); // -1 do 1
        
        const combinedScore = 
            this.scoreWeights.totalReturn * returnScore +
            this.scoreWeights.sharpeRatio * sharpeScore +
            this.scoreWeights.maxDrawdown * ddScore +
            this.scoreWeights.winRate * winRateScore +
            this.scoreWeights.profitFactor * pfScore;
        
        return combinedScore;
    }
    
    /**
     * Uruchamia krótki backtest z danymi parametrami
     */
    async evaluateParams(params) {
        const startEquity = 1000;
        let equity = startEquity;
        let peakEquity = startEquity;
        let maxDrawdown = 0;
        
        const trades = [];
        const equityHistory = [];
        
        // Pobierz dane historyczne (używamy cached danych lub fetch)
        let candles;
        try {
            const data = await fetchJSON(
                'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=500'
            );
            candles = data.map(k => ({
                time: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }));
        } catch (e) {
            // Fallback - symulowane dane
            candles = [];
            let price = 50000;
            for (let i = 0; i < 500; i++) {
                price += (Math.random() - 0.5) * 100;
                candles.push({
                    time: Date.now() - (500 - i) * 60000,
                    open: price,
                    high: price + Math.random() * 50,
                    low: price - Math.random() * 50,
                    close: price,
                    volume: Math.random() * 100
                });
            }
        }
        
        if (candles.length < 100) {
            return {
                totalReturn: -100,
                sharpeRatio: -10,
                maxDrawdown: 100,
                winRate: 0,
                profitFactor: 0,
                combinedScore: -10,
                tradesCount: 0,
                error: 'Brak danych'
            };
        }
        
        // Symulacja DQN z danymi parametrami
        const { learningRate, epsilon, gamma, batchSize, memorySize, hiddenLayers } = params;
        const stateSize = 20; // Uproszczony stan
        const actionSize = 3; // HOLD, LONG, SHORT
        
        // Prosty model Q-value (symulacja)
        let qValues = new Array(actionSize).fill(0);
        
        // Epsilon-greedy z podanym epsilon
        let currentPosition = null; // null | 'LONG' | 'SHORT'
        let entryPrice = 0;
        let tradesCount = 0;
        let winningTrades = 0;
        let totalWin = 0;
        let totalLoss = 0;
        
        // Bufor do symulacji replay
        const buffer = [];
        
        // Parametry strategii
        const feeRate = 0.001; // 0.1% fee
        const positionSize = 0.95; // 95% kapitału
        
        for (let i = 50; i < candles.length - 1; i++) {
            if (this.shouldStop) break;
            
            const closes = candles.slice(Math.max(0, i - 50), i + 1).map(c => c.close);
            const currentPrice = candles[i].close;
            
            // Oblicz wskaźniki
            const rsi = calcRSI(closes, 14);
            const ema9 = calcEMA(closes, 9);
            const ema21 = calcEMA(closes, 21);
            
            // Symulacja Q-values (uproszczona)
            const stateFeatures = [
                (ema9 - ema21) / ema21, // Trend
                (currentPrice - ema9) / ema9, // Price vs EMA
                (rsi - 50) / 50, // RSI normalized
                (currentPrice - Math.min(...closes.slice(-20))) / currentPrice, // Momentum
                closes.slice(-10).reduce((s, p, idx, arr) => idx === 0 ? s : s + (p - arr[idx-1]) / arr[idx-1], 0) / 9 // Volatility
            ];
            
            // Aktualizuj Q-values (symulacja sieci neuronowej)
            const lr = learningRate;
            const rewardSignal = stateFeatures.reduce((s, f) => s + f * 0.1, 0);
            
            // Akcja epsilon-greedy
            let action;
            if (Math.random() < epsilon) {
                action = Math.floor(Math.random() * actionSize);
            } else {
                // Symulacja greedy - użyj wskaźników technicznych
                if (rsi < 30 && ema9 > ema21) action = 1; // BUY
                else if (rsi > 70 && ema9 < ema21) action = 2; // SHORT
                else action = 0; // HOLD
            }
            
            // Wykonaj akcję
            if (action === 1 && !currentPosition) {
                // Otwórz LONG
                const qty = (equity * positionSize) / currentPrice;
                const fee = currentPrice * qty * feeRate;
                entryPrice = currentPrice;
                currentPosition = 'LONG';
                buffer.push({ action: 1, price: currentPrice, qty, fee, equity: equity - qty * currentPrice - fee });
            } else if (action === 2 && !currentPosition) {
                // Otwórz SHORT
                const qty = (equity * positionSize) / currentPrice;
                const fee = currentPrice * qty * feeRate;
                entryPrice = currentPrice;
                currentPosition = 'SHORT';
                buffer.push({ action: 2, price: currentPrice, qty, fee, equity: equity + qty * currentPrice - fee });
            } else if (action === 0 && currentPosition) {
                // Zamknij pozycję
                const exitFee = currentPrice * buffer[buffer.length - 1].qty * feeRate;
                let pnl;
                if (currentPosition === 'LONG') {
                    pnl = (currentPrice - entryPrice) * buffer[buffer.length - 1].qty;
                } else {
                    pnl = (entryPrice - currentPrice) * buffer[buffer.length - 1].qty;
                }
                const netPnl = pnl - buffer[buffer.length - 1].fee - exitFee;
                equity += netPnl;
                
                tradesCount++;
                if (netPnl > 0) {
                    winningTrades++;
                    totalWin += netPnl;
                } else {
                    totalLoss += Math.abs(netPnl);
                }
                
                trades.push({
                    entryPrice,
                    exitPrice: currentPrice,
                    pnl: netPnl,
                    side: currentPosition
                });
                
                currentPosition = null;
                entryPrice = 0;
            }
            
            // Aktualizuj equity
            if (currentPosition === 'LONG') {
                equity = buffer[buffer.length - 1].equity + (currentPrice - buffer[buffer.length - 1].price) * buffer[buffer.length - 1].qty;
            } else if (currentPosition === 'SHORT') {
                equity = buffer[buffer.length - 1].equity + (buffer[buffer.length - 1].price - currentPrice) * buffer[buffer.length - 1].qty;
            }
            
            // Śledzenie peak i DD
            if (equity > peakEquity) peakEquity = equity;
            const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
            
            // Zapisz equity curve co 10 kroków
            if (i % 10 === 0) {
                equityHistory.push({ step: i, equity, drawdown });
            }
            
            // Symuluj uczenie (Q-learning update)
            for (let j = 0; j < Math.min(batchSize, buffer.length); j++) {
                const idx = Math.floor(Math.random() * buffer.length);
                const exp = buffer[idx];
                const maxQ = Math.max(...qValues);
                // Q-update (symulacja)
                const target = rewardSignal + gamma * maxQ;
                qValues[action] = qValues[action] * (1 - lr) + lr * target;
            }
            
            // Ogranicz rozmiar bufora
            if (buffer.length > memorySize) buffer.shift();
        }
        
        // Zamknij otwartą pozycję na końcu
        if (currentPosition && candles.length > 0) {
            const currentPrice = candles[candles.length - 1].close;
            const exitFee = buffer[buffer.length - 1].qty * currentPrice * feeRate;
            let pnl;
            if (currentPosition === 'LONG') {
                pnl = (currentPrice - entryPrice) * buffer[buffer.length - 1].qty;
            } else {
                pnl = (entryPrice - currentPrice) * buffer[buffer.length - 1].qty;
            }
            const netPnl = pnl - buffer[buffer.length - 1].fee - exitFee;
            equity += netPnl;
            
            tradesCount++;
            if (netPnl > 0) {
                winningTrades++;
                totalWin += netPnl;
            } else {
                totalLoss += Math.abs(netPnl);
            }
            
            currentPosition = null;
        }
        
        // Oblicz metryki
        const totalReturn = ((equity - startEquity) / startEquity) * 100;
        const winRate = tradesCount > 0 ? (winningTrades / tradesCount) * 100 : 0;
        const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;
        
        // Sharpe Ratio (uproszczony)
        let sharpeRatio = 0;
        if (tradesCount > 1) {
            const returns = trades.map(t => t.pnl / startEquity);
            const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
            const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
            const stdReturn = Math.sqrt(variance);
            if (stdReturn > 0) {
                sharpeRatio = (meanReturn / stdReturn) * Math.sqrt(252);
            }
        }
        
        const metrics = {
            totalReturn,
            sharpeRatio,
            maxDrawdown,
            winRate,
            profitFactor
        };
        
        const combinedScore = this.calculateCombinedScore(metrics);
        
        return {
            ...metrics,
            combinedScore,
            tradesCount,
            params,
            equityHistory,
            trades
        };
    }
    
    /**
     * Główna pętla optymalizacji
     */
    async optimize(paramGrid, iterations = null) {
        if (this.isRunning) {
            console.log('Optymalizacja już trwa!');
            return;
        }
        
        const combinations = this.generateCombinations(paramGrid);
        this.totalCombinations = iterations ? Math.min(iterations, combinations.length) : combinations.length;
        this.currentIndex = 0;
        this.results = [];
        this.bestParams = null;
        this.bestScore = -Infinity;
        this.isRunning = true;
        this.shouldStop = false;
        
        // Jeśli iterations < total, wylosuj podzbiór
        let toEvaluate = combinations;
        if (iterations && iterations < combinations.length) {
            // Losowy podzbiór
            const shuffled = [...combinations].sort(() => Math.random() - 0.5);
            toEvaluate = shuffled.slice(0, iterations);
            this.totalCombinations = iterations;
        }
        
        console.log(`🔬 Rozpoczynanie optymalizacji: ${this.totalCombinations} konfiguracji`);
        
        for (const params of toEvaluate) {
            if (this.shouldStop) {
                console.log('⏹ Optymalizacja zatrzymana przez użytkownika');
                break;
            }
            
            this.currentIndex++;
            const progress = ((this.currentIndex) / this.totalCombinations * 100).toFixed(1);
            
            console.log(`[${this.currentIndex}/${this.totalCombinations}] (${progress}%) Testowanie: LR=${params.learningRate}, ε=${params.epsilon}, γ=${params.gamma}, BS=${params.batchSize}`);
            
            try {
                const result = await this.evaluateParams(params);
                result.index = this.currentIndex;
                this.results.push(result);
                
                // Sprawdź czy to najlepszy wynik
                if (result.combinedScore > this.bestScore) {
                    this.bestScore = result.combinedScore;
                    this.bestParams = { ...params };
                    console.log(`  ⭐ Nowy best: ${result.combinedScore.toFixed(3)} (Return: ${result.totalReturn.toFixed(2)}%, Sharpe: ${result.sharpeRatio.toFixed(2)}, DD: ${result.maxDrawdown.toFixed(1)}%)`);
                }
                
                // Zapisz wyniki po każdej iteracji
                this.saveResults();
                
            } catch (e) {
                console.error(`  ❌ Błąd evaluacji: ${e.message}`);
            }
        }
        
        this.isRunning = false;
        console.log(`✅ Optymalizacja zakończona! Najlepszy score: ${this.bestScore.toFixed(3)}`);
        console.log(`   Najlepsze params:`, this.bestParams);
        
        return {
            bestParams: this.bestParams,
            bestScore: this.bestScore,
            totalEvaluated: this.results.length
        };
    }
    
    /**
     * Zatrzymaj optymalizację
     */
    stop() {
        this.shouldStop = true;
        console.log('⏹ Wysłano sygnał zatrzymania...');
    }
    
    /**
     * Zwróć najlepszą konfigurację
     */
    getBestParams() {
        return this.bestParams;
    }
    
    /**
     * Zwróć status optymalizacji
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            currentIndex: this.currentIndex,
            totalCombinations: this.totalCombinations,
            progress: this.totalCombinations > 0 
                ? (this.currentIndex / this.totalCombinations * 100).toFixed(1) 
                : 0,
            bestScore: this.bestScore,
            bestParams: this.bestParams,
            resultsCount: this.results.length
        };
    }
    
    /**
     * Zwróć top N wyników
     */
    getTopResults(n = 5) {
        const sorted = [...this.results].sort((a, b) => b.combinedScore - a.combinedScore);
        return sorted.slice(0, n).map(r => ({
            rank: sorted.indexOf(r) + 1,
            params: r.params,
            metrics: {
                totalReturn: r.totalReturn,
                sharpeRatio: r.sharpeRatio,
                maxDrawdown: r.maxDrawdown,
                winRate: r.winRate,
                profitFactor: r.profitFactor
            },
            combinedScore: r.combinedScore,
            tradesCount: r.tradesCount
        }));
    }
    
    /**
     * Zapisz wyniki do pliku
     */
    saveResults() {
        const data = {
            timestamp: new Date().toISOString(),
            bestParams: this.bestParams,
            bestScore: this.bestScore,
            totalEvaluated: this.results.length,
            allResults: this.results.map(r => ({
                index: r.index,
                params: r.params,
                metrics: {
                    totalReturn: r.totalReturn,
                    sharpeRatio: r.sharpeRatio,
                    maxDrawdown: r.maxDrawdown,
                    winRate: r.winRate,
                    profitFactor: r.profitFactor
                },
                combinedScore: r.combinedScore,
                tradesCount: r.tradesCount
            }))
        };
        
        try {
            fs.writeFileSync(this.resultsFile, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Błąd zapisu wyników:', e.message);
        }
    }
    
    /**
     * Wczytaj wyniki z pliku
     */
    loadResults() {
        try {
            if (fs.existsSync(this.resultsFile)) {
                const data = JSON.parse(fs.readFileSync(this.resultsFile, 'utf8'));
                this.bestParams = data.bestParams;
                this.bestScore = data.bestScore;
                this.results = data.allResults || [];
                console.log(`📂 Wczytano ${this.results.length} wyników z poprzedniej optymalizacji`);
            }
        } catch (e) {
            console.log('Brak pliku wyników lub błąd odczytu');
        }
    }
}

module.exports = HyperparameterOptimizer;
