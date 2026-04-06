# Data Management

## Typy danych

| Typ | Źródło | Częstotliwość | Przechowywanie |
|-----|--------|---------------|-----------------|
| Dane cenowe | Alpha Vantage, Polygon.io | Dzienna | Pliki CSV |
| Metadata akcji | Alpaca API | On-demand | Pliki JSON |
| Model checkpoints | Trening | Co 1000 kroków | `models/` |
| Training history | Trening | Ciągłe | `training-history.json` |
| Konfiguracja | Użytkownik | Statyczna | `config.json` |

## Fetching danych

### Alpha Vantage (darmowy)
- Rate limit: **5 requestów/minuta**, 500/dzień
- Funkcja: `TIME_SERIES_DAILY` lub `GLOBAL_QUOTE`
- API Key: w `config.json`

### Polygon.io
- Rate limit: zależy od planu
- Funkcja: `Aggs` (agregate bars)
- Preferowane źródło dla high-frequency

### Alpaca
- Rate limit: 200 requestów/minuta
- Używane głównie dla: metadata akcji, account info, zlecenia
- **Nie używać** dla danych cenowych historycznych (drogo)

## Lokalne cache

### Cena dzienna (CSV)
```
data/
  {SYMBOL}_daily.csv
  columns: date, open, high, low, close, volume
```

### Index akcji
```
data/
  symbols.json    ← lista śledzonych symboli
  cache.json      ← cache metadata (ttl: 24h)
```

## Zasady cache
- **Cache ważny 24 godziny** dla metadata
- **Cache ważny 1 godzinę** dla danych cenowych live
- **Historyczne dane** nigdy nie cache'owane (już pobrane = trwałe)

## Walidacja danych
Przed użyciem danych:
1. Sprawdź czy kolumny `date`, `close`, `volume` istnieją
2. Usuń wiersze z brakującymi wartościami
3. Sprawdź czy daty są posortowane rosnąco
4. Wykryj i obsłuż dni bez trading (weekend, święta) — interpolacja lub skip

## Backup
- Konfiguracja: `config.json` → trzymać w git (bez kluczy API)
- Modele: backup do `models/backups/` co 10 checkpointów
