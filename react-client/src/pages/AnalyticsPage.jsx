import { Card, Button, LoadingSpinner } from '../components/common';
import { useMonteCarlo, useAttribution, usePortfolioHeatmap, useRebalancerStatus, useOptimizerStatus, useStartOptimizer, useStopOptimizer } from '../hooks/useApi';

export default function AnalyticsPage() {
  const { refetch: runMC, data: mc, isFetching: mcLoading } = useMonteCarlo();
  const { data: attribution } = useAttribution();
  const { data: heatmap } = usePortfolioHeatmap();
  const { data: rebalancer } = useRebalancerStatus();
  const { data: optStatus } = useOptimizerStatus();
  const startOpt = useStartOptimizer();
  const stopOpt = useStopOptimizer();

  return (
    <div className="page-grid">
      {/* Monte Carlo */}
      <Card
        title="🎲 Risk Analysis (Monte Carlo)"
        actions={
          <Button onClick={() => runMC()} disabled={mcLoading} size="sm">
            {mcLoading ? '⏳' : '▶ Run'}
          </Button>
        }
      >
        {mcLoading ? (
          <LoadingSpinner text="Running 1000 simulations..." />
        ) : mc?.result ? (
          <div className="mc-results">
            <div className="mc-row">
              <span>VaR 95%:</span><strong>{mc.result.var?.['95']}%</strong>
            </div>
            <div className="mc-row">
              <span>CVaR 95%:</span><strong>{mc.result.cvar?.['95']}%</strong>
            </div>
            <div className="mc-row">
              <span>Prob Loss:</span><strong>{mc.result.probabilityOfLoss}%</strong>
            </div>
            <div className="mc-row">
              <span>Mean Equity:</span><strong>${mc.result.terminalEquity?.mean}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Kliknij Run</div>
        )}
      </Card>

      {/* P&L Attribution */}
      <Card title="📊 P&L Attribution">
        <div className="attribution-tabs">
          <button className="tab active">Strategy</button>
          <button className="tab">Asset</button>
          <button className="tab">Exit</button>
          <button className="tab">Daily</button>
        </div>
        <div className="empty-state">Kliknij ↻ aby załadować</div>
      </Card>

      {/* Portfolio Heatmap */}
      <Card title="🟨 Portfolio Heatmap">
        <div className="heatmap-placeholder">
          {heatmap?.pairs?.length ? (
            <div className="heatmap-grid">
              {heatmap.pairs.map((p) => (
                <div
                  key={p.symbol}
                  className="heatmap-cell"
                  style={{
                    background: p.pnlPercent >= 0
                      ? `rgba(74, 222, 128, ${Math.min(Math.abs(p.pnlPercent) / 10, 1)})`
                      : `rgba(248, 113, 113, ${Math.min(Math.abs(p.pnlPercent) / 10, 1)})`,
                  }}
                >
                  <div>{p.symbol}</div>
                  <div>{p.pnlPercent?.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Brak danych</div>
          )}
        </div>
      </Card>

      {/* Rebalancer */}
      <Card
        title="🔄 Portfolio Rebalancer"
        actions={
          <Button size="sm" variant="success">⚖️ REBALANCE NOW</Button>
        }
      >
        <div className="empty-state">
          {rebalancer?.status || 'Status: Idle'}
        </div>
      </Card>

      {/* Optimizer */}
      <Card title="🔬 Hyperparameter Optimizer">
        <div className="btn-group">
          {optStatus?.running ? (
            <Button onClick={() => stopOpt.mutate()} variant="danger" size="sm">⏹ STOP</Button>
          ) : (
            <Button onClick={() => startOpt.mutate()} size="sm">🔬 OPTYMALIZUJ</Button>
          )}
        </div>
        <div className="status-text">{optStatus?.status || 'Idle'}</div>
        {optStatus?.progress && (
          <div className="bar-container">
            <div className="bar blue" style={{ width: `${optStatus.progress}%` }} />
          </div>
        )}
      </Card>
    </div>
  );
}
