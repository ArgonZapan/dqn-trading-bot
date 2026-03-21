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
│  Dashboard   │  Express +   │  Double DQN   │  Binance WS   │
│  HTML/CSS/   │  Socket.IO   │  + PER +      │  Real-time    │
│  JavaScript  │  0.0.0.0     │  Dueling      │  klines       │
│              │              │               │               │
│  📊 Charts   │  /api/*      │  ↕ TensorFlow │  📈 Indicators │
│  📈 Metrics  │  REST API    │    .js        │  RSI/MACD/BB  │
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

---

## 🚀 Szybki start

```bash
# 1. Zainstaluj zależności
npm install

# 2. Skonfiguruj klucze Binance (opcjonalne dla backtestu)
cp .env.example .env
# Edytuj .env i dodaj klucze API z uprawnieniami do handlu spot

# 3. Uruchom dashboard (LAN)
npm start
# Otwórz http://<IP_SERWERA>:3000

# 4. Trenuj agenta
npm run train

# 5. Backtest
npm run backtest
```

---

## 📁 Struktura projektu

```
dqn-trading-bot/
├── server/
│   └── index.js              # Express + Socket.IO server
├── client/
│   └── index.html             # Dashboard HTML
├── src/
│   ├── agents/
│   │   └── DQNAgent.ts        # Double DQN + PER + Dueling Networks
│   ├── environments/
│   │   └── TradingEnvironment.ts  # RL environment (state/action/reward)
│   ├── models/
│   │   └── DQNModel.ts        # Neural network (TF.js)
│   ├── services/
│   │   └── BinanceClient.ts   # Binance REST + WebSocket
│   ├── utils/
│   │   ├── ReplayBuffer.ts    # Prioritized Experience Replay
│   │   └── MetricsCalculator.ts  # Sharpe, MaxDD, WinRate, PF
│   ├── indicators.js          # RSI, MACD, EMA, Bollinger Bands
│   ├── environment.js         # Legacy JS environment
│   ├── dqnAgent.js            # Legacy JS agent
│   ├── replayBuffer.js        # Legacy JS buffer
│   ├── metrics.js             # Trading metrics tracker
│   ├── portfolio.js           # Portfolio state
│   ├── risk.js                # Risk manager (stop-loss, position sizing)
│   ├── notifier.js            # Telegram notifications
│   ├── strategies.js          # Trading strategies
│   └── logger.js              # Structured logging
├── scripts/
│   ├── train.js               # Training script
│   └── backtest.ts            # Backtest z pełnymi metrykami
├── tests/
│   └── *.js                   # Testy modułów
├── dist/                      # Skompilowane pliki TS
├── .env.example               # Przykładowa konfiguracja
├── docker-compose.yml          # Docker deployment
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

## 📈 Dashboard

- **Ceny na żywo** — BTC, ETH, SOL z WebSocket
- **Portfolio** — stan konta, pozycja, unrealized P&L
- **Wykresy** — cena + wskaźniki techniczne
- **Kontrolki** — start/stop/parametry agenta
- **Metryki** — Sharpe, MaxDD, WinRate w czasie rzeczywistym
- **Logi** — ostatnie transakcje i decyzje agenta

---

## 🔗 API Endpoints

| Method | Endpoint | Opis |
|--------|----------|------|
| GET | `/api/status` | Status agenta i portfolio |
| GET | `/api/metrics` | Metryki portfolio |
| GET | `/api/trades` | Historia transakcji |
| GET | `/api/balance` | Balance konta Binance |
| POST | `/api/start` | Start agenta |
| POST | `/api/stop` | Stop agenta |
| POST | `/api/train` | Trenuj agenta |
| POST | `/api/backtest` | Uruchom backtest |

---

## 📝 Licencja

MIT — używaj na własne ryzyko. Handel kryptowalutami jest ryzykowny.
