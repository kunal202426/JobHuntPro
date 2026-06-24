from datetime import date
from sqlalchemy.orm import Session
from models import DailyQuota

DAILY_EMAIL_CAP = 90


def can_send_today(db: Session, user_id: str) -> tuple[bool, int]:
    today = str(date.today())
    quota = db.query(DailyQuota).filter(DailyQuota.date == today, DailyQuota.user_id == user_id).first()
    if not quota:
        quota = DailyQuota(date=today, emails_sent=0, user_id=user_id)
        db.add(quota)
        db.commit()
        db.refresh(quota)
    remaining = DAILY_EMAIL_CAP - quota.emails_sent
    return remaining > 0, remaining


def increment_quota(db: Session, user_id: str):
    today = str(date.today())
    quota = db.query(DailyQuota).filter(DailyQuota.date == today, DailyQuota.user_id == user_id).first()
    if quota:
        quota.emails_sent += 1
        db.commit()


def get_today_stats(db: Session, user_id: str) -> dict:
    today = str(date.today())
    quota = db.query(DailyQuota).filter(DailyQuota.date == today, DailyQuota.user_id == user_id).first()
    sent = quota.emails_sent if quota else 0
    return {
        "date": today,
        "sent": sent,
        "remaining": DAILY_EMAIL_CAP - sent,
        "cap": DAILY_EMAIL_CAP,
    }
