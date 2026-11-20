import { useEffect, useMemo, useState } from "react";
import axios from "axios";

// The @-mention list for a note of one school: every org user (/users/mentionable), each marked
// `no_access` when they can't open this school (not in /{school_id}/users-with-access — the same
// rule as the server's school access check). Tagging them still works and notifies them; the
// mark only warns the author that they won't be able to read the note. If the access list fails
// to load, nobody is marked — never a false warning.
export function useMentionUsers(schoolId) {
  const [users, setUsers] = useState([]);
  const [accessIds, setAccessIds] = useState(null); // null = unknown

  useEffect(() => {
    let cancelled = false;
    axios.get("/schools/users/mentionable").then(({ data }) => { if (!cancelled) setUsers(data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setAccessIds(null);
    axios.get(`/schools/${schoolId}/users-with-access`)
      .then(({ data }) => { if (!cancelled && Array.isArray(data)) setAccessIds(new Set(data.map(u => u.id))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [schoolId]);

  return useMemo(
    () => (accessIds ? users.map(u => (accessIds.has(u.id) ? u : { ...u, no_access: true })) : users),
    [users, accessIds],
  );
}
