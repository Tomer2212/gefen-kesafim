import axios from "axios";

// The org's private copy of a national-directory school ("מאגר בתי ספר"): returns the
// existing copy, or creates one (status "directory" — hidden from every list). Throws an
// Error with a Hebrew message on failure.
export async function adoptDirectorySchool(directoryId) {
  try {
    const res = await axios.post(`/directory/schools/${directoryId}/adopt`);
    return res.data.school_id;
  } catch (err) {
    const detail = err?.response?.data?.detail;
    const message = typeof detail === "string" ? detail : detail?.message;
    throw new Error(message || "לא ניתן לפתוח את בית הספר מהמאגר. נסו שוב.");
  }
}

export const DIRECTORY_TAG_LABELS = {
  client: "לקוח",
  met: "היו פגישות",
  recycle: "בסל המחזור",
};

export const DIRECTORY_TAG_CLASSES = {
  client: "bg-emerald-50 text-emerald-700 border-emerald-200",
  met: "bg-blue-50 text-blue-700 border-blue-200",
  recycle: "bg-slate-100 text-slate-600 border-slate-200",
};
