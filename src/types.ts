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
export type TablePresetId =
  | "round-36"
  | "round-48"
  | "round-60"
  | "round-72"
  | "rect-6"
  | "rect-8"
  | "king-6"
  | "king-8";

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

export interface TablePreset {
  presetId: TablePresetId;
  label: string;
  shape: TableShape;
  seatConfig: TableSeatConfig;
  comfortableSeating: number;
  maximumSeating: number;
  typicalUseCase: string;
}

export const DEFAULT_TABLE_PRESET_ID: TablePresetId = "round-60";

export const TABLE_PRESETS: TablePreset[] = [
  {
    presetId: "round-36",
    label: "36\" Round (3')",
    shape: "round",
    seatConfig: { shape: "round", seatCount: 4 },
    comfortableSeating: 2,
    maximumSeating: 4,
    typicalUseCase: "Cocktail hour, cake table, or guest book",
  },
  {
    presetId: "round-48",
    label: "48\" Round (4')",
    shape: "round",
    seatConfig: { shape: "round", seatCount: 6 },
    comfortableSeating: 4,
    maximumSeating: 6,
    typicalUseCase: "Sweetheart table or small family clusters",
  },
  {
    presetId: "round-60",
    label: "60\" Round (5')",
    shape: "round",
    seatConfig: { shape: "round", seatCount: 10 },
    comfortableSeating: 8,
    maximumSeating: 10,
    typicalUseCase: "Industry standard for guest dining",
  },
  {
    presetId: "round-72",
    label: "72\" Round (6')",
    shape: "round",
    seatConfig: { shape: "round", seatCount: 12 },
    comfortableSeating: 10,
    maximumSeating: 12,
    typicalUseCase: "High-capacity guest dining for large halls",
  },
  {
    presetId: "rect-6",
    label: "6' Rectangle (30\" wide)",
    shape: "rectangular",
    seatConfig: {
      shape: "rectangular",
      sideCounts: { top: 3, right: 1, bottom: 3, left: 1 },
    },
    comfortableSeating: 6,
    maximumSeating: 8,
    typicalUseCase: "Buffet lines, gift tables, or narrow seating",
  },
  {
    presetId: "rect-8",
    label: "8' Rectangle (30\" wide)",
    shape: "rectangular",
    seatConfig: {
      shape: "rectangular",
      sideCounts: { top: 4, right: 1, bottom: 4, left: 1 },
    },
    comfortableSeating: 8,
    maximumSeating: 10,
    typicalUseCase: 'Family-style dining or long "king" rows',
  },
  {
    presetId: "king-6",
    label: "6' King (42–48\" wide)",
    shape: "rectangular",
    seatConfig: {
      shape: "rectangular",
      sideCounts: { top: 4, right: 2, bottom: 4, left: 2 },
    },
    comfortableSeating: 8,
    maximumSeating: 12,
    typicalUseCase: "Spacious dining with heavy decor",
  },
  {
    presetId: "king-8",
    label: "8' King (42–48\" wide)",
    shape: "rectangular",
    seatConfig: {
      shape: "rectangular",
      sideCounts: { top: 6, right: 2, bottom: 6, left: 2 },
    },
    comfortableSeating: 10,
    maximumSeating: 16,
    typicalUseCase: 'Head tables or "feasting" style layouts',
  },
];

export interface NewTableDefaults {
  labelPrefix: string;
  presetId: TablePresetId;
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
  presetId: TablePresetId;
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

function cloneSeatConfig(seatConfig: TableSeatConfig): TableSeatConfig {
  if (seatConfig.shape === "round") {
    return { shape: "round", seatCount: seatConfig.seatCount };
  }

  return {
    shape: "rectangular",
    sideCounts: { ...seatConfig.sideCounts },
  };
}

export function getDefaultTablePresetId(shape: TableShape = "round"): TablePresetId {
  if (shape === "rectangular") {
    return "rect-6";
  }

  return DEFAULT_TABLE_PRESET_ID;
}

export function isTablePresetId(value: unknown): value is TablePresetId {
  return typeof value === "string" && TABLE_PRESETS.some((preset) => preset.presetId === value);
}

export function getTablePresetById(presetId: TablePresetId): TablePreset {
  const preset = TABLE_PRESETS.find((candidate) => candidate.presetId === presetId);
  if (!preset) {
    throw new Error(`Unknown table preset: ${presetId}`);
  }

  return preset;
}

export function getDerivedTableConfigFromPresetId(
  presetId: TablePresetId
): Pick<TablePreset, "presetId" | "shape"> & { seatConfig: TableSeatConfig } {
  const preset = getTablePresetById(presetId);

  return {
    presetId: preset.presetId,
    shape: preset.shape,
    seatConfig: cloneSeatConfig(preset.seatConfig),
  };
}

export function findTablePresetBySeatConfig(
  shape: TableShape,
  seatConfig: TableSeatConfig
): TablePreset | null {
  return (
    TABLE_PRESETS.find((preset) => {
      if (preset.shape !== shape || preset.seatConfig.shape !== seatConfig.shape) {
        return false;
      }

      if (seatConfig.shape === "round") {
        return (
          preset.seatConfig.shape === "round" &&
          preset.seatConfig.seatCount === seatConfig.seatCount
        );
      }

      return (
        preset.seatConfig.shape === "rectangular" &&
        preset.seatConfig.sideCounts.top === seatConfig.sideCounts.top &&
        preset.seatConfig.sideCounts.right === seatConfig.sideCounts.right &&
        preset.seatConfig.sideCounts.bottom === seatConfig.sideCounts.bottom &&
        preset.seatConfig.sideCounts.left === seatConfig.sideCounts.left
      );
    }) ?? null
  );
}

export function inferTablePresetId(
  shape: TableShape,
  seatConfig: TableSeatConfig
): TablePresetId | null {
  return findTablePresetBySeatConfig(shape, seatConfig)?.presetId ?? null;
}

export function resolvePersistedTablePresetId(
  presetId: unknown,
  shape: TableShape,
  seatConfig: TableSeatConfig
): TablePresetId | null {
  if (isTablePresetId(presetId)) {
    return presetId;
  }

  return inferTablePresetId(shape, seatConfig);
}

export function createDefaultNewTableDefaults(): NewTableDefaults {
  const presetId = getDefaultTablePresetId();
  const preset = getTablePresetById(presetId);

  return {
    labelPrefix: DEFAULT_TABLE_LABEL_PREFIX,
    presetId,
    shape: preset.shape,
    roundSeatCount:
      preset.seatConfig.shape === "round" ? preset.seatConfig.seatCount : DEFAULT_TABLE_CAPACITY,
    rectangularSideCounts:
      preset.seatConfig.shape === "rectangular"
        ? { ...preset.seatConfig.sideCounts }
        : { ...DEFAULT_RECTANGULAR_SIDE_COUNTS },
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
  const preset = getTablePresetById(getDefaultTablePresetId(shape));

  return cloneSeatConfig(preset.seatConfig);
}
