# Backtesting Engine

## Cel
Backtest pozwala przetestować strategię DQN na danych historycznych bez ryzyka finansowego.

## Przepływ
```
1. Load danych historycznych (CSV)
2. Initialize DQN model
3. Dla każdego dnia:
   a. State = okno ostatnich N dni
   b. Agent wybiera akcję (epsilon=0, pełna eksploatacja)
   c. Symuluj execution po cenie zamknięcia
   d. Zapisz transakcję, portfolio value
   e. Update epsilon jeśli eksploracja
4. Podsumowanie: ROI, Sharpe, drawdown, liczba transakcji
```

## Parametry backtestu
```javascript
{
  symbol: 'AAPL',
  startDate: '2020-01-01',
  endDate: '2024-12-31',
  initialCapital: 100000,
  commission: 0,           // $0 per trade (paper)
  epsilon: 0,               // 0% eksploracji
  modelPath: null,          // null = losowe wagi
}
```

## Metryki wynikowe
| Metryka | Definicja |
|---------|-----------|
| **Total ROI** | (final - initial) / initial |
| **Annualized ROI** | (1 + totalROI)^(365/days) - 1 |
| **Sharpe Ratio** | mean(dailyReturns) / std(dailyReturns) * sqrt(252) |
| **Max Drawdown** | max(peak - trough) / peak |
| **Win Rate** | profitableTrades / totalTrades |
| **Avg Trade** | mean(profitLoss) |
| **Max Trade** | max(profit) |
| **Min Trade** | min(profit) |
| **Number of Trades** | ile transakcji wykonano |

## Ograniczenia backtestu
- **Look-ahead bias**: model widzi dane których jeszcze nie znał (jeśli źle podzielone)
- **Survivorship bias**: tylko "żywe" akcje w bazie
- **Brak slippage**: zakładamy natychmiast execution po cenie zamknięcia
- **Brak liquidity**: zakładamy natychmiast wypełnienie zlecenia

## Walk-Forward Optimization
Aby uniknąć overfittingu:
```
1. Podziel dane: train (80%) / validation (20%)
2. Trenuj na train
3. Oceń na validation
4. Jeśli OK → final train na wszystkich danych
5. Nie dostrajaj hyperparameters na validation (to leakage!)
```

## Eksport wyników
- **JSON**: `backtest-{symbol}-{date}.json` — pełny log każdej transakcji
- **CSV**: `backtest-{symbol}-{date}_summary.csv` — metryki podsumowujące
- **Wizualizacja**: equity curve w dashboard

## CLI
```bash
npm run backtest -- --symbol AAPL --days 365 --model models/dqn/model.zip
```
