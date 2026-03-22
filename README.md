# DQN Trading Bot — BTC/USDT on Binance

> Autonomiczny agent handlowy oparty na Deep Q-Network (DQN) + Double DQN + Prioritized Experience Replay (PER) + Dueling Networks. Handel spot na Binance.

![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4.x-FF6F00?style=flat-square&logo=tensorflow)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Binance](https://img.shields.io/badge/Binance-Spot-F0B90B?style=flat-square&logo=binance)

---

## 🏗️ Architektura

```
┌─────────────────────────────────────────────────────────────┐
│                      DQN TRADING BOT                        │
│                     (Binance Spot BTC/USDT)                 │
├──────────────┬──────────────┬───────────────┬───────────────┤
│   CLIENT     │   SERVER     │    AGENT      │   SERVICES    │
│  Dashboard   │  Raw Node.js│  Double DQN   │  Binance WS   │
│  Vanilla JS  │  http.Server│  + PER +      │  Real-time    │
│  + Chart.js │  REST API   │  Dueling      │  klines       │
│              │  port 3000   │               │               │
│  📊 Charts   │  /api/*     │  ↕ TensorFlow │  📈 Indicators │
│  📈 Metrics  │              │    .js        │  RSI/MACD/BB  │
│  💰 Portfolio │              │               │  EMA(9,21,50) │
│  🎮 Controls │              │  ReplayBuffer │               │
└──────────────┴──────────────┴───────────────┴───────────────┘
                            │
                    ┌───────┴───────┐
                    │  ENVIRONMENT  │
                    │  BUY/SELL/    │
                    │  HOLD actions │
                    │  Reward = P&L │
                    │  - fees       │
                    └───────────────┘
```

> **Uwaga:** Serwer to raw `http.Server` (Node.js), NIE Express. Klient używa Vanilla JS + Chart.js (starsza wersja). Nowy frontend React jest w `react-client/`.

---

## 🚀 Szybki start

```bash
# 1. Zainstaluj zależności
npm install

# 2. Skonfiguruj klucze Binance (opcjonalne dla backtestu)
cp .env.example .env
# Edytuj .env i dodaj klucze API z uprawnieniami do handlu spot

# 3. Uruchom serwer (LAN)
npm start
# lub: node server/index.js
# Dashboard: http://<IP_SERWERA>:3000

# 4. Trenuj agenta (przez dashboard)
Dashboard → sekcja Kontrola → TRAIN

# 5. Backtest
npm run backtest
```

---

## 📁 Struktura projektu

```
dqn-trading-bot/
├── server/
│   └── index.js              # Raw http.Server API (port 3000)
├── client/
│   └── index.html            # Dashboard HTML (Vanilla JS + Chart.js)
├── react-client/             # 🆕 Nowy frontend React (w trakcie rozwoju)
│   ├── src/
│   │   ├── pages/            # TrainingPage, BacktestPage, LiveTrading...
│   │   ├── components/       # Layout, Nav, common components
│   │   ├── hooks/            # useApi (React Query hooks)
│   │   ├── store/            # Zustand state management
│   │   └── api/              # API client
│   └── vite.config.js
├── src/
│   ├── agents/
│   │   └── DQNAgent.ts       # Double DQN + PER + Dueling Networks
│   ├── environments/
│   │   └── TradingEnvironment.ts  # RL environment (state/action/reward)
│   ├── models/
│   │   └── DQNModel.ts        # Neural network (TF.js)
│   ├── services/
│   │   ├── BinanceClient.ts  # Binance REST + WebSocket
│   │   ├── LiveTrader.js     # Live trading executor
│   │   └── PaperTrader.ts     # Paper trading engine
│   ├── utils/
│   │   ├── ReplayBuffer.ts    # Prioritized Experience Replay
│   │   └── MetricsCalculator.ts  # Sharpe, MaxDD, WinRate, PF
│   ├── indicators.js          # RSI, MACD, EMA, Bollinger Bands
│   ├── environment.js         # TradingEnvironment (legacy JS)
│   ├── dqnAgent.js            # DQNAgent (legacy JS)
│   ├── replayBuffer.js        # ReplayBuffer (legacy JS)
│   ├── metrics.js             # MetricsCalculator (legacy JS)
│   ├── portfolio.js           # Portfolio state
│   ├── risk.js                # Risk manager (stop-loss, position sizing)
│   ├── notifier.js            # Telegram notifications
│   ├── strategies.js          # Trading strategies
│   ├── strategies/
│   │   ├── scalpingStrategy.ts
│   │   ├── gridStrategy.ts
│   │   └── ...
│   └── logger.js              # Structured logging
├── scripts/
│   ├── train.js               # Training script
│   └── backtest.ts            # Backtest z pełnymi metrykami
├── tests/                     # Testy jednostkowe (Mocha)
├── models/                    # Zapisane modele DQN (dqn-ep{N}.json)
├── dist/                      # Skompilowane pliki TS (nie używane)
├── trade-journal.json         #Dziennik transakcji
├── .env.example               # Przykładowa konfiguracja
├── docker-compose.yml         # Docker deployment
├── Dockerfile
└── README.md
```

---

## 🧠 Specyfikacja DQN

### State Space
Wektor wejściowy sieci neuronowej (~60 świec × ilość_cech):

| Cecha | Opis |
|-------|------|
| OHLCV | Ceny OHLCV znormalizowane (min-max) |
| RSI(14) | Relative Strength Index |
| MACD(12,26,9) | MACD line, signal, histogram |
| EMA(9,21,50) | Exponential Moving Averages |
| Bollinger Bands(20,2) | Upper, middle, lower band |
| Wolumen | Wolumen znormalizowany |
| Pozycja | 0 = flat, 1 = long |
| Unrealized P&L | Niezrealizowany zysk/strata |
| Czas od last trade | Ile świec minęło od ostatniej transakcji |

### Action Space
```
0 = HOLD  — nie rób nic
1 = BUY   — kup BTC za USDT (position_size % kapitału)
2 = SELL  — sprzedaj BTC za USDT
```

### Reward Function
```
reward = realized_pnl
        - trading_fees (0.1% Binance)
        - spread_cost
        + hold_bonus (jeśli pozycja zyskowna)
        - drawdown_penalty
```

### Architektura sieci (TensorFlow.js)
```
Input (state_size)
  ↓
Dense(256, ReLU) + BatchNorm + Dropout(0.2)
  ↓
Dense(256, ReLU) + BatchNorm + Dropout(0.2)
  ↓
Dense(128, ReLU)
  ↓
Value stream → Dense(1)        [wartość stanu]
Advantage stream → Dense(3)    [wartość akcji]
  ↓
Q(s,a) = Value + (Advantage - mean(Advantage))
  ↓
Output: Q-values dla [HOLD, BUY, SELL]
```

---

## 📊 Metryki portfolio

Obliczane przez `MetricsCalculator.ts`:

| Metryka | Opis |
|---------|------|
| **Sharpe Ratio** | Risk-adjusted return (annualized) |
| **Max Drawdown** | Największy spadek od peak |
| **Win Rate** | % zyskownych transakcji |
| **Profit Factor** | Gross profit / Gross loss |
| **P&L %** | Całkowity zysk/strata % |
| **Avg Win/Loss** | Średni zysk i średnia strata |

---

## 🔧 Konfiguracja

Zmienne środowiskowe (`.env`):

```bash
# Binance API (opcjonalne dla backtestu)
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key

# Port serwera
PORT=3000

# Parametry agenta
EPSILON_START=1.0
EPSILON_END=0.1
EPSILON_DECAY=0.995
LEARNING_RATE=0.001
GAMMA=0.99
REPLAY_BUFFER_SIZE=10000
BATCH_SIZE=32

# Risk management
POSITION_SIZE=0.95   # % kapitału na transakcję
STOP_LOSS=0.02       # 2% stop-loss
TAKE_PROFIT=0.04     # 4% take-profit
```

---

## 🐳 Docker

```bash
# Build + uruchom
docker-compose up -d

# Dashboard dostępny na http://localhost:3000
```

---

## 📈 Dashboard (client/index.html)

- **Ceny na żywo** — BTC, ETH, SOL z WebSocket
- **Portfolio** — stan konta, pozycja, unrealized P&L
- **Wykresy** — cena + wskaźniki techniczne (Chart.js)
- **Kontrolki** — start/stop/parametry agenta
- **Metryki** — Sharpe, MaxDD, WinRate w czasie rzeczywistym
- **Logi** — ostatnie transakcje i decyzje agenta
- **Paper Trading** — pełna symulacja z SL/TP, trailing stop
- **Live Trading** — handel na realnym rachunku Binance

> 🆕 **Nowy frontend React** w `react-client/` — Vite + React Query + Zustand + Recharts. W trakcie rozwoju.

---

## 📈 Paper Trading

Pełna symulacja tradingu z realnymi cenami z Binance. **Paper trading jest zalecany przed handlem na żywo.**

### Funkcje

- **Trailing Stop Loss** — aktywacja przy 1% zysku, trailing 0.75% pod szczytem
- **Stop Loss / Take Profit** — konfigurowalne (domyślnie SL: 2%, TP: 4%)
- **Strategie** — trend, mean_reversion, momentum, macd, scalping, grid
- **Equity Curve** — śledzenie equity + drawdown w czasie rzeczywistym
- **Historia** — logowanie wszystkich transakcji paperowych
- **Alerty** — powiadomienia Telegram przy milestone'ach i dużych drawdownach

### Uruchomienie

1. Dashboard → sekcja **Paper Trading**
2. Wybierz strategię z dropdown
3. Kliknij **START PAPER TRADING**
4. Monitoruj equity curve i statystyki

---

## 🔗 API Endpoints

### Server Status

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/status` | Status serwera, ceny, tradingActive |
| GET | `/api/prices` | Aktualne ceny BTC, ETH, SOL |

### Agent & Training

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/training/status` | Status treningu (isTraining, epsilon, episode, duration) |
| POST | `/api/training/start` | Start treningu |
| POST | `/api/training/stop` | Stop treningu |
| POST | `/api/training/save` | Zapisz model ręcznie |
| GET | `/api/hyperparams` | Pobierz hyperparametry |
| POST | `/api/hyperparams` | Zaktualizuj hyperparametry |

### Episode Data

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/episode-data` | Dane ostatniego epizodu (trades, equity, epsilon) |
| GET | `/api/episode-history` | Historia zakończonych epizodów |
| GET | `/api/episode-history/detail/:episode` | Szczegóły epizodu N |

### Metrics

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/metrics` | Metryki (Sharpe, MaxDD, WinRate, PF) |
| GET | `/api/trades` | Ostatnie 20 transakcji |
| GET | `/api/portfolio` | Stan portfolio |
| GET | `/api/buffer-health` | Health check replay buffer |

### HTF Trend

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/htf-trend` | High timeframe trend (1H, 4H) |
| GET | `/api/sentiment` | Market sentiment (mock) |
| GET | `/api/ml-insights` | ML insights |

### Paper Trading

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/paper-trading` | Status, capital, pozycje, statystyki |
| GET | `/api/paper-trading/status` | Status paper tradera |
| POST | `/api/paper-trading/start` | Start paper trading (kapitał $1000) |
| POST | `/api/paper-trading/stop` | Stop paper trading |
| POST | `/api/paper-trading/toggle` | Toggle paper trading |
| POST | `/api/paper-trading/reset` | Reset do $1000 |
| POST | `/api/paper-trading/sltp` | Ustaw SL/TP (body: `{"sl":2.0,"tp":4.0}`) |
| POST | `/api/paper-trading/strategy` | Ustaw strategię (body: `{"strategy":"trend"}`) |
| POST | `/api/paper-trading/scalp-params` | Ustaw parametry scalping |
| GET | `/api/paper-trading/history` | Historia zamkniętych trade'ów |
| GET | `/api/paper-trading/equity-curve` | Equity curve + drawdown |
| POST | `/api/paper-trading/clear-history` | Wyczyść historię |

### Backtest

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/backtest/quick` | Szybki backtest (trend strategy) |
| GET | `/api/backtest/full` | Pełny backtest |
| GET | `/api/backtest/scalping` | Backtest scalping strategii |
| GET | `/api/backtest/grid` | Backtest grid strategii |
| POST | `/api/strategy/compare` | Porównanie wszystkich strategii |
| GET | `/api/strategy/compare/chart` | Wykres porównania strategii |

### Monte Carlo

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/monte-carlo/quick` | Szybki Monte Carlo (100 symulacji) |
| GET | `/api/monte-carlo/full` | Pełny Monte Carlo (1000 symulacji) |

### Risk Management

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/risk/report` | Risk report |
| GET | `/api/risk/can-trade` | Sprawdź czy można handlować |

### Live Trading (Binance)

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/live-trading/status` | Status live tradera |
| POST | `/api/live-trading/start` | Start live tradera |
| POST | `/api/live-trading/stop` | Stop live tradera |
| GET | `/api/live-trading/stats` | Live trading stats |
| POST | `/api/live-trading/open-long` | Otwórz long (body: `{"quantity":0.001}`) |
| POST | `/api/live-trading/close-long` | Zamknij long |
| POST | `/api/live-trading/configure` | Konfiguruj (apiKey, secret, SL, TP) |
| GET | `/api/live-trading/history` | Historia live trade'ów |
| GET | `/api/live-trading/config-check` | Sprawdź konfigurację API |

### Alerts & Notifications

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/alerter/status` | Status alertera |
| POST | `/api/alerter/test` | Test notification |

---

## 📝 Licencja

MIT — używaj na własne ryzyko. Handel kryptowalutami jest ryzykowny.
