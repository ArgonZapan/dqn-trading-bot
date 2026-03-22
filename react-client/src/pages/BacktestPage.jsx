import { useState } from 'react';
import { Card, MetricsGrid, Button, LoadingSpinner } from '../components/common';
import { useHTFTrend, useSentiment, useStrategyCompare } from '../hooks/useApi';

export default function BacktestPage() {
  const { data: htf, isLoading: htfLoading } = useHTFTrend();
  const { data: sentiment } = useSentiment();
  const { refetch: runCompare, data: compare, isFetching: comparing } = useStrategyCompare();

  return (
    <div className="page-grid">
      {/* HTF Trend */}
      <Card title="🗺️ Market Regime" actions={<span className="badge">HTF Trend Filter</span>}>
        {htfLoading ? <LoadingSpinner /> : (
          <div className="htf-grid">
            <div className="htf-panel">
              <div className="htf-label">1H Timeframe</div>
              <div className={`htf-trend ${htf?.h1?.trend || 'neutral'}`}>
                {htf?.h1?.trend?.toUpperCase() || 'NEUTRAL'}
              </div>
              <div className="htf-details">
                <span>RSI: {htf?.h1?.rsi?.toFixed(1) || '—'}</span>
                <span>EMA200: {htf?.h1?.ema200Dist?.toFixed(2) || '—'}%</span>
                <span>Vol: {htf?.h1?.volumeRatio?.toFixed(2) || '—'}x</span>
              </div>
            </div>
            <div className="htf-panel">
              <div className="htf-label">4H Timeframe</div>
              <div className={`htf-trend ${htf?.h4?.trend || 'neutral'}`}>
                {htf?.h4?.trend?.toUpperCase() || 'NEUTRAL'}
              </div>
              <div className="htf-details">
                <span>RSI: {htf?.h4?.rsi?.toFixed(1) || '—'}</span>
                <span>EMA200: {htf?.h4?.ema200Dist?.toFixed(2) || '—'}%</span>
                <span>Vol: {htf?.h4?.volumeRatio?.toFixed(2) || '—'}x</span>
              </div>
            </div>
          </div>
        )}
        <div className="htf-signal">
          Signal: <strong>{htf?.signal || '—'}</strong>
        </div>
      </Card>

      {/* Portfolio */}
      <Card title="💼 Portfolio">
        <MetricsGrid items={[
          { label: 'USDT', value: '$1000', color: 'green' },
          { label: 'BTC', value: '0' },
          { label: 'ETH', value: '0' },
          { label: 'Total', value: '$1000', color: 'green' },
        ]} />
      </Card>

      {/* Trading Stats */}
      <Card title="📈 Trading">
        <MetricsGrid items={[
          { label: 'Trades', value: '0' },
          { label: 'Win Rate', value: '0%', color: 'green' },
          { label: 'P&L', value: '$0' },
          { label: 'Drawdown', value: '0%', color: 'red' },
        ]} />
      </Card>

      {/* Sentiment */}
      <Card title="🗞️ Market Sentiment">
        <div className="sentiment-meter">
          <span className="sentiment-value">{sentiment?.score || '—'}</span>
          <span className="sentiment-label">{sentiment?.label || '—'}</span>
        </div>
        <div className="sentiment-sources">
          <span>Twitter: {sentiment?.twitter || '—'}</span>
          <span>News: {sentiment?.news || '—'}</span>
        </div>
      </Card>

      {/* Strategy Compare */}
      <Card
        title="⚖️ Strategy Comparison"
        actions={
          <Button onClick={() => runCompare()} disabled={comparing} size="sm">
            {comparing ? '⏳ Running...' : '⚡ Compare'}
          </Button>
        }
      >
        {comparing ? (
          <LoadingSpinner text="Running backtests (6 strategies × 300 candles)..." />
        ) : compare?.comparison ? (
          <table className="compare-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Trades</th>
                <th>Win %</th>
                <th>Equity</th>
                <th>P&L %</th>
                <th>Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {compare.comparison.map((s) => (
                <tr key={s.strategyId}>
                  <td>{s.strategyName}</td>
                  <td>{s.totalTrades}</td>
                  <td>{s.winRate?.toFixed(1)}%</td>
                  <td>${s.finalEquity?.toFixed(2)}</td>
                  <td className={s.totalPnlPercent >= 0 ? 'green' : 'red'}>
                    {s.totalPnlPercent?.toFixed(2)}%
                  </td>
                  <td>{s.sharpeRatio?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">Kliknij Compare aby uruchomić</div>
        )}
      </Card>
    </div>
  );
}
