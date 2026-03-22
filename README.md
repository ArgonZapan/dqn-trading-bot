# DQN Trading Bot — BTC/USDT on Binance

> Autonomiczny agent handlowy oparty na Deep Q-Network (DQN) + Double DQN + Prioritized Experience Replay (PER) + Dueling Networks. Handel spot na Binance.

![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4.x-FF6F00?style=flat-square&logo=tensorflow)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## 🏗️ Architektura

```
┌────────────────────────────────────────────────────────────────────┐
│                        DQN TRADING BOT                             │
│                      (Binance Spot BTC/USDT)                       │
├────────────────┬────────────────┬──────────────────┬───────────────┤
│    CLIENT      │    SERVER      │      AGENT       │   SERVICES    │
│  React + Vite  │  Raw Node.js   │   Double DQN     │  Binance WS   │
│  React Router  │  http.Server   │   + PER +        │  Real-time    │
│  React Query   │  REST API      │   Dueling        │  klines       │
│  Zustand       │  port 3000     │                  │               │
│  Recharts      │  /api/*        │  ↕ TensorFlow.js │  📈 Indicators │
│                │                │                  │  RSI/MACD/BB  │
│  📊 Dashboard  │  🎮 Controls   │  🧠 ReplayBuffer │  EMA(9,21,50) │
└────────────────┴────────────────┴──────────────────┴───────────────┘
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
# 1. Zainstaluj zależności (backend)
npm install

# 2. Skonfiguruj klucze Binance (opcjonalne)
cp .env.example .env
# Edytuj .env i dodaj BINANCE_API_KEY + BINANCE_SECRET

# 3. Uruchom backend
node server/index.js
# Dashboard legacy: http://<IP>:3000

# 4. Uruchom frontend React
cd react-client
npm install
npm run dev
# React dashboard: http://<IP>:5173
```

---

## 📁 Struktura projektu

```
dqn-trading-bot/
├── server/
│   └── index.js                # Raw http.Server API (port 3000)
├── client/
│   └── index.html              # Legacy dashboard (Vanilla JS + Chart.js)
├── react-client/               # Nowy frontend React
│   ├── src/
│   │   ├── pages/              # Training, Backtest, Paper, Analytics, Live
│   │   ├── components/
│   │   │   ├── layout/         # Layout, Sidebar, BottomNav
│   │   │   ├── common/         # Card, Button, MetricsGrid, ErrorBoundary
│   │   │   ├── training/       # EpisodeChart, EpisodeHistory
│   │   │   ├── paper/          # TradeTable, EquityCurveChart
│   │   │   ├── backtest/       # (w budowie)
│   │   │   └── analytics/      # (w budowie)
│   │   ├── hooks/              # useApi (React Query), useTrainingTimer
│   │   ├── store/              # Zustand (prices, training, paper state)
│   │   └── api/                # client.js (wszystkie endpointy)
│   ├── vite.config.js          # Proxy /api → localhost:3000
│   └── playwright.config.js    # E2E test config
├── src/
│   ├── dqnAgent.js             # DQN Agent (Double DQN + PER + Dueling)
│   ├── environment.js          # Trading Environment (state/action/reward)
│   ├── replayBuffer.js         # Prioritized Experience Replay
│   ├── indicators.js           # RSI, MACD, EMA, Bollinger Bands
│   ├── strategies.js           # Trend, MeanRev, Momentum, MACD, Scalping
│   ├── strategies/
│   │   ├── scalpingStrategy.js
│   │   ├── gridStrategy.js
│   │   └── index.js
│   ├── metrics.js              # Sharpe, MaxDD, WinRate, ProfitFactor
│   ├── portfolio.js            # Portfolio state management
│   ├── risk.js                 # Risk manager (SL, position sizing)
│   ├── notifier.js             # Telegram notifications
│   └── logger.js               # Structured logging
├── tests/
│   └── dashboard.spec.js       # Playwright E2E tests (35 test cases)
├── bugs/                       # Raporty bugów (tester: Jarvis Horner)
│   ├── TEMPLATE.md             # Szablon raportu
│   ├── SEVERITY.md             # Definicje severity
│   ├── CHECKLIST.md            # Checklista testów
│   └── reports/                # Raporty per aplikacja
├── models/                     # Zapisane modele DQN (dqn-ep{N}.json)
├── .env.example                # Przykładowa konfiguracja
├── docker-compose.yml
├── Dockerfile
├── playwright.config.js        # Playwright E2E config
└── README.md
```

---

## 📊 Dashboard (React)

Zakładki:

| Zakładka | Zawartość |
|----------|-----------|
| **Training** | Kontrola (TRAIN/STOP/SAVE) + Agent Metrics + Timer + Wykres epizodu + Historia + Logi |
| **Backtest** | HTF Trend Filter + Portfolio + Risk/Reward + Trading Chart + Sentiment + Strategy Compare |
| **Paper** | Paper Trading Controls + Strategie + SL/TP + Equity Curve + Trade History |
| **Analytics** | Performance Summary + Monte Carlo + P&L Attribution + Heatmap + Rebalancer + Optimizer |
| **Live** | Live Trading (Binance) + Alert Configuration |

### Stack

- **Vite** — szybki dev server + build
- **React 18** + **React Router v6** — SPA z nawigacją
- **React Query** — cache API, auto-refetch, loading/error states
- **Zustand** — global state (ceny, training status, paper trading)
- **Recharts** — wykresy (equity, epizody, porównanie strategii)
- **CSS** — dark theme, responsywny (sidebar desktop, bottom-nav mobile)

---

## 🧠 Specyfikacja DQN

### State Space

Wejście sieci neuronowej (~394 cechy):

| Grupa | Cechy | Opis |
|-------|-------|------|
| OHLCV | 60×5 | Ceny znormalizowane (open, high, low, close, volume) |
| Volume | 60 | Wolumen znormalizowany |
| Position | 3 | One-hot: [flat, long, short] |
| P&L | 3 | Realized, unrealized, total |
| Timing/Vol | 6 | Time since trade, avg volume ratio, volatility |
| Returns | 4 | 1m, 5m, 15m, 1h returns |
| Sentiment | 1 | Market sentiment score |
| ML Features | 17 | RSI, MACD, EMA, Bollinger, ATR |

### Action Space

```
0 = HOLD  — nie rób nic
1 = BUY   — kup BTC za USDT (95% kapitału)
2 = SELL  — sprzedaj BTC za USDT
```

### Reward Function

```
reward = realized_pnl - trading_fees(0.1%) - spread_cost
        + hold_bonus(if profitable) - drawdown_penalty
```

### Sieć neuronowa (TensorFlow.js)

```
Input (394)
  → Dense(256, ReLU) + BatchNorm + Dropout(0.2)
  → Dense(128, ReLU) + BatchNorm + Dropout(0.2)
  → Dense(64, ReLU)
  → Value stream → Dense(1)
  → Advantage stream → Dense(3)
  → Q(s,a) = Value + (Advantage - mean(Advantage))
  → Output: Q-values [HOLD, BUY, SELL]
```

---

## 🔧 Konfiguracja

```bash
# Binance API (opcjonalne — wymagane tylko dla live tradingu)
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key

# Serwer
PORT=3000

# Agent
EPSILON_START=1.0
EPSILON_END=0.1
EPSILON_DECAY=0.995
LEARNING_RATE=0.001
GAMMA=0.99
REPLAY_BUFFER_SIZE=10000
BATCH_SIZE=32

# Risk
POSITION_SIZE=0.95
STOP_LOSS=0.02
TAKE_PROFIT=0.04
```

---

## 📈 Paper Trading

Symulacja tradingu z realnymi cenami. **Zalecane przed live tradingiem.**

- 6 strategii: trend, mean_reversion, momentum, macd, scalping, grid
- Konfigurowalne SL/TP
- Trailing stop loss
- Equity curve w czasie rzeczywistym
- Historia transakcji (CSV/JSON export)

---

## 🧪 Testy

### Playwright E2E (35 test cases)

```bash
cd react-client
npx playwright install chromium
npx playwright test tests/dashboard.spec.js
```

Testowane: każdy button, nawigacja, API endpoints, edge case'y.

### Raporty bugów

Tester: **Jarvis Horner** 🔍

Raporty w `bugs/` — szablon, severity definitions, checklista, per-aplikacja.

---

## 🔗 API Endpoints

<details>
<summary>Rozwiń pełną listę endpointów</summary>

### Status
| GET | `/api/status` | Status serwera, ceny, metrics |
| GET | `/api/prices` | BTC, ETH, SOL |

### Training
| GET | `/api/training/status` | Status treningu |
| POST | `/api/training/start` | Start treningu |
| POST | `/api/training/stop` | Stop treningu |
| POST | `/api/training/save` | Zapisz model |

### Episode Data
| GET | `/api/episode-data` | Dane ostatniego epizodu |
| GET | `/api/episode-history` | Historia epizodów |

### Paper Trading
| GET | `/api/paper-trading` | Status |
| POST | `/api/paper-trading/start` | Start |
| POST | `/api/paper-trading/stop` | Stop |
| POST | `/api/paper-trading/reset` | Reset do $1000 |
| GET | `/api/paper-trading/history` | Historia trade'ów |
| GET | `/api/paper-trading/equity-curve` | Equity curve |
| POST | `/api/paper-trading/sltp?sl=X&tp=Y` | Set SL/TP |
| POST | `/api/paper-trading/strategy?strategy=X` | Set strategy |
| POST | `/api/paper-trading/scalp-params?...` | Scalping params |

### Backtest
| GET | `/api/strategy/compare` | Porównanie 6 strategii |
| GET | `/api/htf-trend` | HTF trend (1H, 4H) |
| GET | `/api/sentiment?keyword=BTC` | Market sentiment |

### Risk & Portfolio
| GET | `/api/risk/report` | Risk report |
| GET | `/api/portfolio` | Portfolio |
| GET | `/api/portfolio/heatmap` | Heatmap |
| GET | `/api/attribution` | P&L attribution |

### Monte Carlo
| GET | `/api/monte-carlo/quick` | 100 symulacji |

### Optimizer
| GET | `/api/optimizer/status` | Status |
| POST | `/api/optimizer/start` | Start optymalizacji |
| POST | `/api/optimizer/stop` | Stop |

### Live Trading
| GET | `/api/live-trading/status` | Status |
| GET | `/api/live-trading/config-check` | Konfiguracja API |
| POST | `/api/live-trading/open-long` | Otwórz long |
| POST | `/api/live-trading/close-position` | Zamknij pozycję |

### Alerts
| GET | `/api/alerter/status` | Status |
| POST | `/api/alerter/test` | Test alert |

</details>

---

## 🐳 Docker

```bash
docker-compose up -d
# Dashboard: http://localhost:3000
```

---

## 📝 Licencja

MIT — używaj na własne ryzyko. Handel kryptowalutami jest ryzykowny.
