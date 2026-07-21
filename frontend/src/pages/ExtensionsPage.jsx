import { Link } from 'react-router-dom'

export default function ExtensionsPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f0eb', overflowY: 'auto', padding: 'clamp(20px, 5vw, 40px) clamp(12px, 4vw, 16px)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ color: '#1e1510', fontSize: 24, fontWeight: 700, margin: 0 }}>Extensions</h1>
          <Link to="/settings" style={{ color: '#9a8a7e', fontSize: 12, textDecoration: 'none' }}>← Back to Settings</Link>
        </div>
        <p style={{ color: '#9a8a7e', fontSize: 14, marginBottom: 32 }}>
          Two separate Chrome extensions — install whichever ones you need. Each has its own on/off
          switch in its popup, so you can pause one without touching the other.
        </p>

        <ExtensionCard
          accent="#22c55e"
          title="JobHunt Engine"
          subtitle="LinkedIn scraping + auto-connect"
        >
          <ExtensionTutorial />
        </ExtensionCard>

        <ExtensionCard
          accent="#c8845a"
          title="Autofill Extension"
          subtitle="Fills out job applications"
        >
          <AutofillExtensionTutorial />
        </ExtensionCard>

      </div>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function ExtensionCard({ accent, title, subtitle, children }) {
  return (
    <div style={{
      background: '#fdfaf8', border: '1px solid #d4ccc4', borderRadius: 12,
      padding: 'clamp(16px, 4vw, 28px)', marginBottom: 24,
      borderTop: `3px solid ${accent}`,
    }}>
      <h2 style={{ color: '#1e1510', fontSize: 18, fontWeight: 700, margin: '0 0 2px' }}>{title}</h2>
      <p style={{ color: '#9a8a7e', fontSize: 12, margin: '0 0 18px' }}>{subtitle}</p>
      {children}
    </div>
  )
}

// ── JobHunt Engine tutorial ────────────────────────────────────────────────────

function ExtensionTutorial() {
  return (
    <div>
      <p style={{ color: '#7a6a5e', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
        Lets you scrape jobs from LinkedIn, Naukri, CutShort &amp; InstaHyre, find HR contacts, and auto-send connection requests — all synced to your dashboard.
      </p>

      <a
        href="/extension.zip"
        download="JobHuntEngine-extension.zip"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: '#22c55e', borderRadius: 8, color: '#fff',
          fontSize: 15, fontWeight: 700, padding: '12px 28px',
          textDecoration: 'none', marginBottom: 24,
        }}
      >
        ⬇ Download Extension (.zip)
      </a>

      <div style={{ borderTop: '1px solid #d4ccc4', paddingTop: 18 }}>
        <p style={{ color: '#7a6a5e', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Installation steps</p>

        <Step n="1">
          Download and <strong>extract</strong> the ZIP file above (right-click → Extract All, or use 7-Zip).
        </Step>
        <Step n="2">
          Open Chrome and go to <Code>chrome://extensions</Code>
        </Step>
        <Step n="3">
          Toggle <strong>Developer mode</strong> on (top-right corner of the extensions page).
        </Step>
        <Step n="4">
          Click <strong>"Load unpacked"</strong> and select the folder you extracted in step 1.
          You should see <strong>JobHunt Engine</strong> appear in your extensions list.
        </Step>
        <Step n="5">
          <strong>Pin the extension</strong> to your toolbar — click the puzzle-piece icon in Chrome's toolbar, then pin JobHunt Engine.
        </Step>
        <Step n="6">
          <strong>Open the dashboard once after logging in</strong> — that syncs your session to the extension. You can also open the extension popup to refresh the session if needed.
        </Step>
        <Step n="7">
          <strong>Scrape jobs:</strong> In the JobHunt tab, choose a source and click <strong>Scrape</strong>. The extension opens that portal in the background and sends matching jobs to your dashboard.
        </Step>
        <Step n="8">
          <strong>Find HR contacts:</strong> In the Jobs tab on your dashboard, click "Find Leads" on any job — the extension opens LinkedIn People Search and scrapes HR profiles.
        </Step>
        <Step n="9">
          <strong>Auto-connect:</strong> In the Leads tab, queue people for LinkedIn connection requests. The extension sends up to your daily limit automatically in the background.
        </Step>
      </div>

      <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, padding: '10px 14px', marginTop: 16 }}>
        <p style={{ color: '#166534', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          <strong>Note:</strong> The extension must stay installed for job scraping and auto-connect to work. Use the <strong>Extension On/Off</strong> switch in its popup to pause background activity anytime without removing it. Signing out pauses background work and clears the synced session until you open the dashboard or popup again.
        </p>
      </div>
    </div>
  )
}

// ── Autofill extension tutorial ────────────────────────────────────────────────

function AutofillExtensionTutorial() {
  return (
    <div>
      <p style={{ color: '#7a6a5e', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
        A separate extension that fills out the actual application form once you're on an ATS
        portal (Greenhouse, Lever, Workday, and most others), and learns from every question
        you answer manually — reworded versions of the same question get filled automatically
        next time. It's local-first: your profile and everything it learns stay in your own
        browser, not on our servers, and it doesn't share a login with JobHunt Engine — you
        set up your own profile inside its popup after installing.{' '}
        <a href="https://github.com/kunal202426/Simplify_Job" target="_blank" rel="noreferrer" style={{ color: '#c8845a' }}>
          Source & details →
        </a>
      </p>

      <a
        href="/autofill-extension.zip"
        download="Autofill-extension.zip"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          background: '#c8845a', borderRadius: 8, color: '#fff',
          fontSize: 15, fontWeight: 700, padding: '12px 28px',
          textDecoration: 'none', marginBottom: 24,
        }}
      >
        ⬇ Download Extension (.zip)
      </a>

      <div style={{ borderTop: '1px solid #d4ccc4', paddingTop: 18 }}>
        <p style={{ color: '#7a6a5e', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Installation steps</p>

        <Step n="1">
          Download and <strong>extract</strong> the ZIP file above (right-click → Extract All, or use 7-Zip).
        </Step>
        <Step n="2">
          Open Chrome and go to <Code>chrome://extensions</Code>
        </Step>
        <Step n="3">
          Toggle <strong>Developer mode</strong> on (top-right corner of the extensions page).
        </Step>
        <Step n="4">
          Click <strong>"Load unpacked"</strong> and select the folder you extracted in step 1.
          You should see <strong>Autofill Jobs</strong> appear in your extensions list.
        </Step>
        <Step n="5">
          <strong>Pin the extension</strong> to your toolbar — click the puzzle-piece icon in Chrome's toolbar, then pin it.
        </Step>
        <Step n="6">
          <strong>Open the extension popup</strong> and fill in your profile — name, contact info,
          education, resume, and so on. This is stored only in your browser, so it's a one-time
          setup independent of your JobHuntPro account.
        </Step>
        <Step n="7">
          <strong>Apply as usual</strong> — on any application form, the extension fills what it
          can from your profile and flags the rest for you. Fields you fill in manually get
          learned automatically, so the same or a reworded question is filled next time.
        </Step>
      </div>

      <div style={{ background: 'rgba(200,132,90,0.08)', border: '1px solid rgba(200,132,90,0.25)', borderRadius: 6, padding: '10px 14px', marginTop: 16 }}>
        <p style={{ color: '#7a5a28', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
          <strong>Note:</strong> It never auto-submits an application or auto-accepts a consent
          checkbox — you always review and hit submit yourself. Use the <strong>Autofill On/Off</strong> switch
          in its popup to pause it on sites where you don't want it active. The download is
          larger than JobHunt Engine's (~22MB) because it bundles a small local AI model for
          matching reworded questions; that model runs fully offline, no data ever leaves your machine.
        </p>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Step({ n, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
      <span style={{
        flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
        background: '#c8845a', color: '#fff', fontSize: 12, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <div style={{ color: '#4a3728', fontSize: 13, lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function Code({ children }) {
  return (
    <code style={{ background: '#ede8e2', border: '1px solid #d4ccc4', borderRadius: 4, padding: '1px 6px', fontSize: 12, color: '#7a4a28' }}>
      {children}
    </code>
  )
}
