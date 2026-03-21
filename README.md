# DQN Trading Bot - Files

## Project Structure

```
dqn-trading-bot/
├── server/
│   └── index.js           # Main server
├── client/
│   └── index.html         # Dashboard
├── src/
│   ├── dqnAgent.js       # DQN Agent (Double DQN + PER)
│   ├── environment.js     # Trading Environment
│   ├── indicators.js     # Technical Indicators (RSI, MACD, EMA, BB)
│   ├── replayBuffer.js  # Prioritized Experience Replay
│   ├── risk.js         # Risk Manager
│   ├── portfolio.js     # Portfolio Tracker
│   ├── notifier.js     # Telegram notifications
│   ├── strategies.js   # Trading strategies
│   └── logger.js       # Structured logging
├── scripts/
│   ├── train.js        # Training script
│   └── backtest.js    # Backtest
├── test.js            # Module tests
├── package.json       # NPM scripts
└── README.md          # This file
```

## Modules

### src/dqnAgent.js
- Double DQN + PER + Dueling Networks
- Epsilon-greedy exploration
- Target network updates
- Buffer size: 10000

### src/environment.js
- State: OHLCV normalization
- Actions: BUY/SELL/HOLD
- Reward: P&L - fees

### src/indicators.js
- RSI(14), MACD(12,26,9), EMA(9,21,50), Bollinger Bands(20,2)
- Volume ratio tracking

## Usage

```bash
node server/index.js   # Start server
node scripts/train.js  # Train agent
```
