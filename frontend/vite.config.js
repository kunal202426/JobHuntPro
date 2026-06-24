import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Packages used by linkedin/src and cold/src must resolve from frontend/node_modules.
// Rolldown (Vite 8) is stricter than rollup and won't walk up to find them automatically.
function pkg(name) {
  return path.resolve(__dirname, 'node_modules', name)
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lb': path.resolve(__dirname, '../linkedin/src'),
      '@ce': path.resolve(__dirname, '../cold/src'),
      // Force all cross-app imports to resolve from frontend/node_modules
      'react':                   pkg('react'),
      'react-dom':               pkg('react-dom'),
      'react-router-dom':        pkg('react-router-dom'),
      'react-hot-toast':         pkg('react-hot-toast'),
      'lucide-react':            pkg('lucide-react'),
      'axios':                   pkg('axios'),
      'date-fns':                pkg('date-fns'),
      '@tanstack/react-query':   pkg('@tanstack/react-query'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'lucide-react',
      'date-fns',
      'axios',
      'react-hot-toast',
      '@tanstack/react-query',
      'react-router-dom',
    ],
  },
  server: { port: 4000 },
})
