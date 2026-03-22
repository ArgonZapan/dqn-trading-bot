import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/', label: 'Trening', icon: '⚡' },
  { path: '/backtest', label: 'Backtest', icon: '📈' },
  { path: '/paper', label: 'Paper', icon: '📄' },
  { path: '/analytics', label: 'Analytics', icon: '📊' },
  { path: '/live', label: 'Live', icon: '🚀' },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">DQN Bot</div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          end={item.path === '/'}
        >
          <span className="sidebar-icon">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          end={item.path === '/'}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
