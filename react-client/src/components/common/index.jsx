export function Card({ title, children, className = '', actions }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-header">
        {title}
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

export function MetricBox({ label, value, color = '' }) {
  return (
    <div className="metric-box">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color}`}>{value}</div>
    </div>
  );
}

export function MetricsGrid({ items }) {
  return (
    <div className="metrics-grid">
      {items.map((item) => (
        <MetricBox key={item.label} {...item} />
      ))}
    </div>
  );
}

export function LoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function StatusBadge({ active, label }) {
  return (
    <span className={`badge ${active ? 'badge-green' : 'badge-gray'}`}>
      {active ? '🟢' : '⚪'} {label}
    </span>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled = false, size = 'md', className = '' }) {
  const variants = {
    primary: 'btn-primary',
    danger: 'btn-danger',
    success: 'btn-success',
    ghost: 'btn-ghost',
  };
  return (
    <button
      className={`btn ${variants[variant]} btn-${size} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
