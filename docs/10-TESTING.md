# Testing & Quality Assurance

## Zasady

1. **Testuj każdą jednostkę niezależnie** — izolacja = powtarzalność
2. **Testuj edge case'y** — puste dane, extreme values, boundary conditions
3. **Mock external dependencies** — API calls, filesystem (nie uderzać do Alpha Vantage w testach)
4. **CI/CD** — testy muszą przejść przed merge/pull requestem

## Struktura testów

```
tests/
  unit/
    dqn.test.js          # DQN agent (bez TF.js, mock TensorFlow)
    indicators.test.js   # Technical indicators (RSI, SMA, etc.)
    data.test.js         # Data loading, validation
    config.test.js       # Config parsing
  integration/
    backtest.test.js     # End-to-end backtest
    api.test.js          # API calls (mocked)
  fixtures/
    sample_data.csv     # Testowe dane
    config.json          # Test config
```

## Narzędzia

| Narzędzie | Zastosowanie |
|-----------|-------------|
| Jest | Test runner |
| `node-fetch` | Mock fetch API |
| `tf.js` (mock) | Mock TensorFlow.js |

## Zakres testów

### Unit tests

#### DQNAgent
- `constructor`: inicjalizacja parametrów
- `selectAction`: epsilon-greedy (test z epsilon=0, epsilon=1, epsilon=0.5)
- `selectAction`: argmax dla różnych Q-values
- `store`: dodawanie do replay buffer (overflow handling)
- `update`: gradient descent (mock TF.js)

#### Indicators
- `calculateRSI(priceData, period=14)`: known values
- `calculateSMA(prices, period)`: average calculation
- `calculateVolatility(prices, period)`: stddev
- `calculateBollingerBands(prices, period, stdDev)`: bands
- Edge case: period > data.length
- Edge case: all same prices (volatility = 0)

#### DataManager
- `loadCSV()`: parsing, validation
- `fetchFromAlphaVantage()`: rate limit handling
- `cacheGet()`: TTL expiry
- `validateRow()`: missing values, invalid dates

#### Config
- `load()`: parsing JSON
- `validate()`: required fields
- `get()`: nested access

### Integration tests

#### Backtest
- Pełny przebieg: data → agent → trades → metrics
- Znany dataset z oczekiwanym wynikiem (golden path)
- Sprawdzenie ROI ≥ 0 (sanity check)
- Sprawdzenie że wszystkie dni zostały przetworzone

### Performance tests
- Training: < 10min dla 100 epizodów na 365 dniach
- Backtest: < 1min dla 5 lat danych

## Pokrycie kodu (coverage)

- **Cel**: 80%+ line coverage dla `src/`
- **Wykluczone**: `index.js` (CLI glue), mock-heavy integration tests
- **Narzędzie**: Jest `--coverage`

## CI Pipeline

```yaml
test:
  script:
    - npm test
    - npm run coverage
  artifacts:
    reports:
      junit: junit.xml
      coverage: coverage/
```

## Przed merge/pull request
```bash
npm test          # Wszystkie testy
npm run lint      # ESLint
npm run coverage  # Coverage report
```

## Test-first (TDD)
Przy nowych feature'ach:
1. Napisz test (red)
2. Zaimplementuj minimum kodu (green)
3. Refaktoryzuj (refactor)
