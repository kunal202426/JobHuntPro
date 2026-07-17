from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from datetime import datetime
import json
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models import Lead, User
from services import leads_service, quota_service, gemini_service
from services.email_queue import enqueue_email
from auth import get_current_user
from services.crypto import decrypt_field

router = APIRouter(prefix="/api/leads", tags=["leads"])


def _sanitize_cell(value: str) -> str:
    """Strip leading characters that spreadsheet apps interpret as formulas
    (CSV/formula injection defense-in-depth). Returns a trimmed, safe string."""
    if not value:
        return value
    cleaned = value.strip()
    while cleaned and cleaned[0] in ("=", "+", "-", "@", "\t", "\r"):
        cleaned = cleaned[1:].lstrip()
    return cleaned


class LeadCreate(BaseModel):
    hr_name: str
    hr_email: str
    hr_position: Optional[str] = None
    company: str
    company_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None
    email_type: str = "cold_outreach"
    seen_work_detail: Optional[str] = None
    job_title: Optional[str] = None
    job_posting_id: Optional[str] = None
    linkedin_context: Optional[str] = None
    experience_highlight: Optional[str] = None
    role_interest: Optional[str] = None
    company_hook: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str


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
    # De-dupe while preserving order
    seen = set()
    deduped = []
    for key in keys:
        if key and key not in seen:
            seen.add(key)
            deduped.append(key)
    return deduped


def lead_to_dict(lead: Lead) -> dict:
    return {
        "id": lead.id,
        "hr_name": lead.hr_name,
        "hr_email": lead.hr_email,
        "hr_position": lead.hr_position,
        "company": lead.company,
        "company_url": lead.company_url,
        "linkedin_url": lead.linkedin_url,
        "notes": lead.notes,
        "email_type": lead.email_type,
        "seen_work_detail": lead.seen_work_detail,
        "job_title": lead.job_title,
        "job_posting_id": lead.job_posting_id,
        "linkedin_context": lead.linkedin_context,
        "experience_highlight": lead.experience_highlight,
        "role_interest": lead.role_interest,
        "company_hook": lead.company_hook,
        "status": lead.status,
        "email_subject": lead.email_subject,
        "email_body": lead.email_body,
        "sent_at": str(lead.sent_at) if lead.sent_at else None,
        "queued_at": str(lead.queued_at) if lead.queued_at else None,
        "created_at": str(lead.created_at) if lead.created_at else None,
        "retry_count": lead.retry_count,
        "error_log": lead.error_log,
    }


@router.get("/check")
def check_duplicate(email: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return leads_service.check_duplicate(email, db, current_user.id)


@router.post("", status_code=201)
def add_lead(data: LeadCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dup = leads_service.check_duplicate(data.hr_email, db, current_user.id)
    if dup["is_duplicate"]:
        raise HTTPException(status_code=409, detail=dup["message"])

    if data.email_subject and data.email_body:
        email_content = {"subject": data.email_subject, "body": data.email_body}
    else:
        gemini_keys = _get_user_gemini_keys(current_user)
        _raw_claude_key = decrypt_field(current_user.claude_api_key)
        import json as _json
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
            "claude_api_key": _raw_claude_key,
        }
        try:
            email_content = gemini_service.generate_email(data.dict(), user_profile)
            if not email_content or not email_content.get("subject") or not email_content.get("body"):
                raise ValueError("Gemini returned empty or invalid content")
        except Exception as e:
            lead_data = data.dict()
            lead_data.pop("email_subject", None)
            lead_data.pop("email_body", None)
            new_lead = Lead(**lead_data, user_id=current_user.id, status="failed", error_log=f"Generation failed: {str(e)}")
            db.add(new_lead)
            db.commit()
            db.refresh(new_lead)
            raise HTTPException(status_code=502, detail=f"AI generation failed: {str(e)}")

    lead_data = data.dict()
    lead_data.pop("email_subject", None)
    lead_data.pop("email_body", None)
    new_lead = Lead(
        **lead_data,
        user_id=current_user.id,
        email_subject=str(email_content["subject"]),
        email_body=str(email_content["body"]),
    )

    if not new_lead.email_subject or not new_lead.email_body:
        new_lead.status = "failed"
        new_lead.error_log = "Email content was None or empty after generation"
        db.add(new_lead)
        db.commit()
        raise HTTPException(status_code=500, detail="Generated content was empty")

    # Always save as draft — sending happens only after explicit approval
    new_lead.status = "draft"
    db.add(new_lead)
    db.commit()
    db.refresh(new_lead)

    return lead_to_dict(new_lead)


@router.post("/generate-preview")
def generate_preview_email(data: LeadCreate, current_user: User = Depends(get_current_user)):
    import json
    gemini_keys = _get_user_gemini_keys(current_user)
    _claude_key = decrypt_field(current_user.claude_api_key)
    try:
        projects = []
        if current_user.projects_json:
            try:
                projects = json.loads(current_user.projects_json)
            except Exception:
                pass
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
            "projects": projects,
            "gemini_api_keys": gemini_keys,
            "claude_api_key": _claude_key,
        }
        email_content = gemini_service.generate_email(data.dict(), user_profile)
        if not email_content or not email_content.get("subject") or not email_content.get("body"):
            raise ValueError("Gemini returned empty or invalid content")
        return {"subject": email_content["subject"], "body": email_content["body"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {str(e)}")


@router.get("")
def list_leads(
    status: Optional[str] = None,
    company: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    leads = leads_service.get_all_leads(db, current_user.id, status=status, company=company)
    return [lead_to_dict(l) for l in leads]


@router.get("/{lead_id}")
def get_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lead = leads_service.get_lead_by_id(lead_id, db, current_user.id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead_to_dict(lead)


@router.patch("/{lead_id}/status")
def update_status(lead_id: int, body: StatusUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    valid = {"pending", "queued", "sent", "failed", "replied", "draft"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    lead = leads_service.update_lead_status(lead_id, body.status, db, current_user.id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead_to_dict(lead)


@router.delete("/{lead_id}", status_code=204)
def delete_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    deleted = leads_service.delete_lead(lead_id, db, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Lead not found")


@router.post("/{lead_id}/approve", status_code=200)
def approve_draft(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Approve a draft email and send it."""
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == current_user.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status != "draft":
        raise HTTPException(status_code=400, detail=f"Lead is '{lead.status}', not 'draft'")
    if not lead.email_subject or not lead.email_body:
        raise HTTPException(status_code=400, detail="Email content is missing")

    can_send, remaining = quota_service.can_send_today(db, current_user.id)
    if not can_send:
        lead.status = "queued"
        lead.queued_at = datetime.utcnow()
        db.commit()
        db.refresh(lead)
        return {**lead_to_dict(lead), "message": "Quota full — queued for later"}

    lead.status = "pending"
    db.commit()
    db.refresh(lead)

    # Durable queue: worker re-fetches credentials, sends, then updates lead
    # status + quota. Nothing is sent inline here.
    enqueue_email(lead.id, current_user.id)

    return lead_to_dict(lead)


class EditDraftPayload(BaseModel):
    email_subject: Optional[str] = None
    email_body: Optional[str] = None


@router.patch("/{lead_id}/draft")
def edit_draft(lead_id: int, payload: EditDraftPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Edit a draft email's subject/body before approving."""
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == current_user.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status != "draft":
        raise HTTPException(status_code=400, detail=f"Lead is '{lead.status}', not 'draft'")
    if payload.email_subject is not None:
        lead.email_subject = payload.email_subject
    if payload.email_body is not None:
        lead.email_body = payload.email_body
    db.commit()
    db.refresh(lead)
    return lead_to_dict(lead)


@router.post("/drafts/approve-all", status_code=200)
def approve_all_drafts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Approve and send all draft emails."""
    uid = current_user.id
    drafts = db.query(Lead).filter(Lead.user_id == uid, Lead.status == "draft").order_by(Lead.created_at.asc()).all()
    if not drafts:
        return {"processed": 0, "sent": 0, "queued": 0, "message": "No drafts to approve"}

    results = {"processed": 0, "sent": 0, "queued": 0}

    # Reserve quota up front so we don't enqueue more sends than the daily cap
    # allows (the worker sends asynchronously, so we can't rely on live counts).
    _can_send, remaining = quota_service.can_send_today(db, uid)
    queued_today = db.query(Lead).filter(Lead.user_id == uid, Lead.status == "pending").count()
    budget = max(0, remaining - queued_today)

    for lead in drafts:
        if not lead.email_subject or not lead.email_body:
            continue

        results["processed"] += 1

        if budget <= 0:
            lead.status = "queued"
            lead.queued_at = datetime.utcnow()
            db.commit()
            results["queued"] += 1
            continue

        lead.status = "pending"
        db.commit()
        db.refresh(lead)

        enqueue_email(lead.id, uid)
        budget -= 1
        results["sent"] += 1

    return results


class BulkLeadItem(BaseModel):
    hr_name: Optional[str] = None
    hr_email: str
    hr_position: Optional[str] = None
    company: str
    company_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None
    is_duplicate: Optional[bool] = False
    duplicate_status: Optional[str] = None


class BulkSubmitPayload(BaseModel):
    leads: list[BulkLeadItem]


@router.post("/csv-preview")
async def csv_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Invalid file type. Only CSV files are allowed.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty.")

    if b'\x00' in content:
        raise HTTPException(status_code=400, detail="Invalid CSV file. Binary content detected.")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode the CSV file. Please ensure it is saved in UTF-8 or standard text encoding.")

    import csv

    lines = text.splitlines()
    lines = [l for l in lines if l.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="CSV file is empty.")

    first_line = lines[0]
    delimiter = ','
    if '\t' in first_line and ',' not in first_line:
        delimiter = '\t'
    elif ';' in first_line and ',' not in first_line:
        delimiter = ';'

    try:
        reader = csv.reader(lines, delimiter=delimiter)
        rows = list(reader)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV file: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="No rows found in CSV.")

    headers = [h.strip().lower() for h in rows[0]]

    email_col = None
    company_col = None
    name_col = None
    position_col = None
    company_url_col = None
    linkedin_url_col = None
    notes_col = None

    for idx, h in enumerate(headers):
        if h in ['email', 'email_address', 'email address', 'hr_email', 'hr email', 'contact email', 'contact_email', 'hr_mail', 'mail']:
            email_col = idx
        elif h in ['company', 'company_name', 'company name', 'firm', 'organization', 'organisation']:
            company_col = idx
        elif h in ['name', 'hr_name', 'hr name', 'contact_name', 'contact name', 'hr_contact', 'hr contact', 'full_name', 'full name', 'fullname', 'first name', 'first_name']:
            name_col = idx
        elif h in ['position', 'hr_position', 'hr position', 'job_position', 'job position', 'title', 'job_title', 'job title', 'role']:
            position_col = idx
        elif h in ['company_url', 'company url', 'website', 'company_website', 'company website', 'domain', 'url']:
            company_url_col = idx
        elif h in ['linkedin_url', 'linkedin url', 'linkedin', 'linkedin_profile', 'linkedin profile', 'linkedin link']:
            linkedin_url_col = idx
        elif h in ['notes', 'note', 'comment', 'comments', 'additional_info', 'additional info', 'description']:
            notes_col = idx

    # Fuzzy matching fallbacks if not found
    if email_col is None:
        for idx, h in enumerate(headers):
            if 'email' in h or 'mail' in h:
                email_col = idx
                break
    if company_col is None:
        for idx, h in enumerate(headers):
            if 'company' in h or 'firm' in h or 'employer' in h:
                company_col = idx
                break

    if email_col is None or company_col is None:
        raise HTTPException(
            status_code=400,
            detail="CSV must contain 'email' and 'company' columns (or variations like 'Email Address', 'Company Name')."
        )

    leads = []
    errors = []

    for idx, row in enumerate(rows[1:], start=2):
        if not row or all(cell.strip() == '' for cell in row):
            continue

        email = _sanitize_cell(row[email_col]) if email_col < len(row) else ""
        company = _sanitize_cell(row[company_col]) if company_col < len(row) else ""
        name = _sanitize_cell(row[name_col]) if (name_col is not None and name_col < len(row)) else ""
        position = _sanitize_cell(row[position_col]) if (position_col is not None and position_col < len(row)) else ""
        company_url = _sanitize_cell(row[company_url_col]) if (company_url_col is not None and company_url_col < len(row)) else ""
        linkedin_url = _sanitize_cell(row[linkedin_url_col]) if (linkedin_url_col is not None and linkedin_url_col < len(row)) else ""
        notes = _sanitize_cell(row[notes_col]) if (notes_col is not None and notes_col < len(row)) else ""

        if not email or not company:
            errors.append(f"Row {idx}: Missing email or company")
            continue

        if "@" not in email or "." not in email.split("@")[-1]:
            errors.append(f"Row {idx}: Invalid email address '{email}'")
            continue

        dup = leads_service.check_duplicate(email, db, current_user.id)
        is_dup = dup.get("is_duplicate", False)
        dup_msg = dup.get("message", "") if is_dup else ""

        leads.append({
            "hr_name": name or email.split("@")[0].capitalize(),
            "hr_email": email,
            "hr_position": position or None,
            "company": company,
            "company_url": company_url or None,
            "linkedin_url": linkedin_url or None,
            "notes": notes or None,
            "is_duplicate": is_dup,
            "duplicate_status": dup_msg
        })

    return {"leads": leads, "errors": errors}


@router.post("/bulk", status_code=201)
def bulk_submit(
    payload: BulkSubmitPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    added_leads = []
    for item in payload.leads:
        email = item.hr_email.strip() if item.hr_email else ""
        company = item.company.strip() if item.company else ""
        if not email or not company:
            continue
        if "@" not in email:
            continue

        new_lead = Lead(
            user_id=current_user.id,
            hr_name=item.hr_name.strip() if item.hr_name else email.split("@")[0].capitalize(),
            hr_email=email,
            hr_position=item.hr_position.strip() if item.hr_position else None,
            company=company,
            company_url=item.company_url.strip() if item.company_url else None,
            linkedin_url=item.linkedin_url.strip() if item.linkedin_url else None,
            notes=item.notes.strip() if item.notes else None,
            status="queued"
        )
        db.add(new_lead)
        added_leads.append(new_lead)

    if added_leads:
        db.commit()
        from services.generation_queue import enqueue_generation
        for lead in added_leads:
            db.refresh(lead)
            enqueue_generation(lead.id, current_user.id)

    return {"status": "ok", "message": f"Successfully queued {len(added_leads)} leads for email generation"}
