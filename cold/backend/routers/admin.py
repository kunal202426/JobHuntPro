from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Lead, DailyQuota
from auth import get_admin_user

router = APIRouter(prefix="/admin", tags=["admin"])


def lead_to_dict(lead):
    return {
        "id": lead.id, "user_id": lead.user_id, "hr_name": lead.hr_name,
        "hr_email": lead.hr_email, "hr_position": lead.hr_position,
        "company": lead.company, "company_url": lead.company_url,
        "linkedin_url": lead.linkedin_url, "email_type": lead.email_type,
        "status": lead.status, "email_subject": lead.email_subject,
        "email_body": lead.email_body,
        "sent_at": str(lead.sent_at) if lead.sent_at else None,
        "created_at": str(lead.created_at) if lead.created_at else None,
        "retry_count": lead.retry_count, "error_log": lead.error_log,
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), _=Depends(get_admin_user)):
    users = db.query(User).all()
    result = []
    for u in users:
        leads_count = db.query(func.count(Lead.id)).filter(Lead.user_id == u.id).scalar()
        sent_count = db.query(func.count(Lead.id)).filter(Lead.user_id == u.id, Lead.status == "sent").scalar()
        result.append({
            "id": u.id, "email": u.email, "is_admin": u.is_admin,
            "created_at": str(u.created_at) if u.created_at else None,
            "leads_count": leads_count, "sent_count": sent_count,
        })
    return result


@router.get("/users/{user_id}/leads")
def get_user_leads(user_id: str, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    leads = db.query(Lead).filter(Lead.user_id == user_id).order_by(Lead.created_at.desc()).all()
    return [lead_to_dict(l) for l in leads]


@router.get("/users/{user_id}/stats")
def get_user_stats(user_id: str, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        from fastapi import HTTPException
        raise HTTPException(404, "User not found")
    total = db.query(func.count(Lead.id)).filter(Lead.user_id == user_id).scalar()
    sent = db.query(func.count(Lead.id)).filter(Lead.user_id == user_id, Lead.status == "sent").scalar()
    queued = db.query(func.count(Lead.id)).filter(Lead.user_id == user_id, Lead.status == "queued").scalar()
    failed = db.query(func.count(Lead.id)).filter(Lead.user_id == user_id, Lead.status == "failed").scalar()
    return {"user": {"id": user.id, "email": user.email}, "total": total, "sent": sent, "queued": queued, "failed": failed}
