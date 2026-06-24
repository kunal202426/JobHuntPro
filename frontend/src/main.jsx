import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'

// Cold Email's design system (CSS vars, .btn, .input, etc.) — loaded first
import '@ce/index.css'
// Tailwind utilities for LinkedInBot's components — loaded second, no preflight
import './index.css'

import Shell from './Shell'
import { AuthProvider } from './context/AuthContext'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </GoogleOAuthProvider>
  </BrowserRouter>,
)
