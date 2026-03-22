import { Card, MetricsGrid, Button } from '../components/common';
import { useStatus, useStartTraining, useStopTraining, useSaveModel } from '../hooks/useApi';
import { useTrainingTimer } from '../hooks/useTrainingTimer';

export default function TrainingPage() {
  const { data: status } = useStatus();
  const startTraining = useStartTraining();
  const stopTraining = useStopTraining();
  const saveModel = useSaveModel();

  const training = status?.trainingActive;
  const timer = useTrainingTimer(training);
  const metrics = status?.metrics || {};

  return (
    <div className="page-grid">
      {/* Controls */}
      <Card title="Kontrola">
        <div className="btn-group">
          {!training ? (
            <Button onClick={() => startTraining.mutate()} variant="success">
              ▶ TRAIN
            </Button>
          ) : (
            <Button onClick={() => stopTraining.mutate()} variant="danger">
              ⏹ STOP
            </Button>
          )}
          <Button onClick={() => saveModel.mutate()} variant="ghost">
            💾 SAVE MODEL
          </Button>
        </div>
        <div className="status-text">
          Status: {training ? '🟢 Training...' : '⚪ Idle'}
        </div>
      </Card>

      {/* Agent */}
      <Card title="🧠 Agent">
        <MetricsGrid items={[
          { label: 'Epsilon', value: metrics.epsilon?.toFixed(3) || '—', color: 'blue' },
          { label: 'Episode', value: metrics.episode || 0 },
          { label: 'Buffer', value: metrics.bufferSize || 0 },
          { label: 'Loss', value: metrics.loss?.toFixed(5) || '—' },
        ]} />
        <div className="bar-container">
          <div
            className="bar green"
            style={{ width: `${(metrics.epsilon || 0) * 100}%` }}
          />
        </div>
      </Card>

      {/* Timer */}
      <Card title="⏱️ Training Timer">
        <div className="timer-display">{timer.format()}</div>
        <div className="timer-label">{training ? 'Running' : 'Idle'}</div>
      </Card>

      {/* Episode Chart placeholder */}
      <Card title="📊 Wykres ostatniego epizodu">
        <div className="chart-placeholder">Uruchom trening aby zobaczyć wykres</div>
      </Card>

      {/* Episode History placeholder */}
      <Card title="📜 Historia epizodów">
        <div className="empty-state">Brak danych — uruchom trening</div>
      </Card>

      {/* Logs placeholder */}
      <Card title="📋 Logi">
        <div className="logs">
          <div className="log-entry system">System uruchomiony</div>
        </div>
      </Card>
    </div>
  );
}
