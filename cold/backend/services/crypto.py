"""
Symmetric encryption for sensitive user fields (Gmail password, API keys).
Protects data at rest — a database breach does not expose plaintext secrets.

FIELD_ENCRYPTION_KEY env var must be a 32-byte URL-safe base64 key.
Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
import os
import logging
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_key_str = os.getenv("FIELD_ENCRYPTION_KEY", "")

if not _key_str:
    logger.warning(
        "SECURITY: FIELD_ENCRYPTION_KEY is not set. User secrets (Gmail passwords, "
        "API keys, OAuth refresh tokens) will be stored in PLAINTEXT. Set this env var "
        "in production. Generate one with: "
        'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )


def _fernet() -> Fernet | None:
    if not _key_str:
        return None
    try:
        return Fernet(_key_str.encode())
    except Exception:
        logger.error("FIELD_ENCRYPTION_KEY is set but invalid — must be a urlsafe base64 32-byte key.")
        return None


def encrypt_field(value: str | None) -> str | None:
    """Encrypt a string field before storing in DB. Returns None for None/empty."""
    if not value:
        return value
    f = _fernet()
    if not f:
        return value  # No key configured — store as-is (dev mode, warned at startup)
    return f.encrypt(value.encode()).decode()


def decrypt_field(value: str | None) -> str | None:
    """Decrypt a field read from DB.

    Returns None (not the raw ciphertext) when decryption fails — e.g. the
    FIELD_ENCRYPTION_KEY was rotated or blanked. Returning the raw encrypted
    blob would silently feed garbage into Gmail/Gemini calls and produce
    cryptic downstream errors, so we fail closed and log a warning instead.
    """
    if not value:
        return value
    f = _fernet()
    if not f:
        return value  # No key configured — value is plaintext, return as-is
    try:
        return f.decrypt(value.encode()).decode()
    except InvalidToken:
        logger.warning(
            "Failed to decrypt a stored secret (InvalidToken). The FIELD_ENCRYPTION_KEY "
            "may have changed since this value was encrypted. Returning None — the user "
            "must re-enter this credential in Settings."
        )
        return None
    except Exception:
        logger.exception("Unexpected error decrypting a stored secret. Returning None.")
        return None
