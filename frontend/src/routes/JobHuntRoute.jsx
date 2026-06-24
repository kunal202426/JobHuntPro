import { AppProvider } from '@lb/store/appStore'
import LBApp from '@lb/App'
import '../styles/jobhunt-warm.css'

export default function JobHuntRoute() {
  return (
    <AppProvider>
      <div className="route-jobhunt lh-warm">
        <LBApp />
      </div>
    </AppProvider>
  )
}
