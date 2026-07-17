from fastapi import APIRouter, Depends
import json
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import Lead, User
from services import quota_service
from services.crypto import decrypt_field
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["quota"])


def _get_user_gemini_keys(user: User) -> list[str]:
    keys = []
    if user.gemini_api_key:
        keys.append(decrypt_field(user.gemini_api_key))
    if user.gemini_keys_json:
        try:
            raw = json.loads(user.gemini_keys_json)
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


@router.get("/quota/today")
def get_quota(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return quota_service.get_today_stats(db, current_user.id)


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.id
    total   = db.query(func.count(Lead.id)).filter(Lead.user_id == uid).scalar()
    sent    = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "sent").scalar()
    queued  = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "queued").scalar()
    failed  = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "failed").scalar()
    replied = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "replied").scalar()
    pending = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "pending").scalar()
    draft   = db.query(func.count(Lead.id)).filter(Lead.user_id == uid, Lead.status == "draft").scalar()
    quota   = quota_service.get_today_stats(db, uid)
    return {
        "total": total, "sent": sent, "queued": queued,
        "failed": failed, "replied": replied, "pending": pending,
        "draft": draft, "quota": quota,
    }


@router.post("/queue/process")
def process_queue(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.id

    queued_leads = (
        db.query(Lead)
        .filter(Lead.user_id == uid, Lead.status == "queued")
        .order_by(Lead.queued_at.asc())
        .all()
    )

    results = {"processed": 0, "drafted": 0, "failed": 0, "details": []}

    if not queued_leads:
        return {**results, "message": "No queued leads to prepare"}

    for lead in queued_leads:
        results["processed"] += 1
        try:
            if not lead.email_subject or not lead.email_body:
                from services import gemini_service
                import json as _json
                gemini_keys = _get_user_gemini_keys(current_user)
                _claude_key = decrypt_field(current_user.claude_api_key)
                try:
                    _projects = _json.loads(current_user.projects_json) if current_user.projects_json else []
                except Exception:
                    _projects = []
                user_profile = {
                    "full_name": current_user.full_name or "",
                    "phone": current_user.phone or "",
                    "portfolio_url": current_user.portfolio_url or "",
                    "linkedin_url": current_user.linkedin_url or "",
                    "college": current_user.college or "",
                    "current_role": current_user.current_role or "",
                    "current_company": current_user.current_company or "",
                    "graduation_month_year": current_user.graduation_month_year or "",
                    "target_role": current_user.target_role or "",
                    "background_text": current_user.background_text or "",
                    "projects": _projects,
                    "gemini_api_keys": gemini_keys,
                    "claude_api_key": _claude_key,
                }
                lead_data = {
                    "hr_name": lead.hr_name, "hr_email": lead.hr_email,
                    "hr_position": lead.hr_position, "company": lead.company,
                    "company_url": lead.company_url, "linkedin_url": lead.linkedin_url,
                    "notes": lead.notes,
                }
                email_content = gemini_service.generate_email(lead_data, user_profile)
                lead.email_subject = str(email_content["subject"])
                lead.email_body = str(email_content["body"])
                db.commit()

            if not lead.email_subject or not lead.email_body:
                raise ValueError("Email content is still missing after regeneration attempt")

            lead.status = "draft"
            db.commit()
            results["drafted"] += 1
            results["details"].append({"id": lead.id, "email": lead.hr_email, "result": "draft"})
        except Exception as e:
            lead.status = "failed"
            lead.error_log = str(e)
            lead.retry_count = (lead.retry_count or 0) + 1
            db.commit()
            results["failed"] += 1
            results["details"].append({"id": lead.id, "email": lead.hr_email, "result": "failed", "error": str(e)})

    return results
