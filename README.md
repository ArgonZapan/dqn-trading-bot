# 🤖 DQN Trading Bot

> Autonomous Deep Q-Network trading system for Binance Spot Market

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Node.js](https://img.shields.io/badge/Node.js-18+-yellow.svg)
![Binance](https://img.shields.io/badge/Binance-API-F0B90B.svg)

---

## 🎯 About

**DQN Trading Bot** to autonomiczny system tradingowy wykorzystujący uczenie ze wzmocnieniem (Reinforcement Learning) do handlu kryptowalutami na giełdzie Binance.

### Supported Pairs
| Para | Status |
|------|--------|
| BTC/USDT | ✅ Aktywny |
| ETH/USDT | ✅ Aktywny |
| SOL/USDT | ✅ Aktywny |

---

## 🏗️ Architecture

```
dqn-trading-bot/
├── server/              # Main HTTP server
│   └── index.js        # Express-like server, Socket.IO, REST API
├── client/             # Frontend dashboard
│   └── index.html      # Single-page app z Chart.js
├── src/
│   ├── dqnAgent.js    # DQN Agent (Double DQN + PER + Dueling Networks)
│   ├── environment.js  # Trading Environment (state, reward, actions)
│   ├── indicators.js   # Technical indicators (RSI, MACD, EMA, BB)
│   ├── replayBuffer.js # Prioritized Experience Replay
│   └── dqnModel.js    # Neural Network model
├── scripts/
│   ├── train.js       # Training script
│   └── backtest.js    # Backtest script
└── README.md
```

---

## 🚀 Quick Start

### 1. Zainstaluj

```bash
git clone https://github.com/ArgonZapan/dqn-trading-bot.git
cd dqn-trading-bot

# Uruchom server
node server/index.js
```

### 2. Otwórz dashboard

```
http://localhost:3000
```

---

## 📊 Features

### Implemented ✅
- ✅ DQN Agent (Double DQN + PER + Dueling Networks)
- ✅ Live ceny BTC/ETH/SOL z Binance API
- ✅ Technical indicators (RSI, MACD, EMA, Bollinger Bands)
- ✅ Paper trading mode
- ✅ Portfolio tracker
- ✅ Real-time chart z Chart.js
- ✅ Epsilon-greedy exploration
- ✅ Prioritized Experience Replay buffer

### Planned 🚧
- [ ] TensorFlow.js neural network integration
- [ ] Live trading mode
- [ ] Telegram notifications
- [ ] Multi-timeframe analysis
- [ ] Strategy optimization

---

## 🧠 DQN Architecture

### State Space
- Znormalizowane ceny OHLCV (60 świec)
- RSI (14), MACD (12,26,9), Bollinger Bands (20,2)
- EMA (9, 21, 50)
- Aktualna pozycja (FLAT/LONG)
- Niezrealizowany P&L

### Action Space
| Action | Opis |
|--------|------|
| 0 | HOLD - nic nie rób |
| 1 | BUY - kup BTC |
| 2 | SELL - sprzedaj BTC |

### Reward Function
```
reward = zysk/strata - opłata_transakcji (0.1%)
```

---

## 📈 Hyperparameters

```javascript
gamma = 0.99
epsilon_start = 1.0
epsilon_end = 0.01
epsilon_decay = 0.995
replay_buffer = 10000
batch_size = 32
target_update_freq = 100
learning_rate = 0.0005
```

---

## ⚠️ Disclaimer

**Paper Trading:** Zalecamy zaczynać od paper trading.
**Live Trading:** Ryzykujesz własne środki.

---

*Autonomous DQN Trading Bot • 2024*
