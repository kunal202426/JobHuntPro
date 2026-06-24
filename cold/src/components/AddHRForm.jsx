import { useState } from 'react';
import { useCheckDuplicate, useGeneratePreview } from '../hooks/useLeads';
import { Briefcase, Building, Mail, User, Link as LinkIcon, Globe, FileText, Send, Loader2 } from 'lucide-react';
import EmailDraftModal from './EmailDraftModal';

const EMPTY_FORM = {
  hr_name: '', hr_email: '', hr_position: '', company: '',
  company_url: '', linkedin_url: '', notes: '',
  email_type: 'cold_outreach',
  seen_work_detail: '',
  job_title: '',
  job_posting_id: '',
  linkedin_context: '',
  experience_highlight: '',
  role_interest: '',
  company_hook: '',
};

const EMAIL_TYPES = [
  { value: 'cold_outreach',     label: 'Cold Outreach' },
  { value: 'referral_work',     label: 'Referral – Their Work' },
  { value: 'referral_job',      label: 'Referral – Job Posting' },
  { value: 'linkedin_referral', label: 'LinkedIn Referral' },
];

export default function AddHRForm() {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [draft, setDraft] = useState(null); // { subject, body } when preview is open

  const { mutateAsync: checkDuplicate } = useCheckDuplicate();
  const { mutate: generatePreview, isPending: isGenerating } = useGeneratePreview();

  const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const setEmailType = (type) => setFormData(prev => ({ ...prev, email_type: type }));

  const handleEmailBlur = async () => {
    if (!formData.hr_email || !formData.hr_email.includes('@')) return;
    try {
      const res = await checkDuplicate(formData.hr_email);
      if (res.is_duplicate) {
        setDuplicateWarning(`Already ${res.status} on ${res.sent_at || res.created_at}`);
      } else {
        setDuplicateWarning(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (duplicateWarning) {
      const proceed = window.confirm("This email is already in the system. Are you sure you want to add it again?");
      if (!proceed) return;
    }
    generatePreview(formData, {
      onSuccess: (data) => setDraft({ subject: data.subject, body: data.body }),
    });
  };

  const handleDraftClose = (sent) => {
    setDraft(null);
    if (sent) setFormData(EMPTY_FORM);
  };

  const handleRegenerate = () => {
    generatePreview(formData, {
      onSuccess: (data) => setDraft({ subject: data.subject, body: data.body }),
    });
  };

  const { email_type } = formData;

  return (
    <>
      <div className="form-card">
        <h2 className="form-title">⚡ Add New HR Lead</h2>
        <p className="form-subtitle">Enter details to auto-generate a draft you approve before sending.</p>

        {duplicateWarning && (
          <div className="alert-duplicate">
            ⚠️ <strong>Duplicate found:</strong> {duplicateWarning}
          </div>
        )}

        <form onSubmit={handleSubmit} className="hr-form">

          {/* Email type selector */}
          <div className="form-group">
            <label>Email Type</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {EMAIL_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`btn ${email_type === value ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                  onClick={() => setEmailType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label><User size={14}/> {email_type === 'referral_work' ? 'Engineer / Manager Name*' : 'HR Name*'}</label>
              <input required name="hr_name" value={formData.hr_name} onChange={handleChange} className="input" placeholder="e.g. Sarah Connor" />
            </div>
            <div className="form-group">
              <label><Mail size={14}/> {email_type === 'referral_work' ? 'Their Email*' : 'HR Email*'}</label>
              <input required type="email" name="hr_email" value={formData.hr_email} onChange={handleChange} onBlur={handleEmailBlur} className="input" placeholder="sarah@company.com" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label><Briefcase size={14}/> Position</label>
              <input name="hr_position" value={formData.hr_position} onChange={handleChange} className="input" placeholder="e.g. Technical Recruiter" />
            </div>
            <div className="form-group">
              <label><Building size={14}/> Company*</label>
              <input required name="company" value={formData.company} onChange={handleChange} className="input" placeholder="Company Name" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label><Globe size={14}/> Company URL</label>
              <input type="url" name="company_url" value={formData.company_url} onChange={handleChange} className="input" placeholder="https://..." />
            </div>
            <div className="form-group">
              <label><LinkIcon size={14}/> LinkedIn URL</label>
              <input type="url" name="linkedin_url" value={formData.linkedin_url} onChange={handleChange} className="input" placeholder="https://linkedin.com/in/..." />
            </div>
          </div>

          {/* cold_outreach */}
          {email_type === 'cold_outreach' && (
            <div className="form-group">
              <label><FileText size={14}/> Extra Notes / Context</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                className="input textarea"
                placeholder="e.g. 'They recently raised Series B' or 'Hiring for Frontend Engineers'"
                rows={3}
              />
            </div>
          )}

          {/* referral_work */}
          {email_type === 'referral_work' && (
            <div className="form-group">
              <label><FileText size={14}/> Specific work / talk / project of theirs*</label>
              <textarea
                name="seen_work_detail"
                value={formData.seen_work_detail}
                onChange={handleChange}
                className="input textarea"
                placeholder="e.g. 'span aggregation approach for high-cardinality services at Ericsson'"
                rows={3}
                required
              />
            </div>
          )}

          {/* referral_job */}
          {email_type === 'referral_job' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label><Briefcase size={14}/> Job Title*</label>
                  <input
                    name="job_title"
                    value={formData.job_title}
                    onChange={handleChange}
                    className="input"
                    placeholder="e.g. Software Engineer"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Job Posting ID / Link*</label>
                  <input
                    name="job_posting_id"
                    value={formData.job_posting_id}
                    onChange={handleChange}
                    className="input"
                    placeholder="e.g. R-12345 or careers link"
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label><FileText size={14}/> Extra Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  className="input textarea"
                  placeholder="Any additional context about your fit for this role"
                  rows={2}
                />
              </div>
            </>
          )}

          {/* linkedin_referral */}
          {email_type === 'linkedin_referral' && (
            <>
              <div className="form-group">
                <label><LinkIcon size={14}/> How did you find them?*</label>
                <select
                  name="linkedin_context"
                  value={formData.linkedin_context}
                  onChange={handleChange}
                  className="input"
                  required
                >
                  <option value="">Select context...</option>
                  <option value="LinkedIn Profile">LinkedIn Profile</option>
                  <option value="LinkedIn Post about hiring">LinkedIn Post about hiring</option>
                  <option value="LinkedIn Post about their work">LinkedIn Post about their work</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tech / Experience to highlight*</label>
                  <input
                    name="experience_highlight"
                    value={formData.experience_highlight}
                    onChange={handleChange}
                    className="input"
                    placeholder="e.g. React, FastAPI, WebSockets"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Role interest*</label>
                  <input
                    name="role_interest"
                    value={formData.role_interest}
                    onChange={handleChange}
                    className="input"
                    placeholder="e.g. Full Stack Developer, SDE"
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Company hook <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span></label>
                <input
                  name="company_hook"
                  value={formData.company_hook}
                  onChange={handleChange}
                  className="input"
                  placeholder="e.g. Confluent's work in distributed streaming is really interesting"
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={isGenerating}>
            {isGenerating
              ? <><Loader2 size={16} className="spin" /> Generating Preview...</>
              : <><Send size={16} /> Generate Preview</>
            }
          </button>
        </form>
      </div>

      {draft && (
        <EmailDraftModal
          leadData={formData}
          initialSubject={draft.subject}
          initialBody={draft.body}
          onClose={handleDraftClose}
          onRegenerate={handleRegenerate}
          isRegenerating={isGenerating}
        />
      )}
    </>
  );
}
