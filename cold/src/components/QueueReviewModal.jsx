import { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getLeads } from '../api/client';
import { useApproveDraft } from '../hooks/useLeads';

export default function QueueReviewModal({ open, seed, onClose }) {
  const [approvedIds, setApprovedIds] = useState([]);
  const [rejectedIds, setRejectedIds] = useState([]);
  const { mutate: approveDraft, isPending: isApproving } = useApproveDraft();

  const {
    data: drafts = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['draft-leads', seed],
    queryFn: () => getLeads({ status: 'draft' }),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) return;
    setApprovedIds([]);
    setRejectedIds([]);
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'ArrowRight') handleApprove();
      if (e.key === 'ArrowLeft') handleReject();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const approvedSet = useMemo(() => new Set(approvedIds), [approvedIds]);
  const rejectedSet = useMemo(() => new Set(rejectedIds), [rejectedIds]);
  const remaining = useMemo(
    () => drafts.filter((d) => !approvedSet.has(d.id) && !rejectedSet.has(d.id)),
    [drafts, approvedSet, rejectedSet]
  );

  const total = drafts.length;
  const done = approvedIds.length + rejectedIds.length;
  const progress = total > 0 ? (done / total) * 100 : 0;
  const current = remaining[0];

  const handleApprove = () => {
    if (!current || isApproving) return;
    approveDraft(current.id, {
      onSuccess: () => setApprovedIds((prev) => [...prev, current.id]),
    });
  };

  const handleReject = () => {
    if (!current) return;
    setRejectedIds((prev) => [...prev, current.id]);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: '760px', width: '96vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">Review Queue ({done} / {total})</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh drafts"
            >
              <RefreshCw size={14} className={isFetching ? 'spin' : ''} />
              Refresh
            </button>
            <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <p style={{ textAlign: 'center', padding: 24, color: 'var(--subtext)' }}>Loading drafts…</p>
          ) : total === 0 ? (
            <p style={{ textAlign: 'center', padding: 24, color: 'var(--subtext)' }}>No drafts ready for review.</p>
          ) : !current ? (
            <p style={{ textAlign: 'center', padding: 24, color: 'var(--subtext)' }}>All drafts reviewed.</p>
          ) : (
            <div className="swipe-wrap">
              <div className="swipe-progress">
                <div className="swipe-progress-label">
                  {done + 1} of {total} &nbsp;·&nbsp;
                  ✓ {approvedIds.length} approved &nbsp;·&nbsp;
                  ✗ {rejectedIds.length} kept in draft
                </div>
                <div className="swipe-progress-track">
                  <div className="swipe-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="swipe-card" style={{ textAlign: 'left', cursor: 'default' }}>
                <div className="swipe-card-name" style={{ textAlign: 'center' }}>{current.hr_name || '—'}</div>
                <div className="swipe-card-position" style={{ textAlign: 'center' }}>{current.hr_position || 'Unknown position'}</div>
                <div className="swipe-card-company" style={{ textAlign: 'center' }}>{current.company}</div>
                <div className="swipe-card-email" style={{ textAlign: 'center' }}>{current.hr_email}</div>

                <div className="email-preview" style={{ textAlign: 'left' }}>
                  <div className="email-subject">Subject: {current.email_subject || '—'}</div>
                  <pre className="email-body">{current.email_body || 'No email body generated.'}</pre>
                </div>
              </div>

              <div className="swipe-actions">
                <button className="swipe-btn swipe-btn-reject" onClick={handleReject} title="Keep Draft (←)">
                  <XCircle size={22} />
                </button>
                <button className="swipe-btn swipe-btn-approve" onClick={handleApprove} title="Approve & Send (→)" disabled={isApproving}>
                  <CheckCircle size={22} />
                </button>
              </div>

              <div className="swipe-hint">Use ← / → to keep as draft or approve and send.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
