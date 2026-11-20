import { useEffect, useRef } from "react";
import axios from "axios";

// The meetings screens read contacts / stage / advisors from their loaded `schools` list,
// which holds clients only. A meeting with a national-directory school (status "directory",
// never listed) or a district/ownership card (status "entity") would show no contacts — so fetch just the schools of the meetings on screen
// that are missing from the list (GET /schools/?ids=…) and append them. Each id is asked once.
export function useMeetingDirectorySchools(meetings, schools, setSchools, schoolsLoaded) {
  const requestedRef = useRef(new Set());

  useEffect(() => {
    if (!schoolsLoaded) return;
    const known = new Set(schools.map(s => s.id));
    const missing = [...new Set(meetings.map(m => m.school_id).filter(Boolean))]
      .filter(id => !known.has(id) && !requestedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach(id => requestedRef.current.add(id));
    // 100 ids per request keeps the URL short.
    for (let i = 0; i < missing.length; i += 100) {
      axios.get("/schools/", { params: { ids: missing.slice(i, i + 100).join(",") } })
        .then(res => {
          const extra = (res.data || []).filter(s => s.status === "directory" || s.status === "entity");
          if (extra.length === 0) return;
          setSchools(prev => {
            const have = new Set(prev.map(s => s.id));
            return [...prev, ...extra.filter(s => !have.has(s.id))];
          });
        })
        .catch(() => {});
    }
  }, [meetings, schools, setSchools, schoolsLoaded]);
}
