export default function HelpPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f0eb', overflowY: 'auto', padding: 'clamp(20px, 5vw, 40px) clamp(12px, 4vw, 16px)' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        <h1 style={{ color: '#1e1510', fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          How JobHuntPro Works
        </h1>
        <p style={{ color: '#9a8a7e', fontSize: 14, marginBottom: 40 }}>
          Everything you need to know to get the most out of the app.
        </p>

        <Section title="The Full Flow" accent="#c8845a">
          <Flow steps={[
            { n: '1', label: 'Sign up & fill Settings', sub: 'Name, Gmail, profile details, API keys' },
            { n: '2', label: 'Install Chrome Extension', sub: 'Download from Settings → Chrome Extension section' },
            { n: '3', label: 'Scrape jobs from LinkedIn', sub: 'Visit LinkedIn Jobs — extension captures listings automatically' },
            { n: '4', label: 'Find HR contacts', sub: 'Click "Find Leads" on any job card in JobHunt tab' },
            { n: '5', label: 'Auto-send connection requests', sub: 'Lead Connector tab handles LinkedIn connects in the background' },
            { n: '6', label: 'Send cold emails', sub: 'Cold Outreach tab — AI writes personalised emails, Gmail sends them' },
          ]} />
        </Section>

        <Section title="Why Connect Gmail (even though it shows a warning)" accent="#f97316">
          <Callout color="#f97316">
            That Google warning screen is completely normal — it appears for every app that requests Gmail access and is not a sign of anything unsafe.
          </Callout>
          <p style={bodyText}>
            The app needs permission to <strong style={{ color: '#1e1510' }}>send emails on your behalf</strong>. Without connecting Gmail, the Cold Outreach tab cannot send any emails — it will just queue them forever.
          </p>
          <p style={bodyText}>
            The permission requested is <code style={code}>gmail.send</code> — send-only. The app cannot read, delete, or access your inbox. The OAuth token is encrypted before being stored.
          </p>
          <p style={bodyText}>
            Click <em>Advanced → Go to JobHuntPro</em> on the warning screen to proceed. You only need to do this once.
          </p>
          <Note>If you prefer not to use OAuth, expand "Or use an App Password" in Settings. App Passwords work but are less reliable on cloud servers.</Note>
        </Section>

        <Section title="Why Add a Gemini API Key (when OpenRouter already exists)" accent="#22c55e">
          <Callout color="#22c55e">
            OpenRouter is a shared fallback — it works, but it is not your private quota.
          </Callout>
          <p style={bodyText}>
            OpenRouter free models are shared across all users of the platform. Under load they get <strong style={{ color: '#1e1510' }}>rate-limited, slow, or temporarily unavailable</strong>. Your own Gemini key is completely free (Google AI Studio) and gives you a dedicated quota — much faster and more reliable.
          </p>
          <p style={bodyText}>
            Priority order when generating emails:
          </p>
          <ol style={{ color: '#7a6a5e', fontSize: 13, lineHeight: 2, paddingLeft: 20 }}>
            <li><strong style={{ color: '#4ade80' }}>Your Gemini key</strong> — fastest, your own quota, used first</li>
            <li><strong style={{ color: '#facc15' }}>OpenRouter fallback</strong> — tries 9 free models in sequence</li>
            <li><strong style={{ color: '#a78bfa' }}>Your Claude key</strong> — if you added one, used as last resort</li>
          </ol>
          <p style={bodyText}>
            Get a free Gemini key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={link}>aistudio.google.com/app/apikey</a> — takes 30 seconds.
          </p>
        </Section>

        <Section title="Why Fill In All Profile Details" accent="#a78bfa">
          <Callout color="#a78bfa">
            The AI writes every email using your profile. Empty fields = generic emails that get ignored.
          </Callout>
          <p style={bodyText}>
            Every cold email the app generates is personalised from your data. Here is what each field does:
          </p>
          <FieldTable rows={[
            ['Full name', 'Used in the email signature and intro line'],
            ['Current role & company', 'First sentence of every email — e.g. "currently interning at YES Bank"'],
            ['Availability / grad date', 'Sets urgency — "available from July 2026"'],
            ['What you\'re looking for', 'Frames the ask — "full-time SWE roles"'],
            ['Background text', '"Why you" paragraph — your skills, what makes you different'],
            ['Projects (up to 6)', 'AI picks the single most relevant project per email based on the company'],
            ['Portfolio / LinkedIn URL', 'Placed verbatim in every email signature'],
            ['Phone', 'Added to the closing line'],
          ]} />
          <p style={bodyText}>
            Concrete, specific details produce dramatically better emails. "I built X using Y which does Z" beats "I have strong skills in tech".
          </p>
        </Section>

        <Section title="Why the Chrome Extension is Non-Negotiable" accent="#f43f5e">
          <Callout color="#f43f5e">
            Without the extension, the JobHunt tab is empty and the Lead Connector does nothing. The extension is the engine.
          </Callout>
          <p style={bodyText}>
            The extension does three things that cannot be done from a website:
          </p>
          <FeatureList items={[
            {
              title: 'Job Scraping',
              desc: 'Visits LinkedIn Jobs, Naukri, CutShort, and InstaHyre in your browser and captures job listings. These appear in your JobHunt tab automatically.',
            },
            {
              title: 'HR Lead Finding',
              desc: 'When you click "Find Leads" on a job card, the extension opens LinkedIn People Search, finds HR/recruiter profiles for that company, and saves them to your leads list.',
            },
            {
              title: 'Auto Connection Requests',
              desc: 'The Lead Connector tab queues LinkedIn profiles. The extension sends connection requests one by one in the background, respecting your daily cap (default 14/day).',
            },
          ]} />
          <Note>
            The extension must stay installed and Chrome must stay open for auto-connect to run. It does not need a separate login — it picks up your session automatically when you visit the app.
          </Note>
          <p style={{ ...bodyText, marginTop: 16 }}>
            Install steps: Settings → Chrome Extension section → Download Extension → extract the ZIP → Chrome <code style={code}>chrome://extensions</code> → Developer mode ON → Load unpacked → select the folder.
          </p>
        </Section>

        <Section title="Frequently Asked Questions" accent="#38bdf8">
          <FaqList items={[
            {
              q: 'Cold emails are stuck on "queued" and never send.',
              a: 'Gmail is not connected or the app password is wrong. Go to Settings → Gmail → Connect Gmail (OAuth). If you used an App Password, check it is the 16-character app-specific password, not your regular Gmail password.',
            },
            {
              q: 'Email generation fails or gives garbage output.',
              a: 'OpenRouter free models are being rate-limited. Add a free Gemini API key in Settings — it takes 30 seconds and dramatically improves reliability.',
            },
            {
              q: 'The JobHunt tab shows no jobs.',
              a: 'The Chrome extension is not installed or not detecting the current page. Install the extension, visit LinkedIn Jobs, and wait a few seconds — jobs should appear in the dashboard.',
            },
            {
              q: '"Find Leads" button stays on loading forever.',
              a: 'The extension needs to be open (Chrome running). The button polls until the extension finishes scraping HR profiles — this can take 30–90 seconds.',
            },
            {
              q: 'Auto-connect stopped at fewer than my daily cap.',
              a: 'LinkedIn may have shown a CAPTCHA or the connection button was not found on a profile. The queue will resume on the next run. Reduce your daily cap if LinkedIn is showing friction.',
            },
            {
              q: 'The app is slow to load / shows "Server is starting up".',
              a: 'The backend runs on Render free tier which sleeps after 15 minutes of inactivity. The first request wakes it up — this takes 20–40 seconds. Subsequent requests are instant.',
            },
          ]} />
        </Section>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, accent, children }) {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 4, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <h2 style={{ color: '#1e1510', fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Callout({ color, children }) {
  return (
    <div style={{
      background: `${color}18`,
      border: `1px solid ${color}40`,
      borderRadius: 8, padding: '10px 14px', marginBottom: 14,
      color, fontSize: 13, fontWeight: 600, lineHeight: 1.5,
    }}>
      {children}
    </div>
  )
}

function Note({ children }) {
  return (
    <div style={{
      background: 'rgba(168,120,48,0.08)', border: '1px solid rgba(168,120,48,0.25)',
      borderRadius: 6, padding: '9px 13px', marginTop: 12,
      color: '#7a5a28', fontSize: 12, lineHeight: 1.6,
    }}>
      <strong>Note: </strong>{children}
    </div>
  )
}

function Flow({ steps }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#c8845a', color: '#fff',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{s.n}</div>
            {i < steps.length - 1 && <div style={{ width: 2, height: 28, background: '#d4ccc4' }} />}
          </div>
          <div style={{ paddingTop: 4, paddingBottom: i < steps.length - 1 ? 0 : 0 }}>
            <p style={{ color: '#1e1510', fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{s.label}</p>
            <p style={{ color: '#9a8a7e', fontSize: 12, margin: '0 0 16px' }}>{s.sub}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldTable({ rows }) {
  return (
    <div style={{ border: '1px solid #d4ccc4', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      {rows.map(([field, desc], i) => (
        <div key={i} style={{
          display: 'flex', gap: 12,
          padding: '9px 14px',
          background: i % 2 === 0 ? '#fdfaf8' : '#f5f0eb',
          borderTop: i > 0 ? '1px solid #d4ccc4' : 'none',
        }}>
          <span style={{ color: '#c8845a', fontSize: 12, fontWeight: 600, width: 160, flexShrink: 0 }}>{field}</span>
          <span style={{ color: '#7a6a5e', fontSize: 12 }}>{desc}</span>
        </div>
      ))}
    </div>
  )
}

function FeatureList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: '#fdfaf8', borderRadius: 8, padding: '12px 14px',
          borderLeft: '3px solid #b84848', border: '1px solid #d4ccc4',
        }}>
          <p style={{ color: '#1e1510', fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>{item.title}</p>
          <p style={{ color: '#7a6a5e', fontSize: 12, margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
        </div>
      ))}
    </div>
  )
}

function FaqList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: '#fdfaf8', borderRadius: 8, padding: '12px 14px', border: '1px solid #d4ccc4' }}>
          <p style={{ color: '#2d2118', fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>Q: {item.q}</p>
          <p style={{ color: '#7a6a5e', fontSize: 12, margin: 0, lineHeight: 1.6 }}>{item.a}</p>
        </div>
      ))}
    </div>
  )
}

const bodyText = { color: '#7a6a5e', fontSize: 13, lineHeight: 1.7, marginBottom: 10 }
const code = { background: '#ede8e2', border: '1px solid #d4ccc4', borderRadius: 4, padding: '1px 6px', fontSize: 11, color: '#7a4a28' }
const link = { color: '#c8845a', textDecoration: 'none' }
