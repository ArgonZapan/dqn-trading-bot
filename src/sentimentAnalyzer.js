/**
 * Sentiment Analyzer - Analiza nastrojów rynku z Twitter/X i wiadomości
 * Wspomaga decyzje tradingowe DQN agenta
 */

const https = require('https');

// Konfiguracja
const SENTIMENT_ENABLED = process.env.SENTIMENT_ENABLED === 'true';
const SENTIMENT_REFRESH_INTERVAL = parseInt(process.env.SENTIMENT_REFRESH_INTERVAL || '300', 10) * 1000; // ms
const TWITTER_API_KEY = process.env.SENTIMENT_TWITTER_API_KEY || '';
const NEWS_API_KEY = process.env.SENTIMENT_NEWS_API_KEY || '';

class SentimentAnalyzer {
    constructor() {
        // Słowa kluczowe dla scoringu sentymentu
        this.positiveWords = ['bullish', 'moon', 'pump', 'buy', 'up', 'gain', 'profit', 'green', 'surge', 'rally', 'breakout', 'adoption', 'upgrade', 'partnership'];
        this.negativeWords = ['bearish', 'dump', 'sell', 'down', 'loss', 'red', 'crash', 'scam', 'hack', 'ban', 'regulation', 'fear', 'panic', 'liquidation'];

        // Historia sentymentu (ostatnie N godzin)
        this.sentimentHistory = [];
        this.maxHistoryLength = 24; // 24 punkty = 24 godziny przy domyślnym interwale

        // Aktualne wyniki z różnych źródeł
        this.twitterSentiment = 0;
        this.newsSentiment = 0;
        this.combinedSentiment = 0;

        // Interwał odświeżania
        this.refreshInterval = null;

        // Czy używamy mock data
        this.usingMockData = !TWITTER_API_KEY && !NEWS_API_KEY;

        if (this.usingMockData) {
            console.log('[Sentiment] Using mock sentiment data (brak API keys)');
        }

        // Auto-refresh jeśli enabled
        if (SENTIMENT_ENABLED) {
            this.startAutoRefresh();
        }
    }

    /**
     * Analizuj pojedynczy tekst i zwróć wynik sentymentu (-1 do +1)
     */
    analyze(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }

        const lowerText = text.toLowerCase();
        let positiveCount = 0;
        let negativeCount = 0;

        for (const word of this.positiveWords) {
            if (lowerText.includes(word)) {
                positiveCount++;
            }
        }

        for (const word of this.negativeWords) {
            if (lowerText.includes(word)) {
                negativeCount++;
            }
        }

        const total = positiveCount + negativeCount;
        if (total === 0) {
            return 0; // Neutralny - brak słów kluczowych
        }

        // Wynik: (pozytywne - negatywne) / total
        // Zakres: -1 (wszystko negatywne) do +1 (wszystko pozytywne)
        const score = (positiveCount - negativeCount) / total;
        return Math.max(-1, Math.min(1, score));
    }

    /**
     * Pobierz sentyment z Twittera (mock lub API)
     */
    async fetchTwitterSentiment(keyword) {
        if (!SENTIMENT_ENABLED) {
            return { sentiment: 0, count: 0, source: 'disabled' };
        }

        if (!TWITTER_API_KEY || this.usingMockData) {
            // Mock data dla testów
            return this.getMockTwitterSentiment(keyword);
        }

        try {
            // Rzeczywiste API Twittera - placeholder dla przyszłej integracji
            // W prawdziwej implementacji użyć byśmy mogli Twitter API v2
            const tweets = await this.fetchTweets(keyword);
            const sentiments = tweets.map(t => this.analyze(t.text));
            const avgSentiment = sentiments.length > 0
                ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
                : 0;

            return {
                sentiment: avgSentiment,
                count: tweets.length,
                source: 'twitter',
                tweets: tweets.slice(0, 10) // Ogranicz do 10 ostatnich
            };
        } catch (error) {
            console.error('[Sentiment] Twitter API error:', error.message);
            return this.getMockTwitterSentiment(keyword);
        }
    }

    /**
     * Pobierz sentyment z wiadomości (mock lub API)
     */
    async fetchNewsSentiment(keyword) {
        if (!SENTIMENT_ENABLED) {
            return { sentiment: 0, count: 0, source: 'disabled' };
        }

        if (!NEWS_API_KEY || this.usingMockData) {
            return this.getMockNewsSentiment(keyword);
        }

        try {
            // Rzeczywiste API news - placeholder
            const articles = await this.fetchNews(keyword);
            const sentiments = articles.map(a => this.analyze(a.title + ' ' + a.description));
            const avgSentiment = sentiments.length > 0
                ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
                : 0;

            return {
                sentiment: avgSentiment,
                count: articles.length,
                source: 'news',
                articles: articles.slice(0, 5)
            };
        } catch (error) {
            console.error('[Sentiment] News API error:', error.message);
            return this.getMockNewsSentiment(keyword);
        }
    }

    /**
     * Mock Twitter sentiment dla testów
     */
    getMockTwitterSentiment(keyword) {
        // Generuj losowy sentyment między -0.5 a +0.8 (lekko podążający za rynkiem)
        const baseSentiment = (Math.random() - 0.3) * 0.8;
        const sentiment = Math.max(-1, Math.min(1, baseSentiment));

        // Mock "tweety"
        const mockTweets = [
            `${keyword} looking ${sentiment > 0 ? 'bullish' : 'bearish'} right now!`,
            sentiment > 0
                ? `Just bought more ${keyword}, this is going to moon! 🚀`
                : `Considering selling my ${keyword} position...`,
            sentiment > 0
                ? `${keyword} breaking out! Great gains today!`
                : `${keyword} dump incoming? Fear in the market.`,
        ];

        console.log(`[Sentiment] Mock Twitter: ${keyword} = ${(sentiment * 100).toFixed(1)}%`);

        return {
            sentiment,
            count: mockTweets.length,
            source: 'mock-twitter',
            tweets: mockTweets
        };
    }

    /**
     * Mock News sentiment dla testów
     */
    getMockNewsSentiment(keyword) {
        const baseSentiment = (Math.random() - 0.4) * 0.6;
        const sentiment = Math.max(-1, Math.min(1, baseSentiment));

        const mockArticles = [
            {
                title: sentiment > 0
                    ? `${keyword} surges on positive market sentiment`
                    : `${keyword} faces selling pressure amid uncertainty`,
                description: sentiment > 0
                    ? 'Investors remain bullish as adoption grows'
                    : 'Market shows signs of correction'
            },
            {
                title: sentiment > 0
                    ? `Breaking: Major partnership announced for ${keyword}`
                    : `${keyword} under regulatory scrutiny`,
                description: sentiment > 0
                    ? 'New partnerships could drive future growth'
                    : 'Regulatory concerns weigh on prices'
            }
        ];

        console.log(`[Sentiment] Mock News: ${keyword} = ${(sentiment * 100).toFixed(1)}%`);

        return {
            sentiment,
            count: mockArticles.length,
            source: 'mock-news',
            articles: mockArticles
        };
    }

    /**
     * Pobierz połączony sentyment ze wszystkich źródeł
     */
    async getCombinedSentiment(keyword = 'BTC') {
        if (!SENTIMENT_ENABLED) {
            return 0;
        }

        const [twitterResult, newsResult] = await Promise.all([
            this.fetchTwitterSentiment(keyword),
            this.fetchNewsSentiment(keyword)
        ]);

        this.twitterSentiment = twitterResult.sentiment;
        this.newsSentiment = newsResult.sentiment;

        // Ważona średnia: Twitter 60%, News 40%
        this.combinedSentiment = (this.twitterSentiment * 0.6) + (this.newsSentiment * 0.4);

        // Zapisz do historii
        this.addToHistory({
            timestamp: Date.now(),
            combined: this.combinedSentiment,
            twitter: this.twitterSentiment,
            news: this.newsSentiment
        });

        return this.combinedSentiment;
    }

    /**
     * Zwróć historię sentymentu
     */
    getSentimentHistory() {
        return this.sentimentHistory;
    }

    /**
     * Dodaj wpis do historii sentymentu
     */
    addToHistory(entry) {
        this.sentimentHistory.push(entry);

        // Ogranicz długość historii
        if (this.sentimentHistory.length > this.maxHistoryLength) {
            this.sentimentHistory.shift();
        }
    }

    /**
     * Pobierz trend sentymentu (rosnący/spadający/stabilny)
     */
    getSentimentTrend() {
        if (this.sentimentHistory.length < 3) {
            return 'stable';
        }

        const recent = this.sentimentHistory.slice(-5);
        const first = recent[0].combined;
        const last = recent[recent.length - 1].combined;
        const diff = last - first;

        if (diff > 0.1) return 'rising';
        if (diff < -0.1) return 'falling';
        return 'stable';
    }

    /**
     * Pobierz aktualny sentyment jako procent (-100% do +100%)
     */
    getSentimentPercent() {
        return Math.round(this.combinedSentiment * 100);
    }

    /**
     * Rozpocznij auto-odświeżanie
     */
    startAutoRefresh(keyword = 'BTC') {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        // Pierwsze pobranie od razu
        this.refresh(keyword);

        // Następne co SENTIMENT_REFRESH_INTERVAL
        this.refreshInterval = setInterval(() => {
            this.refresh(keyword);
        }, SENTIMENT_REFRESH_INTERVAL);

        console.log(`[Sentiment] Auto-refresh started (every ${SENTIMENT_REFRESH_INTERVAL / 1000}s)`);
    }

    /**
     * Zatrzymaj auto-odświeżanie
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('[Sentiment] Auto-refresh stopped');
        }
    }

    /**
     * Odśwież sentyment
     */
    async refresh(keyword = 'BTC') {
        try {
            await this.getCombinedSentiment(keyword);
        } catch (error) {
            console.error('[Sentiment] Refresh error:', error.message);
        }
    }

    /**
     * Pobierz dane dla dashboard
     */
    getDashboardData() {
        return {
            enabled: SENTIMENT_ENABLED,
            currentSentiment: this.combinedSentiment,
            sentimentPercent: this.getSentimentPercent(),
            sentimentTrend: this.getSentimentTrend(),
            history: this.sentimentHistory,
            sources: {
                twitter: {
                    sentiment: this.twitterSentiment,
                    label: 'Twitter/X',
                    hasData: !this.usingMockData || SENTIMENT_ENABLED
                },
                news: {
                    sentiment: this.newsSentiment,
                    label: 'News',
                    hasData: !this.usingMockData || SENTIMENT_ENABLED
                }
            },
            usingMockData: this.usingMockData
        };
    }

    /**
     * Pobierz sentyment dla integracji z DQN state
     */
    getStateFeature() {
        // Normalizuj do zakresu 0-1 dla DQN (0 = bardzo negatywny, 0.5 = neutralny, 1 = bardzo pozytywny)
        return (this.combinedSentiment + 1) / 2;
    }
}

// Singleton instance
const sentimentAnalyzer = new SentimentAnalyzer();

module.exports = { SentimentAnalyzer, sentimentAnalyzer };
