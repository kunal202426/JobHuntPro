"""
Durable, DB-backed email send queue.

Replaces the old in-memory list queue, which silently lost all queued emails
whenever the Python process restarted (e.g. Render free-tier sleep). Tasks now
live in the `email_tasks` table and are resumed on startup.

Security (S5): the queue stores only `lead_id` + `user_id`. Gmail credentials
are re-fetched from the user row and decrypted only at send time inside the
worker — decrypted secrets are never persisted in the queue.
"""
import threading
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

_worker_lock = threading.Lock()
_worker_running = False

INTER_EMAIL_DELAY = 2  # seconds between sends (rate limiting)


def enqueue_email(lead_id: int, user_id: str):
    """Persist an email-send task and ensure the worker is running."""
    from database import SessionLocal
    from models import EmailTask

    db = SessionLocal()
    try:
        db.add(EmailTask(lead_id=lead_id, user_id=user_id, status="pending"))
        db.commit()
    finally:
        db.close()
    start_queue_worker()


def start_queue_worker():
    """Start the background worker if it isn't already running."""
    global _worker_running
    with _worker_lock:
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_process_queue, daemon=True).start()


def get_queue_size() -> int:
    """Number of email tasks still waiting or in flight."""
    from database import SessionLocal
    from models import EmailTask

    db = SessionLocal()
    try:
        return db.query(EmailTask).filter(EmailTask.status.in_(["pending", "processing"])).count()
    finally:
        db.close()


def _reset_orphaned_processing():
    """On startup, return any task left in 'processing' (process died mid-send)
    back to 'pending' so it gets retried."""
    from database import SessionLocal
    from models import EmailTask

    db = SessionLocal()
    try:
        stuck = db.query(EmailTask).filter(EmailTask.status == "processing").all()
        for t in stuck:
            t.status = "pending"
        if stuck:
            db.commit()
            logger.info("Reset %d orphaned email task(s) to pending on startup", len(stuck))
    finally:
        db.close()


def _process_queue():
    global _worker_running
    from database import SessionLocal
    from models import EmailTask, Lead, User
    from services import quota_service
    from services.email_service import send_cold_email
    from services.crypto import decrypt_field

    _reset_orphaned_processing()
    logger.info("Email queue worker started")

    while True:
        db = SessionLocal()
        try:
            task = (
                db.query(EmailTask)
                .filter(EmailTask.status == "pending")
                .order_by(EmailTask.created_at.asc(), EmailTask.id.asc())
                .first()
            )
            if not task:
                with _worker_lock:
                    _worker_running = False
                logger.info("Email queue worker exiting (no pending tasks)")
                break

            task.status = "processing"
            db.commit()

            lead = db.query(Lead).filter(Lead.id == task.lead_id).first()
            if not lead:
                task.status = "failed"
                task.error = "Lead not found"
                db.commit()
                continue

            if not lead.email_subject or not lead.email_body:
                task.status = "failed"
                task.error = "Missing email subject or body"
                lead.status = "failed"
                lead.error_log = "Missing email content at send time"
                db.commit()
                continue

            user = db.query(User).filter(User.id == task.user_id).first()
            if not user:
                task.status = "failed"
                task.error = "User not found"
                lead.status = "failed"
                lead.error_log = "Sending user not found at send time"
                db.commit()
                continue

            # Re-fetch + decrypt credentials only here, at send time (S5).
            gmail_address = user.gmail_address
            gmail_password = decrypt_field(user.gmail_app_password)
            gmail_refresh_token = decrypt_field(user.gmail_refresh_token)

            try:
                send_cold_email(
                    lead.hr_email,
                    lead.email_subject,
                    lead.email_body,
                    gmail_address=gmail_address,
                    gmail_password=gmail_password,
                    gmail_refresh_token=gmail_refresh_token,
                )
                lead.status = "sent"
                lead.sent_at = datetime.utcnow()
                lead.error_log = None
                task.status = "done"
                db.commit()
                quota_service.increment_quota(db, task.user_id)
            except Exception as e:
                lead.status = "failed"
                lead.error_log = str(e)
                lead.retry_count = (lead.retry_count or 0) + 1
                task.status = "failed"
                task.error = str(e)
                db.commit()
        except Exception:
            logger.exception("Email queue worker iteration failed")
        finally:
            db.close()

        time.sleep(INTER_EMAIL_DELAY)
