import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 20,
          color: '#f87171',
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          margin: 16,
        }}>
          <h3 style={{ marginBottom: 8 }}>⚠️ Coś poszło nie tak</h3>
          <p style={{ fontSize: '0.75rem', color: '#8b949e' }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 12,
              padding: '6px 16px',
              background: '#30363d',
              color: '#e6edf3',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            🔄 Spróbuj ponownie
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
