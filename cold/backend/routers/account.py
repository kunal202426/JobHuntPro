from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, Lead, DailyQuota, EmailTask, GenerationTask
from auth import get_current_user

router = APIRouter(prefix="/api/account", tags=["account"])


@router.post("/reset")
def reset_account(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Wipe all cold-email data for this user (leads/mails, send queue, generation
    queue, daily quota). Does NOT delete the user row itself or profile fields."""
    uid = current_user.id

    deleted_email_tasks = db.query(EmailTask).filter(EmailTask.user_id == uid).delete(synchronize_session=False)
    deleted_gen_tasks = db.query(GenerationTask).filter(GenerationTask.user_id == uid).delete(synchronize_session=False)
    deleted_quota = db.query(DailyQuota).filter(DailyQuota.user_id == uid).delete(synchronize_session=False)
    deleted_leads = db.query(Lead).filter(Lead.user_id == uid).delete(synchronize_session=False)

    db.commit()

    return {
        "ok": True,
        "deleted": {
            "leads": deleted_leads,
            "email_tasks": deleted_email_tasks,
            "generation_tasks": deleted_gen_tasks,
            "daily_quota": deleted_quota,
        },
    }
