import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchWithRetry } from '../utils/fetchWithRetry'

const AuthContext = createContext(null)
const COLD_API = import.meta.env.VITE_COLD_API_URL || 'http://localhost:8000'

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('jh_token'))
  const [loading, setLoading] = useState(true)
  const [serverWaking, setServerWaking] = useState(false)

  const emitAuthSync = useCallback((nextToken, nextEmail = '') => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('jh:auth-sync', {
      detail: { token: nextToken || null, email: nextEmail || '' },
    }))
  }, [])

  const fetchUser = useCallback(async (tok) => {
    try {
      const r = await fetchWithRetry(
        `${COLD_API}/auth/me`,
        { headers: { Authorization: `Bearer ${tok}` } },
        {
          retries: 4,
          baseDelay: 4000,
          onRetry: () => setServerWaking(true),
        }
      )
      setServerWaking(false)
      if (!r.ok) return null
      return await r.json()
    } catch {
      setServerWaking(false)
      return null
    }
  }, [])

  const login = useCallback((tok, userData) => {
    localStorage.setItem('jh_token', tok)
    setToken(tok)
    setUser(userData)
    emitAuthSync(tok, userData?.email || '')
  }, [emitAuthSync])

  const logout = useCallback(({ emit = true } = {}) => {
    localStorage.removeItem('jh_token')
    setToken(null)
    setUser(null)
    if (emit) emitAuthSync(null, '')
  }, [emitAuthSync])

  useEffect(() => {
    let cancelled = false

    if (!token) {
      setLoading(false)
      return () => { cancelled = true }
    }

    setLoading(true)
    fetchUser(token).then(data => {
      if (cancelled) return
      if (data) setUser(data)
      else logout()
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [token, fetchUser, logout])

  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== 'jh_token') return
      setToken(event.newValue)
      if (!event.newValue) setUser(null)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  async function refreshUser() {
    if (!token) return
    const data = await fetchUser(token)
    if (data) setUser(data)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, serverWaking, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
