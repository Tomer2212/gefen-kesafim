# Dev Log

## 2026-06-10 — Fix: ייצוב תשתית — מניעת 503 מ-Stale Connections ו-Worker Exhaustion

- **`backend/supabase_client.py`**: הוספת `reset_admin_client()` — מוחק את ה-singleton ומכריח יצירת `httpx.Client` חדש בבקשה הבאה. `postgrest_client_timeout` ירד מ-30 → 10 שניות (fail fast: worker מתפנה 3× מהר יותר).
- **`backend/auth.py`**: `_get_profile` קורא ל-`reset_admin_client()` על כל כשל DB — מונע ניסיון חוזר על connection פגום.
- **`backend/routers/schools_router.py`**: כל לולאות ה-retry (`list_schools`, `list_accounts`, `list_logs`) קוראות ל-`reset_admin_client()` לפני הניסיון השני. `list_schools` הפך לסדרתי (הוסר `ThreadPoolExecutor`) — פחות חיבורי Supabase מקביליים, פחות לחץ על PostgREST.
- **`render.yaml`**: workers עלו מ-4 → **8** (2GB RAM על $25 plan, 8 × ~150MB = 1.2GB — בטוח). gunicorn `--timeout` ירד מ-120 → **45 שניות** — worker תקוע מעל 45s נהרג ומוחלף.
