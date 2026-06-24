import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useCsvPreview, useBulkSubmit } from '../hooks/useLeads';

export default function CSVUpload({ onClose }) {
  const [step, setStep] = useState('upload'); // upload | review | summary | submitting
  const [leads, setLeads] = useState([]);
  const [errors, setErrors] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [approved, setApproved] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [swipeDir, setSwipeDir] = useState(null);
  const fileInputRef = useRef(null);
  const touchStartX = useRef(null);

  const { mutate: runPreview, isPending: isPreviewing } = useCsvPreview();
  const { mutate: runBulk, isPending: isSubmitting } = useBulkSubmit();

  const dupCount = leads.filter((l) => l.is_duplicate).length;

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'review') return;
    const handler = (e) => {
      if (e.key === 'ArrowRight') handleApprove();
      if (e.key === 'ArrowLeft')  handleReject();
      if (e.key === 'Escape')     onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, currentIdx, leads]);

  // ── File handling ─────────────────────────────────────────────────────────
  const processFile = useCallback((file) => {
    if (!file) return;

    // 1. Check file extension
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please upload a .csv file.');
      return;
    }

    // 2. Inspect MIME type (allow empty MIME type as some OS do not set it for CSV)
    const validMimes = [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'text/x-csv',
      'text/comma-separated-values',
      'text/x-comma-separated-values'
    ];
    if (file.type && !validMimes.includes(file.type)) {
      alert('Invalid file type: The selected file is not recognized as a valid CSV file.');
      return;
    }

    // 3. Read first few KB to verify it is not binary/corrupted
    const reader = new FileReader();
    reader.onerror = () => {
      alert('Failed to read the file.');
    };
    reader.onload = (e) => {
      const text = e.target.result;

      // Check for null characters indicating binary data
      if (text.includes('\u0000')) {
        alert('Invalid file format: Binary content detected. Please select a valid CSV file.');
        return;
      }

      // Check for ZIP/Excel (.xlsx) signature
      if (text.startsWith('PK\u0003\u0004')) {
        alert('This file appears to be a ZIP or Excel (.xlsx) file. Please save it as CSV (Comma delimited) format first.');
        return;
      }

      // Check for PDF signature
      if (text.startsWith('%PDF')) {
        alert('This file appears to be a PDF. Please convert or export it as a CSV file first.');
        return;
      }

      // Check if file is empty
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        alert('The uploaded file is empty.');
        return;
      }

      // All client-side checks passed, send to API for preview
      runPreview(file, {
        onSuccess: (data) => {
          if (data.leads.length === 0) {
            const errMsg = data.errors.length > 0
              ? `No valid leads found — ${data.errors.length} rows were missing email or company.`
              : 'No valid leads found in this CSV. Check that columns include email and company.';
            alert(errMsg);
            return; // stay on upload screen
          }
          setLeads(data.leads);
          setErrors(data.errors || []);
          setCurrentIdx(0);
          setApproved([]);
          setRejected([]);
          setStep('review');
        },
        onError: (err) => {
          const msg = err?.response?.data?.detail || 'Failed to parse CSV. Please check the file format.';
          alert(msg);
        },
      });
    };

    reader.readAsText(file.slice(0, 8192));
  }, [runPreview]);

  const handleFileChange = (e) => processFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  // ── Swipe actions ─────────────────────────────────────────────────────────
  const advance = (dir) => {
    setSwipeDir(dir);
    setTimeout(() => {
      setSwipeDir(null);
      const next = currentIdx + 1;
      if (next >= leads.length) {
        setStep('summary');
      } else {
        setCurrentIdx(next);
      }
    }, 160);
  };

  const handleApprove = () => {
    if (currentIdx >= leads.length) return;
    setApproved((prev) => [...prev, leads[currentIdx]]);
    advance('right');
  };

  const handleReject = () => {
    if (currentIdx >= leads.length) return;
    setRejected((prev) => [...prev, leads[currentIdx]]);
    advance('left');
  };

  // ── Touch swipe ───────────────────────────────────────────────────────────
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx > 60) handleApprove();
    else if (dx < -60) handleReject();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    setStep('submitting');
    runBulk(approved, { onSettled: onClose });
  };

  const current = leads[currentIdx];
  const progress = leads.length > 0 ? (currentIdx / leads.length) * 100 : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            {step === 'upload'     && 'Bulk CSV Upload'}
            {step === 'review'     && `Review Leads (${currentIdx + 1} / ${leads.length})`}
            {step === 'summary'    && 'Confirm & Send'}
            {step === 'submitting' && 'Queuing Emails...'}
          </h2>
          <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">

          {/* ── Step 1: Upload ─────────────────────────────────────────── */}
          {step === 'upload' && (
            <>
              <div
                className={`csv-drop-zone${dragOver ? ' drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {isPreviewing ? (
                  <Loader2 size={36} className="spin" style={{ color: 'var(--primary)', margin: '0 auto 12px' }} />
                ) : (
                  <div className="drop-icon">📂</div>
                )}
                <div className="drop-title">
                  {isPreviewing ? 'Parsing CSV...' : 'Drop your CSV here or click to browse'}
                </div>
                <div className="drop-sub">
                  {isPreviewing ? 'Checking for duplicates' : 'Accepted: .csv files only'}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="csv-col-hint">
                <strong style={{ color: 'var(--text)' }}>Expected columns</strong> (names are flexible):<br />
                <code>name</code>, <code>email</code> *, <code>company</code> *, <code>position</code>, <code>linkedin_url</code>, <code>notes</code>
                <br /><span style={{ color: '#fab387' }}>* required</span>
              </div>
            </>
          )}

          {/* ── Step 2: Swipe review ───────────────────────────────────── */}
          {step === 'review' && current && (
            <div className="swipe-wrap">
              <div className="swipe-progress">
                <div className="swipe-progress-label">
                  {currentIdx + 1} of {leads.length} &nbsp;·&nbsp;
                  ✓ {approved.length} approved &nbsp;·&nbsp;
                  ✗ {rejected.length} rejected
                </div>
                <div className="swipe-progress-track">
                  <div className="swipe-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div
                className={`swipe-card${swipeDir === 'left' ? ' swiping-left' : swipeDir === 'right' ? ' swiping-right' : ''}`}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div className="swipe-card-name">{current.hr_name || '—'}</div>
                <div className="swipe-card-position">{current.hr_position || 'Unknown position'}</div>
                <div className="swipe-card-company">{current.company}</div>
                <div className="swipe-card-email">{current.hr_email}</div>
                {current.is_duplicate && (
                  <div>
                    <span className="swipe-dup-badge">
                      Already in system · {current.duplicate_status}
                    </span>
                  </div>
                )}
              </div>

              <div className="swipe-actions">
                <button className="swipe-btn swipe-btn-reject" onClick={handleReject} title="Reject (←)">
                  ✗
                </button>
                <button className="swipe-btn swipe-btn-approve" onClick={handleApprove} title="Approve (→)">
                  ✓
                </button>
              </div>

              <div className="swipe-hint">← Reject &nbsp;·&nbsp; Approve → &nbsp;·&nbsp; Keyboard arrows work too</div>
            </div>
          )}

          {/* ── Step 3: Summary ───────────────────────────────────────── */}
          {step === 'summary' && (
            <>
              <p style={{ color: 'var(--subtext)', fontSize: '0.85rem', textAlign: 'center', marginBottom: '20px' }}>
                Review complete. Here's what you chose:
              </p>
              <div className="csv-summary">
                <div className="csv-summary-stat approved">
                  <div className="stat-num">{approved.length}</div>
                  <div className="stat-lbl">Approved</div>
                </div>
                <div className="csv-summary-stat rejected">
                  <div className="stat-num">{rejected.length}</div>
                  <div className="stat-lbl">Rejected</div>
                </div>
                {dupCount > 0 && (
                  <div className="csv-summary-stat dupes">
                    <div className="stat-num">{approved.filter((l) => l.is_duplicate).length}</div>
                    <div className="stat-lbl">Dupes approved</div>
                  </div>
                )}
              </div>
              {errors.length > 0 && (
                <p style={{ fontSize: '0.75rem', color: '#f9e2af', textAlign: 'center' }}>
                  ⚠ {errors.length} rows skipped (missing email or company)
                </p>
              )}
              {approved.length === 0 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--subtext)', textAlign: 'center' }}>
                  Nothing approved — close and re-upload to try again.
                </p>
              )}
            </>
          )}

          {/* ── Step 4: Submitting ─────────────────────────────────────── */}
          {step === 'submitting' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Loader2 size={40} className="spin" style={{ color: 'var(--primary)', margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--subtext)' }}>Saving {approved.length} leads and queuing generation...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {step === 'upload' && (
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          )}
          {step === 'review' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto', color: 'var(--subtext)' }}
                onClick={() => setStep('summary')}
              >
                Skip remaining ({leads.length - currentIdx} left)
              </button>
            </>
          )}
          {step === 'summary' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep('review'); setCurrentIdx(Math.max(0, leads.length - 1)); }}>
                Back
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={approved.length === 0}
                onClick={handleSubmit}
              >
                <Upload size={14} /> Generate &amp; Queue {approved.length} Emails
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
