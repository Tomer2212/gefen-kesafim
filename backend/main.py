import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from routers.advisor_finder_router import router as advisor_finder_router
from routers.agent_router import router as agent_router
from routers.analyze_router import router as analyze_router
from routers.calendar_router import router as calendar_router
from routers.chatbot_router import router as chatbot_router
from routers.contact_router import router as contact_router
from routers.meeting_booking_router import router as meeting_booking_router
from routers.meeting_summary_router import router as meeting_summary_router
from routers.meeting_upload_router import router as meeting_upload_router
from routers.performance_router import router as performance_router
from routers.person_tasks_router import router as person_tasks_router
from routers.schools_router import router as schools_router
from routers.signup_router import router as signup_router
from routers.tasks_router import router as tasks_router
from routers.voicenter_router import router as voicenter_router

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

_log = logging.getLogger(__name__)
app = FastAPI(title="Gefen Reconciliation API")


async def _cleanup_old_storage_files() -> None:
    """Delete Supabase Storage files for check_logs older than 24 months."""
    try:
        from supabase_client import get_admin_client
        db = get_admin_client()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=730)).isoformat()
        old_logs = (
            db.table("check_logs")
            .select("id, summary")
            .lt("run_at", cutoff)
            .execute()
            .data or []
        )
        deleted_count = 0
        for log in old_logs:
            paths = (log.get("summary") or {}).get("stored_file_paths") or []
            if not paths:
                continue
            try:
                keys = [sp["path"] if isinstance(sp, dict) else sp for sp in paths]
                db.storage.from_("check-files").remove(keys)
                summary = dict(log.get("summary") or {})
                summary.pop("stored_file_paths", None)
                db.table("check_logs").update({"summary": summary}).eq("id", log["id"]).execute()
                deleted_count += 1
            except Exception:
                pass
        if deleted_count:
            _log.info("Storage cleanup: removed files for %d old check logs", deleted_count)
    except Exception as exc:
        _log.warning("Storage cleanup failed: %s", exc)


async def _cleanup_old_run_states() -> None:
    """Delete run_states rows (and their Excel files in Storage) older than 120 days."""
    try:
        from supabase_client import get_admin_client
        db = get_admin_client()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
        old_runs = (
            db.table("run_states")
            .select("id")
            .lt("created_at", cutoff)
            .execute()
            .data or []
        )
        if not old_runs:
            return
        excel_keys = [f"excel/{r['id']}/hashvaa-gefen-ksafim.xlsx" for r in old_runs]
        try:
            db.storage.from_("check-files").remove(excel_keys)
        except Exception:
            pass
        ids = [r["id"] for r in old_runs]
        for i in range(0, len(ids), 100):
            db.table("run_states").delete().in_("id", ids[i:i+100]).execute()
        _log.info("run_states cleanup: removed %d old entries", len(old_runs))
    except Exception as exc:
        _log.warning("run_states cleanup failed: %s", exc)


@app.on_event("startup")
def _warmup():
    """Pre-fetch JWKS key on startup so the first user request doesn't fail."""
    try:
        from auth import _get_public_key
        _get_public_key()
    except Exception as exc:
        _log.warning("JWKS warmup failed: %s — will retry on first request", exc)
    asyncio.create_task(_cleanup_old_storage_files())
    asyncio.create_task(_cleanup_old_run_states())

_allowed = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
_origins = [o.strip() for o in _allowed.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    _log.error(
        "Unhandled exception on %s %s: %s",
        request.method, request.url.path, exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות"},
    )


app.include_router(agent_router, prefix="/agent")
app.include_router(analyze_router, prefix="/analyze")
app.include_router(calendar_router, prefix="/calendar")
app.include_router(chatbot_router, prefix="/chatbot")
app.include_router(contact_router, prefix="/contact")
app.include_router(meeting_booking_router)
app.include_router(meeting_summary_router)
app.include_router(meeting_upload_router)
app.include_router(performance_router, prefix="/performance")
app.include_router(person_tasks_router, prefix="/person-tasks")
app.include_router(schools_router, prefix="/schools")
app.include_router(advisor_finder_router, prefix="/schools")
app.include_router(signup_router, prefix="/signup")
app.include_router(tasks_router, prefix="/tasks")
app.include_router(voicenter_router, prefix="/voicenter")


@app.get("/health")
def health():
    return {"status": "ok"}
