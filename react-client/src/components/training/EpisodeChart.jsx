import { useEffect, useRef, memo } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../../api/client';
import { Card, LoadingSpinner } from '../common';

/**
 * Reusable CandlestickChart — renders one chart with candles + trade markers.
 */
const CandlestickChart = memo(function CandlestickChart({ title, subtitle, candles, trades, height = 280 }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current || !candles?.length) return;

    // Cleanup previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: 'solid', color: '#0d1117' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#161b22' },
        horzLines: { color: '#161b22' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#58a6ff', width: 1, style: 2 },
        horzLine: { color: '#58a6ff', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#30363d',
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Candlestick series (lightweight-charts v5 API)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#4ade80',
      downColor: '#f87171',
      borderDownColor: '#f87171',
      borderUpColor: '#4ade80',
      wickDownColor: '#f87171',
      wickUpColor: '#4ade80',
    });

    // Ensure candles have integer time (TradingView requires seconds, not ms)
    const formattedCandles = candles.map(c => ({
      time: typeof c.time === 'number' && c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Remove duplicate timestamps (TradingView requires unique times)
    const seen = new Set();
    const uniqueCandles = formattedCandles.filter(c => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    });

    candlestickSeries.setData(uniqueCandles);

    // Markers — BUY/SELL triangles
    if (trades?.length) {
      const markers = trades
        .map(t => {
          // Snap marker to nearest candle
          const stepTime = t.time != null
            ? (typeof t.time === 'number' && t.time > 1e12 ? Math.floor(t.time / 1000) : t.time)
            : null;

          // If we have a step number, try to find time from context
          let markerTime = stepTime;
          if (!markerTime && t.step != null && uniqueCandles.length > 0) {
            // Approximate: map step to candle index
            const idx = Math.min(t.step, uniqueCandles.length - 1);
            markerTime = uniqueCandles[idx]?.time;
          }

          if (!markerTime && uniqueCandles.length > 0) {
            markerTime = uniqueCandles[uniqueCandles.length - 1].time;
          }
          if (!markerTime) return null;

          // Find nearest candle to snap marker
          const nearestCandle = uniqueCandles.reduce((best, c) => {
            return Math.abs(c.time - markerTime) < Math.abs(best.time - markerTime) ? c : best;
          }, uniqueCandles[0]);

          const action = t.action?.toUpperCase() || 'HOLD';
          return {
            time: nearestCandle?.time || markerTime,
            position: (action === 'BUY' || action === 'LONG') ? 'belowBar' : 'aboveBar',
            color: (action === 'BUY' || action === 'LONG') ? '#4ade80' : '#f87171',
            shape: (action === 'BUY' || action === 'LONG') ? 'arrowUp' : 'arrowDown',
            text: action,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);

      if (markers.length > 0) {
        createSeriesMarkers(candlestickSeries, markers);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    // Responsive resize
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, trades, height]);

  return (
    <Card title={title}>
      {subtitle && <div className="episode-subtitle">{subtitle}</div>}
      {candles?.length ? (
        <>
          <div ref={chartContainerRef} style={{ width: '100%', height }} />
          <div className="chart-legend">
            <span style={{ color: '#4ade80' }}>▲ BUY</span>
            <span style={{ color: '#f87171' }}>▼ SELL</span>
            <span style={{ color: '#8b949e' }}>┃ Świece OHLC</span>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {title.includes('LIVE') ? 'Uruchom trening aby zobaczyć wykres na żywo' : 'Brak danych poprzedniego epizodu'}
        </div>
      )}
    </Card>
  );
});

/**
 * EpisodeCharts — fetches /api/episode-data every 5s, renders two charts:
 *   1. Aktualny Epizod (LIVE)
 *   2. Poprzedni Epizod (statyczny)
 */
export function EpisodeCharts() {
  const { data, isLoading } = useQuery({
    queryKey: ['episode', 'data'],
    queryFn: endpoints.episodeData,
    refetchInterval: 5000, // co 5s dla live update
  });

  if (isLoading) return <Card title="📊 Wykresy epizodów"><LoadingSpinner /></Card>;

  const prevEp = data?.prevEp;
  const prevSubtitle = prevEp?.episode != null
    ? `Epizod #${prevEp.episode} (P&L: ${prevEp.pnlPercent >= 0 ? '+' : ''}${prevEp.pnlPercent?.toFixed(2)}%)`
    : undefined;

  return (
    <>
      <CandlestickChart
        title="📊 Aktualny Epizod (LIVE)"
        candles={data?.currentEp?.candles}
        trades={data?.currentEp?.trades}
        height={280}
      />
      <CandlestickChart
        title="📊 Poprzedni Epizod"
        candles={prevEp?.candles}
        trades={prevEp?.trades}
        subtitle={prevSubtitle}
        height={280}
      />
    </>
  );
}

/**
 * Legacy single-chart component — kept for backward compat.
 */
export function EpisodeChart() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['episode', 'current'],
    queryFn: endpoints.episodeData,
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!chartContainerRef.current || !data?.candles?.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { type: 'solid', color: '#0d1117' },
        textColor: '#8b949e',
      },
      grid: {
        vertLines: { color: '#161b22' },
        horzLines: { color: '#161b22' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#58a6ff', width: 1, style: 2 },
        horzLine: { color: '#58a6ff', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#30363d',
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#4ade80',
      downColor: '#f87171',
      borderDownColor: '#f87171',
      borderUpColor: '#4ade80',
      wickDownColor: '#f87171',
      wickUpColor: '#4ade80',
    });

    const formattedCandles = data.candles.map(c => ({
      time: typeof c.time === 'number' && c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const seen = new Set();
    const uniqueCandles = formattedCandles.filter(c => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    });

    candlestickSeries.setData(uniqueCandles);

    if (data.trades?.length) {
      const markers = data.trades
        .filter(t => {
          const tradeTime = data.prices?.find(p => p.step === t.step)?.time;
          return tradeTime != null;
        })
        .map(t => {
          const tradeTime = data.prices.find(p => p.step === t.step).time;
          const time = typeof tradeTime === 'number' && tradeTime > 1e12
            ? Math.floor(tradeTime / 1000)
            : Math.floor(tradeTime / 1000);
          const nearestCandle = uniqueCandles.reduce((best, c) => {
            return Math.abs(c.time - time) < Math.abs(best.time - time) ? c : best;
          }, uniqueCandles[0] || { time });
          return {
            time: nearestCandle?.time || time,
            position: t.action === 'BUY' ? 'belowBar' : 'aboveBar',
            color: t.action === 'BUY' ? '#4ade80' : '#f87171',
            shape: t.action === 'BUY' ? 'arrowUp' : 'arrowDown',
            text: t.action,
          };
        })
        .sort((a, b) => a.time - b.time);

      if (markers.length > 0) {
        createSeriesMarkers(candlestickSeries, markers);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  if (isLoading) return <Card title="📊 Wykres epizodu"><LoadingSpinner /></Card>;
  if (!data?.candles?.length) {
    return (
      <Card title="📊 Wykres ostatniego epizodu">
        <div className="chart-placeholder">Uruchom trening aby zobaczyć wykres</div>
      </Card>
    );
  }

  const episode = data.episode || '?';
  const lastEquity = data.equity?.[data.equity.length - 1]?.equity;

  return (
    <Card title={`📊 Wykres epizodu #${episode}`}>
      {lastEquity && (
        <div className="episode-stats">
          <span>Equity: <strong>${lastEquity.toFixed(2)}</strong></span>
          <span>Steps: <strong>{data.prices?.length || 0}</strong></span>
          <span>Trades: <strong>{data.trades?.length || 0}</strong></span>
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: '100%', height: 280 }} />
      <div className="chart-legend">
        <span style={{ color: '#4ade80' }}>▲ BUY</span>
        <span style={{ color: '#f87171' }}>▼ SELL</span>
        <span style={{ color: '#8b949e' }}>┃ Świece OHLC</span>
      </div>
    </Card>
  );
}

export function EpisodeHistoryList() {
  const { data } = useQuery({
    queryKey: ['episode', 'history'],
    queryFn: endpoints.episodeHistory,
    refetchInterval: 60000,
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
