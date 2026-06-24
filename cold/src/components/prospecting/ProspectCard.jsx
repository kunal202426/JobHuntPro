import { useState } from 'react';
import {
  ExternalLink, ChevronDown, ChevronUp, Mail,
  Briefcase, Loader2, Send, Target, Wrench, User,
} from 'lucide-react';
import { useGeneratePreview } from '../../hooks/useLeads';
import EmailDraftModal from '../EmailDraftModal';

const CATEGORY_META = {
  hiring_manager:  { label: 'Hiring Manager',  Icon: Target },
  senior_engineer: { label: 'Senior Engineer', Icon: Wrench },
  recruiter:       { label: 'Recruiter',        Icon: Briefcase },
  peer:            { label: 'Peer',             Icon: User },
};

const EMAIL_TYPES = [
  { value: 'cold_outreach',     label: 'Cold Outreach' },
  { value: 'referral_work',     label: 'Referral – Their Work' },
  { value: 'referral_job',      label: 'Referral – Job Posting' },
  { value: 'linkedin_referral', label: 'LinkedIn Referral' },
];

const CONNECT_COLORS = {
  not_queued: 'var(--subtext)',
  queued:     '#7c3aed',
  sent:       'var(--success)',
  accepted:   'var(--success)',
  failed:     'var(--danger)',
};

const SCORE_STYLE = (s) =>
  s >= 8
    ? { background: '#eaf4ea', color: 'var(--success)' }
    : s >= 6
    ? { background: '#fef6e4', color: 'var(--warning)' }
    : { background: '#fdecea', color: 'var(--danger)' };

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

const EMPTY_FORM = {
  hr_email: '',
  email_type: 'cold_outreach',
  notes: '',
  seen_work_detail: '',
  job_title: '',
  job_posting_id: '',
  linkedin_context: '',
  experience_highlight: '',
  role_interest: '',
  company_hook: '',
};

export default function ProspectCard({ lead }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [draft, setDraft] = useState(null); // { subject, body, leadData }

  const { mutate: generatePreview, isPending: isGenerating } = useGeneratePreview();

  const { label: categoryLabel, Icon: CategoryIcon } =
    CATEGORY_META[lead.category] ?? CATEGORY_META.peer;
  const connectColor = CONNECT_COLORS[lead.connect_status] ?? 'var(--subtext)';
  const connectLabel = (lead.connect_status ?? 'not_queued').replace(/_/g, ' ');

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const setType = (v) => setForm((f) => ({ ...f, email_type: v }));

  const buildPayload = () => ({
    hr_name:              lead.name        || '',
    hr_email:             form.hr_email,
    hr_position:          lead.title       || '',
    company:              lead.company     || '',
    linkedin_url:         lead.profile_url || '',
    email_type:           form.email_type,
    notes:                form.notes,
    seen_work_detail:     form.seen_work_detail,
    job_title:            form.job_title,
    job_posting_id:       form.job_posting_id,
    linkedin_context:     form.linkedin_context,
    experience_highlight: form.experience_highlight,
    role_interest:        form.role_interest,
    company_hook:         form.company_hook,
  });

  const runGenerate = (payload) => {
    generatePreview(payload, {
      onSuccess: (data) =>
        setDraft({ subject: data.subject, body: data.body, leadData: payload }),
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    runGenerate(buildPayload());
  };

  const handleRegenerate = () => runGenerate(buildPayload());

  const { email_type } = form;

  return (
    <div
      className="form-card"
      style={{ padding: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      {/* ── Top row: avatar + name + score ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 700, color: 'var(--primary)', flexShrink: 0,
          }}
        >
          {getInitials(lead.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <p style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.name}
            </p>
            {lead.ai_score != null && (
              <span
                style={{
                  ...SCORE_STYLE(lead.ai_score),
                  fontSize: '10px', fontWeight: 700, padding: '2px 6px',
                  borderRadius: '99px', flexShrink: 0,
                }}
              >
                {lead.ai_score}/10
              </span>
            )}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[lead.title, lead.company].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* ── Category + LinkedIn connect status ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', color: 'var(--subtext)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <CategoryIcon size={11} /> {categoryLabel}
        </span>
        <span style={{ fontSize: '10px', color: connectColor, textTransform: 'capitalize', fontWeight: 500 }}>
          LI: {connectLabel}
        </span>
      </div>

      {/* ── AI reason ── */}
      {lead.ai_reason && (
        <p style={{ fontSize: '11px', color: 'var(--subtext)', fontStyle: 'italic', lineHeight: 1.4 }}>
          {lead.ai_reason}
        </p>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <a
          href={lead.profile_url}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary btn-sm"
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', textDecoration: 'none' }}
        >
          <ExternalLink size={11} /> LinkedIn
        </a>
        <button
          className={`btn btn-sm ${expanded ? 'btn-active' : 'btn-primary'}`}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => setExpanded((v) => !v)}
        >
          <Mail size={11} />
          {expanded ? 'Cancel' : 'Reach Out'}
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* ── Expandable email form ── */}
      {expanded && (
        <form
          onSubmit={handleSubmit}
          style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          {/* Email */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>
              Their Email*{' '}
              <span style={{ color: 'var(--subtext)', fontWeight: 400 }}>
                (use ContactOut on their LinkedIn)
              </span>
            </label>
            <input
              required
              type="email"
              name="hr_email"
              value={form.hr_email}
              onChange={change}
              className="input"
              placeholder="their@email.com"
              style={{ fontSize: '13px' }}
            />
          </div>

          {/* Email type */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '11px' }}>Email Type</label>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '4px' }}>
              {EMAIL_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm ${email_type === value ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '5px 9px' }}
                  onClick={() => setType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Cold Outreach extras */}
          {email_type === 'cold_outreach' && (
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>Context / Notes</label>
              <textarea
                name="notes"
                value={form.notes}
                onChange={change}
                className="input textarea"
                placeholder="e.g. They're hiring for frontend roles…"
                rows={2}
                style={{ fontSize: '12px' }}
              />
            </div>
          )}

          {/* Referral – Their Work */}
          {email_type === 'referral_work' && (
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '11px' }}>Their specific work / talk / project*</label>
              <textarea
                required
                name="seen_work_detail"
                value={form.seen_work_detail}
                onChange={change}
                className="input textarea"
                placeholder="e.g. Their talk on distributed tracing at Ericsson…"
                rows={2}
                style={{ fontSize: '12px' }}
              />
            </div>
          )}

          {/* Referral – Job Posting */}
          {email_type === 'referral_job' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="form-row">
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Job Title*</label>
                  <input
                    required
                    name="job_title"
                    value={form.job_title}
                    onChange={change}
                    className="input"
                    placeholder="Software Engineer"
                    style={{ fontSize: '12px' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Job ID / Link*</label>
                  <input
                    required
                    name="job_posting_id"
                    value={form.job_posting_id}
                    onChange={change}
                    className="input"
                    placeholder="R-12345 or job URL"
                    style={{ fontSize: '12px' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '11px' }}>Extra Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={change}
                  className="input textarea"
                  placeholder="Additional context about your fit…"
                  rows={2}
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>
          )}

          {/* LinkedIn Referral */}
          {email_type === 'linkedin_referral' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '11px' }}>How did you find them?*</label>
                <select
                  required
                  name="linkedin_context"
                  value={form.linkedin_context}
                  onChange={change}
                  className="input"
                  style={{ fontSize: '12px' }}
                >
                  <option value="">Select…</option>
                  <option value="LinkedIn Profile">LinkedIn Profile</option>
                  <option value="LinkedIn Post about hiring">LinkedIn Post about hiring</option>
                  <option value="LinkedIn Post about their work">LinkedIn Post about their work</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Tech to highlight*</label>
                  <input
                    required
                    name="experience_highlight"
                    value={form.experience_highlight}
                    onChange={change}
                    className="input"
                    placeholder="React, FastAPI, …"
                    style={{ fontSize: '12px' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '11px' }}>Role interest*</label>
                  <input
                    required
                    name="role_interest"
                    value={form.role_interest}
                    onChange={change}
                    className="input"
                    placeholder="Full Stack Dev, SDE"
                    style={{ fontSize: '12px' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '11px' }}>Company hook <span style={{ color: 'var(--subtext)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  name="company_hook"
                  value={form.company_hook}
                  onChange={change}
                  className="input"
                  placeholder="e.g. Their work on distributed streaming…"
                  style={{ fontSize: '12px' }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isGenerating}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {isGenerating
              ? <><Loader2 size={14} className="spin" /> Generating…</>
              : <><Send size={14} /> Generate Preview</>}
          </button>
        </form>
      )}

      {/* ── Email draft modal ── */}
      {draft && (
        <EmailDraftModal
          leadData={draft.leadData}
          initialSubject={draft.subject}
          initialBody={draft.body}
          onClose={() => setDraft(null)}
          onRegenerate={handleRegenerate}
          isRegenerating={isGenerating}
        />
      )}
    </div>
  );
}
