import { Card, Button, MetricsGrid, StatusBadge } from '../components/common';
import { useLiveStatus, useLiveConfigCheck, useAlerterStatus, useAlerterTest } from '../hooks/useApi';

export default function LiveTradingPage() {
  const { data: live } = useLiveStatus();
  const { data: config } = useLiveConfigCheck();
  const { data: alerter } = useAlerterStatus();
  const testAlert = useAlerterTest();

  return (
    <div className="page-grid">
      {/* Live Trading */}
      <Card title="🚀 Live Trading">
        <div className="live-header">
          <StatusBadge active={live?.active} label={live?.active ? 'ACTIVE' : 'INACTIVE'} />
          {live?.mode === 'test' && <span className="badge badge-yellow">🧪 TEST</span>}
          {live?.mode === 'real' && <span className="badge badge-red">⚠️ REAL</span>}
        </div>

        {config?.configured ? (
          <>
            <MetricsGrid items={[
              { label: 'Position', value: live?.position || 'None' },
              { label: 'Entry', value: live?.entryPrice ? `$${live.entryPrice}` : '—' },
              { label: 'P&L', value: live?.pnl ? `$${live.pnl.toFixed(2)}` : '—', color: live?.pnl >= 0 ? 'green' : 'red' },
              { label: 'Balance', value: live?.balance ? `$${live.balance.toFixed(2)}` : '—' },
            ]} />
            <div className="btn-group">
              <Button variant="success" size="sm">📈 LONG</Button>
              <Button variant="danger" size="sm">📉 SHORT</Button>
              <Button variant="ghost" size="sm">❌ CLOSE</Button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div style={{ fontSize: '1.5rem' }}>🔐</div>
            <div>API keys not configured</div>
            <div className="hint">Skonfiguruj BINANCE_API_KEY i BINANCE_SECRET</div>
          </div>
        )}
      </Card>

      {/* Alerts */}
      <Card
        title="🔔 Alert Configuration"
        actions={
          <div className="btn-group">
            <Button onClick={() => testAlert.mutate()} size="sm">🧪 TEST</Button>
            <Button variant="ghost" size="sm">🔄 REFRESH</Button>
          </div>
        }
      >
        <div className="alerter-status">
          <span>Status: {alerter?.enabled ? '🟢 Enabled' : '⚪ Disabled'}</span>
          <span>Channel: {alerter?.channel || '—'}</span>
        </div>
      </Card>
    </div>
  );
}
