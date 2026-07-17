from dotenv import load_dotenv
load_dotenv()

import os
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from limiter import limiter

from database import engine, Base
from routers import leads, quota, account
from routers.auth import router as auth_router
from routers.admin import router as admin_router
from services.email_queue import start_queue_worker
from services.generation_queue import start_gen_worker

# Create tables
Base.metadata.create_all(bind=engine)

# Migrate existing tables — add columns that may be missing from older schema
def _run_migrations():
    from sqlalchemy import text, inspect
    from database import engine as _engine

    inspector = inspect(_engine)
    tables = set(inspector.get_table_names())

    def add_missing(table, required_columns):
        if table not in tables:
            return
        existing = {col["name"] for col in inspector.get_columns(table)}
        missing = [(n, t) for n, t in required_columns if n not in existing]
        if not missing:
            return
        with _engine.begin() as conn:
            for name, col_type in missing:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN "{name}" {col_type}'))

    add_missing("users", [
        ("google_sub", "TEXT"),
        ("full_name", "TEXT"),
        ("phone", "TEXT"),
        ("portfolio_url", "TEXT"),
        ("linkedin_url", "TEXT"),
        ("college", "TEXT"),
        ("current_role", "TEXT"),
        ("current_company", "TEXT"),
        ("graduation_month_year", "TEXT"),
        ("target_role", "TEXT"),
        ("background_text", "TEXT"),
        ("projects_json", "TEXT"),
        ("gemini_api_key", "TEXT"),
        ("gemini_keys_json", "TEXT"),
        ("gmail_refresh_token", "TEXT"),
        ("claude_api_key", "TEXT"),
    ])

    # leads / daily_quota gained a user_id column in the multi-user upgrade
    add_missing("leads", [
        ("user_id", "TEXT"),
        ("email_type", "TEXT DEFAULT 'cold_outreach'"),
        ("seen_work_detail", "TEXT"),
        ("job_title", "TEXT"),
        ("job_posting_id", "TEXT"),
        ("linkedin_context", "TEXT"),
        ("experience_highlight", "TEXT"),
        ("role_interest", "TEXT"),
        ("company_hook", "TEXT"),
    ])
    add_missing("daily_quota", [
        ("user_id", "TEXT"),
    ])

_run_migrations()

logger = logging.getLogger("cold_api.startup")


def _log_feature_flags():
    """Log which optional integrations are enabled, so misconfigured deploys
    surface at startup instead of as cryptic 500s at request time."""
    def state(var: str) -> str:
        return "enabled" if os.getenv(var) else "DISABLED"

    logger.info("Google Sign-In / Gmail OAuth ID verification: %s (GOOGLE_CLIENT_ID)", state("GOOGLE_CLIENT_ID"))
    logger.info("Gmail OAuth token exchange (send): %s (GOOGLE_CLIENT_SECRET)", state("GOOGLE_CLIENT_SECRET"))
    logger.info("OpenRouter AI fallback: %s (OPENROUTER_API_KEY)", state("OPENROUTER_API_KEY"))
    logger.info("Server Gemini key pool: %s (GEMINI_API_KEY)", state("GEMINI_API_KEY"))
    # Field encryption is a hard requirement (see services/crypto.py) — the
    # process would already have failed to start without it, so reaching here
    # means it's enabled.
    logger.info("Field encryption at rest: enabled (FIELD_ENCRYPTION_KEY)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _log_feature_flags()
    start_queue_worker()
    start_gen_worker()
    yield


app = FastAPI(
    title="Cold Email Outreach API",
    description="HR cold email outreach app with Gemini AI + Gmail SMTP",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def _parse_cors_origins(value: str) -> list[str]:
    return [origin.strip() for origin in value.split(",") if origin.strip()]


raw_cors_origins = os.getenv("CORS_ORIGINS", "")
cors_origins = _parse_cors_origins(raw_cors_origins) if raw_cors_origins else [
    "http://localhost:4000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:4000",
]
cors_origin_regex = os.getenv("CORS_ORIGIN_REGEX", r"^chrome-extension://.*$") or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(leads.router)
app.include_router(quota.router)
app.include_router(account.router)


@app.get("/health")
def health():
    return {"status": "ok", "message": "Cold Email API v2 is running"}
