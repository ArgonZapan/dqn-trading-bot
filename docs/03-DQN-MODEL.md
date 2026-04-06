# DQN Model Architecture

## Typ modelu
**Deep Q-Network (DQN)** z replay buffer i target network.

## Architektura sieci

```
Input Layer (12 features)
        │
        ▼
Dense Layer 1: 128 units, ReLU activation
        │
        ▼
Dense Layer 2: 64 units, ReLU activation
        │
        ▼
Dense Layer 3: 32 units, ReLU activation
        │
        ▼
Output Layer: 3 units (BUY, SELL, HOLD)
```

## Konfiguracja modelu
| Parametr | Wartość | Uzasadnienie |
|----------|---------|-------------|
| `gamma` (discount factor) | 0.99 | Daleki horyzont planowania |
| `epsilon` (exploration) | 1.0 → 0.01 | Początkowa eksploracja, stopniowa eksploatacja |
| `epsilon_decay` | 0.995 | Powolny spadek epsilon |
| `learning_rate` | 0.0001 | Stabilny training |
| `batch_size` | 32 | Kompromis między szybkością a stabilnością |
| `replay_buffer_size` | 10000 | Duży buffer dla stabilności |
| `target_update_freq` | 100 | Częsta aktualizacja target network |
| `min_replay_size` | 100 | Minimum przed rozpoczęciem learning |

## Input features (12 wymiarów)
```
[change_rate, volatility, volume_ratio,
 price_change_1d, price_change_5d, price_change_20d,
 sma_20_ratio, sma_50_ratio,
 rsi, bb_position, macd_signal, market_cap_norm]
```

## Output (3 akcje)
```
[Q(buy), Q(sell), Q(hold)]
```

## Training loop
```
1. Pobierz batch (32) z replay buffer
2. Oblicz target Q-values: r + γ * max(Q_target(s'))
3. Gradient descent na (Q(s,a) - target)²
4. Co 100 kroków: target_network ← online_network
```

## Epsilon-greedy policy
```javascript
if (Math.random() < epsilon) {
  action = randomAction();  // eksploracja
} else {
  action = argmax(Q(state)); // eksploatacja
}
```

## Zapisywanie modelu
- **Checkpointing**: co 1000 kroków treningowych
- **Format**: TensorFlow.js `model.save()` → format `tensorflowjs`
- **Lokalizacja**: `models/dqn/`
- **Naming**: `dqn_step_{step}.zip`

## Ładowanie modelu
```javascript
const model = await tf.loadLayersModel('file://models/dqn/dqn_step_10000.json');
```
