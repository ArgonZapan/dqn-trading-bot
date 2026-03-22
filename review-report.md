# Review Report — dqn-trading-bot Commits

**Data:** 2026-03-22 | **Reviewer:** Jarvis Horner 🔍

---

## 1. `0a89a5a` — Risk/Reward Ratio Display

**Status: ⚠️ Uwagi**

- Dodaje R&R display do kart pozycji na dashboardzie
- `innerHTML` z danymi z API — potencjalny XSS (dane pochodzą z serwera, nie od użytkownika, więc niskie ryzyko ale zły wzorzec)
- Brak null-check na `p.rr` — `rr===null` jest handle'owane, ale `rr` jako undefined już nie (triple equals)
- Endpoint `/api/paper-trading` zwraca `rr` — konieczna zgodność pól frontend-backend ✅

---

## 2. `bdde096` — Portfolio Heatmap Visualization

**Status: ⚠️ Uwagi**

- Duży commit: heatmap + Monte Carlo fan chart
- `updateHeatmap()` robi fetch co 5s — **brak debounce/cancel poprzedniego requesta**. Przy wolnym połączeniu fetchy mogą się nakładać
- `renderMonteCarloChart` i `renderFanChart` — Chart.js instances nie są niszczone przy re-render (potencjalny memory leak na canvas)
- Fan chart: `displayLabels` mapa tworzona za każdym razem — przy długich seriach dane mogą być duże
- `totalEquity` w endpoint `/api/portfolio/heatmap` — dzielenie przez `totalValue` bez sprawdzenia `totalEquity > 0` (w odróżnieniu od `totalPnlPercent` który ma ten check)
- Monte Carlo chart przyjmuje `data.worstScenarios` — jeśli jest puste, `scenarios` będzie puste, ale chart nie crashuje

---

## 3. `1e07ab0` — ML Features dla DQN Trading Bot

**Status: ❌ Bug**

### BUG: Orphaned kod w server/index.js (krytyczny)

W diffie commita widoczny jest **osierocony blok kodu** po handlerze `/api/ml-insights`:

```javascript
    // GET /api/ml-insights
    if (url === '/api/ml-insights') {
        // ...
        res.json(insights);  // ← użycie res.json() zamiast res.end(JSON.stringify(...))
        return;
    }
        const urlParts = req.url.split('?');   // ← ORPHANED — poza if blockiem!
        const params = new URLSearchParams(urlParts[1] || '');
        const keyword = params.get('keyword') || 'BTC';
        sentimentAnalyzer.getCombinedSentiment(keyword).then(() => {
            res.json(sentimentAnalyzer.getDashboardData());
        }).catch(err => {
            res.status(500).json({ error: err.message });
        });
        return;
    }
```

**Problemy:**
1. **Orphaned code** — kod handlera `/api/sentiment` wklejony PO returnie `if (url === '/api/ml-insights')` bloku, więc wykona się dla KAŻDEGO requesta który dojdzie do tego miejsca
2. **`res.json()`** — serwer używa raw Node.js `http.createServer`, NIE Express. `res.json()` nie istnieje → `TypeError: res.json is not a function`
3. **`res.status(500).json()`** — ten sam problem, brak Express

> **Uwaga:** W późniejszych commitach (4348685, bdde096) kod został naprawiony — sentiment handler ma własny `if` block i używa `res.end(JSON.stringify(...))`. Bug istniał tylko w tym commicie.

### BUG: State size mismatch (istotny)

- MLFeatures dodaje 17 nowych features do state vector (pattern + prediction + anomaly + aggregate)
- Agent stateSize nadal = 313 (ustawiony w commit 815cb7c dla sentymentu)
- **DQN nie widzi ML features** — są dodawane do state object, ale Agent state-to-array konwertuje tylko pierwsze ~313 elementów + padding zera
- Zostało naprawione w bdde096 gdzie Agent stateSize zmieniono na 394

---

## 4. `815cb7c` — Sentiment Analysis

**Status: ⚠️ Uwagi**

- Moduł solidny: singleton, mock data fallback, auto-refresh, proper cleanup (`stopAutoRefresh`)
- `getStateFeature()` normalizuje do 0-1 — poprawne dla DQN
- StateSize zmieniony z 312 na 313 ✅ (dodano 1 feature dla sentymentu)
- **Uwaga:** `usingMockData` jest stały w konstruktorze — jeśli API keys zostaną dodane później (env reload), nadal będzie używał mocków do restartu procesu
- `sentimentHistory` rośnie ale jest ograniczony do 24 — OK

---

## 5. `4348685` — Automated Hyperparameter Optimization

**Status: ⚠️ Uwagi**

- Duży commit: optimizer + multi-asset rebalancing + grid fix
- **Global state:** `global.optimizer` — działa ale anty-pattern (namespace pollution)
- `optimize()` jest async i uruchamiane fire-and-forget z endpointu — brak mechanizmu zatrzymania poza `shouldStop` flagą
- **Multi-asset rebalancing:** `paperMultiPositions` close logic na STOP_API ma błąd w SHORT — `paperTrading.capital += pnl - pos.fee - exitFee` ale SHORT close powinno dodać entryValue, nie exitValue do kapitału (potrzebna dokładna analiza P&L accounting)
- Grid strategy fix: `let gridStrategy = null` przed require, `gridStrategy = new GridStrategy()` po require — naprawia bug z bb46738 ✅
- Agent stateSize zmieniony na 394 ✅

---

## 6. `bb46738` — Grid Trading

**Status: ❌ Bug**

### BUG: `GridStrategy` użyty przed require (krytyczny)

```javascript
// Line ~41 (PRZED require):
const gridStrategy = new GridStrategy();  // ← GridStrategy is undefined!
// ...
// Line ~254:
const { GridStrategy, backtestGridStrategy } = require('../src/strategies/gridStrategy');
```

`new GridStrategy()` wykona się PRZED `require`, więc `GridStrategy` jest undefined → `ReferenceError: GridStrategy is not defined`. Server nie wystartuje.

> **Naprawione w:** 4348685 — `gridStrategy` zainicjalizowane jako `null`, `new GridStrategy()` przeniesione po require.

### Uwaga: Grid stop logic

Stop loss w grid trading: `const stopPrice = entryPrice - (gridParams.gridSize * 2)` — przy `gridSpacing: 'percentage'` gridSize jest procentem, ale mnożenie traktuje go jak wartość absolutną. Błąd konwersji.

---

## 7. `8b3f2b4` — Alerty email/SMS

**Status: ⚠️ Uwagi**

- Solidna przebudowa alertera: email → email + SMS (Twilio) + Telegram + log fallback
- `getConfig()` maskuje email/phone — dobry praktyka bezpieczeństwa ✅
- `updateConfig()` pozwala zmienić email/phone bez restartu — OK
- **Uwaga:** `_sendTwilioSMS` nie ma timeout na HTTP request — przy problemach z Twilio API może wisieć
- **Uwaga:** `shouldAlert` używa `Math.abs(value) >= threshold` — dla loss alerts `percentChange` jest ujemny, `Math.abs` zamienia na pozytywny, więc alert wyzwoli się przy -5% co jest poprawne, ale semantycznie dziwne
- **Breaking change:** usunięto `sendEmail()` i `_sendTelegramFallback()` — jeśli gdzieś indziej były wywoływane, będą błędy. Ale z diffu wynika że refaktor jest kompletny

---

## 8. `b63d066` — Responsive mobile dashboard

**Status: ✅ OK**

- Solidny responsive CSS z 5 breakpointami (1024/768/480/360)
- Touch-friendly: `touch-action: manipulation`, `-webkit-tap-highlight-color`, 44px min tap targets ✅
- Sticky bottom navigation z scroll-spy
- `-webkit-overflow-scrolling: touch` dla smooth scroll na iOS
- Brak JS bugs — prosty scroll-to-section logic
- **Jedyna uwaga:** `cards[3]?.scrollIntoView` — hardcoded indexy kart mogą się zmienić gdy dodawane są nowe sekcje (heatmap, optimizer, etc.)

---

## Podsumowanie

| Commit | Status | Opis |
|--------|--------|------|
| `0a89a5a` | ⚠️ | R&R Display — minor innerHTML pattern |
| `bdde096` | ⚠️ | Heatmap — fetch overlap, chart memory leak |
| `1e07ab0` | ❌ | **ML Features — orphaned code, res.json() crash, stateSize mismatch** |
| `815cb7c` | ⚠️ | Sentiment — stale usingMockData flag |
| `4348685` | ⚠️ | Optimizer — global state, fire-and-forget |
| `bb46738` | ❌ | **Grid Trading — GridStrategy used before require** |
| `8b3f2b4` | ⚠️ | Alerts — Twilio no timeout, breaking change |
| `b63d066` | ✅ | Responsive — solid, no bugs |

---

## Issues do utworzenia (tylko ❌)

1. **`1e07ab0`** — Orphaned sentiment handler code w server/index.js (krytyczny — crash)
2. **`1e07ab0`** — State size mismatch: ML features nie są konwertowane do array (Agent stateSize 313 vs 17 ML features)
3. **`bb46738`** — GridStrategy used before require — server crash on startup
