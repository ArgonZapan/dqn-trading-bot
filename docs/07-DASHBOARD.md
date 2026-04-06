# TensorFlow.js Dashboard

## Cel
Interaktywna wizualizacja treningu DQN i wyników tradingowych w przeglądarce.

## Stack
- **Frontend**: Vanilla JS + TensorFlow.js-vis
- **Bundling**: Vite
- **Styling**: Custom CSS (minimal, dark theme)

## Lokalizacja
```
client/
  index.html      — główna strona
  src/
    main.js       — entry point
    dashboard.js  — logika dashboardu
    charts.js     — wykresy (TF.js Vis)
    agent.js      — interakcja z agentem
  styles/
    main.css
  assets/
    logo.svg
```

## Ekosystem TensorFlow.js Vis

### Layer Model (architektura sieci)
```javascript
const layerModel = tfvis.show模型(model, container);
```

### Training History Chart
```javascript
tfvis.render.linechart(
  { name: 'Loss' },
  history,  // { step: [], loss: [] }
  container
);
```

### Metrics Dashboard
- Loss curve (training vs validation)
- Q-values distribution
- Epsilon decay
- Portfolio value over time

## Widoki dashboardu

### 1. Model Summary
- Architektura sieci (warstwy, unitów)
- Parametry (learning rate, gamma, epsilon)
- Checkpoint info (step, timestamp)

### 2. Training Monitor
- Real-time loss chart
- Epsilon value
- Liczba epizodów
- Średni reward per episode

### 3. Backtest Results
- Equity curve (portfolio value over time)
- ROI, Sharpe, Max Drawdown
- Trade log (tabela)
- Win/Loss distribution

### 4. Live Trading (opcjonalne)
- Aktualna pozycja
- Ostatni signal
- Portfolio balance

## Protokół komunikacji
Klient ↔ Server (WebSocket):
```javascript
// Client → Server
{ type: 'subscribe', channels: ['training', 'backtest'] }
{ type: 'getModelSummary' }
{ type: 'runBacktest', params: { symbol, days } }

// Server → Client
{ type: 'trainingUpdate', data: { step, loss, epsilon } }
{ type: 'backtestUpdate', data: { day, portfolio, action } }
{ type: 'backtestComplete', data: { metrics } }
```

## Uruchomienie
```bash
cd client
npm install
npm run dev    # Vite dev server na porcie 5173
```

## Proxy
Vite proxy: `/api` → `http://localhost:3000`

## Mobile
Dashboard responsywny (CSS flexbox/grid). Na mobile: uproszczone wykresy.
