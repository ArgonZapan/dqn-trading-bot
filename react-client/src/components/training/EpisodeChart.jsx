import { useEffect, useRef, memo, useMemo } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../../api/client';
import { Card, LoadingSpinner } from '../common';

/**
 * Convert raw step data [{step, time, price, action, equity}] to OHLC candles.
 * @param {Array} steps - raw step array
 * @param {number} targetCount - target number of candles (dynamic bucketing)
 * @returns {Array} OHLC candles with integer-seconds timestamps
 */
function bucketStepsToCandles(steps, targetCount = 20) {
  if (steps.length < 2) return [];
  const totalTime = steps[steps.length - 1].time - steps[0].time;
  const bucketMs = Math.max(100, Math.floor(totalTime / targetCount));
  const buckets = {};
  for (const s of steps) {
    const bucket = Math.floor(s.time / bucketMs) * bucketMs;
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(s.price);
  }
  return Object.entries(buckets)
    .map(([t, p]) => ({
      time: Math.floor(Number(t) / 1000),
      open: p[0],
      high: Math.max(...p),
      low: Math.min(...p),
      close: p[p.length - 1],
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Bucket steps with fixed interval (e.g. 5s for live chart).
 */
function bucketStepsFixed(steps, intervalSec = 5) {
  if (steps.length < 1) return [];
  const buckets = {};
  for (const s of steps) {
    const bucketKey = Math.floor(s.time / (intervalSec * 1000)) * intervalSec;
    if (!buckets[bucketKey]) {
      buckets[bucketKey] = { time: bucketKey, open: s.price, high: s.price, low: s.price, close: s.price };
    } else {
      buckets[bucketKey].high = Math.max(buckets[bucketKey].high, s.price);
      buckets[bucketKey].low = Math.min(buckets[bucketKey].low, s.price);
      buckets[bucketKey].close = s.price;
    }
  }
  return Object.values(buckets).sort((a, b) => a.time - b.time);
}

/**
 * Extract trade markers from step data (steps where action is BUY/SELL/SHORT/COVER).
 */
function extractTradeMarkers(steps, candles) {
  if (!steps?.length || !candles?.length) return [];
  const tradeActions = ['BUY', 'SELL', 'SHORT', 'COVER'];
  const tradeSteps = steps.filter(s => tradeActions.includes(s.action));
  return tradeSteps
    .map(s => {
      const stepSec = Math.floor(s.time / 1000);
      // Snap to nearest candle
      const nearestCandle = candles.reduce((best, c) => {
        return Math.abs(c.time - stepSec) < Math.abs(best.time - stepSec) ? c : best;
      }, candles[0]);
      if (!nearestCandle) return null;
      const isBuy = s.action === 'BUY' || s.action === 'COVER';
      return {
        time: nearestCandle.time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#4ade80' : '#f87171',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: s.action,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

/**
 * Deduplicate candle timestamps (TradingView requires unique times).
 */
function dedupeCandles(candles) {
  const seen = new Set();
  return candles.filter(c => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  });
}

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

    // Ensure candles have integer time (seconds, not ms)
    const formattedCandles = candles.map(c => ({
      time: typeof c.time === 'number' && c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const uniqueCandles = dedupeCandles(formattedCandles);

    // Handle duplicate timestamps with business-day format fallback
    let finalCandles = uniqueCandles;
    if (uniqueCandles.length < formattedCandles.length * 0.8) {
      // Too many dupes — use sequential index as time
      finalCandles = formattedCandles.map((c, i) => ({ ...c, time: i }));
    }

    candlestickSeries.setData(finalCandles);

    // Markers — from trade data
    if (trades?.length) {
      // If trades come from raw steps (have .time), use extractTradeMarkers logic
      if (trades[0]?.time) {
        const markers = extractTradeMarkers(trades, finalCandles);
        if (markers.length > 0) {
          createSeriesMarkers(candlestickSeries, markers);
        }
      } else {
        // Legacy trade format (has .step but no .time)
        const markers = trades
          .map(t => {
            let markerTime = null;
            if (t.step != null && finalCandles.length > 0) {
              const idx = Math.min(t.step, finalCandles.length - 1);
              markerTime = finalCandles[idx]?.time;
            }
            if (!markerTime && finalCandles.length > 0) {
              markerTime = finalCandles[finalCandles.length - 1].time;
            }
            if (!markerTime) return null;

            const nearestCandle = finalCandles.reduce((best, c) => {
              return Math.abs(c.time - markerTime) < Math.abs(best.time - markerTime) ? c : best;
            }, finalCandles[0]);

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
 *   1. Aktualny Epizod (LIVE) — bucketkuje 5s po stronie klienta
 *   2. Poprzedni Epizod (statyczny) — bucketkuje dynamicznie (~20 świec)
 */
export function EpisodeCharts() {
  const { data, isLoading } = useQuery({
    queryKey: ['episode', 'data'],
    queryFn: endpoints.episodeData,
    refetchInterval: 5000, // co 5s dla live update
  });

  // Current episode: bucket raw steps to 5s candles
  const currentCandles = useMemo(() => {
    const steps = data?.currentEp?.steps;
    if (!steps?.length) {
      // Fallback to legacy candles if no steps
      return data?.currentEp?.candles || [];
    }
    return bucketStepsFixed(steps, 5);
  }, [data?.currentEp?.steps, data?.currentEp?.candles]);

  // Trade markers for current episode
  const currentTrades = useMemo(() => {
    const steps = data?.currentEp?.steps;
    if (steps?.length && steps[0]?.time) {
      return steps; // Pass raw steps, CandlestickChart will extract markers
    }
    return data?.currentEp?.trades || [];
  }, [data?.currentEp?.steps, data?.currentEp?.trades]);

  // Previous episode: bucket raw steps dynamically (~20 candles)
  const prevCandles = useMemo(() => {
    const steps = data?.prevEp?.steps;
    if (!steps?.length) {
      // Fallback to legacy candles
      return data?.prevEp?.candles || [];
    }
    return bucketStepsToCandles(steps, 20);
  }, [data?.prevEp?.steps, data?.prevEp?.candles]);

  // Trade markers for previous episode
  const prevTrades = useMemo(() => {
    const steps = data?.prevEp?.steps;
    if (steps?.length && steps[0]?.time) {
      return steps;
    }
    return data?.prevEp?.trades || [];
  }, [data?.prevEp?.steps, data?.prevEp?.trades]);

  const prevEp = data?.prevEp;
  const prevSubtitle = prevEp?.episode != null
    ? `Epizod #${prevEp.episode} (P&L: ${prevEp.pnlPercent >= 0 ? '+' : ''}${prevEp.pnlPercent?.toFixed(2)}%)`
    : undefined;

  if (isLoading) return <Card title="📊 Wykresy epizodów"><LoadingSpinner /></Card>;

  return (
    <>
      <CandlestickChart
        title="📊 Aktualny Epizod (LIVE)"
        candles={currentCandles}
        trades={currentTrades}
        height={280}
      />
      <CandlestickChart
        title="📊 Poprzedni Epizod"
        candles={prevCandles}
        trades={prevTrades}
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

  // Bucket raw steps to candles for legacy chart
  const candles = useMemo(() => {
    const steps = data?.currentEp?.steps;
    if (steps?.length >= 2) {
      return bucketStepsFixed(steps, 5);
    }
    return data?.candles || [];
  }, [data]);

  const trades = useMemo(() => {
    const steps = data?.currentEp?.steps;
    if (steps?.length && steps[0]?.time) return steps;
    return data?.trades || [];
  }, [data]);

  useEffect(() => {
    if (!chartContainerRef.current || !candles?.length) return;

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

    const formattedCandles = candles.map(c => ({
      time: typeof c.time === 'number' && c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const uniqueCandles = dedupeCandles(formattedCandles);
    candlestickSeries.setData(uniqueCandles);

    if (trades?.length) {
      if (trades[0]?.time) {
        const markers = extractTradeMarkers(trades, uniqueCandles);
        if (markers.length > 0) createSeriesMarkers(candlestickSeries, markers);
      } else {
        const markers = trades
          .filter(t => {
            const tradeTime = data?.prices?.find(p => p.step === t.step)?.time;
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
  }, [candles, trades, data]);

  if (isLoading) return <Card title="📊 Wykres epizodu"><LoadingSpinner /></Card>;
  if (!candles?.length) {
    return (
      <Card title="📊 Wykres ostatniego epizodu">
        <div className="chart-placeholder">Uruchom trening aby zobaczyć wykres</div>
      </Card>
    );
  }

  const episode = data?.episode || '?';
  const lastEquity = data?.equity?.[data.equity.length - 1]?.equity;

  return (
    <Card title={`📊 Wykres epizodu #${episode}`}>
      {lastEquity && (
        <div className="episode-stats">
          <span>Equity: <strong>${lastEquity.toFixed(2)}</strong></span>
          <span>Steps: <strong>{data?.prices?.length || 0}</strong></span>
          <span>Trades: <strong>{data?.trades?.length || 0}</strong></span>
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
