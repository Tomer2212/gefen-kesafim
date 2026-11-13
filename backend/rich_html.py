"""Allowlist sanitizer for rich-text HTML written in the app's TipTap editor (RichNoteEditor):
meeting notes and task message bodies. Shared so both are cleaned by exactly the same rules."""
import nh3
from fastapi import HTTPException

RICH_HTML_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "span", "mark", "a", "h1", "h2", "h3",
    "ul", "ol", "li", "blockquote", "hr", "table", "colgroup", "col", "tbody", "thead", "tr", "th", "td",
    "label", "input", "div",
}
RICH_HTML_ATTRS = {
    "*": {"dir", "style", "class", "data-type"},
    "a": {"href", "target"},
    "mark": {"data-color"},
    "li": {"data-checked"},
    "input": {"type", "checked"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    "ol": {"start"},
    "span": {"data-id", "data-label", "data-mention-suggestion-char"},
}
RICH_HTML_STYLES = {"color", "background-color", "font-size", "text-align", "min-width", "width"}
RICH_HTML_MAX_LEN = 200_000


def sanitize_rich_html(html: str | None, too_long_detail: str = "התוכן ארוך מדי") -> str | None:
    if not html or not html.strip():
        return None
    if len(html) > RICH_HTML_MAX_LEN:
        raise HTTPException(status_code=400, detail=too_long_detail)
    cleaned = nh3.clean(
        html,
        tags=RICH_HTML_TAGS,
        clean_content_tags={"script", "style"},
        attributes=RICH_HTML_ATTRS,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
        filter_style_properties=RICH_HTML_STYLES,
    )
    return cleaned or None
