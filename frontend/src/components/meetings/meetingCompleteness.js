export function getMissingCriticalFields(meeting, { requireSchool = false, requireAdvisor = false } = {}) {
  const missing = [];
  if (!meeting.meeting_date) missing.push("תאריך");
  if (!meeting.start_time) missing.push("שעת התחלה");
  if (!meeting.end_time) missing.push("שעת סיום");
  if (requireSchool && !meeting.school_id) missing.push("שם מוסד");
  if (requireAdvisor && !(meeting.advisor_ids && meeting.advisor_ids.length > 0)) missing.push("יועץ מבצע");
  return missing;
}

export function isMeetingIncomplete(meeting, opts) {
  return getMissingCriticalFields(meeting, opts).length > 0;
}
