import { X, Mail, Globe, Link as Linkedin, Calendar, Clock, AlertTriangle, Send } from 'lucide-react';
import { useApproveDraft } from '../hooks/useLeads';

const STATUS_MAP = {
  draft:    { label: 'Draft',    cls: 'badge-draft'   },
  pending:  { label: 'Pending',  cls: 'badge-pending'  },
  queued:   { label: 'Queued',   cls: 'badge-queued'   },
  sent:     { label: 'Sent',     cls: 'badge-sent'      },
  failed:   { label: 'Failed',   cls: 'badge-failed'   },
  replied:  { label: 'Replied',  cls: 'badge-replied'  },
};

export default function EmailPreviewModal({ lead, onClose, onStatusChange }) {
  if (!lead) return null;
  const { mutate: approveDraft, isPending: isApproving } = useApproveDraft();
  const { label, cls } = STATUS_MAP[lead.status] || { label: lead.status, cls: '' };

  const fmt = (ts) =>
    ts ? new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{lead.hr_name}</h2>
            <p className="modal-sub">
              {lead.hr_position && <span>{lead.hr_position} @ </span>}
              <strong>{lead.company}</strong>
            </p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-meta">
          <a href={`mailto:${lead.hr_email}`} className="meta-chip">
            <Mail size={14} /> {lead.hr_email}
          </a>
          {lead.company_url && (
            <a href={lead.company_url} target="_blank" rel="noreferrer" className="meta-chip">
              <Globe size={14} /> Website
            </a>
          )}
          {lead.linkedin_url && (
            <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="meta-chip">
              <Linkedin size={14} /> LinkedIn
            </a>
          )}
          <span className={`badge ${cls}`}>{label}</span>
          {lead.email_type === 'linkedin_referral' && (
            <span className="meta-chip" style={{ background: '#0a66c2', color: '#fff', fontWeight: 600 }}>
              LinkedIn Referral
            </span>
          )}
        </div>

        <div className="modal-timestamps">
          <span><Calendar size={13}/> Added: {fmt(lead.created_at)}</span>
          {lead.sent_at   && <span><Clock size={13}/> Sent: {fmt(lead.sent_at)}</span>}
          {lead.queued_at && <span><Clock size={13}/> Queued: {fmt(lead.queued_at)}</span>}
        </div>

        {lead.notes && (
          <div className="modal-section">
            <h3 className="section-label">Notes</h3>
            <p className="notes-text">{lead.notes}</p>
          </div>
        )}

        {lead.email_type === 'linkedin_referral' && lead.linkedin_context && (
          <div className="modal-section">
            <h3 className="section-label">LinkedIn Context</h3>
            <p className="notes-text">
              <strong>Found via:</strong> {lead.linkedin_context}<br />
              <strong>Experience:</strong> {lead.experience_highlight}<br />
              <strong>Role interest:</strong> {lead.role_interest}
              {lead.company_hook && <><br /><strong>Company hook:</strong> {lead.company_hook}</>}
            </p>
          </div>
        )}

        {lead.email_subject ? (
          <div className="modal-section">
            <h3 className="section-label">Generated Email</h3>
            <div className="email-preview">
              <div className="email-subject">Subject: {lead.email_subject}</div>
              <pre className="email-body">{lead.email_body}</pre>
            </div>
          </div>
        ) : (
          <div className="modal-section empty-email">
            <AlertTriangle size={16} /> No email generated yet.
          </div>
        )}

        {lead.error_log && (
          <div className="modal-section error-box">
            <h3 className="section-label">Error Log</h3>
            <pre className="error-text">{lead.error_log}</pre>
          </div>
        )}

        <div className="modal-footer">
          <span className="footer-label">Update Status:</span>
          {['draft', 'pending', 'queued', 'sent', 'failed', 'replied'].map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${lead.status === s ? 'btn-active' : 'btn-ghost'}`}
              onClick={() => onStatusChange(lead.id, s)}
            >
              {s}
            </button>
          ))}
          {lead.status === 'draft' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => approveDraft(lead.id, { onSuccess: () => onClose() })}
              disabled={isApproving}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={14} /> {isApproving ? 'Approving…' : 'Approve & Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
