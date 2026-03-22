/**
 * Scalping Strategy - DQN Trading Bot
 * Strategia krótkoterminowa - szybkie kupno i sprzedaż na małych zmianach cenowych.
 * Zyski z wielu małych ruchów cenowych (minuty do godzin).
 */

class ScalpingStrategy {
    constructor() {
        // === PARAMETRY STRATEGII ===
        
        /** Cel zysku w % (domyślnie 0.5%) */
        this.SCALP_PROFIT_TARGET = 0.5;
        
        /** Stop loss w % (domyślnie 0.3%) */
        this.SCALP_STOP_LOSS = 0.3;
        
        /** Timeframe w sekundach (domyślnie 60 = 1 minuta) */
        this.SCALP_TIMEFRAME = 60;
        
        /** Minimalny wolumen do wejścia (wielokrotność średniej) */
        this.SCALP_MIN_VOLUME = 1.5;
        
        /** Próg momentum do wejścia (0-100, domyślnie 60) */
        this.SCALP_MOMENTUM_THRESHOLD = 60;
        
        /** Maksymalny czas trzymania pozycji w sekundach (domyślnie 15 min) */
        this.SCALP_MAX_HOLD_TIME = 900;
        
        /** Fee giełdowy (Binance 0.1%) */
        this.fee = 0.001;
        
        // === STAN WEWNĘTRZNY ===
        this.position = 0;          // 0 = brak pozycji, 1 = long
        this.entryPrice = 0;
        this.entryTime = 0;
        this.entryVolume = 0;
        this.prevMomentum = 50;
    }

    /**
     * Szybka analiza price action
     * @param {Array} prices - Tablica cen (ostatnie N candle)
     * @param {Object} indicators - Obiekt z indicatorami {rsi, macd, ema5, ema21, volume}
     * @returns {Object} - Wynik analizy {momentum, trend, volumeSignal}
     */
    analyzePriceAction(prices, indicators) {
        if (!prices || prices.length < 5) {
            return { momentum: 50, trend: 'neutral', volumeSignal: false };
        }

        const currentPrice = prices[prices.length - 1];
        const prevPrice = prices[prices.length - 2];
        
        // Oblicz momentum (zmiana ceny %)
        const priceChange = ((currentPrice - prevPrice) / prevPrice) * 100;
        const momentum = 50 + (priceChange * 10); // Skala 0-100, 50 = neutralne
        
        // Określ trend na podstawie EMA
        let trend = 'neutral';
        if (indicators.ema5 && indicators.ema21) {
            if (indicators.ema5 > indicators.ema21 * 1.001) {
                trend = 'bullish';
            } else if (indicators.ema5 < indicators.ema21 * 0.999) {
                trend = 'bearish';
            }
        }
        
        // Sygnał wolumenu (current vs średnia)
        let volumeSignal = false;
        if (indicators.volume && indicators.avgVolume) {
            volumeSignal = indicators.volume > indicators.avgVolume * this.SCALP_MIN_VOLUME;
        }
        
        return {
            momentum: Math.max(0, Math.min(100, momentum)),
            trend,
            volumeSignal,
            priceChange
        };
    }

    /**
     * Sprawdza czy powinien kupić
     * @param {number} price - Aktualna cena
     * @param {number} momentum - Momentum (0-100)
     * @param {number} volume - Aktualny wolumen
     * @param {Object} indicators - Dodatkowe wskaźniki
     * @returns {boolean} - true jeśli sygnał kupna
     */
    shouldBuy(price, momentum, volume, indicators = {}) {
        // Nie kupuj jeśli już mamy pozycję
        if (this.position === 1) return false;
        
        // Sprawdź czy momentum przekracza próg
        const momentumOk = momentum > this.SCALP_MOMENTUM_THRESHOLD;
        
        // Sprawdź czy wolumen rośnie
        const volumeOk = indicators.volume > (indicators.avgVolume || 0) * this.SCALP_MIN_VOLUME;
        
        // Dodatkowe filtry RSI
        const rsiOk = !indicators.rsi || (indicators.rsi < 65 && indicators.rsi > 30);
        
        // EMA crossover (EMA5 > EMA21)
        const emaCrossUp = indicators.ema5 && indicators.ema21 && 
                          indicators.ema5 > indicators.ema21;
        
        // Kierunek ceny (musi iść w górę)
        const priceDirection = indicators.priceChange > 0;
        
        // BUY: momentum + volume + EMA bullish
        if (momentumOk && volumeOk && rsiOk && priceDirection) {
            return true;
        }
        
        // Oversold bounce - szybki trade przy głębokim oversold
        if (indicators.rsi && indicators.rsi < 25) {
            return true;
        }
        
        return false;
    }

    /**
     * Sprawdza czy powinien sprzedać
     * @param {number} price - Aktualna cena
     * @param {number} profit - Zysk w % od wejścia
     * @param {number} momentum - Momentum (0-100)
     * @param {Object} indicators - Dodatkowe wskaźniki
     * @returns {Object} - {shouldSell, reason}
     */
    shouldSell(price, profit, momentum, indicators = {}) {
        if (this.position !== 1 || this.entryPrice === 0) {
            return { shouldSell: false, reason: null };
        }

        const currentTime = Date.now() / 1000;
        const holdTime = currentTime - this.entryTime;
        
        // === SYGNAŁY WYJŚCIA ===
        
        // 1. Take Profit - osiągnięto cel zysku
        if (profit >= this.SCALP_PROFIT_TARGET) {
            return { shouldSell: true, reason: 'TAKE_PROFIT' };
        }
        
        // 2. Stop Loss - strata zbyt duża
        if (profit <= -this.SCALP_STOP_LOSS) {
            return { shouldSell: true, reason: 'STOP_LOSS' };
        }
        
        // 3. Maximum hold time - nie trzymaj overnight
        if (holdTime >= this.SCALP_MAX_HOLD_TIME) {
            return { shouldSell: true, reason: 'MAX_HOLD_TIME' };
        }
        
        // 4. Fast exit - momentum odwraca (momentum spada poniżej 50)
        if (momentum < 45 && profit > 0) {
            return { shouldSell: true, reason: 'MOMENTUM_REVERSAL' };
        }
        
        // 5. RSI overbought + negative momentum
        if (indicators.rsi && indicators.rsi > 70 && momentum < 50) {
            return { shouldSell: true, reason: 'RSI_OVERBOUGHT' };
        }
        
        // 6. EMA cross down (EMA5 < EMA21) z zyskiem
        if (indicators.ema5 && indicators.ema21 && 
            indicators.ema5 < indicators.ema21 && profit > 0) {
            return { shouldSell: true, reason: 'EMA_CROSS_DOWN' };
        }
        
        return { shouldSell: false, reason: null };
    }

    /**
     * Główna metoda decyzyjna - zwraca akcję
     * @param {Object} state - Stan rynku
     * @returns {number} - 0=HOLD, 1=BUY, 2=SELL
     */
    getAction(state) {
        const { price, prices, indicators, position, entryPrice, entryTime, volume } = state;
        
        this.position = position || 0;
        this.entryPrice = entryPrice || 0;
        this.entryTime = entryTime || 0;
        
        // Analiza price action
        const analysis = this.analyzePriceAction(prices, indicators);
        const momentum = analysis.momentum;
        
        // Oblicz aktualny zysk/stratę
        let profit = 0;
        if (this.position === 1 && this.entryPrice > 0) {
            profit = ((price - this.entryPrice) / this.entryPrice) * 100;
        }
        
        // === SPRAWDŹ SPRZEDAŻ ===
        if (this.position === 1) {
            const sellSignal = this.shouldSell(price, profit, momentum, {
                ...indicators,
                priceChange: analysis.priceChange
            });
            
            if (sellSignal.shouldSell) {
                console.log(`[SCALP] SELL signal: ${sellSignal.reason} | profit: ${profit.toFixed(2)}%`);
                return 2; // SELL
            }
        }
        
        // === SPRAWDŹ KUPNO ===
        if (this.position === 0) {
            const buySignal = this.shouldBuy(price, momentum, volume, {
                ...indicators,
                priceChange: analysis.priceChange,
                avgVolume: indicators.avgVolume || (volume * 0.7)
            });
            
            if (buySignal) {
                console.log(`[SCALP] BUY signal | momentum: ${momentum.toFixed(1)} | price: ${price}`);
                return 1; // BUY
            }
        }
        
        return 0; // HOLD
    }

    /**
     * Zapisz parametry z config
     * @param {Object} params - Parametry {profitTarget, stopLoss, timeframe, minVolume, momentumThreshold, maxHoldTime}
     */
    setParams(params) {
        if (params.profitTarget !== undefined) this.SCALP_PROFIT_TARGET = params.profitTarget;
        if (params.stopLoss !== undefined) this.SCALP_STOP_LOSS = params.stopLoss;
        if (params.timeframe !== undefined) this.SCALP_TIMEFRAME = params.timeframe;
        if (params.minVolume !== undefined) this.SCALP_MIN_VOLUME = params.minVolume;
        if (params.momentumThreshold !== undefined) this.SCALP_MOMENTUM_THRESHOLD = params.momentumThreshold;
        if (params.maxHoldTime !== undefined) this.SCALP_MAX_HOLD_TIME = params.maxHoldTime;
    }

    /**
     * Pobierz aktualne parametry
     * @returns {Object}
     */
    getParams() {
        return {
            profitTarget: this.SCALP_PROFIT_TARGET,
            stopLoss: this.SCALP_STOP_LOSS,
            timeframe: this.SCALP_TIMEFRAME,
            minVolume: this.SCALP_MIN_VOLUME,
            momentumThreshold: this.SCALP_MOMENTUM_THRESHOLD,
            maxHoldTime: this.SCALP_MAX_HOLD_TIME
        };
    }

    /**
     * Reset stanu strategii
     */
    reset() {
        this.position = 0;
        this.entryPrice = 0;
        this.entryTime = 0;
        this.entryVolume = 0;
        this.prevMomentum = 50;
    }
}

/**
 * Backtest Scalping Strategy
 * @param {Array} data - Dane cenowe (candle z close, high, low, open, volume, time)
 * @param {Object} params - Parametry backtestu
 * @returns {Object} - Wyniki: tradesCount, avgProfit, maxDrawdown, winRate, profitFactor
 */
function backtestScalpingStrategy(data, params = {}) {
    const profitTarget = params.profitTarget || 0.5;    // %
    const stopLoss = params.stopLoss || 0.3;             // %
    const minVolume = params.minVolume || 1.5;           // wielokrotność średniej
    const momentumThreshold = params.momentumThreshold || 60;
    const maxHoldTime = params.maxHoldTime || 900;      // 15 min
    const initialBalance = params.initialBalance || 1000;
    
    if (!data || data.length < 30) {
        return {
            error: 'Insufficient data (need at least 30 candles)',
            tradesCount: 0,
            avgProfit: 0,
            maxDrawdown: 0,
            winRate: 0,
            profitFactor: 0
        };
    }
    
    const strategy = new ScalpingStrategy();
    strategy.SCALP_PROFIT_TARGET = profitTarget;
    strategy.SCALP_STOP_LOSS = stopLoss;
    strategy.SCALP_MIN_VOLUME = minVolume;
    strategy.SCALP_MOMENTUM_THRESHOLD = momentumThreshold;
    strategy.SCALP_MAX_HOLD_TIME = maxHoldTime;
    
    let capital = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let entryTime = 0;
    let trades = [];
    let equityCurve = [];
    let peakEquity = initialBalance;
    let maxDrawdown = 0;
    
    // Oblicz średni wolumen
    const avgVolume = data.slice(0, 20).reduce((sum, d) => sum + (d.volume || 0), 0) / 20;
    
    for (let i = 20; i < data.length - 1; i++) {
        const currentCandle = data[i];
        const price = currentCandle.close;
        
        // Oblicz wskaźniki
        const closes = data.slice(Math.max(0, i - 20), i + 1).map(d => d.close);
        const volumes = data.slice(Math.max(0, i - 20), i + 1).map(d => d.volume || 0);
        
        // EMA 5 i 21
        const ema5 = calcEMA(closes.slice(-5), 5);
        const ema21 = calcEMA(closes, 21);
        
        // RSI (9-period)
        const rsi = calcRSI(closes, 9);
        
        // Momentum
        const priceChange = ((price - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
        const momentum = 50 + (priceChange * 10);
        
        // Analiza
        const analysis = strategy.analyzePriceAction(closes, { ema5, ema21, rsi, volume: currentCandle.volume, avgVolume });
        
        // Oblicz zysk
        let profit = 0;
        if (position === 1 && entryPrice > 0) {
            profit = ((price - entryPrice) / entryPrice) * 100;
        }
        
        // === SPRAWDŹ SPRZEDAŻ ===
        if (position === 1) {
            const holdTime = (currentCandle.time || i * 60) - entryTime;
            
            // Take Profit
            if (profit >= profitTarget) {
                const fees = price * (capital / entryPrice) * strategy.fee;
                capital += (price - entryPrice) * (capital / entryPrice) - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    profit,
                    reason: 'TAKE_PROFIT',
                    holdTime
                });
                position = 0;
                entryPrice = 0;
            }
            // Stop Loss
            else if (profit <= -stopLoss) {
                const fees = price * (capital / entryPrice) * strategy.fee;
                capital += (price - entryPrice) * (capital / entryPrice) - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    profit,
                    reason: 'STOP_LOSS',
                    holdTime
                });
                position = 0;
                entryPrice = 0;
            }
            // Max Hold Time
            else if (holdTime >= maxHoldTime) {
                const fees = price * (capital / entryPrice) * strategy.fee;
                capital += (price - entryPrice) * (capital / entryPrice) - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    profit,
                    reason: 'MAX_HOLD_TIME',
                    holdTime
                });
                position = 0;
                entryPrice = 0;
            }
            // Momentum Reversal (fast exit)
            else if (momentum < 45 && profit > 0) {
                const fees = price * (capital / entryPrice) * strategy.fee;
                capital += (price - entryPrice) * (capital / entryPrice) - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    profit,
                    reason: 'MOMENTUM_REVERSAL',
                    holdTime
                });
                position = 0;
                entryPrice = 0;
            }
            // EMA Cross Down
            else if (ema5 < ema21 && profit > 0) {
                const fees = price * (capital / entryPrice) * strategy.fee;
                capital += (price - entryPrice) * (capital / entryPrice) - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    profit,
                    reason: 'EMA_CROSS_DOWN',
                    holdTime
                });
                position = 0;
                entryPrice = 0;
            }
        }
        
        // === SPRAWDŹ KUPNO ===
        if (position === 0) {
            const volumeOk = currentCandle.volume > avgVolume * minVolume;
            const momentumOk = momentum > momentumThreshold;
            const rsiOk = rsi < 65 && rsi > 30;
            const priceDirOk = priceChange > 0;
            
            if (momentumOk && volumeOk && rsiOk && priceDirOk) {
                position = 1;
                entryPrice = price;
                entryTime = currentCandle.time || i * 60;
                trades.push({
                    step: i,
                    action: 'BUY',
                    price,
                    momentum: momentum.toFixed(1),
                    volume: currentCandle.volume
                });
            }
        }
        
        // Zapisz equity curve
        const equity = capital + (position === 1 ? (capital / entryPrice) * price : 0);
        peakEquity = Math.max(peakEquity, equity);
        const drawdown = ((peakEquity - equity) / peakEquity) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
        
        equityCurve.push({
            step: i,
            time: currentCandle.time,
            equity,
            drawdown
        });
    }
    
    // Final equity
    const finalEquity = capital;
    const totalProfit = finalEquity - initialBalance;
    const totalProfitPct = (totalProfit / initialBalance) * 100;
    
    // Statystyki trades
    const sells = trades.filter(t => t.action === 'SELL');
    const wins = sells.filter(t => t.profit > 0);
    const losses = sells.filter(t => t.profit <= 0);
    
    const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
    
    const totalWins = wins.reduce((sum, t) => sum + t.profit, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    
    const avgProfit = sells.length > 0 ? sells.reduce((sum, t) => sum + t.profit, 0) / sells.length : 0;
    
    return {
        initialBalance,
        finalEquity,
        totalProfit,
        totalProfitPct: totalProfitPct.toFixed(2),
        tradesCount: trades.length,
        buyCount: trades.filter(t => t.action === 'BUY').length,
        sellCount: sells.length,
        winRate: winRate.toFixed(1),
        avgProfit: avgProfit.toFixed(3),
        maxDrawdown: maxDrawdown.toFixed(2),
        profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
        bestTrade: sells.length > 0 ? Math.max(...sells.map(t => t.profit)).toFixed(2) : 0,
        worstTrade: sells.length > 0 ? Math.min(...sells.map(t => t.profit)).toFixed(2) : 0,
        equityCurve,
        tradeLog: trades
    };
}

/**
 * Pomocnicza funkcja EMA
 */
function calcEMA(data, period) {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

/**
 * Pomocnicza funkcja RSI
 */
function calcRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

module.exports = { ScalpingStrategy, backtestScalpingStrategy };
