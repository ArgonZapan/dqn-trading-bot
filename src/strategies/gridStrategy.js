/**
 * Grid Trading Strategy
 * Strategia oparta na siatce zleceń kupna/sprzedaży wokół aktualnej ceny.
 * Zyski pochodzą z różnic cenowych między gridami.
 */

class GridStrategy {
    constructor() {
        // Parametry strategii
        this.GRID_SIZE = 50;           // Odstęp między gridami ($ lub %)
        this.GRID_COUNT = 5;           // Liczba poziomów w górę i w dół
        this.GRID_SPACING = 'absolute'; // 'percentage' lub 'absolute'
        this.fee = 0.001;              // 0.1% Binance fee
    }

    /**
     * Generuje poziomy grid wokół aktualnej ceny
     * @param {number} price - Aktualna cena
     * @param {number} gridSize - Odstęp między gridami
     * @param {number} gridCount - Liczba poziomów w górę i w dół
     * @returns {Object} - Obiekt z poziomami buy i sell
     */
    generateGrid(price, gridSize = this.GRID_SIZE, gridCount = this.GRID_COUNT) {
        const levels = {
            buy: [],   // Poziomy kupna (poniżej aktualnej ceny)
            sell: [],  // Poziomy sprzedaży (powyżej aktualnej ceny)
            spacing: this.GRID_SPACING
        };

        for (let i = 1; i <= gridCount; i++) {
            const distance = gridSize * i;
            
            // Sell levels (powyżej ceny)
            const sellPrice = this.GRID_SPACING === 'percentage'
                ? price * (1 + distance / 100)
                : price + distance;
            levels.sell.push({
                level: i,
                price: sellPrice,
                distance: distance,
                distancePct: (distance / price * 100).toFixed(2)
            });

            // Buy levels (poniżej ceny)
            const buyPrice = this.GRID_SPACING === 'percentage'
                ? price * (1 - distance / 100)
                : price - distance;
            levels.buy.push({
                level: i,
                price: buyPrice,
                distance: distance,
                distancePct: (distance / price * 100).toFixed(2)
            });
        }

        // Sortujemy: buy od najbliższego do najdalszego, sell od najbliższego do najdalszego
        levels.buy.sort((a, b) => b.distance - a.distance);
        levels.sell.sort((a, b) => a.distance - b.distance);

        return levels;
    }

    /**
     * Sprawdza czy należy kupić na danym poziomie
     * @param {number} price - Aktualna cena
     * @param {Object} grid - Siatka grid
     * @returns {boolean}
     */
    shouldBuy(price, grid) {
        // Sprawdź czy cena jest blisko któregokolwiek poziomu buy
        // Tolerance: 0.1% od poziomu
        const tolerance = 0.001;
        
        for (const level of grid.buy) {
            const diff = Math.abs(price - level.price) / level.price;
            if (diff <= tolerance) {
                return true;
            }
        }
        
        // Dodatkowa logika: kupujemy gdy cena spadła ostatnio
        return false;
    }

    /**
     * Sprawdza czy należy sprzedać na danym poziomie
     * @param {number} price - Aktualna cena
     * @param {Object} grid - Siatka grid
     * @returns {boolean}
     */
    shouldSell(price, grid) {
        // Sprawdź czy cena jest blisko któregokolwiek poziomu sell
        const tolerance = 0.001;
        
        for (const level of grid.sell) {
            const diff = Math.abs(price - level.price) / level.price;
            if (diff <= tolerance) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Oblicza zysk z grid
     * @param {Object} grid - Siatka grid
     * @param {Array} trades - Historia transakcji
     * @returns {Object} - Statystyki zysku
     */
    calculateProfit(grid, trades = []) {
        if (trades.length === 0) {
            return {
                totalProfit: 0,
                buyCount: 0,
                sellCount: 0,
                avgProfitPerTrade: 0,
                winRate: 0
            };
        }

        const buys = trades.filter(t => t.action === 'BUY');
        const sells = trades.filter(t => t.action === 'SELL');

        // Oblicz zysk z każdej pary buy-sell
        let totalProfit = 0;
        let wins = 0;

        // Prosty model: kupujemy na poziomach buy, sprzedajemy na poziomach sell
        for (const sell of sells) {
            // Znajdź odpowiedni buy (zakładamy że buy był wcześniej)
            const correspondingBuy = buys.find(b => b.step < sell.step);
            if (correspondingBuy) {
                const profit = (sell.price - correspondingBuy.price) * (correspondingBuy.amount || 1);
                totalProfit += profit;
                if (profit > 0) wins++;
            }
        }

        const totalTrades = sells.length || buys.length;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

        return {
            totalProfit,
            buyCount: buys.length,
            sellCount: sells.length,
            avgProfitPerTrade: totalTrades > 0 ? totalProfit / totalTrades : 0,
            winRate
        };
    }

    /**
     * Zwraca akcję dla danego stanu rynku
     * @param {number} currentPrice - Aktualna cena
     * @param {number} position - Czy mamy pozycję (0 = brak, 1 = long)
     * @param {number} entryPrice - Cena wejścia
     * @param {Object} params - Parametry (opcjonalne)
     * @returns {number} - Akcja: 0 = HOLD, 1 = BUY, 2 = SELL
     */
    getAction(currentPrice, position = 0, entryPrice = 0, params = {}) {
        const gridSize = params.gridSize || this.GRID_SIZE;
        const gridCount = params.gridCount || this.GRID_COUNT;
        
        const grid = this.generateGrid(currentPrice, gridSize, gridCount);

        // Jeśli nie mamy pozycji - szukamy okazji do kupna
        if (position === 0) {
            // Sprawdź czy cena jest blisko poziomu buy
            for (const level of grid.buy) {
                const diff = Math.abs(currentPrice - level.price) / level.price;
                if (diff <= 0.005) { // W ramach 0.5% od poziomu
                    return 1; // BUY
                }
            }
        }

        // Jeśli mamy pozycję - sprawdź czy sprzedać
        if (position === 1 && entryPrice > 0) {
            // Oblicz TP na podstawie średniego grid spread
            const avgSpread = grid.sell[0] ? grid.sell[0].price - grid.buy[0].price : gridSize;
            const profitTarget = entryPrice + avgSpread * 0.5; // 50% zysku z średniego spreadu
            
            if (currentPrice >= profitTarget) {
                return 2; // SELL
            }
            
            // Stop loss - jeśli cena spadła o 2 gridy
            const stopLevel = entryPrice - (gridSize * 2);
            if (currentPrice <= stopLevel) {
                return 2; // SELL (stop loss)
            }
        }

        return 0; // HOLD
    }
}

/**
 * Backtest Grid Strategy
 * @param {Array} data - Dane cenowe (candle z close, high, low, open, volume)
 * @param {Object} params - Parametry backtestu
 * @returns {Object} - Wyniki backtestu
 */
function backtestGridStrategy(data, params = {}) {
    const gridSize = params.gridSize || 50;
    const gridCount = params.gridCount || 5;
    const initialBalance = params.initialBalance || 1000;
    const spacing = params.spacing || 'absolute';

    if (!data || data.length === 0) {
        return {
            error: 'No data provided',
            totalProfit: 0,
            maxDrawdown: 0,
            tradesCount: 0,
            winRate: 0
        };
    }

    const strategy = new GridStrategy();
    strategy.GRID_SIZE = gridSize;
    strategy.GRID_COUNT = gridCount;
    strategy.GRID_SPACING = spacing;

    let capital = initialBalance;
    let btc = 0;
    let position = 0;
    let entryPrice = 0;
    let trades = [];
    let equityCurve = [];
    let peakEquity = initialBalance;
    let maxDrawdown = 0;

    for (let i = 60; i < data.length - 1; i++) {
        const price = data[i].close;
        const grid = strategy.generateGrid(price, gridSize, gridCount);

        // Sprawdź czy powinniśmy kupić
        if (position === 0) {
            for (const level of grid.buy) {
                const diff = Math.abs(price - level.price) / price;
                if (diff <= 0.005) {
                    // Kupujemy
                    btc = (capital * 0.95) / price;
                    capital = capital * 0.05;
                    entryPrice = price;
                    position = 1;
                    trades.push({
                        step: i,
                        action: 'BUY',
                        price,
                        level: level.level,
                        capital: capital + btc * price
                    });
                    break;
                }
            }
        }

        // Sprawdź czy powinniśmy sprzedać (mamy pozycję)
        if (position === 1 && entryPrice > 0) {
            // Sprawdź poziomy sell
            for (const level of grid.sell) {
                const diff = Math.abs(price - level.price) / price;
                if (diff <= 0.005 && price > entryPrice) {
                    // Sprzedajemy z zyskiem
                    const fees = price * btc * 0.001;
                    capital += btc * price - fees;
                    const pnl = (price - entryPrice) * btc - fees;
                    trades.push({
                        step: i,
                        action: 'SELL',
                        price,
                        level: level.level,
                        pnl,
                        capital
                    });
                    btc = 0;
                    position = 0;
                    entryPrice = 0;
                    break;
                }
            }

            // Stop loss - jeśli cena spadła o 2 gridy
            const stopPrice = entryPrice - (gridSize * 2);
            if (price <= stopPrice) {
                const fees = price * btc * 0.001;
                capital += btc * price - fees;
                const pnl = (price - entryPrice) * btc - fees;
                trades.push({
                    step: i,
                    action: 'SELL',
                    price,
                    level: 'STOP_LOSS',
                    pnl,
                    capital
                });
                btc = 0;
                position = 0;
                entryPrice = 0;
            }
        }

        // Zapisz equity curve
        const equity = capital + btc * price;
        peakEquity = Math.max(peakEquity, equity);
        const drawdown = ((peakEquity - equity) / peakEquity) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        equityCurve.push({
            step: i,
            time: data[i].time,
            equity,
            drawdown
        });
    }

    // Finalna wycena
    const finalEquity = capital + btc * data[data.length - 1].close;
    const totalProfit = finalEquity - initialBalance;
    const totalProfitPct = (totalProfit / initialBalance) * 100;

    // Oblicz win rate
    const sells = trades.filter(t => t.action === 'SELL');
    const wins = sells.filter(t => t.pnl > 0);
    const winRate = sells.length > 0 ? (wins.length / sells.length * 100) : 0;

    // Oblicz Sharpe ratio (uproszczony)
    const returns = equityCurve.map((e, i) => 
        i > 0 ? (e.equity - equityCurve[i-1].equity) / equityCurve[i-1].equity : 0
    );
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(
        returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn * Math.sqrt(252)).toFixed(2) : '0.00';

    return {
        initialBalance,
        finalEquity,
        totalProfit,
        totalProfitPct: totalProfitPct.toFixed(2),
        maxDrawdown: maxDrawdown.toFixed(2),
        tradesCount: trades.length,
        buyCount: trades.filter(t => t.action === 'BUY').length,
        sellCount: sells.length,
        winRate: winRate.toFixed(1),
        sharpeRatio,
        equityCurve,
        tradeLog: trades,
        gridParams: {
            gridSize,
            gridCount,
            spacing
        }
    };
}

module.exports = { GridStrategy, backtestGridStrategy };
