import json
import os
import smtplib
import threading
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

router = APIRouter()

GMAIL_USER     = os.getenv("GMAIL_USER", "")
GMAIL_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
SUPPORT_EMAIL  = os.getenv("SUPPORT_EMAIL", "")

TICKETS_FILE  = Path(__file__).parent.parent / "tickets.json"
CONSENTS_FILE = Path(__file__).parent.parent / "consents.json"
_lock = threading.Lock()

CONSENT_TEXT = "אני מאשר/ת קבלת עדכונים במייל ו/או בטלפון בנוגע לפנייה זו."


def next_ticket_number() -> int:
    with _lock:
        data = json.loads(TICKETS_FILE.read_text(encoding="utf-8"))
        data["last"] += 1
        TICKETS_FILE.write_text(json.dumps(data), encoding="utf-8")
        return data["last"]


def log_consent(ticket_id: str, user_email: str, user_phone: str, ip: str):
    with _lock:
        records = json.loads(CONSENTS_FILE.read_text(encoding="utf-8"))
        records.append({
            "ticket":       ticket_id,
            "timestamp":    datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "email":        user_email,
            "phone":        user_phone or "לא צוין",
            "consent_text": CONSENT_TEXT,
            "ip":           ip,
        })
        CONSENTS_FILE.write_text(
            json.dumps(records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def build_email_html(
    ticket_id: str,
    subject: str,
    description: str,
    user_email: str,
    phone_display: str,
    for_user: bool,
) -> str:
    desc_html = description.replace("\n", "<br>")
    header_sub = "אישור קבלת פנייה" if for_user else "פנייה חדשה"

    reply_subject  = quote(f"טיפול בפנייה {ticket_id}")
    reply_btn = (
        f"""<div style="margin-top: 20px;">
          <a href="mailto:{user_email}?subject={reply_subject}"
             style="display: inline-block; background: #0070F3; color: white;
                    font-size: 13px; font-weight: 700; padding: 10px 20px;
                    border-radius: 8px; text-decoration: none;">
            השב לפנייה
          </a>
        </div>"""
        if not for_user else ""
    )

    footer_extra = (
        """<p style="margin: 16px 0 0 0; font-size: 13px; color: #475569; font-weight: 600;">
             אנחנו בדרך כלל חוזרים תוך <strong>72 שעות</strong>.
           </p>"""
        if for_user else ""
    )

    return f"""
<html>
<body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b;
                       background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white;
              border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">

    <!-- Header -->
    <div style="background: #0070F3; padding: 20px 24px;">
      <p style="margin: 0; color: white; font-size: 13px; font-weight: 600;">
        גפן AI &middot; {header_sub}
      </p>
      <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.75); font-size: 12px;">
        מספר פנייה {ticket_id}
      </p>
    </div>

    <div style="padding: 24px;">

      <!-- Subject -->
      <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700;
                color: #94a3b8; letter-spacing: 0.05em;">נושא</p>
      <p style="margin: 0 0 20px 0; font-size: 16px; font-weight: 700; color: #0f172a;">
        {subject}
      </p>

      <!-- Description -->
      <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #64748b;">
        תיאור הפנייה
      </p>
      <div style="background: #f8fafc; border-right: 3px solid #0070F3;
                  padding: 12px 14px; border-radius: 0 8px 8px 0;
                  font-size: 14px; color: #334155; line-height: 1.6;
                  margin-bottom: 24px;">
        {desc_html}
      </div>

      <!-- Divider -->
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px 0;">

      <!-- Contact details -->
      <p style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #64748b;">
        פרטי קשר
      </p>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 6px 0; font-weight: 700; color: #475569;
                     font-size: 13px; width: 80px;">מייל</td>
          <td style="padding: 6px 0; color: #0070F3; font-size: 13px;">
            <a href="mailto:{user_email}" style="color: #0070F3; text-decoration: none;">
              {user_email}
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: 700; color: #475569; font-size: 13px;">
            טלפון
          </td>
          <td style="padding: 6px 0; color: #334155; font-size: 13px;">{phone_display}</td>
        </tr>
      </table>

      {footer_extra}
      {reply_btn}

    </div>

    <!-- Footer -->
    <div style="background: #f1f5f9; padding: 12px 24px; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">
        נשלח מגפן AI
      </p>
    </div>

  </div>
</body>
</html>
"""


SENDER_NAME = "gefenai"

def send_email(to: str, subject: str, html: str, attachments: list[tuple[str, bytes]]):
    msg = MIMEMultipart()
    msg["From"]    = f"{SENDER_NAME} <{GMAIL_USER}>"
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))

    for i, (filename, content) in enumerate(attachments):
        safe_name = filename or f"attachment_{i+1}"
        part = MIMEBase("application", "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        try:
            safe_name.encode("ascii")
            part.add_header("Content-Disposition", f'attachment; filename="{safe_name}"')
        except UnicodeEncodeError:
            part.add_header(
                "Content-Disposition",
                f"attachment; filename*=UTF-8''{quote(safe_name)}",
            )
        msg.attach(part)

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASSWORD)
        server.send_message(msg)


@router.post("/send")
async def send_contact(
    request:     Request,
    subject:     str = Form(...),
    description: str = Form(...),
    user_email:  str = Form(...),
    user_phone:  str = Form(""),
    consent:     bool = Form(...),
    files: List[UploadFile] = File(default=[]),
):
    if not consent:
        raise HTTPException(status_code=400, detail="Consent required")
    if not GMAIL_USER or not GMAIL_PASSWORD:
        raise HTTPException(status_code=500, detail="Email service not configured")

    ticket_num    = next_ticket_number()
    ticket_id     = f"#{ticket_num:04d}"
    phone_display = user_phone.strip() if user_phone.strip() else "לא צוין"
    client_ip     = request.client.host if request.client else "unknown"

    log_consent(ticket_id, user_email, user_phone.strip(), client_ip)

    attachments: list[tuple[str, bytes]] = []
    for upload in files:
        content = await upload.read()
        if content:
            attachments.append((upload.filename, content))

    html_support = build_email_html(ticket_id, subject, description, user_email, phone_display, for_user=False)
    html_user    = build_email_html(ticket_id, subject, description, user_email, phone_display, for_user=True)

    try:
        send_email(SUPPORT_EMAIL, f"gefenai-support: {ticket_id}", html_support, attachments)
        send_email(user_email,    "קיבלנו את הפנייה שלך!",         html_user,    [])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {exc}")

    return {"ok": True, "ticket": ticket_id}
