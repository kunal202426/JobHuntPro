import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const COLD_API = import.meta.env.VITE_COLD_API_URL || 'http://localhost:8000'
const LINKEDIN_API = import.meta.env.VITE_LINKEDIN_API_URL || 'http://localhost:3001'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { user, token } = useAuth()
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [view, setView] = useState('cold') // 'cold' | 'jobs' | 'linkedin_leads'
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.is_admin) return
    fetch(`${COLD_API}/admin/users`, { headers: authHeaders(token) })
      .then(r => r.json())
      .then(setUsers)
      .catch(() => setError('Failed to load users'))
  }, [user])

  async function loadUserData(uid, viewType) {
    setLoading(true); setError(''); setData([])
    try {
      let res
      if (viewType === 'cold') {
        res = await fetch(`${COLD_API}/admin/users/${uid}/leads`, { headers: authHeaders(token) })
      } else if (viewType === 'jobs') {
        res = await fetch(`${LINKEDIN_API}/admin/users/${uid}/jobs`, { headers: authHeaders(token) })
      } else {
        res = await fetch(`${LINKEDIN_API}/admin/users/${uid}/li_leads`, { headers: authHeaders(token) })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (err) {
      setError(`Failed to load data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  function selectUser(u) {
    setSelectedUser(u)
    loadUserData(u.id, view)
  }

  function changeView(v) {
    setView(v)
    if (selectedUser) loadUserData(selectedUser.id, v)
  }

  if (!user?.is_admin) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You need admin privileges to view this page.</p>
      </div>
    )
  }

  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'inherit', flexDirection: 'column' }}>

      {/* Mobile top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }} className="admin-mobile-bar">
        <button onClick={() => navigate('/jobhunt')} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#334155', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>← Back</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Admin Portal</span>
        <button onClick={() => setSidebarOpen(o => !o)} style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#334155', cursor: 'pointer', fontSize: 12 }}>
          {selectedUser ? selectedUser.email.split('@')[0] : 'Select User'} ▾
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: 260, borderRight: '1px solid #e2e8f0', padding: '24px 16px', overflowY: 'auto', background: '#f8fafc', flexShrink: 0 }} className={`admin-sidebar ${sidebarOpen ? 'admin-sidebar--open' : ''}`}>
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => navigate('/jobhunt')}
            style={{
              marginBottom: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: 'white',
              color: '#334155',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              width: '100%',
            }}
          >
            ← Back to workspace
          </button>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Admin Portal</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{users.length} users</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => { selectUser(u); setSidebarOpen(false) }}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid',
                borderColor: selectedUser?.id === u.id ? '#6366f1' : '#e2e8f0',
                background: selectedUser?.id === u.id ? '#eef2ff' : 'white',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {u.leads_count} cold leads · {u.sent_count} sent
                {u.is_admin && ' · admin'}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ borderBottom: '1px solid #e2e8f0', padding: '0 24px', display: 'flex', gap: 0 }}>
          {[
            { id: 'cold', label: 'Cold Email Leads' },
            { id: 'jobs', label: 'Scraped Jobs' },
            { id: 'linkedin_leads', label: 'LinkedIn Leads' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => changeView(tab.id)}
              style={{
                padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: view === tab.id ? 600 : 400,
                borderBottom: view === tab.id ? '2px solid #6366f1' : '2px solid transparent',
                color: view === tab.id ? '#6366f1' : '#64748b',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!selectedUser && (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
              <p style={{ fontSize: 32 }}>👆</p>
              <p>Select a user from the sidebar to view their data</p>
            </div>
          )}

          {selectedUser && (
            <div>
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>
                {selectedUser.email} — {view === 'cold' ? 'Cold Email Leads' : view === 'jobs' ? 'Scraped Jobs' : 'LinkedIn Leads'}
              </h3>

              {loading && <p style={{ color: '#94a3b8' }}>Loading…</p>}
              {error && <p style={{ color: '#ef4444' }}>{error}</p>}

              {!loading && !error && view === 'cold' && (
                <ColdLeadsTable leads={data} />
              )}
              {!loading && !error && view === 'jobs' && (
                <JobsTable jobs={data} />
              )}
              {!loading && !error && view === 'linkedin_leads' && (
                <LinkedInLeadsTable leads={data} />
              )}
            </div>
          )}
        </div>
      </main>
      </div>
    </div>
  )
}

function ColdLeadsTable({ leads }) {
  if (!leads.length) return <p style={{ color: '#94a3b8' }}>No cold email leads yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
            {['Name', 'Email', 'Company', 'Position', 'Type', 'Status', 'Sent At'].map(h => (
              <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 12px' }}>{l.hr_name}</td>
              <td style={{ padding: '8px 12px' }}>{l.hr_email}</td>
              <td style={{ padding: '8px 12px' }}>{l.company}</td>
              <td style={{ padding: '8px 12px', color: '#64748b' }}>{l.hr_position || '—'}</td>
              <td style={{ padding: '8px 12px' }}>{l.email_type}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                  background: l.status === 'sent' ? '#dcfce7' : l.status === 'failed' ? '#fee2e2' : '#f1f5f9',
                  color: l.status === 'sent' ? '#166534' : l.status === 'failed' ? '#991b1b' : '#475569',
                }}>
                  {l.status}
                </span>
              </td>
              <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                {l.sent_at ? new Date(l.sent_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobsTable({ jobs }) {
  if (!jobs.length) return <p style={{ color: '#94a3b8' }}>No jobs scraped yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
            {['Title', 'Company', 'Location', 'Source', 'Score', 'Status', 'Posted'].map(h => (
              <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map(j => (
            <tr key={j.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 12px' }}>
                <a href={j.job_url} target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>{j.title}</a>
              </td>
              <td style={{ padding: '8px 12px' }}>{j.company}</td>
              <td style={{ padding: '8px 12px', color: '#64748b' }}>{j.location || '—'}</td>
              <td style={{ padding: '8px 12px' }}>{j.source}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: j.ai_score >= 8 ? '#166534' : j.ai_score >= 5 ? '#92400e' : '#475569' }}>
                {j.ai_score ?? '—'}
              </td>
              <td style={{ padding: '8px 12px' }}>{j.status}</td>
              <td style={{ padding: '8px 12px', color: '#64748b' }}>{j.posted_at || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LinkedInLeadsTable({ leads }) {
  if (!leads.length) return <p style={{ color: '#94a3b8' }}>No LinkedIn leads yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
            {['Name', 'Title', 'Company', 'Score', 'Category', 'Status', 'Job'].map(h => (
              <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 12px' }}>
                <a href={l.profile_url} target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>{l.name}</a>
              </td>
              <td style={{ padding: '8px 12px', color: '#64748b' }}>{l.title || '—'}</td>
              <td style={{ padding: '8px 12px' }}>{l.company || '—'}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{l.ai_score ?? '—'}</td>
              <td style={{ padding: '8px 12px' }}>{l.category || '—'}</td>
              <td style={{ padding: '8px 12px' }}>{l.connect_status}</td>
              <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 11 }}>{l.job_title} @ {l.job_company}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
