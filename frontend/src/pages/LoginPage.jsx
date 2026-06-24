import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { useAuth } from '../context/AuthContext'
import { fetchWithRetry } from '../utils/fetchWithRetry'

const COLD_API = import.meta.env.VITE_COLD_API_URL || 'http://localhost:8000'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [wakeMsg, setWakeMsg] = useState('')

  function onRetry(attempt, total, delaySecs) {
    setWakeMsg(`Server is starting up… retry ${attempt}/${total} in ${delaySecs}s`)
  }

  async function handleGoogleSuccess(credentialResponse) {
    setError(''); setWakeMsg('')
    setLoading(true)
    try {
      const res = await fetchWithRetry(
        `${COLD_API}/auth/google`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: credentialResponse.credential }),
        },
        { onRetry }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Sign-in failed')
      login(data.token, data.user)
      navigate('/jobhunt', { replace: true })
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Server unreachable — try again in a moment.' : err.message)
    } finally {
      setLoading(false)
      setWakeMsg('')
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setError(''); setWakeMsg('')
    setLoading(true)
    const endpoint = mode === 'signup' ? '/auth/signup' : '/auth/login'
    try {
      const res = await fetchWithRetry(
        `${COLD_API}${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        },
        { onRetry }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Authentication failed')
      login(data.token, data.user)
      navigate('/jobhunt', { replace: true })
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Server unreachable — try again in a moment.' : err.message)
    } finally {
      setLoading(false)
      setWakeMsg('')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">JobHuntPro</h1>
        <p className="auth-subtitle">Sign in to continue</p>

        {error && <p className="auth-error">{error}</p>}
        {wakeMsg && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#f59e0b', margin: '8px 0', padding: '8px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.25)' }}>
            ⏳ {wakeMsg}
          </p>
        )}

        {/* Email / password form */}
        <form onSubmit={handleEmailSubmit} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', margin: '12px 0' }}>
          {mode === 'login' ? (
            <>No account?{' '}
              <button onClick={() => { setMode('signup'); setError('') }} style={linkStyle}>Sign up</button>
            </>
          ) : (
            <>Already have one?{' '}
              <button onClick={() => { setMode('login'); setError('') }} style={linkStyle}>Sign in</button>
            </>
          )}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px' }}>
          <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
          <span style={{ color: '#475569', fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {loading ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Signing in…</p>
          ) : (
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google sign-in failed. Try again.')}
              theme="filled_blue"
              size="large"
              text="signin_with"
              shape="rectangular"
            />
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#f1f5f9',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btnStyle = {
  background: '#6366f1',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  padding: '10px 12px',
  width: '100%',
}

const linkStyle = {
  background: 'none',
  border: 'none',
  color: '#6366f1',
  cursor: 'pointer',
  fontSize: 13,
  padding: 0,
  textDecoration: 'underline',
}
