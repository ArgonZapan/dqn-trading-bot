# Trading Strategy

## Rynek i instrumenty
- Rynek: **American stocks** (giełda amerykańska — NYSE, NASDAQ, AMEX)
- Interwał: **1 dzień** (dzienne ceny zamknięcia)
- Horyzont czasowy: **short-term** (1-30 dni)

## Typy zleceń
| Akcja | Opis | Warunek |
|-------|------|---------|
| **BUY** | Otwarcie / powiększenie pozycji long | Sygnał długi + kapitał dostępny |
| **SELL** | Zamknięcie / zmniejszenie pozycji long | Sygnał sprzedaży lub stop-loss |
| **HOLD** | Brak akcji | Brak wyraźnego sygnału |

## Zasady zarządzania pozycją
1. **Maksymalna pozycja**: 100% kapitału dostępnego (all-in lub nic)
2. **Jedna pozycja na raz** — tylko jeden instrument w danym momencie
3. **Brak short selling** — tylko pozycje long
4. **Brak dźwigni** — bez margin/leveraged positions

## Zasady zarządzania kapitałem
- **Kapitał początkowy**: $100,000 (paper trading)
- **Alpaca**: tylko `HOLD` dopóki portfel < $1,000
- **Frakcja na transakcję**: 100% wolnej gotówki przy sygnale BUY

## Warunki wyjścia (Exit Rules)
- **Stop-loss**: -5% od ceny wejścia → natychmiast SELL
- **Take-profit**: +10% od ceny wejścia → SELL
- **Time-based exit**: zamknięcie pozycji po 20 dniach niezależnie od P&L

## Feature Engineering
Model używa następujących cech (inputs):
1. `change_rate` — dzienna procentowa zmiana ceny
2. `volatility` — 20-dniowa zmienność (stddev zmian)
3. `volume_ratio` — stosunek wolumenu do średniej 20-dniowej
4. `price_change_1d`, `price_change_5d`, `price_change_20d`
5. `sma_20` / `price` — relacja ceny do SMA 20
6. `sma_50` / `price` — relacja ceny do SMA 50
7. `rsi` — Relative Strength Index (14-dniowy)
8. `bb_position` — pozycja ceny w kanale Bollingera
9. `macd_signal` — różnica MACD vs sygnał
10. `market_cap` — kapitalizacja rynkowa (jeśli dostępna)

## Reward Function
```
reward = (current_portfolio_value - previous_portfolio_value) / previous_portfolio_value
```
- Reward jest **proporcjonalny do procentowej zmiany wartości portfela**
- Pozytywny przy zysku, negatywny przy stracie
- Skalowany przez współczynnik dyskontowy γ (discount factor)

## Sygnał tradingowy
Model zwraca Q-wartości dla 3 akcji: `[Q_BUY, Q_SELL, Q_HOLD]`
- max(Q) == Q_BUY → Kupuj
- max(Q) == Q_SELL → Sprzedawaj
- max(Q) == Q_HOLD → Trzymaj

## Symulacja execution
- **Backtest**: natychmiast execution po sygnale, cena = zamknięcie dnia
- **Live**: opóźnienie ~1 minuta od sygnału do execution (symulowane)

## Ograniczenia rynkowe
- Brak opcji ani futures
- Brak forex/crypto
- Tylkorynki amerykańskie
- Tylko instrumenty dostępne w Alpaca
