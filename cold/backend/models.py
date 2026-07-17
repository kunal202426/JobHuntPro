from sqlalchemy import Column, Integer, Text, TIMESTAMP, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
import uuid
from database import Base


class User(Base):
    __tablename__ = "users"

    id           = Column(Text, primary_key=True, default=lambda: str(uuid.uuid4()))
    email        = Column(Text, nullable=False, unique=True)
    password_hash = Column(Text, nullable=True)   # null for Google-auth users
    google_sub   = Column(Text)                    # Google user ID ("sub" claim)
    is_admin     = Column(Boolean, default=False)
    gmail_address      = Column(Text)
    gmail_app_password = Column(Text)
    gmail_refresh_token = Column(Text)  # OAuth2 refresh token for Gmail API (preferred over app password)

    # AI provider keys — user provides one or both; Gemini preferred, Claude fallback
    claude_api_key       = Column(Text)

    # Per-user AI + profile fields
    gemini_api_key       = Column(Text)
    gemini_keys_json     = Column(Text)   # JSON array of encrypted Gemini API keys
    full_name            = Column(Text)
    phone                = Column(Text)
    portfolio_url        = Column(Text)
    linkedin_url         = Column(Text)
    college              = Column(Text)   # e.g. "IIT Bombay" — distinct from current_role
    current_role         = Column(Text)   # e.g. "Full Stack Dev Intern at YES Bank"
    current_company      = Column(Text)   # e.g. "YES Bank"
    graduation_month_year = Column(Text)  # e.g. "July 2026"
    target_role          = Column(Text)   # e.g. "full-time SWE roles"
    background_text      = Column(Text)   # free-form bio for AI prompts
    projects_json        = Column(Text)   # JSON array of project description strings

    created_at   = Column(TIMESTAMP, server_default=func.now())


class Lead(Base):
    __tablename__ = "leads"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Text, ForeignKey("users.id"), nullable=False)
    hr_name       = Column(Text, nullable=False)
    hr_email      = Column(Text, nullable=False)
    hr_position   = Column(Text)
    company       = Column(Text, nullable=False)
    company_url   = Column(Text)
    linkedin_url  = Column(Text)
    notes         = Column(Text)

    # email type + per-type fields
    email_type           = Column(Text, default="cold_outreach")
    seen_work_detail     = Column(Text)
    job_title            = Column(Text)
    job_posting_id       = Column(Text)
    linkedin_context     = Column(Text)
    experience_highlight = Column(Text)
    role_interest        = Column(Text)
    company_hook         = Column(Text)

    # email lifecycle
    status        = Column(Text, default="pending")
    email_subject = Column(Text)
    email_body    = Column(Text)
    sent_at       = Column(TIMESTAMP)
    queued_at     = Column(TIMESTAMP)
    created_at    = Column(TIMESTAMP, server_default=func.now())

    # rate limit tracking
    retry_count   = Column(Integer, default=0)
    error_log     = Column(Text)


class DailyQuota(Base):
    __tablename__ = "daily_quota"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(Text, ForeignKey("users.id"), nullable=False)
    date        = Column(Text)
    emails_sent = Column(Integer, default=0)
    quota_limit = Column(Integer, default=90)


class EmailTask(Base):
    """Durable email-send queue. Survives process restarts (Render free-tier
    sleeps). Stores ONLY lead_id + user_id — credentials are re-fetched and
    decrypted at send time, never persisted in plaintext (security S5)."""
    __tablename__ = "email_tasks"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    lead_id     = Column(Integer, ForeignKey("leads.id"), nullable=False)
    user_id     = Column(Text, ForeignKey("users.id"), nullable=False)
    status      = Column(Text, default="pending")   # pending|processing|done|failed
    error       = Column(Text)
    retry_count = Column(Integer, default=0)
    created_at  = Column(TIMESTAMP, server_default=func.now())


class GenerationTask(Base):
    """Durable AI-generation queue for bulk lead imports. Same restart-safe
    pattern as EmailTask."""
    __tablename__ = "generation_tasks"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    lead_id     = Column(Integer, ForeignKey("leads.id"), nullable=False)
    user_id     = Column(Text, ForeignKey("users.id"), nullable=False)
    status      = Column(Text, default="pending")   # pending|processing|done|failed
    error       = Column(Text)
    retry_count = Column(Integer, default=0)
    created_at  = Column(TIMESTAMP, server_default=func.now())
