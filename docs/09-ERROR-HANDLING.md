# Error Handling & Logging

## Zasady

1. **Każdy error → log + graceful recovery lub exit z kodem**
2. **Nigdy nie gaszenie cichych** — wszystko logowane
3. **User-friendly messages** w CLI, detailed w logs
4. **Retry z exponential backoff** przy błędach przejściowych

## Kategorie błędów

### 1. Błędy konfiguracji (fatal, exit 2)
```javascript
if (!config.alpaca?.key) throw new ConfigError('Missing Alpaca API key');
```
- Brakujące wymagane pola w config
- Nieprawidłowy format config
- Brak pliku config

### 2. Błędy sieci/API (retry lub exit 3)
```javascript
try {
  await fetchData(symbol);
} catch (e) {
  if (e.code === 'ENOTFOUND') { /* retry z longer timeout */ }
  if (e.status === 429) { /* wait 60s, retry */ }
  throw e;
}
```

### 3. Błędy danych (warning + skip)
```javascript
if (!row.close || row.close === 0) {
  logger.warn(`Skipping row ${row.date}: missing close price`);
  continue;
}
```
- Brakujące dane → skip wiersz
- Nieprawidłowy format → skip + warning

### 4. Błędy TF.js (fatal, exit 1)
```javascript
try {
  await model.fit(xs, ys);
} catch (e) {
  logger.error('Training failed:', e.message);
  throw e; // TF.js errors are fatal
}
```

## Logowanie

### Poziomy
```javascript
logger.debug('Detailed info');  // tylko z --verbose
logger.info('Status info');
logger.warn('Warning (recoverable)');
logger.error('Error (may be fatal)');
```

### Format logu
```
2026-04-06 08:32:15 [INFO]  Backtest: symbol=AAPL, days=365, initialCapital=100000
2026-04-06 08:32:16 [DEBUG] Fetched 365 days of AAPL data
2026-04-06 08:32:20 [INFO]  Trade: BUY AAPL @ $182.50, qty=54, value=$9850
2026-04-06 08:32:20 [WARN]  Price > SMA_50 (1.02x), overvalued signal
```

### Output
- **CLI**: stdout (TTY colors) + stderr (errors)
- **File**: `logs/{command}-{date}.log`
- **Format**: timestamp [LEVEL] message (machine-parseable)

## Retry policy

```javascript
async function withRetry(fn, maxAttempts = 3, baseDelay = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      const delay = baseDelay * Math.pow(2, i);
      logger.warn(`Retry ${i+1}/${maxAttempts} after ${delay}ms: ${e.message}`);
      await sleep(delay);
    }
  }
}
```

## Graceful shutdown

```javascript
process.on('SIGINT', async () => {
  logger.info('Shutdown requested, saving model...');
  await model.save(`models/dqn/emergency_step_${step}.zip`);
  process.exit(0);
});
```

## Validation

### Input validation
```javascript
function validateSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') throw new ConfigError('Invalid symbol');
  if (!/^[A-Z]{1,5}$/.test(symbol)) throw new ConfigError('Symbol must be 1-5 uppercase letters');
  return symbol;
}

function validateDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) throw new ConfigError(`Invalid date: ${date}`);
  return d;
}
```
