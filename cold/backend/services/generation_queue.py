"""
Durable, DB-backed AI email-generation queue (used by bulk CSV imports).

Replaces the old in-memory queue, which lost all pending generation jobs on a
process restart, leaving leads stuck at status='queued' forever. Tasks now live
in the `generation_tasks` table and resume on startup.
"""
import threading
import time
import logging
import json

logger = logging.getLogger(__name__)

_worker_lock = threading.Lock()
_worker_running = False

GEMINI_DELAY = 4  # seconds between Gemini calls — safe for 15 RPM free tier


def _get_user_gemini_keys(user_row) -> list[str]:
    from services.crypto import decrypt_field

    keys = []
    if user_row.gemini_api_key:
        keys.append(decrypt_field(user_row.gemini_api_key))
    if user_row.gemini_keys_json:
        try:
            raw = json.loads(user_row.gemini_keys_json)
            for enc in raw:
                if enc:
                    keys.append(decrypt_field(enc))
        except Exception:
            pass
    seen = set()
    deduped = []
    for key in keys:
        if key and key not in seen:
            seen.add(key)
            deduped.append(key)
    return deduped


def enqueue_generation(lead_id: int, user_id: str):
    """Persist a generation task and ensure the worker is running."""
    from database import SessionLocal
    from models import GenerationTask

    db = SessionLocal()
    try:
        db.add(GenerationTask(lead_id=lead_id, user_id=user_id, status="pending"))
        db.commit()
    finally:
        db.close()
    _start_worker()


def start_gen_worker():
    """Called once at app startup — resumes any pending tasks left from a restart."""
    _start_worker()


def get_gen_queue_size() -> int:
    from database import SessionLocal
    from models import GenerationTask

    db = SessionLocal()
    try:
        return db.query(GenerationTask).filter(GenerationTask.status.in_(["pending", "processing"])).count()
    finally:
        db.close()


def _start_worker():
    global _worker_running
    with _worker_lock:
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_process_gen_queue, daemon=True).start()


def _reset_orphaned_processing():
    from database import SessionLocal
    from models import GenerationTask

    db = SessionLocal()
    try:
        stuck = db.query(GenerationTask).filter(GenerationTask.status == "processing").all()
        for t in stuck:
            t.status = "pending"
        if stuck:
            db.commit()
            logger.info("Reset %d orphaned generation task(s) to pending on startup", len(stuck))
    finally:
        db.close()


def _process_gen_queue():
    global _worker_running
    from database import SessionLocal
    from models import GenerationTask, Lead, User
    from services import gemini_service

    _reset_orphaned_processing()
    logger.info("Generation queue worker started")

    while True:
        db = SessionLocal()
        try:
            task = (
                db.query(GenerationTask)
                .filter(GenerationTask.status == "pending")
                .order_by(GenerationTask.created_at.asc(), GenerationTask.id.asc())
                .first()
            )
            if not task:
                with _worker_lock:
                    _worker_running = False
                logger.info("Generation queue worker exiting (no pending tasks)")
                break

            task.status = "processing"
            db.commit()

            lead = db.query(Lead).filter(Lead.id == task.lead_id).first()
            if not lead:
                task.status = "failed"
                task.error = "Lead not found"
                db.commit()
                continue

            # Already generated (e.g. retried) — just move to draft for review.
            if lead.email_subject and lead.email_body:
                lead.status = "draft"
                task.status = "done"
                db.commit()
                continue

            user_row = db.query(User).filter(User.id == lead.user_id).first()
            user_profile = {}
            if user_row:
                projects = []
                if user_row.projects_json:
                    try:
                        projects = json.loads(user_row.projects_json)
                    except Exception:
                        pass
                from services.crypto import decrypt_field
                user_profile = {
                    "full_name": user_row.full_name or "",
                    "phone": user_row.phone or "",
                    "portfolio_url": user_row.portfolio_url or "",
                    "linkedin_url": user_row.linkedin_url or "",
                    "college": user_row.college or "",
                    "current_role": user_row.current_role or "",
                    "current_company": user_row.current_company or "",
                    "graduation_month_year": user_row.graduation_month_year or "",
                    "target_role": user_row.target_role or "full-time roles",
                    "background_text": user_row.background_text or "",
                    "projects": projects,
                    "gemini_api_keys": _get_user_gemini_keys(user_row),
                    "claude_api_key": decrypt_field(user_row.claude_api_key),
                }

            logger.info("Generating email for lead %s (%s)", lead.id, lead.company)
            lead_dict = {
                "hr_name": lead.hr_name or "",
                "hr_email": lead.hr_email,
                "company": lead.company,
                "notes": lead.notes or "",
                "email_type": lead.email_type or "cold_outreach",
                "seen_work_detail": lead.seen_work_detail or "",
                "job_title": lead.job_title or "",
                "job_posting_id": lead.job_posting_id or "",
                "linkedin_context": lead.linkedin_context or "",
                "experience_highlight": lead.experience_highlight or "",
                "role_interest": lead.role_interest or "",
                "company_hook": lead.company_hook or "",
            }

            try:
                email_content = gemini_service.generate_email(lead_dict, user_profile)
                if not email_content or not email_content.get("subject") or not email_content.get("body"):
                    raise ValueError("Gemini returned empty or invalid content")
                lead.email_subject = email_content["subject"]
                lead.email_body = email_content["body"]
                lead.status = "draft"   # always draft — user reviews before sending
                task.status = "done"
                db.commit()
                logger.info("Lead %s generated and marked as draft", lead.id)
            except Exception as e:
                logger.error("Generation failed for lead %s: %s", lead.id, e)
                lead.status = "failed"
                lead.error_log = f"Generation failed: {str(e)}"
                lead.retry_count = (lead.retry_count or 0) + 1
                task.status = "failed"
                task.error = str(e)
                db.commit()
        except Exception:
            logger.exception("Generation queue worker iteration failed")
        finally:
            db.close()

        time.sleep(GEMINI_DELAY)
