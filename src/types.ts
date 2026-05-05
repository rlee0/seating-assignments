// ─── Domain types ────────────────────────────────────────────────────────────

export type Host = string;

export interface GuestInputRow {
  id: string;
  host: Host;
  party: string;
  circle: string;
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
  circle: string;
}

export interface Party {
  id: string; // "p{partyIndex}", stable within a parsed dataset
  party: string;
  circle: string; // primary circle (from first member that has one)
  host: Host;
  guestIds: string[]; // ordered list of Guest ids
}

// ─── Seating state ────────────────────────────────────────────────────────────

export const DEFAULT_BOARD_ROWS = 5;
export const DEFAULT_BOARD_COLUMNS = 5;
export const DEFAULT_TABLE_COUNT = DEFAULT_BOARD_ROWS * DEFAULT_BOARD_COLUMNS;
export const DEFAULT_TABLE_CAPACITY = 8;
export const MIN_ROUND_TABLE_CAPACITY = 2;
export const MAX_ROUND_TABLE_CAPACITY = 16;
export const DEFAULT_TABLE_LABEL_PREFIX = "Table";
export const TABLE_COUNT = DEFAULT_TABLE_COUNT;
export const TABLE_CAPACITY = DEFAULT_TABLE_CAPACITY;
export const TABLES_PER_ROW = DEFAULT_BOARD_COLUMNS;
export const STORAGE_KEY = "wedding-seating-v2";
export const GUEST_DATA_STORAGE_KEY = "wedding-guests-v1";
export const GUEST_DATA_SOURCE_KEY = "wedding-guests-source-v1";
export const EXPORT_FORMAT_VERSION = 3;

export type TableShape = "round" | "rectangular";

export interface GridPosition {
  row: number;
  column: number;
}

export interface RectangularSeatCounts {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RoundTableConfig {
  shape: "round";
  seatCount: number;
}

export interface RectangularTableConfig {
  shape: "rectangular";
  sideCounts: RectangularSeatCounts;
}

export type TableSeatConfig = RoundTableConfig | RectangularTableConfig;

export interface NewTableDefaults {
  labelPrefix: string;
  shape: TableShape;
  roundSeatCount: number;
  rectangularSideCounts: RectangularSeatCounts;
}

export interface BoardState {
  rows: number;
  columns: number;
  newTableDefaults: NewTableDefaults;
}

export const DEFAULT_RECTANGULAR_SIDE_COUNTS: RectangularSeatCounts = {
  top: 3,
  right: 1,
  bottom: 3,
  left: 1,
};

export interface TableState {
  id: string;
  tableNumber: number; // 1-based
  name: string; // display label, default "Table N"
  shape: TableShape;
  gridPosition: GridPosition;
  seatConfig: TableSeatConfig;
  guestIds: Array<string | null>; // seat slots in visual order
  disabledSeats?: number[]; // seat indexes that are disabled (no guest can sit here)
}

export interface SeatingState {
  board: BoardState;
  tables: TableState[];
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
  board: BoardState;
  tables: TableState[];
}

export function getTableSeatCount(seatConfig: TableSeatConfig): number {
  if (seatConfig.shape === "round") {
    return seatConfig.seatCount;
  }

  return (
    seatConfig.sideCounts.top +
    seatConfig.sideCounts.right +
    seatConfig.sideCounts.bottom +
    seatConfig.sideCounts.left
  );
}

export function createDefaultNewTableDefaults(): NewTableDefaults {
  return {
    labelPrefix: DEFAULT_TABLE_LABEL_PREFIX,
    shape: "round",
    roundSeatCount: DEFAULT_TABLE_CAPACITY,
    rectangularSideCounts: { ...DEFAULT_RECTANGULAR_SIDE_COUNTS },
  };
}

export function createDefaultBoardState(): BoardState {
  return {
    rows: DEFAULT_BOARD_ROWS,
    columns: DEFAULT_BOARD_COLUMNS,
    newTableDefaults: createDefaultNewTableDefaults(),
  };
}

export function createDefaultTableSeatConfig(shape: TableShape = "round"): TableSeatConfig {
  if (shape === "rectangular") {
    return {
      shape,
      sideCounts: { ...DEFAULT_RECTANGULAR_SIDE_COUNTS },
    };
  }

  return {
    shape,
    seatCount: DEFAULT_TABLE_CAPACITY,
  };
}
