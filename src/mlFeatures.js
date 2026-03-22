/**
 * ML Features - Pattern Recognition, Price Prediction, Anomaly Detection
 * Proste algorytmy statystyczne bez zewnętrznych bibliotek ML
 */

const ML_FEATURES_ENABLED = process.env.ML_FEATURES_ENABLED !== 'false';
const ML_ANOMALY_THRESHOLD = parseFloat(process.env.ML_ANOMALY_THRESHOLD || '3');

// ─── Statystyka pomocnicza ───────────────────────────────────────────────────

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
    if (!arr || arr.length < 2) return 1;
    const m = mean(arr);
    const variance = arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length;
    return Math.sqrt(variance) || 1;
}

function min(arr) {
    if (!arr || arr.length === 0) return 0;
    return Math.min(...arr);
}

function max(arr) {
    if (!arr || arr.length === 0) return 0;
    return Math.max(...arr);
}

function slope(prices) {
    // Oblicz nachylenie linii trendu (prosta regresja liniowa)
    if (!prices || prices.length < 3) return 0;
    const n = prices.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    const sumX = idx.reduce((a, b) => a + b, 0);
    const sumY = prices.reduce((a, b) => a + b, 0);
    const sumXY = idx.reduce((s, x, i) => s + x * prices[i], 0);
    const sumX2 = idx.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return 0;
    return (n * sumXY - sumX * sumY) / denom;
}

// ─── Klasa MLFeatures ────────────────────────────────────────────────────────

class MLFeatures {
    constructor() {
        this.enabled = ML_FEATURES_ENABLED;
        this.anomalyThreshold = ML_ANOMALY_THRESHOLD;
        // Historia cen i wolumenów do wykrywania anomalii (rolling window)
        this.priceHistory = [];
        this.volumeHistory = [];
        this.maxHistory = 200;
    }

    // ─── a) Pattern Recognition ───────────────────────────────────────────────

    /**
     * Wykryj wzorzec podwójnego dna (Double Bottom)
     * @param {number[]} prices - tablica cen
     * @returns {object} { detected: boolean, confidence: 0-1, levels: [price1, price2] }
     */
    detectDoubleBottom(prices) {
        if (!prices || prices.length < 40) return { detected: false, confidence: 0, levels: [] };

        const window = prices.slice(-40);
        const minPrice = min(window);
        const avgPrice = mean(window);
        const tolerance = avgPrice * 0.02; // 2% tolerancja

        // Szukaj dwóch dołków w podobnej cenie
        // Podziel okno na 3 części i szukaj minimów w pierwszej i trzeciej
        const third = Math.floor(window.length / 3);
        const left = window.slice(0, third);
        const middle = window.slice(third, 2 * third);
        const right = window.slice(2 * third);

        const leftMin = min(left);
        const rightMin = min(right);
        const middleMax = max(middle);

        // Oba dołki muszą być blisko siebie (w tolerancji)
        const bottomsMatch = Math.abs(leftMin - rightMin) <= tolerance;
        // Środkowa część musi być wyżej (potwierdzenie formacji M)
        const middleHigher = middleMax > leftMin && middleMax > rightMin;
        // Dołki muszą być poniżej średniej okolicy (istotność)
        const significant = leftMin < avgPrice * 0.98 && rightMin < avgPrice * 0.98;

        if (bottomsMatch && middleHigher && significant) {
            // Oblicz confidence na podstawie głębokości i równości dołków
            const depthScore = 1 - Math.min(Math.abs(leftMin - rightMin) / tolerance, 1);
            const riseScore = (middleMax - Math.min(leftMin, rightMin)) / (avgPrice * 0.05);
            const confidence = Math.min((depthScore * 0.5 + Math.min(riseScore, 1) * 0.5), 1);
            return { detected: true, confidence, levels: [leftMin, rightMin] };
        }

        return { detected: false, confidence: 0, levels: [] };
    }

    /**
     * Wykryj wzorzec podwójnego szczytu (Double Top)
     * @param {number[]} prices - tablica cen
     * @returns {object} { detected: boolean, confidence: 0-1, levels: [price1, price2] }
     */
    detectDoubleTop(prices) {
        if (!prices || prices.length < 40) return { detected: false, confidence: 0, levels: [] };

        const window = prices.slice(-40);
        const avgPrice = mean(window);
        const tolerance = avgPrice * 0.02; // 2% tolerancja

        const third = Math.floor(window.length / 3);
        const left = window.slice(0, third);
        const middle = window.slice(third, 2 * third);
        const right = window.slice(2 * third);

        const leftMax = max(left);
        const rightMax = max(right);
        const middleMin = min(middle);

        // Oba szczyty muszą być blisko siebie
        const topsMatch = Math.abs(leftMax - rightMax) <= tolerance;
        // Środkowa część musi być niżej (potwierdzenie formacji W)
        const middleLower = middleMin < leftMax && middleMin < rightMax;
        // Szczyty muszą być powyżej średniej (istotność)
        const significant = leftMax > avgPrice * 1.02 && rightMax > avgPrice * 1.02;

        if (topsMatch && middleLower && significant) {
            const depthScore = 1 - Math.min(Math.abs(leftMax - rightMax) / tolerance, 1);
            const dropScore = (Math.max(leftMax, rightMax) - middleMin) / (avgPrice * 0.05);
            const confidence = Math.min((depthScore * 0.5 + Math.min(dropScore, 1) * 0.5), 1);
            return { detected: true, confidence, levels: [leftMax, rightMax] };
        }

        return { detected: false, confidence: 0, levels: [] };
    }

    /**
     * Wykryj wzorzec głowy i ramion (Head and Shoulders)
     * @param {number[]} prices - tablica cen
     * @returns {object} { detected: boolean, confidence: 0-1 }
     */
    detectHeadShoulders(prices) {
        if (!prices || prices.length < 60) return { detected: false, confidence: 0 };

        const window = prices.slice(-60);
        const avgPrice = mean(window);

        // Podziel na 5 części: lewe ramię, głowa, prawe ramię
        const segmentSize = Math.floor(window.length / 5);
        const leftShoulder = window.slice(0, segmentSize);
        const head = window.slice(segmentSize, 2 * segmentSize);
        const rightShoulder = window.slice(2 * segmentSize, 3 * segmentSize);
        const leftPart = window.slice(3 * segmentSize, 4 * segmentSize);
        const rightPart = window.slice(4 * segmentSize);

        const leftShoulderMax = max(leftShoulder);
        const headMax = max(head);
        const rightShoulderMax = max(rightShoulder);
        const leftPartMin = min(leftPart);
        const rightPartMin = min(rightPart);

        // Głowa musi być wyżej niż ramiona
        const headHigher = headMax > leftShoulderMax && headMax > rightShoulderMax;
        // Ramiona muszą być na podobnym poziomie
        const shouldersLevel = Math.abs(leftShoulderMax - rightShoulderMax) / avgPrice < 0.015;
        // Po głowie i prawym ramieniu cena spada
        const declining = rightPartMin < avgPrice;

        // Opcjonalnie: linia szyi (support) - po obu stronach głowy
        const necklineLeft = leftPartMin;
        const necklineRight = rightPartMin;
        const necklineFlat = Math.abs(necklineLeft - necklineRight) / avgPrice < 0.02;

        if (headHigher && shouldersLevel && declining && necklineFlat) {
            const headHeight = headMax - avgPrice;
            const shoulderHeight = (leftShoulderMax + rightShoulderMax) / 2 - avgPrice;
            const hsr = headHeight / (shoulderHeight || 1);
            const confidence = Math.min(hsr / 1.5, 1) * shouldersLevel;
            return { detected: true, confidence: Math.max(confidence, 0.5) };
        }

        return { detected: false, confidence: 0 };
    }

    /**
     * Wykryj linię trendu (Trend Line)
     * @param {number[]} prices - tablica cen
     * @returns {object} { detected: boolean, direction: 'UP'|'DOWN'|'NEUTRAL', slope: number }
     */
    detectTrendLine(prices) {
        if (!prices || prices.length < 20) return { detected: false, direction: 'NEUTRAL', slope: 0 };

        const window = prices.slice(-20);
        const s = slope(window);
        const avgPrice = mean(window);
        const normalizedSlope = s / avgPrice; // Slope jako % ceny na okres

        // Nachylenie > 0.001 oznacza trend wzrostowy, < -0.001 spadkowy
        if (normalizedSlope > 0.001) {
            return { detected: true, direction: 'UP', slope: normalizedSlope };
        } else if (normalizedSlope < -0.001) {
            return { detected: true, direction: 'DOWN', slope: normalizedSlope };
        }

        return { detected: false, direction: 'NEUTRAL', slope: normalizedSlope };
    }

    // ─── b) Price Prediction (prosty regresor) ────────────────────────────────

    /**
     * Przewiduj następną cenę na podstawie ostatnich cen
     * Używa średniej kroczącej + momentum
     * @param {number[]} prices - tablica cen
     * @returns {object} { predicted: number, direction: 'UP'|'DOWN'|'NEUTRAL', confidence: 0-1 }
     */
    predictNextPrice(prices) {
        if (!prices || prices.length < 10) {
            return { predicted: prices?.[prices.length - 1] || 0, direction: 'NEUTRAL', confidence: 0 };
        }

        const last = prices[prices.length - 1];
        const recent = prices.slice(-10);
        const older = prices.slice(-20, -10);

        // Średnia krocząca (MA)
        const ma10 = mean(recent);
        const ma20 = older && older.length > 0 ? mean(older) : ma10;

        // Momentum: zmiana ceny w ostatnich 5 okresach
        const momentum = recent.length >= 5
            ? (recent[recent.length - 1] - recent[recent.length - 5]) / recent[recent.length - 5]
            : 0;

        // Regresja liniowa na ostatnich 10 cenach
        const s = slope(recent);
        const normalizedSlope = s / last;

        // Ważona predykcja: 60% MA + 30% momentum + 10% linear regression
        const maWeight = 0.6;
        const momentumWeight = 0.3;
        const regWeight = 0.1;

        // Predicted price = last price + weighted change
        const maChange = (ma10 - last) / last;
        const predictedChange = maWeight * maChange + momentumWeight * momentum + regWeight * normalizedSlope;
        const predicted = last * (1 + predictedChange);

        // Direction based on predicted change
        let direction = 'NEUTRAL';
        if (predictedChange > 0.002) direction = 'UP';
        else if (predictedChange < -0.002) direction = 'DOWN';

        // Confidence based on agreement between methods
        const signAgreement = [
            maChange > 0 ? 1 : -1,
            momentum > 0 ? 1 : -1,
            normalizedSlope > 0 ? 1 : -1
        ];
        const agreement = signAgreement.filter(s => s === (predictedChange > 0 ? 1 : -1)).length / 3;
        const confidence = Math.min(agreement, 1);

        return {
            predicted: Math.max(predicted, last * 0.9), // Nie pozwól na spadek >10%
            direction,
            confidence: Math.max(confidence, 0.3), // Minimum 30% confidence
            predictedChange: predictedChange * 100 // jako %
        };
    }

    // ─── c) Anomaly Detection ─────────────────────────────────────────────────

    /**
     * Wykryj anomalię w cenie lub wolumenie używając Z-score
     * @param {number} price - aktualna cena
     * @param {number} volume - aktualny wolumen
     * @returns {object} { isAnomaly: boolean, priceZScore: number, volumeZScore: number, alert: string|null }
     */
    detectAnomaly(price, volume) {
        // Dodaj do historii
        if (price > 0) this.priceHistory.push(price);
        if (volume > 0) this.volumeHistory.push(volume);

        // Trim historii
        if (this.priceHistory.length > this.maxHistory) this.priceHistory.shift();
        if (this.volumeHistory.length > this.maxHistory) this.volumeHistory.shift();

        const result = { isAnomaly: false, priceZScore: 0, volumeZScore: 0, alert: null };

        if (this.priceHistory.length < 20) return result; // Potrzebujemy minimum 20 próbek

        const priceMean = mean(this.priceHistory.slice(0, -1)); // bez aktualnej
        const priceStd = stddev(this.priceHistory.slice(0, -1));
        const priceZ = Math.abs((price - priceMean) / priceStd);

        const volMean = mean(this.volumeHistory.slice(0, -1));
        const volStd = stddev(this.volumeHistory.slice(0, -1));
        const volumeZ = Math.abs((volume - volMean) / volStd);

        result.priceZScore = parseFloat(priceZ.toFixed(2));
        result.volumeZScore = parseFloat(volumeZ.toFixed(2));

        // Anomalia gdy |z-score| > threshold
        if (priceZ > this.anomalyThreshold) {
            result.isAnomaly = true;
            result.alert = price > priceMean ? '⚠️ Price surge detected!' : '⚠️ Price drop detected!';
        }
        if (volumeZ > this.anomalyThreshold) {
            result.isAnomaly = true;
            if (!result.alert) result.alert = '⚠️ Volume anomaly detected!';
            else result.alert += ' Volume spike!';
        }

        return result;
    }

    // ─── d) Feature Engineering ───────────────────────────────────────────────

    /**
     * Zwróć dodatkowe ML features dla DQN state vector
     * @param {object} state - aktualny stan środowiska (opcjonalnie)
     * @param {object} extra - dodatkowe dane: { prices, volumes, candles }
     * @returns {object} dodatkowe features dla DQN
     */
    getMLFeatures(state = {}, extra = {}) {
        if (!this.enabled) return {};

        const prices = extra.prices || (state.close ? Array.from(state.close) : []);
        const volumes = extra.volumes || [];
        const candles = extra.candles || [];

        // Jeśli mamy dostęp do surowych świec, wyciągnij ceny i wolumeny
        if (candles.length > 0 && !prices.length) {
            prices.length = 0;
            candles.forEach(c => prices.push(c.close));
            candles.forEach(c => volumes.push(c.volume));
        }

        if (prices.length < 10) return {};

        const lastPrice = prices[prices.length - 1];
        const lastVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;

        // Pattern detection
        const doubleBottom = this.detectDoubleBottom(prices);
        const doubleTop = this.detectDoubleTop(prices);
        const headShoulders = this.detectHeadShoulders(prices);
        const trendLine = this.detectTrendLine(prices);

        // Price prediction
        const prediction = this.predictNextPrice(prices);

        // Anomaly detection
        const anomaly = this.detectAnomaly(lastPrice, lastVolume);

        // Znormalizowane features (0-1 gdzie to możliwe)
        const avgPrice = mean(prices);
        const priceRange = max(prices) - min(prices);

        return {
            // Pattern flags (jako binarne 0/1)
            patternDoubleBottom: doubleBottom.detected ? 1 : 0,
            patternDoubleTop: doubleTop.detected ? 1 : 0,
            patternHeadShoulders: headShoulders.detected ? 1 : 0,
            patternUptrend: trendLine.direction === 'UP' ? 1 : 0,
            patternDowntrend: trendLine.direction === 'DOWN' ? 1 : 0,

            // Pattern confidence (0-1)
            patternConfidence: Math.max(
                doubleBottom.confidence,
                doubleTop.confidence,
                headShoulders.confidence
            ),

            // Direction prediction (jako kategoryczne 0-1-2)
            predictedDirectionUp: prediction.direction === 'UP' ? 1 : 0,
            predictedDirectionDown: prediction.direction === 'DOWN' ? 1 : 0,
            predictedDirectionNeutral: prediction.direction === 'NEUTRAL' ? 1 : 0,
            predictionConfidence: prediction.confidence,

            // Predicted change (% jako znormalizowana wartość)
            predictedChangePct: Math.max(-0.1, Math.min(0.1, prediction.predictedChange / 100)),

            // Anomaly detection
            isAnomaly: anomaly.isAnomaly ? 1 : 0,
            priceZScore: Math.min(anomaly.priceZScore / this.anomalyThreshold, 3) / 3, // znormalizowany do 0-1
            volumeZScore: Math.min(anomaly.volumeZScore / this.anomalyThreshold, 3) / 3,

            // Trend slope (jako % na okres)
            trendSlope: trendLine.slope,

            // Pozycja ceny względem średniej (0-1)
            priceVsMA: priceRange > 0 ? (lastPrice - min(prices)) / priceRange : 0.5
        };
    }

    // ─── Dashboard Data ────────────────────────────────────────────────────────

    /**
     * Zwróć dane do wyświetlenia na dashboardzie
     * @param {number[]} prices - historia cen
     * @param {number[]} volumes - historia wolumenów
     * @returns {object} dane dashboardowe
     */
    getDashboardData(prices = [], volumes = []) {
        const lastPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
        const lastVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;

        const doubleBottom = this.detectDoubleBottom(prices);
        const doubleTop = this.detectDoubleTop(prices);
        const headShoulders = this.detectHeadShoulders(prices);
        const trendLine = this.detectTrendLine(prices);
        const prediction = this.predictNextPrice(prices);
        const anomaly = this.detectAnomaly(lastPrice, lastVolume);

        // Build pattern badges
        const patterns = [];
        if (doubleBottom.detected) patterns.push({ name: 'Double Bottom', confidence: doubleBottom.confidence });
        if (doubleTop.detected) patterns.push({ name: 'Double Top', confidence: doubleTop.confidence });
        if (headShoulders.detected) patterns.push({ name: 'Head & Shoulders', confidence: headShoulders.confidence });
        if (trendLine.detected) patterns.push({ name: `${trendLine.direction} Trend`, confidence: 0.7 });

        // Prediction direction label
        const directionLabel = prediction.direction === 'UP' ? '📈 UP' :
            prediction.direction === 'DOWN' ? '📉 DOWN' : '➡️ NEUTRAL';

        return {
            patterns,
            anomaly: {
                detected: anomaly.isAnomaly,
                alert: anomaly.alert,
                priceZScore: anomaly.priceZScore,
                volumeZScore: anomaly.volumeZScore
            },
            prediction: {
                direction: prediction.direction,
                directionLabel,
                predictedPrice: prediction.predicted,
                predictedChangePct: prediction.predictedChange,
                confidence: prediction.confidence
            },
            trend: {
                direction: trendLine.direction,
                slope: trendLine.slope
            },
            lastPrice,
            lastVolume
        };
    }

    // Resetuj historie (np. przy starcie nowej epizody)
    reset() {
        this.priceHistory = [];
        this.volumeHistory = [];
    }
}

module.exports = { MLFeatures };
