import { useState, useMemo } from 'react';
import { RefreshCw, Search, AlertCircle, Loader2, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { useProspects } from '../../hooks/useProspects';
import ProspectCard from './ProspectCard';

const CATEGORIES = [
  { value: '',                label: 'All' },
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'senior_engineer',label: 'Senior Engineer' },
  { value: 'recruiter',      label: 'Recruiter' },
  { value: 'peer',           label: 'Peer' },
];

const CONNECT_FILTERS = [
  { value: '',           label: 'All' },
  { value: 'sent',       label: 'Connected' },
  { value: 'not_queued', label: 'Not yet' },
];

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

function Chip({ active, onClick, children }) {
  return (
    <button
      className={`btn btn-sm ${active ? 'btn-active' : 'btn-secondary'}`}
      style={{ fontSize: '11px', padding: '5px 10px' }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CompanyGroup({ company, leads }) {
  const [open, setOpen] = useState(false);
  const catCounts = leads.reduce((a, l) => {
    const c = l.category || 'peer';
    a[c] = (a[c] || 0) + 1;
    return a;
  }, {});
  const summary = Object.entries(catCounts)
    .map(([c, n]) => `${n} ${c.replace(/_/g, ' ')}`)
    .join(' · ');

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--rounded-md)',
      background: 'var(--surface-1)',
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', border: 'none', cursor: 'pointer',
          padding: '10px 14px',
          background: 'var(--surface-0)',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {open
            ? <ChevronDown size={14} style={{ color: 'var(--subtext)' }} />
            : <ChevronRight size={14} style={{ color: 'var(--subtext)' }} />
          }
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
            {company}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--subtext)' }}>
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--subtext)' }}>{summary}</span>
      </button>

      {open && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
          padding: 14,
          borderTop: '1px solid var(--border)',
        }}>
          {leads.map((lead) => (
            <ProspectCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProspectingPanel() {
  const [search, setSearch]         = useState('');
  const [category, setCategory]     = useState('');
  const [connectFilter, setConnect] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [viewMode, setViewMode]     = useState('grid'); // 'grid' | 'company'

  const { data: leads = [], isLoading, isError, refetch, isFetching } = useProspects();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter((l) => {
      const matchSearch =
        !q ||
        (l.name    || '').toLowerCase().includes(q) ||
        (l.company || '').toLowerCase().includes(q) ||
        (l.title   || '').toLowerCase().includes(q);
      const matchCategory = !category || l.category === category;
      const matchConnect  =
        !connectFilter ||
        (connectFilter === 'sent'
          ? ['sent', 'accepted'].includes(l.connect_status)
          : l.connect_status === connectFilter);
      const matchDate = matchesDate(l.created_at, dateFilter);
      return matchSearch && matchCategory && matchConnect && matchDate;
    });
  }, [leads, search, category, connectFilter, dateFilter]);

  const companiesList = useMemo(() => {
    if (viewMode !== 'company') return [];
    const map = new Map();
    filtered.forEach((l) => {
      const co = l.company || 'Unknown Company';
      if (!map.has(co)) map.set(co, []);
      map.get(co).push(l);
    });
    return [...map.entries()]
      .map(([company, items]) => ({ company, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [filtered, viewMode]);

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>
            LinkedIn Prospects
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--subtext)', marginTop: 3 }}>
            {isLoading
              ? 'Loading from JobHunt Engine…'
              : isError
              ? 'JobHunt Engine offline'
              : `${filtered.length} of ${leads.length} leads · click a card to reach out by email`}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh"
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <RefreshCw size={13} className={isFetching ? 'spin' : ''} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Filters ── */}
      {!isError && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {/* Row 1: Search + view toggle */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--subtext)', pointerEvents: 'none' }} />
              <input
                className="input"
                placeholder="Search name, company, title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 30, fontSize: '13px' }}
              />
            </div>
            {/* View toggle */}
            <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 'var(--rounded-md)', padding: 3, border: '1px solid var(--border)', flexShrink: 0 }}>
              <button
                className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '5px 12px', fontSize: '12px' }}
                onClick={() => setViewMode('grid')}
              >
                Grid
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'company' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '5px 12px', fontSize: '12px' }}
                onClick={() => setViewMode('company')}
              >
                By Company
              </button>
            </div>
          </div>

          {/* Row 2: Category + connection chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {CATEGORIES.map(({ value, label }) => (
                <Chip key={value} active={category === value} onClick={() => setCategory(value)}>{label}</Chip>
              ))}
            </div>
            <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {CONNECT_FILTERS.map(({ value, label }) => (
                <Chip key={value} active={connectFilter === value} onClick={() => setConnect(value)}>{label}</Chip>
              ))}
            </div>
          </div>

          {/* Row 3: Date chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--subtext)', marginRight: 4 }}>Extracted:</span>
            {DATE_FILTERS.map(({ value, label }) => (
              <Chip key={value} active={dateFilter === value} onClick={() => setDateFilter(value)}>{label}</Chip>
            ))}
          </div>
        </div>
      )}

      {/* ── States ── */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 10, color: 'var(--subtext)' }}>
          <Loader2 size={24} className="spin" />
          <p style={{ fontSize: '14px' }}>Connecting to JobHunt Engine…</p>
          <p style={{ fontSize: '12px' }}>Make sure the LinkedInBot backend is running on localhost:3001</p>
        </div>
      )}

      {isError && !isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 0', textAlign: 'center' }}>
          <AlertCircle size={32} style={{ color: 'var(--danger)', opacity: 0.7 }} />
          <div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>JobHunt Engine is offline</p>
            <p style={{ fontSize: '12px', color: 'var(--subtext)', marginTop: 4 }}>
              Start the LinkedInBot backend (<code>node server.js</code> in <code>linkedin/backend/</code>) then try again.
            </p>
          </div>
          <button className="btn btn-sm" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {!isLoading && !isError && leads.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 0', textAlign: 'center', color: 'var(--subtext)' }}>
          <Users size={32} style={{ opacity: 0.4 }} />
          <p style={{ fontSize: '14px', fontWeight: 500 }}>No leads yet</p>
          <p style={{ fontSize: '12px' }}>
            Use <strong>Find Leads</strong> in JobHunt Engine to discover LinkedIn profiles —<br />
            they'll appear here automatically.
          </p>
        </div>
      )}

      {!isLoading && !isError && leads.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--subtext)' }}>
          <p style={{ fontSize: '14px' }}>No prospects match your filters.</p>
        </div>
      )}

      {/* ── Grid view ── */}
      {!isLoading && !isError && filtered.length > 0 && viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '14px' }}>
          {filtered.map((lead) => (
            <ProspectCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}

      {/* ── By Company view ── */}
      {!isLoading && !isError && filtered.length > 0 && viewMode === 'company' && (
        <div>
          {companiesList.map(({ company, items }) => (
            <CompanyGroup key={company} company={company} leads={items} />
          ))}
        </div>
      )}
    </div>
  );
}
