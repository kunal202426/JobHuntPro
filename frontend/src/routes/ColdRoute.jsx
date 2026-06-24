import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Dashboard from '@ce/pages/Dashboard'

const queryClient = new QueryClient()

export default function ColdRoute() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="route-cold">
        <Dashboard />
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1e1e2e',
            color: '#cdd6f4',
            border: '1px solid #313244',
          },
        }}
      />
    </QueryClientProvider>
  )
}
