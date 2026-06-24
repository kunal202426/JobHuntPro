import { useQuota } from '../hooks/useQuota';
import { useProcessQueue } from '../hooks/useQuota';
import { Zap } from 'lucide-react';

export default function QuotaBar({ onQueueOpen, onQueueProcessed }) {
  const { data: quota } = useQuota();
  const { mutate: processQueue, isPending } = useProcessQueue();

  const sent = quota?.sent ?? 0;
  const cap  = quota?.cap  ?? 90;
  const pct  = Math.min((sent / cap) * 100, 100);
  const isHit = sent >= cap;

  const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';

  return (
    <div className={`quota-bar ${isHit ? 'quota-hit' : ''}`}>
      <div className="quota-info">
        <span className="quota-label">📧 Daily Quota</span>
        <span className="quota-count">
          <strong>{sent}</strong> / {cap} emails sent
        </span>
        {isHit && <span className="quota-warning">⚠️ Daily limit reached — new emails will be queued</span>}
      </div>

      <div className="quota-track">
        <div
          className="quota-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>

      <button
        className="btn btn-sm btn-ghost"
        onClick={() => {
          onQueueOpen?.();
          processQueue(undefined, {
            onSuccess: (data) => onQueueProcessed?.(data),
            onError: () => onQueueProcessed?.(),
          });
        }}
        disabled={isPending}
        title="Prepare queued emails for review before sending"
      >
        <Zap size={14} />
        {isPending ? 'Processing…' : 'Process Queue'}
      </button>
    </div>
  );
}
