import os
from pathlib import Path

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash"

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
