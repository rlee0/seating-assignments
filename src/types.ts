// ─── Domain types ────────────────────────────────────────────────────────────

export type Host = string;

export interface GuestInputRow {
  id: string;
  host: Host;
  household: string;
  group: string;
  fullName: string;
}

export interface PersistedGuestData {
  rows: GuestInputRow[];
}

export interface Guest {
  id: string;
  fullName: string;
  partyId: string; // matches Party.id
  host: Host;
  group: string;
}

export interface Party {
  id: string; // "p{householdIndex}", stable within a parsed dataset
  household: string;
  group: string; // primary group (from first member that has one)
  host: Host;
  guestIds: string[]; // ordered list of Guest ids
}

// ─── Seating state ────────────────────────────────────────────────────────────

export const TABLE_COUNT = 25;
export const TABLE_CAPACITY = 8;
// Configurable later via UI; treated as a constant for now.
export const TABLES_PER_ROW = 5;
export const STORAGE_KEY = "wedding-seating-v1";
export const GUEST_DATA_STORAGE_KEY = "wedding-guests-v1";
export const GUEST_DATA_SOURCE_KEY = "wedding-guests-source-v1";
export const EXPORT_FORMAT_VERSION = 2;

export interface TableState {
  tableNumber: number; // 1-based
  name: string; // display label, default "Table N"
  guestIds: Array<string | null>; // fixed seat slots in visual order
  disabledSeats?: number[]; // seat indexes that are disabled (no guest can sit here)
}

export interface SeatingState {
  tables: TableState[]; // length === TABLE_COUNT
  unassigned: string[]; // guest ids not yet seated
  lockedGuestIds: string[]; // anchored guest ids; auto-seat never moves them
}

export interface PersistedSeatingData {
  state: SeatingState;
  history: SeatingState[];
  future: SeatingState[];
}

export interface SeatingExportData {
  version: number;
  exportedAt: string;
  guests: GuestInputRow[];
  tables: TableState[];
}
