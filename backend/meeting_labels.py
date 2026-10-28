"""Canonical-value normalization for the three free-text meeting fields that a past-mode
meeting import copies verbatim from the org's Excel file: ``status``, ``meeting_type``
(מיקום) and ``meeting_service_type`` (סוג).

The app's filters, stats and automations all assume these columns hold one of a small closed
set of canonical values. An import that leaves them as raw Hebrew text ("התקיימה",
"חיבור מרחוק", "גפן") breaks filtering. These helpers map the common Hebrew wordings to the
canonical value; anything they don't recognise returns ``None`` so the caller can surface it
for a human to map (see the "unrecognized_*" import problems and the value-mapping screen).

This is a deliberate mirror of the frontend synonym tables in
``frontend/src/constants/meetingImportFieldConfig.js`` — same maintenance pattern as
``_normalize_stage_scope`` / ``normalizeImportStageScope``. Keep the two in sync.
Pattern itself follows ``zihuy_core.normalize_budget_name`` / ``BUDGET_NAME_MAP``.
"""

MEETING_STATUS_VALUES = ["scheduled", "completed", "cancelled", "postponed", "other"]
MEETING_TYPE_VALUES = ["physical", "remote"]
MEETING_SERVICE_TYPE_VALUES = ["gefen", "current", "gefen_current", "district", "takuma"]

MEETING_STATUS_LABELS = {
    "scheduled": "נקבעה",
    "completed": "בוצעה",
    "cancelled": "בוטלה",
    "postponed": "נדחתה",
    "other": "אחר",
}
MEETING_TYPE_LABELS = {"physical": "פיזי", "remote": "מרחוק"}
MEETING_SERVICE_TYPE_LABELS = {
    "gefen": "גפן",
    "current": "שוטף",
    "gefen_current": "גפן+שוטף",
    "district": "מחוז",
    "takuma": "תקומה",
}

# Hebrew final-form letters -> their regular form, so substring matching isn't defeated by
# "התקיים" (ends final-mem ם) not being a prefix of "התקיימה" (regular-mem מ), etc.
_FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def _definalize(s: str) -> str:
    return s.translate(_FINALS)


# Each entry: (list of substrings already in regular-letter form, canonical value). First
# match wins, so order matters — more specific rules first.
_STATUS_MAP = [
    (["אחר", "other"], "other"),
    (["בוטל", "מבוטל", "ביטול", "cancel"], "cancelled"),
    (["נדח", "דחיי", "דחייה", "postpon"], "postponed"),
    (["בוצע", "התקיי", "הושלמ", "נערכ", "קוימ", "complete", "done"], "completed"),
    (["נקבע", "מתוכנ", "מתוזמ", "עתידי", "טרמ", "schedul", "planned"], "scheduled"),
]

_TYPE_MAP = [
    (["מרחוק", "טלפו", "זומ", "zoom", "וידאו", "video", "online", "אונלי", "remote"], "remote"),
    (["פיזי", "שטח", "פרונטל", "פנימ אל פנימ", "פנימ", "בבית הספר", "physical", "in person", "onsite"], "physical"),
]

# NOTE: the "גפן"+"שוטף" together -> gefen_current rule is handled specially in
# normalize_meeting_service_type() before this table is consulted.
_SERVICE_TYPE_MAP = [
    (["מחוז", "district"], "district"),
    (["תקומה", "takuma"], "takuma"),
    (["גפנ", 'גפ"נ', "גפ״נ", "מכתב בקרה", "gefen"], "gefen"),
    (["שוטפ", "סגירת שנה", "current"], "current"),
]


def _match(raw, table):
    if raw is None:
        return None
    t = _definalize(str(raw).strip().lower())
    if not t:
        return None
    for keys, canonical in table:
        for key in keys:
            if _definalize(key.lower()) in t:
                return canonical
    return None


def normalize_meeting_status(raw):
    """Free Hebrew status text -> one of MEETING_STATUS_VALUES, or None if unrecognised."""
    t = (str(raw).strip() if raw is not None else "")
    if t in MEETING_STATUS_VALUES:
        return t
    return _match(raw, _STATUS_MAP)


def normalize_meeting_type(raw):
    """Free Hebrew מיקום text -> 'physical' / 'remote', or None if unrecognised."""
    t = (str(raw).strip() if raw is not None else "")
    if t in MEETING_TYPE_VALUES:
        return t
    return _match(raw, _TYPE_MAP)


def normalize_meeting_service_type(raw):
    """Free Hebrew סוג text -> one of MEETING_SERVICE_TYPE_VALUES, or None if unrecognised."""
    t = (str(raw).strip() if raw is not None else "")
    if t in MEETING_SERVICE_TYPE_VALUES:
        return t
    d = _definalize(t.lower())
    has_gefen = "גפנ" in d or 'גפ"נ' in d or "gefen" in d
    has_current = "שוטפ" in d or "current" in d
    if has_gefen and has_current:
        return "gefen_current"
    return _match(raw, _SERVICE_TYPE_MAP)


NORMALIZERS = {
    "status": normalize_meeting_status,
    "meeting_type": normalize_meeting_type,
    "meeting_service_type": normalize_meeting_service_type,
}

CANONICAL_LABELS = {
    "status": MEETING_STATUS_LABELS,
    "meeting_type": MEETING_TYPE_LABELS,
    "meeting_service_type": MEETING_SERVICE_TYPE_LABELS,
}


# ---------------------------------------------------------------------------
# Participant-role recognition for the meeting-import "תפקיד/י משתתפים" column —
# maps free Hebrew role text (e.g. "מנהל", "מנהלנית") to the standard contact keys
# ParticipantsSelector already uses ("principal" / "secretary" / "finance"), or to a
# specific school's own extra_contacts entry ("extra_0", "extra_1", ...). Same
# substring-match-via-_match() pattern as the three tables above; only the
# extra_contacts step is inherently per-school (not a fixed global table) since each
# school defines its own extra contact roles.
# ---------------------------------------------------------------------------

_PRINCIPAL_ROLE_SYNONYMS = [
    "מנהל", "מנהלת", "מנהל/ת", "מנהל בית הספר", "מנהלת בית הספר", "מנהל בי\"ס", "מנהלת בי\"ס", "principal",
]
_SECRETARY_ROLE_SYNONYMS = [
    "מנהלן", "מנהלנית", "מנהלנ/ית", "מנהלן/נית", "מזכיר", "מזכירה", "מזכיר/ה", "secretary",
]
_FINANCE_ROLE_SYNONYMS = [
    "אחראי כספים", "אחראית כספים", "אחראי/ת כספים", "גזבר", "גזברית", "רכז כספים", "רכזת כספים", "finance",
]

# Order matters (first match wins, via _match()'s substring check): secretary and finance are
# checked BEFORE principal, because "מנהל" is itself a substring of "מנהלן"/"מנהלנית" (secretary)
# — checking principal first would make every secretary token falsely match "principal" via that
# accidental substring collision. Putting the more specific synonym lists first avoids this.
_PARTICIPANT_ROLE_MAP = [
    (_SECRETARY_ROLE_SYNONYMS, "secretary"),
    (_FINANCE_ROLE_SYNONYMS, "finance"),
    (_PRINCIPAL_ROLE_SYNONYMS, "principal"),
]


def resolve_participant_role_token(raw_token: str, school: dict) -> str | None:
    """A single comma-split token from the import's participant-role column -> one of
    'principal' / 'secretary' / 'finance' / 'extra_{i}' (matching that specific school's
    extra_contacts[i]), or None if nothing matches (caller surfaces this as an
    'unrecognized_participant_role' import problem)."""
    standard = _match(raw_token, _PARTICIPANT_ROLE_MAP)
    if standard:
        return standard
    for i, ec in enumerate(school.get("extra_contacts") or []):
        role = ec.get("role") if isinstance(ec, dict) else None
        if role and _match(raw_token, [([role], f"extra_{i}")]):
            return f"extra_{i}"
    return None
