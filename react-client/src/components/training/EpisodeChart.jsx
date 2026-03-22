import { useEffect, useRef, memo, useMemo } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../../api/client';
import { Card, LoadingSpinner } from '../common';

/**
 * Deduplicate candle timestamps (TradingView requires unique times).
 * If 2 ticks share the same second, shift later ones by +1s.
 */
function dedupeCandles(candles) {
  const seen = new Set();
  return candles.map(c => {
    let t = c.time;
    while (seen.has(t)) t++;
    seen.add(t);
    return { ...c, time: t };
  });
}

/**
 * Extract trade markers from candle action field.
 */
function extractMarkers(candles) {
  if (!candles?.length) return [];
  const tradeActions = ['BUY', 'SELL', 'SHORT', 'COVER'];
  return candles
    .filter(c => tradeActions.includes(c.action))
    .map(c => {
      const isBuy = c.action === 'BUY' || c.action === 'COVER';
      return {
        time: c.time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#4ade80' : '#f87171',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: c.action,
      };
    })
    .sort((a, b) => a.time - b.time);
}

/**
 * Reusable CandlestickChart — renders one chart with candles + trade markers.
 * Candles come ready from backend (each tick = 1 OHLC candle).
 */
const CandlestickChart = memo(function CandlestickChart({ title, subtitle, candles, height = 280 }) {
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
        secondsVisible: true,
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

    // Ensure candles have integer time (seconds, not ms)
    const formattedCandles = candles.map(c => ({
      time: typeof c.time === 'number' && c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Deduplicate timestamps (TradingView requires unique times)
    const uniqueCandles = dedupeCandles(formattedCandles);

    candlestickSeries.setData(uniqueCandles);

    // Markers from candle.action field
    const markers = extractMarkers(candles);
    if (markers.length > 0) {
      createSeriesMarkers(candlestickSeries, markers);
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
  }, [candles, height]);

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
 * EpisodeCharts — fetches /api/episode-data every 2s, renders two charts:
 *   1. Aktualny Epizod (LIVE) — candles directly from API
 *   2. Poprzedni Epizod — candles directly from API
 */
export function EpisodeCharts() {
  const { data, isLoading } = useQuery({
    queryKey: ['episode', 'data'],
    queryFn: endpoints.episodeData,
    refetchInterval: 2000, // co 2s dla live
  });

  const currentCandles = data?.currentEp?.candles || [];
  const prevCandles = data?.prevEp?.candles || [];

  const prevSubtitle = prevCandles.length > 0
    ? `Poprzedni epizod (${prevCandles.length} świec)`
    : undefined;

  if (isLoading) return <Card title="📊 Wykresy epizodów"><LoadingSpinner /></Card>;

  return (
    <>
      <CandlestickChart
        title="📊 Aktualny Epizod (LIVE)"
        candles={currentCandles}
        height={280}
      />
      <CandlestickChart
        title="📊 Poprzedni Epizod"
        candles={prevCandles}
        subtitle={prevSubtitle}
        height={280}
      />
    </>
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
