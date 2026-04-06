# Project Overview

## Cel projektu
Automatyczny system tradingowy oparty na Deep Q-Learning (DQN), który uczy się strategii tradingowych z danych rynkowych i realizuje transakcje w czasie rzeczywistym.

## Kluczowe cele
1. **Backtesting** — przetestowanie strategii na danych historycznych
2. **Nauka DQN** — agent uczy się optymalnych decyzji kupna/sprzedaży
3. **Handel na żywo** — integracja z Alpaca API
4. **Interaktywny dashboard** — wizualizacja w TensorFlow.js

## Stack technologiczny
| Komponent | Technologia |
|-----------|-------------|
| Backend | Node.js |
| Sieć neuronowa | TensorFlow.js |
| Dane rynkowe | Alpha Vantage, Polygon.io |
| Broker | Alpaca API |
| Wizualizacja | TensorFlow.js Dashboard |
| CLI | Commander.js |

## Architektura ogólna
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Data       │────▶│  DQN Agent   │────▶│  Trading    │
│  Fetchers   │     │  (TF.js)     │     │  Executor   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  Backtest   │
                    │  Engine     │
                    └─────────────┘
```

## Metryki sukcesu
- Zwrot z inwestycji (ROI) > 0
- Sharpe Ratio > 1.0
- Maksymalny drawdown < 20%

## Status
- [x] Backtesting module
- [x] DQN z TF.js
- [x] Strategie tradingowe
- [x] Alpaca trading
- [x] Dashboard
- [ ] Optymalizacja hiperparametrów
- [ ] Wdrożenie produkcyjne
