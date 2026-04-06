# CLI Interface

## Struktura poleceń

```bash
node index.js <command> [options]
```

## Komendy

### `train`
Trenuj agenta DQN.

```bash
node index.js train --symbol AAPL --days 365 --episodes 100
```

| Opcja | Typ | Domyślna | Opis |
|-------|-----|----------|------|
| `--symbol` | string | wymagane | Symbol akcji |
| `--days` | number | 365 | Liczba dni danych |
| `--episodes` | number | 100 | Liczba epizodów |
| `--model` | string | null | Ścieżka do modelu (kontynuacja) |

### `backtest`
Uruchom backtest.

```bash
node index.js backtest --symbol AAPL --days 365 --model models/dqn/latest.zip
```

| Opcja | Typ | Domyślna | Opis |
|-------|-----|----------|------|
| `--symbol` | string | wymagane | Symbol akcji |
| `--days` | number | 365 | Liczba dni |
| `--model` | string | null | Model do użycia |
| `--output` | string | stdout | Plik wynikowy JSON |

### `trade`
Tryb live trading (Alpaca paper).

```bash
node index.js trade --symbol AAPL --model models/dqn/latest.zip
```

| Opcja | Typ | Domyślna | Opis |
|-------|-----|----------|------|
| `--symbol` | string | wymagane | Symbol |
| `--model` | string | wymagane | Model |
| `--interval` | number | 60 | Interwał w sekundach |

### `evaluate`
Ocena modelu na danych.

```bash
node index.js evaluate --model models/dqn/latest.zip --symbol AAPL
```

### `data`
Zarządzanie danymi.

```bash
# Pobierz dane
node index.js data --symbol AAPL --source alpha_vantage

# Lista缓存owanych danych
node index.js data --list

# Wyczyść cache
node index.js data --clear --symbol AAPL
```

## Flagi globalne

| Flaga | Opis |
|-------|------|
| `--config <path>` | Ścieżka do config.json (domyślna: ./config.json) |
| `--verbose` | Verbose logging |
| `--dry-run` | Symulacja bez side effects |

## Help

```bash
node index.js --help          # Lista komend
node index.js <cmd> --help    # Help dla konkretnej komendy
```

## Przykłady

```bash
# Pełny workflow
node index.js data --symbol AAPL --days 500
node index.js train --symbol AAPL --days 365 --episodes 50
node index.js backtest --symbol AAPL --days 90 --model models/dqn/latest.zip
```

## Exit codes
- `0` — sukces
- `1` — błąd ogólny
- `2` — błąd konfiguracji
- `3` — błąd API / sieci
