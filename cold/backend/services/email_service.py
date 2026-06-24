import os
import json
import base64
import time
import urllib.request
import urllib.parse
import urllib.error
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")


def _refresh_access_token(refresh_token: str) -> str:
    data = urllib.parse.urlencode({
        "refresh_token": refresh_token,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    if "access_token" not in result:
        raise Exception(f"Token refresh failed: {result.get('error_description', result)}")
    return result["access_token"]


def _send_via_gmail_api(msg: MIMEMultipart, refresh_token: str, max_retries: int) -> bool:
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    payload = json.dumps({"raw": raw}).encode()

    for attempt in range(max_retries):
        try:
            access_token = _refresh_access_token(refresh_token)
            req = urllib.request.Request(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                result = json.loads(resp.read())
            if result.get("id"):
                return True
            raise Exception(f"Gmail API unexpected response: {result}")
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code == 401:
                raise Exception("Gmail authorization expired. Reconnect Gmail in Settings.")
            if e.code == 403:
                raise Exception(f"Gmail API access denied (check Gmail send scope): {body}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise Exception(f"Gmail API error {e.code}: {body}")
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def _send_via_smtp(msg: MIMEMultipart, gmail_address: str, gmail_password: str, max_retries: int) -> bool:
    import smtplib, ssl
    context = ssl.create_default_context()
    for attempt in range(max_retries):
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=15) as server:
                server.login(gmail_address, gmail_password)
                server.sendmail(gmail_address, msg["To"], msg.as_string())
            return True
        except smtplib.SMTPAuthenticationError:
            raise Exception("SMTP auth failed. Check your Gmail address and App Password in Settings.")
        except (smtplib.SMTPException, TimeoutError, OSError) as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise Exception(f"SMTP error after {max_retries} attempts: {str(e)}")


def send_cold_email(
    to_email: str,
    subject: str,
    body: str,
    gmail_address: str = None,
    gmail_refresh_token: str = None,
    gmail_password: str = None,
    max_retries: int = 3,
) -> bool:
    if not gmail_address:
        raise Exception("Gmail address not configured. Please set it in Settings.")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = gmail_address
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))

    if gmail_refresh_token and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
        return _send_via_gmail_api(msg, gmail_refresh_token, max_retries)
    elif gmail_password:
        return _send_via_smtp(msg, gmail_address, gmail_password, max_retries)
    else:
        raise Exception(
            "No sending credentials configured. "
            "Click 'Connect Gmail' in Settings to authorize sending."
        )
