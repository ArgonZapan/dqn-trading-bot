import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import Layout from './components/layout/Layout';
import TrainingPage from './pages/TrainingPage';
import BacktestPage from './pages/BacktestPage';
import PaperTradingPage from './pages/PaperTradingPage';
import AnalyticsPage from './pages/AnalyticsPage';
import LiveTradingPage from './pages/LiveTradingPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<TrainingPage />} />
              <Route path="/backtest" element={<BacktestPage />} />
              <Route path="/paper" element={<PaperTradingPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/live" element={<LiveTradingPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
