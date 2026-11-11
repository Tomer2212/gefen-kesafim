"""A small in-memory stand-in for the Supabase client, enough for the booking path: select/insert/
update/delete with eq/lt/gte/lte/in_ filters. Every execute() is atomic (one global lock), like a
single SQL statement, and a table's primary key is unique — so it can host real thread races."""
import threading
import time
import uuid
from datetime import datetime, timezone

PRIMARY_KEYS = {"booking_slot_locks": "lock_key"}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self.row_limit = None

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, on_conflict=""):
        self.op, self.payload, self.conflict = "upsert", row, [c for c in on_conflict.split(",") if c]
        return self

    def update(self, values):
        self.op, self.payload = "update", values
        return self

    def delete(self):
        self.op = "delete"
        return self

    def limit(self, n):
        self.row_limit = n
        return self

    def _filter(self, fn):
        self.filters.append(fn)
        return self

    def eq(self, col, val):
        return self._filter(lambda r: r.get(col) == val)

    def gt(self, col, val):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) > str(val))

    def lt(self, col, val):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) < str(val))

    def gte(self, col, val):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))

    def lte(self, col, val):
        return self._filter(lambda r: r.get(col) is not None and str(r.get(col)) <= str(val))

    def in_(self, col, vals):
        return self._filter(lambda r: r.get(col) in vals)

    def _match(self, row):
        return all(f(row) for f in self.filters)

    def execute(self):
        with self.db.lock:
            rows = self.db.tables.setdefault(self.table, [])
            if self.db.latency:
                time.sleep(self.db.latency)
            if self.op == "upsert":
                existing = next((r for r in rows if all(r.get(c) == self.payload.get(c) for c in self.conflict)), None) if self.conflict else None
                if existing:
                    existing.update(self.payload)
                    return _Result([dict(existing)])
                self.op = "insert"
            if self.op == "insert":
                row = dict(self.payload)
                pk = PRIMARY_KEYS.get(self.table, "id")
                if pk == "id":
                    row.setdefault("id", str(uuid.uuid4()))
                if any(r.get(pk) == row.get(pk) for r in rows):
                    raise Exception(f"duplicate key value violates unique constraint ({self.table}.{pk})")
                row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
                if self.table == "booking_slot_locks":
                    row.setdefault("locked_at", row["created_at"])
                rows.append(row)
                time.sleep(0.000002)  # distinct created_at values, like now() per statement
                return _Result([dict(row)])
            matched = [r for r in rows if self._match(r)]
            if self.op == "update":
                for r in matched:
                    r.update(self.payload)
                return _Result([dict(r) for r in matched][:self.row_limit])
            if self.op == "delete":
                self.db.tables[self.table] = [r for r in rows if not self._match(r)]
                return _Result([dict(r) for r in matched][:self.row_limit])
            return _Result([dict(r) for r in matched][:self.row_limit])


class FakeDb:
    def __init__(self, tables=None, latency=0.0):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.lock = threading.Lock()
        self.latency = latency
        self.rpc_results = {}

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        result = self.rpc_results.get(name, [])
        rows = result(params) if callable(result) else result
        return type("_Rpc", (), {"execute": lambda _self: _Result(rows)})()
