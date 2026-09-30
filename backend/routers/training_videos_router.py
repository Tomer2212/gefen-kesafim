import logging
import os
import time
from typing import Annotated

import boto3
from botocore.client import Config
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

router = APIRouter()
logger = logging.getLogger(__name__)

_PRESIGNED_URL_TTL_SECONDS = 900  # 15 minutes


def _env(name: str) -> str | None:
    # Defends against trailing newlines/whitespace from pasting values into a host's env var UI.
    val = os.getenv(name)
    return val.strip() if val else val


def _r2_client():
    account_id = _env("R2_ACCOUNT_ID")
    access_key = _env("R2_ACCESS_KEY_ID")
    secret_key = _env("R2_SECRET_ACCESS_KEY")
    if not (account_id and access_key and secret_key):
        raise HTTPException(status_code=503, detail="אחסון סרטוני ההדרכה טרם הוגדר (חסרים פרטי R2)")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


@router.get("/")
def list_training_videos(user: Annotated[dict, Depends(get_current_user)]):
    org_id = user.get("org_id")
    for attempt in range(2):
        try:
            db = get_admin_client()
            query = db.table("training_videos").select("*")
            # org_id IS NULL → visible to every organization; otherwise restricted to that org only.
            if org_id:
                query = query.or_(f"org_id.is.null,org_id.eq.{org_id}")
            else:
                query = query.is_("org_id", "null")
            rows = query.order("topic_order").execute().data or []
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_training_videos attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_training_videos failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    bucket = _env("R2_BUCKET_NAME")
    if not bucket:
        # DB rows exist but R2 isn't configured yet — return metadata without a playable URL.
        return [{**row, "video_url": None} for row in rows]

    client = _r2_client()
    result = []
    for row in rows:
        try:
            url = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": row["r2_object_key"]},
                ExpiresIn=_PRESIGNED_URL_TTL_SECONDS,
            )
        except Exception as exc:
            logger.warning("presign failed for %s: %s", row.get("r2_object_key"), exc)
            url = None
        result.append({**row, "video_url": url})
    return result
