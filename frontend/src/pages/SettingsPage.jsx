import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'

const COLD_API = import.meta.env.VITE_COLD_API_URL || 'http://localhost:8000'
const LINKEDIN_API = import.meta.env.VITE_LINKEDIN_API_URL || 'http://localhost:3001'

const DEFAULT_FORM = {
  // Gmail
  gmail_address: '',
  gmail_app_password: '',
  // AI keys
  gemini_api_key: '',
  gemini_api_keys: '',
  claude_api_key: '',
  // Personal
  full_name: '',
  phone: '',
  portfolio_url: '',
  linkedin_url: '',
  // Role
  current_role: '',
  current_company: '',
  graduation_month_year: '',
  target_role: '',
  // AI context
  background_text: '',
  projects: ['', '', ''],
  // Job search profile (drives extension scraping + job scoring — not tied to one resume/college/location)
  college: '',
  location: '',
  experience_years: '',
  target_keywords: '',
  skills: '',
}

export default function SettingsPage() {
  const { user, token, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(DEFAULT_FORM)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [gmailMsg, setGmailMsg] = useState('')
  // Whether secrets already exist server-side (we never load the values themselves)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [hasClaudeKey, setHasClaudeKey] = useState(false)
  const [hasGmailPassword, setHasGmailPassword] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  async function handleResetAccount() {
    const confirmText = 'Type RESET to permanently delete all your scraped jobs, applications, LinkedIn leads, and cold-email leads/mails:'
    const typed = window.prompt(confirmText)
    if (typed !== 'RESET') return

    setResetting(true)
    setResetMsg('')
    try {
      const [liRes, coldRes] = await Promise.all([
        fetch(`${LINKEDIN_API}/api/account/reset`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${COLD_API}/api/account/reset`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      if (!liRes.ok || !coldRes.ok) throw new Error('Reset failed on one or both backends')
      setResetMsg('Account reset — all jobs, leads, and mails cleared.')
    } catch (err) {
      setResetMsg(`Reset failed: ${err.message}`)
    } finally {
      setResetting(false)
    }
  }

  // Inline Gmail OAuth connect (auth-code flow → backend exchanges for a
  // refresh token with gmail.send scope, stored encrypted).
  const connectGmail = useGoogleLogin({
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    onSuccess: async ({ code }) => {
      setGmailConnecting(true)
      setGmailMsg('')
      try {
        const res = await fetch(`${COLD_API}/auth/gmail-connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Failed to connect Gmail')
        setGmailConnected(true)
        setGmailMsg('Gmail connected! You can now send emails.')
        await refreshUser()
      } catch (err) {
        setGmailMsg(`Error: ${err.message}`)
      } finally {
        setGmailConnecting(false)
      }
    },
    onError: (err) => setGmailMsg(`Google error: ${err.error_description || err.error || 'unknown'}`),
  })

  // Load existing profile — merges the cold backend's profile (Gmail/AI
  // keys/email-drafting fields) with the linkedin backend's own copy of the
  // job-search fields (college/location/skills/experience_years) it uses to
  // score jobs and drive the extension's search URLs.
  useEffect(() => {
    if (!token) return
    Promise.all([
      fetch(`${COLD_API}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${LINKEDIN_API}/api/account/profile`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([data, matchProfile]) => {
        if (data) {
          const projects = Array.isArray(data.projects) ? data.projects : []
          while (projects.length < 3) projects.push('')
          setGmailConnected(!!data.has_gmail_connected)
          setHasGeminiKey(!!data.has_gemini_key)
          setHasClaudeKey(!!data.has_claude_key)
          setHasGmailPassword(!!data.has_gmail_password)
          setForm(f => ({
            ...f,
            gmail_address: data.gmail_address || '',
            full_name: data.full_name || '',
            phone: data.phone || '',
            portfolio_url: data.portfolio_url || '',
            linkedin_url: data.linkedin_url || '',
            college: data.college || '',
            current_role: data.current_role || '',
            current_company: data.current_company || '',
            graduation_month_year: data.graduation_month_year || '',
            target_role: data.target_role || '',
            background_text: data.background_text || '',
            projects,
            // Never pre-fill secrets
            gmail_app_password: '',
            gemini_api_key: '',
            gemini_api_keys: '',
            claude_api_key: '',
          }))
        }
        if (matchProfile) {
          setForm(f => ({
            ...f,
            // Cold backend's own college value (set above) wins if present —
            // only fall back to the linkedin-match copy when cold has none.
            college: f.college || matchProfile.college || '',
            location: matchProfile.location || '',
            experience_years: matchProfile.experience_years != null ? String(matchProfile.experience_years) : '',
            target_keywords: Array.isArray(matchProfile.target_keywords) ? matchProfile.target_keywords.join(', ') : '',
            skills: Array.isArray(matchProfile.skills) ? matchProfile.skills.join(', ') : '',
          }))
        }
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [token])

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function setProject(i, val) {
    setForm(f => {
      const projects = [...f.projects]
      projects[i] = val
      return { ...f, projects }
    })
  }

  function addProject() {
    setForm(f => ({ ...f, projects: [...f.projects, ''] }))
  }

  function removeProject(i) {
    setForm(f => ({ ...f, projects: f.projects.filter((_, idx) => idx !== i) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setError(''); setSaved(false)
    if (!form.full_name.trim()) { setError('Full name is required'); return }
    if (!form.gmail_address.trim()) { setError('Gmail address is required'); return }
    setLoading(true)
    try {
      const payload = {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        portfolio_url: form.portfolio_url.trim(),
        linkedin_url: form.linkedin_url.trim(),
        college: form.college.trim(),
        gmail_address: form.gmail_address.trim(),
        current_role: form.current_role.trim(),
        current_company: form.current_company.trim(),
        graduation_month_year: form.graduation_month_year.trim(),
        target_role: form.target_role.trim(),
        background_text: form.background_text.trim(),
        projects_json: JSON.stringify(form.projects.filter(p => p.trim())),
      }
      // Only send secrets if user typed something
      if (form.gmail_app_password.trim()) payload.gmail_app_password = form.gmail_app_password.trim()
      if (form.gemini_api_key.trim()) payload.gemini_api_key = form.gemini_api_key.trim()
      const extraGeminiKeys = form.gemini_api_keys
        .split(/\r?\n|,|;/)
        .map(k => k.trim())
        .filter(Boolean)
      const allGeminiKeys = [form.gemini_api_key.trim(), ...extraGeminiKeys].filter(Boolean)
      if (allGeminiKeys.length > 0) payload.gemini_api_keys = allGeminiKeys
      if (form.claude_api_key.trim()) payload.claude_api_key = form.claude_api_key.trim()

      const matchPayload = {
        full_name: form.full_name.trim(),
        current_role: form.current_role.trim(),
        target_role: form.target_role.trim(),
        background_text: form.background_text.trim(),
        college: form.college.trim(),
        location: form.location.trim(),
        experience_years: form.experience_years.trim(),
        target_keywords: form.target_keywords.trim(),
        skills: form.skills.trim(),
      }

      const [res, matchRes] = await Promise.all([
        fetch(`${COLD_API}/auth/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }),
        fetch(`${LINKEDIN_API}/api/account/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(matchPayload),
        }),
      ])
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to save')
      if (!matchRes.ok) throw new Error('Saved profile, but failed to save job-search settings (college/location/skills)')

      // Reflect newly-saved secrets in the "saved" indicators, then clear the
      // input boxes (we never keep secret values in the form after saving).
      if (allGeminiKeys.length > 0) setHasGeminiKey(true)
      if (form.claude_api_key.trim()) setHasClaudeKey(true)
      if (form.gmail_app_password.trim()) setHasGmailPassword(true)
      setForm(f => ({ ...f, gemini_api_key: '', gemini_api_keys: '', claude_api_key: '', gmail_app_password: '' }))

      await refreshUser()
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div style={{ padding: 40, textAlign: 'center', color: '#9a8a7e' }}>Loading…</div>

  const isNew = !user?.setup_complete

  return (
    <div style={{ minHeight: '100vh', background: '#f5f0eb', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 16px)', overflowY: 'auto' }}>
      <div style={{ maxWidth: 580, margin: '0 auto' }}>

        {isNew && (
          <div style={{ background: 'rgba(200,132,90,0.12)', border: '1px solid rgba(200,132,90,0.4)', borderRadius: 8, padding: '12px 16px', marginBottom: 24, color: '#7a4a28', fontSize: 13 }}>
            <strong>Welcome!</strong> Complete your profile so the AI can write personalised emails on your behalf.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ color: '#1e1510', fontSize: 22, fontWeight: 700, margin: 0 }}>Settings</h1>
          <button
            onClick={logout}
            style={{ background: 'none', border: '1px solid #d4ccc4', borderRadius: 6, color: '#9a8a7e', cursor: 'pointer', fontSize: 12, padding: '6px 12px' }}
          >Sign out</button>
        </div>
        <p style={{ color: '#9a8a7e', fontSize: 13, marginBottom: 28 }}>
          Signed in as <strong style={{ color: '#7a6a5e' }}>{user?.email}</strong>
        </p>

        <form onSubmit={handleSave}>

          {/* ── Section: Gmail ─────────────────────────────── */}
          <Section title="Gmail (for sending cold emails)">
            <Input label="Gmail address" type="email" value={form.gmail_address} onChange={v => set('gmail_address', v)} placeholder="you@gmail.com" required />

            {/* Recommended: OAuth connect (inline) */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: '#7a6a5e', fontSize: 12, marginBottom: 6 }}>
                Authorize Gmail Sending <span style={{ color: '#c8845a', fontSize: 11 }}>(recommended — works everywhere)</span>
              </label>
              {gmailConnected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#4a8f47', fontSize: 13 }}>Gmail connected</span>
                  <button
                    type="button" onClick={() => connectGmail()} disabled={gmailConnecting}
                    style={{ padding: '4px 10px', background: '#fdfaf8', border: '1px solid #d4ccc4', borderRadius: 6, color: '#7a6a5e', fontSize: 11, cursor: 'pointer' }}
                  >
                    Reconnect
                  </button>
                </div>
              ) : (
                <button
                  type="button" onClick={() => connectGmail()} disabled={gmailConnecting}
                  style={{ background: '#c8845a', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {gmailConnecting ? 'Connecting…' : 'Connect Gmail for Sending'}
                </button>
              )}
              {gmailMsg && (
                <p style={{ fontSize: 12, marginTop: 6, color: gmailConnected ? '#4a8f47' : '#b84848' }}>{gmailMsg}</p>
              )}
            </div>

            {/* Fallback: App Password */}
            <details style={{ marginTop: 4 }}>
              <summary style={{ color: '#9a8a7e', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
                Or use an App Password instead (only works if not on Render free tier)
              </summary>
              <div style={{ marginTop: 10 }}>
                <HelpLink href="https://support.google.com/accounts/answer/185833" label="How to create an App Password →" />
                <Input label="Gmail App Password" type="password" saved={hasGmailPassword} value={form.gmail_app_password} onChange={v => set('gmail_app_password', v)} placeholder="16-char app password (leave blank to keep existing)" />
              </div>
            </details>
          </Section>

          {/* ── Section: AI Keys ──────────────────────────── */}
          <Section title="AI API Keys (optional — yours take priority)">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              Add your own Gemini key for priority generation. If you don't, emails still generate using a
              shared server key pool (with OpenRouter + Claude as further fallbacks) — so a key is optional.
              Your key, when set, is always tried first.
            </p>
            <HelpLink href="https://aistudio.google.com/app/apikey" label="Get a free Gemini API key →" />
            <Input label="Gemini API Key" type="password" saved={hasGeminiKey} value={form.gemini_api_key} onChange={v => set('gemini_api_key', v)} placeholder={hasGeminiKey ? 'Key(s) saved — leave blank to keep, or type to add another' : 'AIza… (leave blank to keep existing)'} />
            <label style={{ display: 'block', color: '#7a6a5e', fontSize: 12, marginBottom: 4 }}>
              Additional Gemini API Keys (one per line)
            </label>
            <textarea
              value={form.gemini_api_keys}
              onChange={e => set('gemini_api_keys', e.target.value)}
              placeholder="AIza...\nAIza..."
              rows={3}
              style={textareaStyle}
            />
            <p style={{ color: '#9a8a7e', fontSize: 11, margin: '6px 0 12px' }}>
              Existing keys are hidden. New keys are appended as fallbacks.
            </p>
            <HelpLink href="https://console.anthropic.com/settings/keys" label="Get a Claude API key →" />
            <Input label="Claude API Key" type="password" saved={hasClaudeKey} value={form.claude_api_key} onChange={v => set('claude_api_key', v)} placeholder="sk-ant-… (leave blank to keep existing)" />
          </Section>

          {/* ── Section: Personal Info ─────────────────────── */}
          <Section title="Your Info">
            <Input label="Full name *" value={form.full_name} onChange={v => set('full_name', v)} placeholder="Jane Doe" required />
            <Input label="Phone" value={form.phone} onChange={v => set('phone', v)} placeholder="+91 9999999999" />
            <Input label="Portfolio URL" value={form.portfolio_url} onChange={v => set('portfolio_url', v)} placeholder="https://yoursite.com" />
            <Input label="LinkedIn URL" value={form.linkedin_url} onChange={v => set('linkedin_url', v)} placeholder="https://linkedin.com/in/yourprofile" />
          </Section>

          {/* ── Section: Role ──────────────────────────────── */}
          <Section title="Current Role & Target">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>This is used in the intro sentence of every cold email — be specific.</p>
            <Input label="Current role" value={form.current_role} onChange={v => set('current_role', v)} placeholder="Full Stack Developer Intern" />
            <Input label="Current company" value={form.current_company} onChange={v => set('current_company', v)} placeholder="YES Bank" />
            <Input label="Availability / grad date" value={form.graduation_month_year} onChange={v => set('graduation_month_year', v)} placeholder="July 2026" />
            <Input label="What you're looking for" value={form.target_role} onChange={v => set('target_role', v)} placeholder="full-time SWE roles" />
          </Section>

          {/* ── Section: Job Search Profile ──────────────── */}
          <Section title="Job Search Profile (drives job matching + the extension)">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              Used to score scraped jobs and build the extension's search queries — so results match
              your background, not a fixed profile. Leave blank to use sensible defaults.
            </p>
            <Input label="College / University" value={form.college} onChange={v => set('college', v)} placeholder="e.g. IIT Bombay" />
            <Input label="Location" value={form.location} onChange={v => set('location', v)} placeholder="e.g. Bangalore, India" />
            <Input label="Years of experience" type="number" value={form.experience_years} onChange={v => set('experience_years', v)} placeholder="e.g. 0" />
            <label style={{ display: 'block', color: '#7a6a5e', fontSize: 12, marginBottom: 4 }}>
              Target roles / keywords (comma separated)
            </label>
            <textarea
              value={form.target_keywords}
              onChange={e => set('target_keywords', e.target.value)}
              placeholder="e.g. product manager, growth marketing, business analyst"
              rows={2}
              style={textareaStyle}
            />
            <p style={{ color: '#9a8a7e', fontSize: 11, margin: '6px 0 12px' }}>
              What job titles you're searching for — replaces the default software-engineer keyword list.
            </p>
            <label style={{ display: 'block', color: '#7a6a5e', fontSize: 12, marginBottom: 4 }}>
              Skills (comma separated)
            </label>
            <textarea
              value={form.skills}
              onChange={e => set('skills', e.target.value)}
              placeholder="e.g. react, node, sql, figma, salesforce"
              rows={2}
              style={textareaStyle}
            />
          </Section>

          {/* ── Section: Background ───────────────────────── */}
          <Section title="Your Background (for AI context)">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              Write 2–4 sentences about your skills, what you've built, and what makes you stand out. The AI uses this for the "why fit" paragraph.
            </p>
            <textarea
              value={form.background_text}
              onChange={e => set('background_text', e.target.value)}
              placeholder="e.g. I've been building production features for a high-throughput trading platform using React, Node.js, and FastAPI. I've shipped ML pipelines and distributed systems end-to-end. Strong in backend systems and real-time data."
              rows={4}
              style={textareaStyle}
            />
          </Section>

          {/* ── Section: Projects ─────────────────────────── */}
          <Section title="Projects (AI picks the most relevant one per email)">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              One line per project — describe it concretely (tech + what it does). Add up to 6.
            </p>
            {form.projects.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={p}
                  onChange={e => setProject(i, e.target.value)}
                  placeholder={`Project ${i + 1} — e.g. "Distributed Systems Simulator — ReactFlow, FastAPI, chaos engineering, metrics dashboard"`}
                  style={{ ...inputStyle, flex: 1 }}
                />
                {form.projects.length > 1 && (
                  <button type="button" onClick={() => removeProject(i)} style={removeBtnStyle}>✕</button>
                )}
              </div>
            ))}
            {form.projects.length < 6 && (
              <button type="button" onClick={addProject} style={addBtnStyle}>+ Add project</button>
            )}
          </Section>

          {/* ── Section: Extensions ────────────────────────── */}
          <Section title="Chrome Extensions">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              Two separate installs: JobHunt Engine (LinkedIn scraping + auto-connect) and the
              Autofill extension (fills out application forms). Downloads and step-by-step
              install instructions for both moved to their own page.
            </p>
            <Link
              to="/extensions"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#c8845a', borderRadius: 6, color: '#fff',
                fontSize: 13, fontWeight: 600, padding: '8px 18px',
                textDecoration: 'none',
              }}
            >
              Go to Extensions →
            </Link>
          </Section>

          {/* ── Section: Danger Zone ───────────────────────── */}
          <Section title="Danger Zone">
            <p style={{ color: '#9a8a7e', fontSize: 12, marginBottom: 12 }}>
              Permanently deletes everything: scraped jobs, applied jobs, LinkedIn leads, and cold-email leads/mails across both backends.
              Your account, profile, and settings are kept.
            </p>
            <button
              type="button"
              onClick={handleResetAccount}
              disabled={resetting}
              style={{
                background: '#fdf2f2', border: '1px solid #e8b4b4', borderRadius: 6,
                color: '#b84848', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                padding: '8px 16px',
              }}
            >
              {resetting ? 'Resetting…' : 'Reset Account'}
            </button>
            {resetMsg && <p style={{ color: resetMsg.startsWith('Reset failed') ? '#b84848' : '#4a8f47', fontSize: 13, marginTop: 10 }}>{resetMsg}</p>}
          </Section>

          {error && <p style={{ color: '#b84848', fontSize: 13, marginBottom: 12 }}>{error}</p>}
          {saved && <p style={{ color: '#4a8f47', fontSize: 13, marginBottom: 12 }}>Saved! {user?.setup_complete ? 'Redirecting…' : ''}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="submit" disabled={loading} style={saveBtnStyle}>
              {loading ? 'Saving…' : 'Save Settings'}
            </button>
            <button type="button" onClick={() => navigate('/jobhunt')} style={cancelBtnStyle}>
              {isNew ? 'Skip for now →' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ color: '#4a3728', fontSize: 14, fontWeight: 600, marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #d4ccc4' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function SavedBadge() {
  return (
    <span style={{ marginLeft: 8, color: '#4a8f47', fontSize: 11, fontWeight: 600, background: 'rgba(74,143,71,0.12)', border: '1px solid rgba(74,143,71,0.35)', borderRadius: 10, padding: '1px 8px' }}>
      ✓ Saved
    </span>
  )
}

function Input({ label, type = 'text', value, onChange, placeholder, required, saved }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', color: '#7a6a5e', fontSize: 12, marginBottom: 4 }}>
        {label}{saved && <SavedBadge />}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={inputStyle}
      />
    </div>
  )
}

function HelpLink({ href, label }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ display: 'block', color: '#c8845a', fontSize: 12, marginBottom: 10, textDecoration: 'none' }}>
      {label}
    </a>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#fdfaf8', border: '1px solid #d4ccc4',
  borderRadius: 6, padding: '9px 12px',
  color: '#1e1510', fontSize: 13,
  outline: 'none',
}

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
}

const saveBtnStyle = {
  padding: '10px 24px', background: '#c8845a',
  border: 'none', borderRadius: 6,
  color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
}

const cancelBtnStyle = {
  padding: '10px 16px', background: '#fdfaf8',
  border: '1px solid #d4ccc4', borderRadius: 6,
  color: '#7a6a5e', fontSize: 13, cursor: 'pointer',
}

const removeBtnStyle = {
  padding: '9px 10px', background: '#fdfaf8',
  border: '1px solid #d4ccc4', borderRadius: 6,
  color: '#b84848', fontSize: 13, cursor: 'pointer', flexShrink: 0,
}

const addBtnStyle = {
  padding: '7px 14px', background: 'transparent',
  border: '1px dashed #d4ccc4', borderRadius: 6,
  color: '#9a8a7e', fontSize: 12, cursor: 'pointer', marginTop: 4,
}
