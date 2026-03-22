import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../../api/client';
import { Card, LoadingSpinner } from '../common';

export function TradeTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['paper', 'trades'],
    queryFn: endpoints.paperTrades,
    refetchInterval: 10000,
  });

  if (isLoading) return <Card title="📖 Trade History"><LoadingSpinner /></Card>;

  const trades = data?.trades || [];

  return (
    <Card title={`📖 Trade History (${trades.length})`}>
      {trades.length === 0 ? (
        <div className="empty-state">Brak transakcji — włącz Paper Trading</div>
      ) : (
        <div className="trade-table-wrap" style={{ overflowX: 'auto' }}>
          <table className="trade-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>P&L</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(-20).reverse().map((t, i) => (
                <tr key={i}>
                  <td>{trades.length - i}</td>
                  <td>
                    <span className={`badge ${t.side === 'LONG' ? 'badge-green' : 'badge-red'}`}>
                      {t.side}
                    </span>
                  </td>
                  <td>${t.entry?.toFixed(2)}</td>
                  <td>${t.exit?.toFixed(2)}</td>
                  <td className={t.pnl >= 0 ? 'green' : 'red'}>
                    {t.pnl >= 0 ? '+' : ''}{t.pnl?.toFixed(2)}
                  </td>
                  <td className="text-muted">
                    {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function EquityCurveChart() {
  const { data } = useQuery({
    queryKey: ['paper', 'equity'],
    queryFn: endpoints.paperEquityCurve,
    refetchInterval: 10000,
  });

  const chartData = data?.equity?.map((v, i) => ({ step: i, equity: v })) || [];

  if (chartData.length < 2) {
    return (
      <Card title="📈 Equity Curve">
        <div className="chart-placeholder">Brak danych equity</div>
      </Card>
    );
  }

  return (
    <Card title="📈 Equity Curve">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#8b949e' }} />
          <YAxis tick={{ fontSize: 10, fill: '#8b949e' }} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, fontSize: 12 }}
          />
          <ReferenceLine y={1000} stroke="#30363d" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="equity" stroke="#4ade80" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
