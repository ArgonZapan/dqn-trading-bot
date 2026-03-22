import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints } from '../api/client';
import useAppStore from '../store/useAppStore';

// ─── TRAINING ───────────────────────────────────────────────

export function useStatus() {
  const setPrices = useAppStore((s) => s.setPrices);
  const setTraining = useAppStore((s) => s.setTrainingActive);

  return useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const data = await endpoints.status();
      setPrices(data.prices);
      setTraining(data.trainingActive);
      return data;
    },
    refetchInterval: (query) => {
      // Szybciej podczas treningu
      return query.state.data?.trainingActive ? 2000 : 5000;
    },
  });
}

export function useStartTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.trainingStart,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  });
}

export function useStopTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.trainingStop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  });
}

export function useSaveModel() {
  return useMutation({ mutationFn: endpoints.trainingSave });
}

// ─── PAPER TRADING ──────────────────────────────────────────

export function usePaperStatus() {
  return useQuery({
    queryKey: ['paper', 'status'],
    queryFn: endpoints.paperStatus,
    refetchInterval: 10000,
  });
}

export function usePaperStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.paperStart,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper'] }),
  });
}

export function usePaperStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.paperStop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper'] }),
  });
}

export function usePaperReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.paperReset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper'] }),
  });
}

export function usePaperHistory() {
  return useQuery({
    queryKey: ['paper', 'history'],
    queryFn: endpoints.paperHistory,
  });
}

export function usePaperTrades() {
  return useQuery({
    queryKey: ['paper', 'trades'],
    queryFn: endpoints.paperTrades,
  });
}

export function usePaperEquityCurve() {
  return useQuery({
    queryKey: ['paper', 'equity'],
    queryFn: endpoints.paperEquityCurve,
  });
}

export function usePaperPerformance() {
  return useQuery({
    queryKey: ['paper', 'performance'],
    queryFn: endpoints.paperPerformance,
  });
}

export function useSelectStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => endpoints.selectStrategy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['paper'] }),
  });
}

// ─── BACKTEST ───────────────────────────────────────────────

export function useHTFTrend() {
  return useQuery({
    queryKey: ['htf'],
    queryFn: endpoints.htfTrend,
    refetchInterval: 60000,
  });
}

export function useSentiment(keyword = 'BTC') {
  return useQuery({
    queryKey: ['sentiment', keyword],
    queryFn: () => endpoints.sentiment(keyword),
    refetchInterval: 120000,
  });
}

// ─── ANALYTICS ──────────────────────────────────────────────

export function useStrategyCompare() {
  return useQuery({
    queryKey: ['strategy', 'compare'],
    queryFn: endpoints.strategyCompare,
    enabled: false, // manual trigger
  });
}

export function useMonteCarlo() {
  return useQuery({
    queryKey: ['monteCarlo'],
    queryFn: endpoints.monteCarlo,
    enabled: false,
  });
}

export function useAttribution() {
  return useQuery({
    queryKey: ['attribution'],
    queryFn: endpoints.attribution,
  });
}

export function usePortfolioHeatmap() {
  return useQuery({
    queryKey: ['heatmap'],
    queryFn: endpoints.portfolioHeatmap,
  });
}

export function useRebalancerStatus() {
  return useQuery({
    queryKey: ['rebalancer'],
    queryFn: endpoints.rebalancerStatus,
  });
}

// ─── LIVE ───────────────────────────────────────────────────

export function useLiveStatus() {
  return useQuery({
    queryKey: ['live', 'status'],
    queryFn: endpoints.liveStatus,
    refetchInterval: 5000,
  });
}

export function useLiveConfigCheck() {
  return useQuery({
    queryKey: ['live', 'config'],
    queryFn: endpoints.liveConfigCheck,
  });
}

// ─── ALERTER ────────────────────────────────────────────────

export function useAlerterStatus() {
  return useQuery({
    queryKey: ['alerter'],
    queryFn: endpoints.alerterStatus,
  });
}

export function useAlerterTest() {
  return useMutation({ mutationFn: endpoints.alerterTest });
}

// ─── OPTIMIZER ──────────────────────────────────────────────

export function useOptimizerStatus() {
  return useQuery({
    queryKey: ['optimizer', 'status'],
    queryFn: endpoints.optimizerStatus,
    refetchInterval: 5000,
  });
}

export function useStartOptimizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.optimizerStart,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['optimizer'] }),
  });
}

export function useStopOptimizer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: endpoints.optimizerStop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['optimizer'] }),
  });
}
