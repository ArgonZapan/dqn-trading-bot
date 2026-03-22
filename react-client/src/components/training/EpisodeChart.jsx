import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../../api/client';
import { Card, LoadingSpinner } from '../common';

export function EpisodeChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['episode', 'current'],
    queryFn: endpoints.episodeData,
    refetchInterval: 5000,
  });

  if (isLoading) return <Card title="📊 Wykres epizodu"><LoadingSpinner /></Card>;
  if (!data?.prices?.length) {
    return (
      <Card title="📊 Wykres ostatniego epizodu">
        <div className="chart-placeholder">Uruchom trening aby zobaczyć wykres</div>
      </Card>
    );
  }

  // Build chart data from prices + trades
  const chartData = data.prices.map((p, i) => {
    // Find if any trade happened at this step
    const buyTrade = data.trades?.find(t => t.step === p.step && t.action === 'BUY');
    const sellTrade = data.trades?.find(t => t.step === p.step && t.action === 'SELL');
    return {
      step: i,
      price: p.price,
      buy: buyTrade ? p.price : null,
      sell: sellTrade ? p.price : null,
    };
  });

  const episode = data.episode || '?';
  const lastEquity = data.equity?.[data.equity.length - 1]?.equity;

  return (
    <Card title={`📊 Wykres epizodu #${episode}`}>
      {lastEquity && (
        <div className="episode-stats">
          <span>Equity: <strong>${lastEquity.toFixed(2)}</strong></span>
          <span>Steps: <strong>{data.prices.length}</strong></span>
          <span>Trades: <strong>{data.trades?.length || 0}</strong></span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#8b949e' }} />
          <YAxis tick={{ fontSize: 10, fill: '#8b949e' }} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#8b949e' }}
          />
          <Line type="monotone" dataKey="price" stroke="#58a6ff" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="buy" stroke="#4ade80" dot={{ r: 3 }} strokeWidth={0} name="BUY" />
          <Line type="monotone" dataKey="sell" stroke="#f87171" dot={{ r: 3 }} strokeWidth={0} name="SELL" />
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        <span style={{ color: '#4ade80' }}>▲ BUY</span>
        <span style={{ color: '#f87171' }}>▼ SELL</span>
        <span style={{ color: '#58a6ff' }}>● Price</span>
      </div>
    </Card>
  );
}

export function EpisodeHistoryList() {
  const { data } = useQuery({
    queryKey: ['episode', 'history'],
    queryFn: endpoints.episodeHistory,
    refetchInterval: 10000,
  });

  return (
    <Card title="📜 Historia epizodów">
      {data?.length ? (
        <div className="episode-list">
          {data.slice(-10).reverse().map((ep, i) => (
            <div key={i} className="episode-row">
              <span>#{ep.episode}</span>
              <span className={ep.pnlPercent >= 0 ? 'green' : 'red'}>
                {ep.pnlPercent?.toFixed(2) || '—'}%
              </span>
              <span className="text-muted">{ep.steps} steps</span>
              <span className="text-muted">{ep.tradesCount} trades</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">Brak danych — uruchom trening</div>
      )}
    </Card>
  );
}
