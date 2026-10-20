// Client-side mirror of schools_router.py's _gefen_files_slots_for_school /
// _GEFEN_FILES_SLOT_LABELS / _resolve_gefen_files_responsible_for_slot. Keep these in
// lockstep with the backend. Deliberately NOT built on slotsForSchool/SLOT_LABELS from
// meetingCoordinatorSlots.js — this field's split is driven ONLY by stage === "sheshshnati",
// independent of service_type (district DOES split here, unlike meeting coordinators).
import { resolveCoordinatorRef } from "./meetingCoordinatorSlots";

export const GEFEN_FILES_SLOT_LABELS = { default: "אחראי/ת קבצי גפן", tichon: "תיכון", beinayim: 'חט"ב' };

export function gefenFilesSlotsForSchool(school) {
  return school?.stage === "sheshshnati" ? ["tichon", "beinayim"] : ["default"];
}

export function resolveGefenFilesResponsibleForSlot(school, slot) {
  const ref = school?.gefen_files_responsible?.[slot];
  const contact = resolveCoordinatorRef(school, ref);
  return contact && contact.email ? contact : null;
}
