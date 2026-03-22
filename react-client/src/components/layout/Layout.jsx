import { Outlet } from 'react-router-dom';
import { Sidebar, BottomNav } from './Nav';
import useAppStore from '../../store/useAppStore';

export default function Layout() {
  const prices = useAppStore((s) => s.prices);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="top-bar">
          <h1 className="app-title">DQN Trading</h1>
          <div className="live-prices">
            <span className="price-pill">BTC ${prices.btc?.toLocaleString() || '—'}</span>
            <span className="price-pill">ETH ${prices.eth?.toLocaleString() || '—'}</span>
            <span className="price-pill">SOL ${prices.sol?.toFixed(2) || '—'}</span>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
