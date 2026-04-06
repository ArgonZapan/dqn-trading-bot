# API Integration

## Alpaca Trading API

### Autentykacja
```javascript
{
  keyId: config.alpaca.key,
  secretKey: config.alpaca.secret,
  paper: true  // paper trading (nigdy real bez zgody użytkownika!)
}
```

### Endpointy

| Funkcja | Endpoint | Opis |
|---------|----------|------|
| Account | `GET /v2/account` | Saldo, equity, buying power |
| Positions | `GET /v2/positions` | Otwarte pozycje |
| Orders | `GET /v2/orders` | Historia zleceń |
| Submit Order | `POST /v2/orders` | Złóż zlecenie |
| Cancel | `DELETE /v2/orders/{id}` | Anuluj zlecenie |

### Zasady bezpieczeństwa
1. **Paper trading ONLY** — domyślnie włączony
2. **Czytać account balance** przed każdą transakcją
3. **Nigdy nie wysyłać zleceń większych niż buying power**
4. **Retry z exponential backoff** przy rate limit (429)

### Rate Limits
- 200 requestów/minutę
- Retry: 429 → wait 60s → retry
- Log każdego 429

### Order execution (live)
```javascript
{
  symbol: 'AAPL',
  qty: Math.floor(buyingPower / currentPrice),
  side: 'buy',           // lub 'sell'
  type: 'market',       // lub 'limit'
  time_in_force: 'day'
}
```

## Alpha Vantage

### Rate Limit handling
- 5 requestów/minutę
- Cache'ować odpowiedzi
- Batch requesty gdy możliwe

### Error handling
```javascript
if (response['Error Message']) throw new Error(response['Error Message']);
if (response['Note']) { /* rate limited, wait */ }
```

## Polygon.io
- Używać dla real-time ticks (jeśli dostępne)
- WebSocket dla live data (opcjonalne)

## Konfiguracja API
Wszystkie klucze w `config.json`:
```json
{
  "alpaca": {
    "key": "...",
    "secret": "...",
    "paper": true
  },
  "alphaVantage": {
    "key": "..."
  }
}
```

Nigdy nie commitować `config.json` z prawdziwymi kluczami!
