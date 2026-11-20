// "סוג לקוח" — district / ownership client cards. Mirrors backend/client_entities.py: keep in sync.
// A district/ownership is a `schools` row with client_type 'district' | 'ownership' and status 'entity'.

// Same list (and order) as the school card's "מחוז" field — the only source for both.
export const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

export const CLIENT_TYPE_TABS = [
  { value: "school", label: "בתי ספר" },
  { value: "district", label: "מחוזות" },
  { value: "ownership", label: "בעלויות" },
];

export const ENTITY_TYPE_LABELS = {
  district: { singular: "מחוז", plural: "מחוזות", allLabel: "כל המחוזות" },
  ownership: { singular: "בעלות", plural: "בעלויות", allLabel: "כל הבעלויות" },
};

// "סוג" options of a district/ownership meeting (meetings.meeting_service_type).
export const ENTITY_MEETING_SERVICE_TYPES = ["gefen", "current"];

export function isEntityClientType(clientType) {
  return clientType === "district" || clientType === "ownership";
}

// The card's name is stored ready to show ("מחוז דרום" / the ownership's name).
export function clientLabel(row) {
  return row?.name || "";
}
