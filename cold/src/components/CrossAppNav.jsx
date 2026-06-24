import { ExternalLink } from 'lucide-react';

export default function CrossAppNav() {
  return (
    <a
      href="http://localhost:3000"
      target="_blank"
      rel="noreferrer"
      title="Open JobHunt Engine"
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '8px 14px',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--rounded-md)',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--text)',
        textDecoration: 'none',
        boxShadow: 'var(--shadow-sm)',
        transition: 'background 0.13s ease, box-shadow 0.13s ease',
        fontFamily: 'Inter, sans-serif',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'var(--surface-1)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      <ExternalLink size={14} style={{ color: '#0a66c2' }} />
      JobHunt Engine
      <span style={{ opacity: 0.4 }}>→</span>
    </a>
  );
}
