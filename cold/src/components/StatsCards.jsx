import { useStats } from '../hooks/useQuota';
import { TrendingUp, Send, Clock, AlertTriangle, MessageCircle, Users } from 'lucide-react';

const cards = [
  { key: 'total',   label: 'Total Leads',  icon: Users,          color: '#6c63ff' },
  { key: 'sent',    label: 'Sent',         icon: Send,           color: '#22c55e' },
  { key: 'queued',  label: 'Queued',       icon: Clock,          color: '#3b82f6' },
  { key: 'failed',  label: 'Failed',       icon: AlertTriangle,  color: '#ef4444' },
  { key: 'replied', label: 'Replied',      icon: MessageCircle,  color: '#f59e0b' },
  { key: 'pending', label: 'Pending',      icon: TrendingUp,     color: '#8b5cf6' },
];

export default function StatsCards() {
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="stats-grid">
        {cards.map(({ key }) => (
          <div key={key} className="stat-card">
            <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div className="skeleton" style={{ width: 52, height: 26 }} />
              <div className="skeleton" style={{ width: 80, height: 12 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="stats-grid">
      {cards.map(({ key, label, icon: Icon, color }) => (
        <div key={key} className="stat-card" style={{ '--accent': color }}>
          <div className="stat-icon" style={{ background: `${color}22`, color }}>
            <Icon size={22} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.[key] ?? 0}</span>
            <span className="stat-label">{label}</span>
          </div>
          <div className="stat-glow" style={{ background: color }} />
        </div>
      ))}
    </div>
  );
}
