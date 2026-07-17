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
    raise RuntimeError(
        "FIELD_ENCRYPTION_KEY environment variable is required — without it, user "
        "secrets (Gmail passwords, API keys, OAuth refresh tokens) would be stored in "
        "plaintext. Generate one with: "
        'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )

try:
    _fernet_instance = Fernet(_key_str.encode())
except Exception as exc:
    raise RuntimeError(
        "FIELD_ENCRYPTION_KEY is set but invalid — must be a urlsafe base64 32-byte key."
    ) from exc


def _fernet() -> Fernet:
    return _fernet_instance


def encrypt_field(value: str | None) -> str | None:
    """Encrypt a string field before storing in DB. Returns None for None/empty."""
    if not value:
        return value
    return _fernet().encrypt(value.encode()).decode()


def decrypt_field(value: str | None) -> str | None:
    """Decrypt a field read from DB.

    Returns None (not the raw ciphertext) when decryption fails — e.g. the
    FIELD_ENCRYPTION_KEY was rotated. Returning the raw encrypted blob would
    silently feed garbage into Gmail/Gemini calls and produce cryptic
    downstream errors, so we fail closed and log a warning instead.
    """
    if not value:
        return value
    try:
        return _fernet().decrypt(value.encode()).decode()
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
