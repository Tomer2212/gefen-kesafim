"""Formatted task messages (message_config.body_html): sanitizing on save and the email HTML
built from them at send time. No DB access."""
import pytest
from fastapi import HTTPException

from routers.tasks_router import MessageConfigIn, TemplateIn, _rich_body_to_email_html, _wrap_email_html

SCHOOL = {"name": "אורט <בדיקה>"}


def render(body, **kw):
    return _rich_body_to_email_html(body, SCHOOL, **kw)


def test_body_html_is_sanitized_on_save():
    cfg = MessageConfigIn(recipient_role="principal", channel="email_resend", body_template="x",
                          body_html='<p onclick="x()">hi<script>alert(1)</script></p><a href="javascript:x">l</a>')
    assert "onclick" not in cfg.body_html and "script" not in cfg.body_html and "javascript" not in cfg.body_html
    assert TemplateIn(name="t", body_html="  ").body_html is None
    assert MessageConfigIn(recipient_role="principal", channel="email_resend").body_html is None


def test_body_html_too_long_is_rejected():
    with pytest.raises(HTTPException):
        MessageConfigIn(recipient_role="principal", channel="email_resend", body_html="<p>" + "a" * 200_001 + "</p>")


def test_formatting_survives_and_gets_inline_styles():
    out = render('<p style="text-align: center"><strong>b</strong><u>u</u>'
                 '<span style="color: #dc2626">c</span><mark data-color="#fef08a" style="background-color: #fef08a">m</mark></p>'
                 '<ul><li><p>a</p></li></ul><ol start="3"><li><p>n</p></li></ol><h1>כותרת</h1>'
                 '<blockquote><p>q</p></blockquote><hr><table><tbody><tr><td><p>t</p></td></tr></tbody></table>')
    for piece in ("<strong>b</strong>", "<u>u</u>", "color: #dc2626", "background-color: #fef08a",
                  'start="3"', "<h1 style=", "border-right: 3px solid", "<hr style=", "border: 1px solid #cbd5e1"):
        assert piece in out, piece
    # the user's own alignment comes after the base style, so it wins
    assert 'style="margin: 0; line-height: 1.7; text-align: center;"' in out


def test_placeholders_are_escaped_and_blocks_replace_their_paragraph():
    out = render("<p>שלום {recipient_name}, בית הספר {school_name} עם {advisor_names}</p>"
                 "<p>{meetings_list}</p><p>{booking_link}</p>",
                 recipient_name="דנה & <x>", advisor_names="גל", booking_url="https://x.co/b?a=1&b=2",
                 meetings_list_html="<div>MEETINGS</div>")
    assert "דנה &amp; &lt;x&gt;" in out and "אורט &lt;בדיקה&gt;" in out and "<x>" not in out
    assert "<div>MEETINGS</div>" in out and "<p" not in out.split("<div>MEETINGS</div>")[0][-40:]
    assert 'href="https://x.co/b?a=1&amp;b=2"' in out and "קביעת מועד" in out
    assert "{" not in out


def test_missing_values_drop_the_tokens():
    out = render("<p>{booking_link}</p><p>a {meetings_list} b</p>")
    assert "{" not in out and "קביעת מועד" not in out


def test_task_list_becomes_symbols_and_blank_lines_survive():
    out = render('<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label>'
                 '<div><p>done</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label>'
                 '<div><p>todo</p></div></li></ul><p></p><p>end</p>')
    assert "☑&nbsp;done" in out and "☐&nbsp;todo" in out
    assert "<input" not in out and "<label" not in out
    assert "line-through" in out.split("todo")[0]
    assert '<br /></p><p style="margin: 0; line-height: 1.7;">end' in out


def test_opt_out_line_is_appended():
    out = render("<p>x</p>", opt_out_link="https://app/opt?e=a&t=b")
    assert "להסרה מרשימת התפוצה" in out and 'href="https://app/opt?e=a&amp;t=b"' in out


def test_plain_path_is_unchanged():
    # No body_html → the original renderer, byte for byte.
    out = _wrap_email_html("שלום\n\nשורה", None, None, branded=False)
    assert '<p style="margin: 0 0 16px 0; color: #334155; line-height: 1.8;">שלום</p>' in out
