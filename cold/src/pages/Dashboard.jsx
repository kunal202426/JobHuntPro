import { useState } from 'react';
import { Upload } from 'lucide-react';
import StatsCards from '../components/StatsCards';
import QuotaBar from '../components/QuotaBar';
import AddHRForm from '../components/AddHRForm';
import LeadsTable from '../components/LeadsTable';
import CSVUpload from '../components/CSVUpload';
import ProspectingPanel from '../components/prospecting/ProspectingPanel';
import QueueReviewModal from '../components/QueueReviewModal';

export default function Dashboard() {
  const [showCsv, setShowCsv]     = useState(false);
  const [activeTab, setActiveTab] = useState('outreach');
  const [showQueueReview, setShowQueueReview] = useState(false);
  const [queueSeed, setQueueSeed] = useState(0);

  const handleQueueOpen = () => {
    setQueueSeed((prev) => prev + 1);
    setShowQueueReview(true);
  };

  const handleQueueProcessed = () => {
    setQueueSeed((prev) => prev + 1);
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1 className="main-title">Cold Outreach Hub</h1>
          <p className="main-subtitle">Automate your HR outreach with GenAI 🚀</p>
        </div>

        <div className="header-actions">
          {/* Tab switcher */}
          <div style={{
            display: 'flex', gap: '3px',
            background: 'var(--surface-2)',
            borderRadius: 'var(--rounded-md)',
            padding: '3px',
            border: '1px solid var(--border)',
          }}>
            <button
              className={`btn btn-sm ${activeTab === 'outreach' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '5px 14px', fontSize: '12px' }}
              onClick={() => setActiveTab('outreach')}
            >
              Outreach
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'prospecting' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '5px 14px', fontSize: '12px' }}
              onClick={() => setActiveTab('prospecting')}
            >
              Prospecting
            </button>
          </div>

          {activeTab === 'outreach' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCsv(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Upload size={14} /> Bulk CSV
            </button>
          )}

          <QuotaBar onQueueOpen={handleQueueOpen} onQueueProcessed={handleQueueProcessed} />
        </div>
      </header>

      {showCsv && <CSVUpload onClose={() => setShowCsv(false)} />}
      {showQueueReview && (
        <QueueReviewModal
          open={showQueueReview}
          seed={queueSeed}
          onClose={() => setShowQueueReview(false)}
        />
      )}

      <main className="dashboard-main">
        {/* Always mounted — hidden via display:none to preserve scroll + state */}
        <div style={{ display: activeTab === 'outreach' ? 'contents' : 'none' }}>
          <section className="dashboard-section section-stats">
            <StatsCards />
          </section>
          <div className="dashboard-grid">
            <aside className="dashboard-sidebar">
              <AddHRForm />
            </aside>
            <section className="dashboard-content">
              <LeadsTable />
            </section>
          </div>
        </div>

        <div style={{ display: activeTab === 'prospecting' ? 'contents' : 'none' }}>
          <section className="dashboard-section">
            <ProspectingPanel />
          </section>
        </div>
      </main>
    </div>
  );
}
