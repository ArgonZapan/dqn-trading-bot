import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
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
  if (!data?.candles?.length) {
    return (
      <Card title="📊 Wykres ostatniego epizodu">
        <div className="chart-placeholder">Uruchom trening aby zobaczyć wykres</div>
      </Card>
    );
  }

  const chartData = data.candles.map((c, i) => ({
    step: i,
    price: c.close,
    buy: data.actions?.[i] === 1 ? c.close : null,
    sell: data.actions?.[i] === 2 ? c.close : null,
  }));

  return (
    <Card title={`📊 Wykres epizodu #${data.episode || '?'}`}>
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
      {data?.episodes?.length ? (
        <div className="episode-list">
          {data.episodes.slice(-10).reverse().map((ep, i) => (
            <div key={i} className="episode-row">
              <span>#{ep.episode}</span>
              <span className={ep.reward >= 0 ? 'green' : 'red'}>
                {ep.reward?.toFixed(2)}
              </span>
              <span className="text-muted">{ep.steps} steps</span>
              <span className="text-muted">ε={ep.epsilon?.toFixed(3)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">Brak danych — uruchom trening</div>
      )}
    </Card>
  );
}
