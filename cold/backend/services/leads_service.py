from sqlalchemy.orm import Session
from models import Lead
from .time_utils import to_utc_iso


def check_duplicate(email: str, db: Session, user_id: str) -> dict:
    existing = db.query(Lead).filter(Lead.hr_email == email, Lead.user_id == user_id).first()
    if existing:
        sent_or_created = existing.sent_at or existing.created_at
        sent_or_created_iso = to_utc_iso(sent_or_created)
        return {
            "is_duplicate": True,
            "lead_id": existing.id,
            "status": existing.status,
            "sent_at": to_utc_iso(existing.sent_at),
            "created_at": to_utc_iso(existing.created_at),
            "message": f"Already {existing.status} on {sent_or_created_iso}"
        }
    return {"is_duplicate": False}


def get_all_leads(db: Session, user_id: str, status: str = None, company: str = None) -> list:
    q = db.query(Lead).filter(Lead.user_id == user_id)
    if status:
        q = q.filter(Lead.status == status)
    if company:
        q = q.filter(Lead.company.ilike(f"%{company}%"))
    return q.order_by(Lead.created_at.desc()).all()


def get_lead_by_id(lead_id: int, db: Session, user_id: str):
    return db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == user_id).first()


def delete_lead(lead_id: int, db: Session, user_id: str) -> bool:
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == user_id).first()
    if not lead:
        return False
    db.delete(lead)
    db.commit()
    return True


def update_lead_status(lead_id: int, new_status: str, db: Session, user_id: str):
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == user_id).first()
    if not lead:
        return None
    lead.status = new_status
    db.commit()
    db.refresh(lead)
    return lead
