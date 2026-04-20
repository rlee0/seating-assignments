// ─── Domain types ────────────────────────────────────────────────────────────

export type RSVPStatus = "r" | "s";

export interface Guest {
  id: string; // slugified full name, unique
  fullName: string;
  partyId: string; // matches Party.id
  rsvp: RSVPStatus;
  group: string;
}

export interface Party {
  id: string; // slugified Table Display Name, unique
  displayName: string;
  group: string; // primary group (from first member that has one)
  rsvp: RSVPStatus; // 'r' if all members are 'r', else 's'
  guestIds: string[]; // ordered list of Guest ids
}

// ─── Seating state ────────────────────────────────────────────────────────────

export const TABLE_COUNT = 25;
export const TABLE_CAPACITY = 8;
export const STORAGE_KEY = "wedding-seating-v1";

export interface TableState {
  tableNumber: number; // 1-based
  name: string; // user-editable label, default "Table N"
  guestIds: Array<string | null>; // fixed seat slots in visual order
}

export interface SeatingState {
  tables: TableState[]; // length === TABLE_COUNT
  unassigned: string[]; // guest ids not yet seated
}
