import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLeads, useDeleteLead, useUpdateStatus } from '../hooks/useLeads';
import EmailPreviewModal from './EmailPreviewModal';
import { Trash2, Eye, RefreshCcw, ChevronDown, ChevronRight } from 'lucide-react';

const STATUS_MAP = {
  draft:    { label: '📝 Draft',    cls: 'badge-draft'   },
  pending:  { label: '🟡 Pending',  cls: 'badge-pending'  },
  queued:   { label: '🔵 Queued',   cls: 'badge-queued'   },
  sent:     { label: '🟢 Sent',     cls: 'badge-sent'      },
  failed:   { label: '🔴 Failed',   cls: 'badge-failed'   },
  replied:  { label: '💬 Replied',  cls: 'badge-replied'  },
};

const STATUSES     = ['all', 'draft', 'pending', 'queued', 'sent', 'failed', 'replied'];
const STATUS_OPTIONS = ['draft', 'pending', 'queued', 'sent', 'failed', 'replied'];

const DATE_FILTERS = [
  { value: 'all',       label: 'All Time'  },
  { value: 'today',     label: 'Today'     },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week',      label: 'This Week' },
];

function matchesDate(dateStr, filter) {
  if (filter === 'all') return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
  const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 7);
  if (filter === 'today')     return d >= todayStart;
  if (filter === 'yesterday') return d >= yesterdayStart && d < todayStart;
  if (filter === 'week')      return d >= weekStart;
  return true;
}

/* ── Status dropdown ── */
function StatusDropdown({ lead, onStatusChange }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const badgeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        !badgeRef.current?.contains(e.target) &&
        !document.getElementById('status-portal')?.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleBadgeClick = (e) => {
    e.stopPropagation();
    const rect = badgeRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
    setOpen((v) => !v);
  };

  const { label, cls } = STATUS_MAP[lead.status] || { label: lead.status, cls: '' };

  return (
    <>
      <span ref={badgeRef} className={`badge ${cls} badge-clickable`} onClick={handleBadgeClick} title="Click to change status">
        {label} ▾
      </span>
      {open && createPortal(
        <div id="status-portal" className="status-menu" style={{ position: 'absolute', top: menuPos.top, left: menuPos.left }}>
          {STATUS_OPTIONS.map((s) => (
            <button key={s} className={`status-menu-item ${lead.status === s ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onStatusChange(lead.id, s); setOpen(false); }}>
              <span className={`badge ${STATUS_MAP[s].cls}`}>{STATUS_MAP[s].label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

/* ── Skeleton ── */
function SkeletonRows() {
  return Array.from({ length: 6 }, (_, i) => (
    <tr key={i} style={{ pointerEvents: 'none' }}>
      <td><div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 6 }} /><div className="skeleton" style={{ height: 11, width: '50%' }} /></td>
      <td><div className="skeleton" style={{ height: 13, width: '80%' }} /></td>
      <td><div className="skeleton" style={{ height: 13, width: '60%' }} /></td>
      <td><div className="skeleton" style={{ height: 22, width: 72, borderRadius: 20 }} /></td>
      <td><div className="skeleton" style={{ height: 13, width: '55%' }} /></td>
      <td><div style={{ display: 'flex', gap: 4 }}><div className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} /><div className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} /></div></td>
    </tr>
  ));
}

/* ── Company group (By Company view) ── */
function CompanyGroup({ company, leads, onStatusChange, onDelete, onPreview, fmt }) {
  const [open, setOpen] = useState(false);

  const statusCounts = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="company-group">
      <button className="company-group-header" onClick={() => setOpen((v) => !v)}>
        <div className="company-group-title">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{company}</span>
          <span className="company-group-count">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="company-group-badges">
          {Object.entries(statusCounts).map(([s, n]) => (
            <span key={s} className={`badge ${STATUS_MAP[s]?.cls || ''}`} style={{ fontSize: '10px', padding: '2px 8px' }}>
              {n} {s}
            </span>
          ))}
        </div>
      </button>

      {open && leads.map((lead) => (
        <div key={lead.id} className="company-lead-row" onClick={() => onPreview(lead)}>
          <div className="company-lead-info">
            <span className="company-lead-name">{lead.hr_name}</span>
            <span className="company-lead-email">{lead.hr_email}</span>
            {lead.hr_position && <span className="company-lead-position">{lead.hr_position}</span>}
          </div>
          <span className="ts" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {fmt(lead.sent_at || lead.created_at)}
          </span>
          <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
            <StatusDropdown lead={lead} onStatusChange={onStatusChange} />
          </div>
          <div className="action-btns" onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
            <button className="btn btn-icon" title="Preview" onClick={() => onPreview(lead)}><Eye size={14} /></button>
            <button className="btn btn-icon btn-danger" title="Delete"
              onClick={() => { if (confirm(`Delete ${lead.hr_name}?`)) onDelete(lead.id); }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main component ── */
export default function LeadsTable() {
  const [filterStatus,     setFilterStatus]     = useState('all');
  const [filterCompany,    setFilterCompany]    = useState('');
  const [debouncedCompany, setDebouncedCompany] = useState('');
  const [dateFilter,       setDateFilter]       = useState('all');
  const [viewMode,         setViewMode]         = useState('table');
  const [selectedLead,     setSelectedLead]     = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCompany(filterCompany.trim()), 280);
    return () => clearTimeout(t);
  }, [filterCompany]);

  const apiFilters = {};
  if (filterStatus !== 'all') apiFilters.status  = filterStatus;
  if (debouncedCompany)       apiFilters.company = debouncedCompany;

  const { data: rawLeads = [], isLoading, isFetching, refetch } = useLeads(apiFilters);
  const { mutate: deleteLead }  = useDeleteLead();
  const { mutate: updateStatus } = useUpdateStatus();

  /* client-side date filter on top of server-filtered data */
  const leads = useMemo(
    () => dateFilter === 'all'
      ? rawLeads
      : rawLeads.filter((l) => matchesDate(l.created_at, dateFilter)),
    [rawLeads, dateFilter]
  );

  /* group for company view */
  const companiesView = useMemo(() => {
    const map = new Map();
    leads.forEach((l) => {
      const co = l.company || 'Unknown';
      if (!map.has(co)) map.set(co, []);
      map.get(co).push(l);
    });
    return [...map.entries()]
      .map(([company, items]) => ({ company, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [leads]);

  const handleStatusChange = (id, status) => {
    updateStatus({ id, status });
    setSelectedLead((prev) => prev ? { ...prev, status } : prev);
  };

  const fmt = (ts) =>
    ts ? new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const hasFilter = filterStatus !== 'all' || debouncedCompany || dateFilter !== 'all';

  const emptyMsg = hasFilter ? 'No leads match this filter.' : 'No leads yet — add your first HR! 🚀';

  return (
    <div className="leads-section">

      {/* ══ Filter bar ══ */}
      <div className="leads-filters-bar">

        {/* Row 1 — Status chips + company search + refresh */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="filter-group">
            {STATUSES.map((s) => (
              <button key={s} className={`filter-chip ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                {s === 'all' ? 'All' : STATUS_MAP[s]?.label || s}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <input
              className="input search-input"
              placeholder="Filter by company…"
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => refetch()} title="Refresh">
              <RefreshCcw size={14} className={isFetching ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Row 2 — Date chips + view toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="filter-group" style={{ alignItems: 'center' }}>
            {DATE_FILTERS.map((df) => (
              <button key={df.value} className={`filter-chip ${dateFilter === df.value ? 'active' : ''}`}
                onClick={() => setDateFilter(df.value)}>
                {df.label}
              </button>
            ))}
            {leads.length > 0 && (
              <span style={{ fontSize: '0.78rem', color: 'var(--subtext)', marginLeft: 4 }}>
                {leads.length} lead{leads.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 'var(--rounded-md)', padding: 3, border: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'company' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => setViewMode('company')}
            >
              Company
            </button>
          </div>
        </div>
      </div>

      {/* ══ Table view ══ */}
      {viewMode === 'table' && (
        <div className="table-wrap">
          <table className="leads-table">
            <thead>
              <tr>
                <th>Name</th><th>Company</th><th>Position</th>
                <th>Status</th><th>Sent At</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <SkeletonRows />
                : leads.length === 0
                ? <tr><td colSpan={6} className="table-empty">{emptyMsg}</td></tr>
                : leads.map((lead) => (
                  <tr key={lead.id} className="lead-row" onClick={() => setSelectedLead(lead)}>
                    <td>
                      <div className="lead-name">{lead.hr_name}</div>
                      <div className="lead-email">{lead.hr_email}</div>
                    </td>
                    <td>{lead.company}</td>
                    <td>{lead.hr_position || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <StatusDropdown lead={lead} onStatusChange={handleStatusChange} />
                      {lead.status === 'failed' && lead.error_log && (
                        <div title={lead.error_log} style={{ fontSize: '10px', color: '#f87171', marginTop: 2, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>
                          ⚠ {lead.error_log}
                        </div>
                      )}
                    </td>
                    <td className="ts">{fmt(lead.sent_at || lead.queued_at || lead.created_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="action-btns">
                        <button className="btn btn-icon" title="Preview" onClick={() => setSelectedLead(lead)}><Eye size={15} /></button>
                        <button className="btn btn-icon btn-danger" title="Delete"
                          onClick={() => { if (confirm(`Delete ${lead.hr_name}?`)) deleteLead(lead.id); }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}

      {/* ══ By Company view ══ */}
      {viewMode === 'company' && (
        <div className="table-wrap" style={{ paddingTop: 14, paddingBottom: 14 }}>
          {isLoading ? (
            <p style={{ textAlign: 'center', padding: 32, color: 'var(--subtext)' }}>Loading…</p>
          ) : leads.length === 0 ? (
            <p style={{ textAlign: 'center', padding: 32, color: 'var(--subtext)' }}>{emptyMsg}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {companiesView.map(({ company, items }) => (
                <CompanyGroup
                  key={company}
                  company={company}
                  leads={items}
                  onStatusChange={handleStatusChange}
                  onDelete={deleteLead}
                  onPreview={setSelectedLead}
                  fmt={fmt}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedLead && (
        <EmailPreviewModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
