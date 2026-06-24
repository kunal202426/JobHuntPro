import { useState } from 'react';
import { X, Save, Loader2, RefreshCw } from 'lucide-react';
import { useAddLead } from '../hooks/useLeads';

export default function EmailDraftModal({ leadData, initialSubject, initialBody, onClose, onRegenerate, isRegenerating }) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  const { mutate: addLead, isPending: isSending } = useAddLead();

  const handleSend = () => {
    addLead(
      { ...leadData, email_subject: subject, email_body: body },
      { onSuccess: () => onClose(true) }
    );
  };

  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div
        className="modal"
        style={{ maxWidth: '620px', width: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">Review &amp; Edit Email</h2>
          <button className="btn btn-icon" onClick={() => onClose(false)}><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px', color: '#a6adc8', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Subject
            </label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ fontSize: '13px' }}
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px', color: '#a6adc8', marginBottom: '6px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Body
            </label>
            <textarea
              className="input textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              style={{ fontSize: '13px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical' }}
            />
          </div>

          <p style={{ fontSize: '11px', color: '#6c7086', margin: 0 }}>
            Edit freely — this will save a draft for approval before sending.
          </p>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onRegenerate}
            disabled={isRegenerating || isSending}
            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            {isRegenerating
              ? <><Loader2 size={13} className="spin" /> Regenerating...</>
              : <><RefreshCw size={13} /> Regenerate</>
            }
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={isSending || !subject.trim() || !body.trim()}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            {isSending
              ? <><Loader2 size={13} className="spin" /> Saving...</>
              : <><Save size={13} /> Save Draft</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
