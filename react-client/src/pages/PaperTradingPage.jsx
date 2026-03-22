import { Card, Button } from '../components/common';
import { usePaperStatus, usePaperStart, usePaperStop, usePaperReset, useSelectStrategy } from '../hooks/useApi';
import useAppStore from '../store/useAppStore';

const STRATEGIES = [
  { id: 'trend', name: '📈 Trend Following' },
  { id: 'mean_reversion', name: '↔️ Mean Reversion' },
  { id: 'momentum', name: '💨 Momentum' },
  { id: 'macd', name: '〰️ MACD Crossover' },
  { id: 'scalping', name: '⚡ Scalping' },
  { id: 'grid', name: '🔲 Grid Trading' },
];

export default function PaperTradingPage() {
  const { data: status } = usePaperStatus();
  const start = usePaperStart();
  const stop = usePaperStop();
  const reset = usePaperReset();
  const selectStrategy = useSelectStrategy();
  const paperStrategy = useAppStore((s) => s.paperStrategy);

  return (
    <div className="page-grid">
      {/* Main Control */}
      <Card title="🎮 Paper Trading">
        <div className="paper-controls">
          <div className="paper-toggle">
            <label className="switch">
              <input
                type="checkbox"
                checked={status?.active || false}
                onChange={() => status?.active ? stop.mutate() : start.mutate()}
              />
              <span className="slider" />
            </label>
            <span>{status?.active ? '🟢 Active' : '⚪ Inactive'}</span>
          </div>
          <div className="btn-group">
            <Button onClick={() => reset.mutate()} variant="danger" size="sm">🔄 RESET</Button>
          </div>
        </div>

        <div className="paper-stats">
          <div className="stat">
            <span className="stat-label">Equity</span>
            <span className="stat-value green">${status?.equity?.toFixed(2) || '1000.00'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Position</span>
            <span className="stat-value">{status?.position || 'None'}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Trades</span>
            <span className="stat-value">{status?.tradesCount || 0}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Win Rate</span>
            <span className="stat-value green">{status?.winRate?.toFixed(1) || '0'}%</span>
          </div>
        </div>
      </Card>

      {/* Strategy Selector */}
      <Card title="🎯 Strategia">
        <div className="strategy-list">
          {STRATEGIES.map((s) => (
            <div
              key={s.id}
              className={`strategy-item ${paperStrategy === s.id ? 'selected' : ''}`}
              onClick={() => {
                useAppStore.getState().setPaperStrategy(s.id);
                selectStrategy.mutate(s.id);
              }}
            >
              {s.name}
            </div>
          ))}
        </div>
      </Card>

      {/* SL/TP */}
      <Card title="⚙️ Stop Loss / Take Profit">
        <div className="param-row">
          <label>Stop Loss %</label>
          <input type="number" step="0.1" defaultValue="3" className="param-input" />
        </div>
        <div className="param-row">
          <label>Take Profit %</label>
          <input type="number" step="0.1" defaultValue="5" className="param-input" />
        </div>
      </Card>

      {/* Equity Curve placeholder */}
      <Card title="📈 Equity Curve">
        <div className="chart-placeholder">Uruchom Paper Trading</div>
      </Card>

      {/* Trade Journal placeholder */}
      <Card title="📖 Trade Journal">
        <div className="empty-state">Brak transakcji</div>
      </Card>
    </div>
  );
}
