import os
import re
import json
import time
import logging
import threading as _threading
from google import genai
from google.genai import types as genai_types

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── API key rotation (env-var fallback pool) ──────────────────────────────────
_key_lock = _threading.Lock()
_key_cooldowns: dict = {}
_key_index = 0
KEY_COOLDOWN_SECS = 65


def _load_api_keys() -> list:
    keys = []
    base = os.getenv("GEMINI_API_KEY")
    if base:
        keys.append(base)
    for i in range(2, 10):
        k = os.getenv(f"GEMINI_API_KEY_{i}")
        if k and k not in keys:
            keys.append(k)
    return keys


_api_keys = _load_api_keys()

# ── OpenRouter shared server key (fallback for all users) ────────────────────
_OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Tried in order — first one that returns a valid email wins.
# Override the whole list via OPENROUTER_MODELS (comma-separated) env var.
_DEFAULT_OR_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "poolside/laguna-m.1:free",
    "openai/gpt-oss-120b:free",
    "z-ai/glm-4.5-air:free",
    "deepseek/deepseek-v4-flash:free",
    "minimax/minimax-m2.5:free",
    "google/gemma-4-31b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",  # known-good fallback
    "qwen/qwen3-next-80b-a3b-instruct:free",
]
_env_models = os.getenv("OPENROUTER_MODELS", "")
_OPENROUTER_MODELS: list[str] = (
    [m.strip() for m in _env_models.split(",") if m.strip()]
    if _env_models else _DEFAULT_OR_MODELS
)


def _pick_key(override_key: str = None) -> str:
    if override_key:
        return override_key
    global _key_index
    if not _api_keys:
        raise ValueError("No Gemini API key available. Set your key in Settings.")
    now = time.time()
    with _key_lock:
        for _ in range(len(_api_keys)):
            key = _api_keys[_key_index % len(_api_keys)]
            _key_index = (_key_index + 1) % len(_api_keys)
            if now >= _key_cooldowns.get(key, 0):
                return key
        key = min(_api_keys, key=lambda k: _key_cooldowns.get(k, 0))
        wait = _key_cooldowns[key] - now
        logger.warning(f"All Gemini keys rate-limited. Waiting {wait:.0f}s")
        time.sleep(max(wait, 0))
        return key


def _mark_key_limited(key: str):
    with _key_lock:
        _key_cooldowns[key] = time.time() + KEY_COOLDOWN_SECS


def _call_claude(system_prompt: str, prompt: str, api_key: str, max_tokens: int = 500) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    return msg.content[0].text


def _call_openrouter(system_prompt: str, prompt: str, model: str, max_tokens: int = 500) -> str:
    import urllib.request, urllib.error
    if not _OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not configured")
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_OPENROUTER_API_KEY}",
            "HTTP-Referer": "https://jobhuntpro.app",
            "X-Title": "JobHuntPro",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise ValueError(f"OpenRouter HTTP {e.code}: {e.read().decode()[:200]}")
    return data["choices"][0]["message"]["content"]


def _call_gemini(system_prompt: str, prompt: str, api_key: str, max_tokens: int = 500) -> str:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.4,
            max_output_tokens=max_tokens,
        ),
    )
    if not response or not response.candidates:
        raise ValueError("Gemini returned no candidates.")
    return response.text


# ── User profile → prompt strings ────────────────────────────────────────────

def _build_background(u: dict) -> str:
    name          = u.get("full_name") or "the sender"
    current_role  = u.get("current_role") or "currently working in tech"
    current_co    = u.get("current_company") or ""
    college       = u.get("college") or u.get("current_role") or ""
    grad          = u.get("graduation_month_year") or ""
    target        = u.get("target_role") or "full-time roles"
    background    = u.get("background_text") or ""
    projects_raw  = u.get("projects") or []

    projects_block = ""
    if projects_raw:
        lines = [f"{i+1}. {p}" for i, p in enumerate(projects_raw) if p]
        if lines:
            projects_block = "\n\nPROJECTS (pick ONE most relevant per email):\n" + "\n".join(lines)

    parts = [f"SENDER'S BACKGROUND:\n{name}"]
    if college:
        parts.append(f"Education: {college}")
    if current_role:
        company_str = f" at {current_co}" if current_co else ""
        parts.append(f"Current role: {current_role}{company_str}")
    if grad:
        parts.append(f"Available for {target} from {grad}")
    if background:
        parts.append(f"\n{background}")
    if projects_block:
        parts.append(projects_block)

    return "\n".join(parts)


def _build_signal(u: dict) -> str:
    name     = u.get("full_name") or "The Sender"
    phone    = u.get("phone") or ""
    port     = u.get("portfolio_url") or ""
    linkedin = u.get("linkedin_url") or ""

    lines = []
    if port:
        lines.append(f"Check my work at:\n{port}")
    if linkedin:
        lines.append(linkedin)
    contact = f"~ {name}"
    if phone:
        contact += f" | {phone}"
    lines.append(contact)
    return "\n".join(lines)


def _build_cold_signal(u: dict) -> str:
    name     = u.get("full_name") or "The Sender"
    phone    = u.get("phone") or ""
    port     = u.get("portfolio_url") or ""
    linkedin = u.get("linkedin_url") or ""

    lines = ["Would love to explore opportunities or get a referral in your company."]
    if port or linkedin:
        lines.append("\nCheck my work at:")
        if port:
            lines.append(port)
        if linkedin:
            lines.append(linkedin)
    contact = f"\n~ {name}"
    if phone:
        contact += f" | {phone}"
    lines.append(contact)
    return "\n".join(lines)


# ── Prompt builders ───────────────────────────────────────────────────────────

def _cold_outreach_prompt(u: dict) -> str:
    name        = u.get("full_name") or "the sender"
    current_role = u.get("current_role") or "working in tech"
    current_co  = u.get("current_company") or "their company"
    grad        = u.get("graduation_month_year") or "soon"
    target      = u.get("target_role") or "full-time roles"
    signal      = _build_cold_signal(u)
    background  = _build_background(u)

    return f"""ABSOLUTE LIMIT: The email body must be 90-130 words.
Count before outputting. If it exceeds 130 words, CUT IT.

You write cold emails for {name}. {name} is the SENDER. The HR/recipient is someone else.

{background}

GREETING:
Start with: Hi [recipient's first name],
CRITICAL: The recipient's name is provided as "HR/Recipient name" in the prompt.
Use THAT name. Never use "{name}" as the greeting — {name} is the sender, not the recipient.
If no name is given, write: Hi there,

SUBJECT LINE:
Format: "SDE roles at [Company Name]" OR "Application at [Company Name]".

STRUCTURE (2 paragraphs only):
Paragraph 1 — INTRO:
    ONE sentence. Introduce {name}, mention their current role ({current_role} at {current_co}), state they are looking for {target} from {grad} and interested in [Company].

Paragraph 2 — WHY FIT:
    2 sentences. Start with the company's domain or product, then connect to {name}'s most relevant work.
    Use ONE concrete detail from background/projects/notes if available (e.g., "building production features for a high-throughput trading platform").
    Keep it human and specific; avoid generic corporate buzzwords.

HARD RULES:
- 90-130 words body MAX (excluding signal)
- Company name must appear at least once
- Exactly 2 paragraphs, one blank line between them
- No em dashes (—)

SIGNAL FORMAT (exact, append after body):
{signal}
"""


def _referral_work_prompt(u: dict) -> str:
    name       = u.get("full_name") or "the sender"
    current_co = u.get("current_company") or "their current company"
    signal     = _build_signal(u)
    background = _build_background(u)

    return f"""ABSOLUTE LIMIT: Email body must be 80-120 words.

You write referral-ask emails for {name} targeting engineering managers or tech leads.
{name} is the SENDER. THIS IS NOT A COLD EMAIL — peer-to-peer outreach referencing specific work they published.
{background}

GREETING: Start with: Hi [recipient's first name],

SUBJECT LINE: "[Their domain/topic] at [Company] — quick question"
Under 8 words. NEVER use "Application" in subject.

STRUCTURE (3 short paragraphs):
Paragraph 1 — THEIR WORK: Open with a specific technical detail from their work. One sentence connecting {name}'s parallel project.
Paragraph 2 — PROOF: One project. Name the specific technique or mechanism built.
Paragraph 3 — ASK: Is [Company] taking new-grad hires? Would a referral or 15-min chat be possible? End with: "No worries if not."

HARD RULES:
- 80-120 words body MAX
- Peer-to-peer tone
- Company name must appear
- Exactly 3 paragraphs

SIGNAL FORMAT (exact):
{signal}
"""


def _referral_job_prompt(u: dict) -> str:
    name   = u.get("full_name") or "the sender"
    grad   = u.get("graduation_month_year") or "soon"
    target = u.get("target_role") or "the role"
    signal = _build_signal(u)
    background = _build_background(u)

    return f"""ABSOLUTE LIMIT: Email body must be 70-100 words.

You write post-application follow-up emails for {name}.
{name} is the SENDER. The HR person is the RECIPIENT.
The candidate has ALREADY applied through the careers portal.
{background}

GREETING: Start with: Hi [recipient's first name],

SUBJECT LINE: "Application - [Job Title], Job ID [Job Posting ID] - {name}"

STRUCTURE (2 short paragraphs):
Paragraph 1: State applied for [Job Title] (Job ID [ID]) through [Company] careers portal.
  One sentence connecting ONE specific project or skill to what this role does.
Paragraph 2: "Targeting a {grad} start. If the application is in your queue, I'd appreciate any visibility."

HARD RULES:
- 70-100 words body MAX
- NO BULLETS
- NO EM DASHES (—)
- Company name must appear

SIGNAL FORMAT (exact):
{signal}
"""


def _linkedin_referral_prompt(u: dict) -> str:
    name   = u.get("full_name") or "the sender"
    port   = u.get("portfolio_url") or ""
    role   = u.get("current_role") or "working in tech"

    return f"""ABSOLUTE LIMIT: Email body must be 60-90 words. Count before outputting. If over 90, CUT IT.

You write LinkedIn referral ask emails for {name}.
{name} is the SENDER. The recipient is someone they found on LinkedIn.
{name}: {role}
Portfolio: {port}

SUBJECT LINE: "Reaching out — [Company Name]"

STRUCTURE (use \\n\\n between paragraphs):
Para 1: "Hi [name]\\n\\n" then exactly one sentence about how they were found on LinkedIn.
Para 2: Start with "I'm {name}, currently {role}." Then one sentence about experience and interest in the company.
Para 3 — output EXACTLY:
"You can check out my work and portfolio here:\\n{port}\\n\\nI'd be happy to share my resume or discuss my experience further if required.\\n\\nThank you.\\n~{name}"

HARD RULES:
- 60-90 words (Para 1 + Para 2 only)
- No project mentions
- Sound human, short sentences
"""


# ── Generation ────────────────────────────────────────────────────────────────

def count_words(body: str) -> int:
    return len(body.split()) if body else 0


_PLACEHOLDER_PATTERNS = re.compile(
    r"<email body>|<body>|\[email body\]|\[body\]|<insert|<write|<your email",
    re.IGNORECASE,
)

def _parse_ai_response(text: str, max_words: int) -> dict | None:
    text = text.strip()
    # Strip code fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    subject, body = None, None

    # ── Try JSON first ────────────────────────────────────────
    json_match = re.search(r"\{.*\}", text, re.DOTALL)
    if json_match:
        try:
            result = json.loads(json_match.group())
            subject = result.get("subject")
            body = result.get("body")
        except Exception:
            pass

    # ── Fallback: plain-text "Subject: ...\n\n<body>" ─────────
    if not subject or not body:
        subj_match = re.search(r"(?i)^subject\s*:\s*(.+)$", text, re.MULTILINE)
        if subj_match:
            subject = subj_match.group(1).strip()
            # Body is everything after the subject line (skip blank lines)
            after = text[subj_match.end():].strip()
            # Drop a leading "Body:" label if present
            after = re.sub(r"(?i)^body\s*:\s*", "", after).strip()
            body = after if after else None

    if not subject or not body:
        return None

    # Reject unfilled template placeholders
    if _PLACEHOLDER_PATTERNS.search(body):
        raise ValueError(f"Unfilled placeholder in body: {body[:100]}")
    # Reject suspiciously short bodies
    if count_words(body) < 15:
        raise ValueError(f"Body too short ({count_words(body)} words): {body[:100]}")
    if count_words(body) > max_words * 1.5:
        return None
    return {"subject": str(subject), "body": str(body)}


def _try_openrouter(system_prompt: str, prompt: str, max_words: int, max_tokens: int) -> dict | None:
    if not _OPENROUTER_API_KEY:
        return None
    for model in _OPENROUTER_MODELS:
        try:
            text = _call_openrouter(system_prompt, prompt, model, max_tokens)
            parsed = _parse_ai_response(text, max_words)
            if parsed:
                logger.info(f"[OpenRouter] {model} succeeded")
                return parsed
            logger.warning(f"[OpenRouter] {model} unparseable — raw: {text[:300]}")
        except Exception as e:
            logger.warning(f"[OpenRouter] {model} failed: {e}")
    return None


def _run_generation(system_prompt: str, prompt: str, max_words: int, label: str,
                    api_key: str = None, api_keys: list[str] | None = None,
                    max_tokens: int = 500, claude_api_key: str = None) -> dict:
    # Priority: 1) User Gemini keys  2) Server Gemini pool  3) OpenRouter  4) User Claude key
    user_keys = [k for k in (api_keys or []) if k]
    if api_key and api_key not in user_keys:
        user_keys.insert(0, api_key)

    if user_keys:
        for key in user_keys:
            try:
                text = _call_gemini(system_prompt, prompt, key, max_tokens)
                parsed = _parse_ai_response(text, max_words)
                if parsed:
                    return parsed
                raise ValueError(f"Bad response format: {text[:200]}")
            except Exception as e:
                err = str(e)
                is_rate_limit = "429" in err or "quota" in err.lower() or "resource_exhausted" in err.lower()
                if is_rate_limit:
                    continue
                logger.error(f"[Gemini] user key failed: {err}")

    has_server_gemini = bool(_api_keys)
    if not user_keys and not has_server_gemini:
        # No Gemini at all — go straight to shared OpenRouter
        result = _try_openrouter(system_prompt, prompt, max_words, max_tokens)
        if result:
            return result
        # Claude as last resort
        if claude_api_key:
            for attempt in range(3):
                try:
                    text = _call_claude(system_prompt, prompt, claude_api_key, max_tokens)
                    parsed = _parse_ai_response(text, max_words)
                    if parsed:
                        return parsed
                    raise ValueError(f"Bad response format: {text[:200]}")
                except Exception as e:
                    logger.error(f"[Claude] attempt {attempt + 1} failed: {e}")
                    if attempt >= 2:
                        raise Exception(f"Claude generation failed: {e}")
                    time.sleep(2)
        raise Exception("No AI provider available — add a Gemini key in Settings or contact admin")

    if has_server_gemini:
        attempts_per_key = 3
        max_attempts = max(len(_api_keys) * attempts_per_key, 3)
        all_rate_limited = False

        for attempt in range(max_attempts):
            key = _pick_key(None)
            try:
                text = _call_gemini(system_prompt, prompt, key, max_tokens)
                parsed = _parse_ai_response(text, max_words)
                if parsed:
                    return parsed
                raise ValueError(f"Bad response format: {text[:200]}")
            except Exception as e:
                err = str(e)
                is_rate_limit = "429" in err or "quota" in err.lower() or "resource_exhausted" in err.lower()
                if is_rate_limit:
                    _mark_key_limited(key)
                    all_rate_limited = True
                    continue
                logger.error(f"[Gemini] attempt {attempt + 1} failed: {err}")
                if attempt >= max_attempts - 1:
                    break
                time.sleep(2)

        logger.warning(f"[Gemini] Server keys {'rate-limited' if all_rate_limited else 'failed'}, trying fallbacks")

    result = _try_openrouter(system_prompt, prompt, max_words, max_tokens)
    if result:
        return result
    if claude_api_key:
        try:
            text = _call_claude(system_prompt, prompt, claude_api_key, max_tokens)
            parsed = _parse_ai_response(text, max_words)
            if parsed:
                return parsed
        except Exception as e:
            logger.error(f"[Claude] fallback failed: {e}")

    raise Exception("Generation failed — all AI providers exhausted")


def _extract_first_name(full_name: str) -> str:
    if not full_name or not full_name.strip():
        return "there"
    return full_name.strip().split()[0]


def _ensure_greeting(body: str, first_name: str) -> str:
    if body.lstrip().lower().startswith("hi "):
        return body
    return f"Hi {first_name},\n\n" + body.lstrip()


def _ensure_signal(body: str, signal: str) -> str:
    # Don't double-append if a portfolio URL or "~" closing is already there
    if "~" in body or (signal and signal.split("\n")[0][:20] in body):
        return body
    return body.rstrip() + "\n\n" + signal


# ── Public API ────────────────────────────────────────────────────────────────

def generate_email(lead: dict, user: dict) -> dict:
    email_type      = lead.get("email_type", "cold_outreach")
    recipient_first = _extract_first_name(lead.get("hr_name", ""))
    api_keys        = user.get("gemini_api_keys") or []
    api_key         = user.get("gemini_api_key") or None
    claude_api_key  = user.get("claude_api_key") or None
    cold_signal     = _build_cold_signal(user)
    signal          = _build_signal(user)
    name            = user.get("full_name") or "the sender"
    company         = lead.get("company", "Unknown Company")

    if api_key and api_key not in api_keys:
        api_keys = [api_key] + list(api_keys)
    kw = dict(api_key=None, api_keys=api_keys, claude_api_key=claude_api_key)

    if email_type == "linkedin_referral":
        prompt = f"""Generate the LinkedIn referral ask email for:
Company: {company}
Recipient name: {recipient_first}
linkedin_context: {lead.get("linkedin_context", "LinkedIn Profile")}
experience_highlight: {lead.get("experience_highlight", "")}
role_interest: {lead.get("role_interest", "")}
company_hook: {lead.get("company_hook", "")}

Return ONLY valid JSON:
{{"subject": "Reaching out — {company}", "body": "<email body>"}}
"""
        return _run_generation(_linkedin_referral_prompt(user), prompt, max_words=110,
                       label="linkedin_referral", max_tokens=400, **kw)

    if email_type in {"referral_work", "referral_job"}:
        if email_type == "referral_job":
            sys_prompt = _referral_job_prompt(user)
            prompt = f"""Generate post-application follow-up for:
Sender: {name}
Recipient: {recipient_first}
Company: {company}
Job Title: {lead.get("job_title", "")}
Job Posting ID: {lead.get("job_posting_id", "")}
Notes: {lead.get("notes", "")}

Return ONLY valid JSON:
{{"subject": "Application - {lead.get('job_title', 'Role')}, Job ID {lead.get('job_posting_id', 'N/A')} - {name}", "body": "<email body>"}}
"""
            result = _run_generation(sys_prompt, prompt, max_words=110, label="referral_job", **kw)
        else:
            sys_prompt = _referral_work_prompt(user)
            prompt = f"""Generate referral-ask email for:
Sender: {name}
Recipient: {recipient_first}
Company: {company}
Their specific work: {lead.get("seen_work_detail", "")}
Notes: {lead.get("notes", "")}

Return ONLY valid JSON:
{{"subject": "<subject>", "body": "<email body>"}}
"""
            result = _run_generation(sys_prompt, prompt, max_words=130, label="referral_work", **kw)

        result["body"] = _ensure_greeting(result["body"], recipient_first)
        result["body"] = _ensure_signal(result["body"], signal)
        result["body"] = result["body"].replace("—", ",")
        result["subject"] = result["subject"].replace("—", "-")
        return result

    # cold_outreach (default)
    sys_prompt = _cold_outreach_prompt(user)
    prompt = f"""Generate the 2-paragraph cold email for:
SENDER: {name}
RECIPIENT (use this name in greeting): {recipient_first}
Company: {company}
Notes / context: {lead.get("notes", "")}

Return ONLY valid JSON:
{{"subject": "Application at {company}", "body": "<email body>"}}
"""
    result = _run_generation(sys_prompt, prompt, max_words=120, label="cold_outreach", **kw)
    result["body"] = _ensure_greeting(result["body"], recipient_first)
    result["body"] = _ensure_signal(result["body"], cold_signal)
    result["body"] = result["body"].replace("—", ",")
    result["subject"] = result["subject"].replace("—", "-")
    return result
