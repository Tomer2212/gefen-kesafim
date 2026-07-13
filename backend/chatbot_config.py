import os
from pathlib import Path

# Active provider: "google" (direct billing, default) or "openrouter" (inactive backup —
# kept working intentionally so reverting is a one-line env change, not a code change).
CHATBOT_PROVIDER = os.getenv("CHATBOT_PROVIDER", "google")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
# gemini-3.1-flash-lite chosen over gemini-flash-latest (currently 3.5-flash) after comparing
# real pricing: flash-lite is ~6x cheaper on input/output/cache, and this bot's task (answering
# questions grounded in a provided document) doesn't need top-tier reasoning capability.
GOOGLE_MODEL = "gemini-3.1-flash-lite"

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash"

CHATBOT_PER_USER_DAILY_LIMIT = int(os.getenv("CHATBOT_PER_USER_DAILY_LIMIT", "10"))
CHATBOT_GLOBAL_DAILY_LIMIT = int(os.getenv("CHATBOT_GLOBAL_DAILY_LIMIT", "100"))

_KB_PATH = Path(__file__).parent / "knowledge" / "chatbot_kb.md"

_INSTRUCTIONS = (
    "אתה עוזר AI מקצועי באתר של גפן AI, כלי להתאמת תקציבי חינוך מול דיווחי גפן. "
    "ענה בעברית, בקצרה ובבהירות, על סמך המסמך המצורף בלבד. "
    "אם השאלה חורגת מתחום המסמך, ציין בנימוס שאין לך מידע על כך והפנה את המשתמש לצוות התמיכה."
)

# Read once at process startup and never again — the resulting string must stay
# byte-for-byte identical across requests so Gemini's implicit caching can match
# the prefix. Do not add timestamps or per-request data to this string.
_SYSTEM_PREFIX = _INSTRUCTIONS + "\n\n---\n\n" + _KB_PATH.read_text(encoding="utf-8")


def get_system_prefix() -> str:
    return _SYSTEM_PREFIX
