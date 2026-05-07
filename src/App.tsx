import {
  DndContext,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  Download,
  MoreHorizontal,
  Moon,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SeatingProvider, useSeating } from "./store/SeatingContext";
import { SearchProvider, useSearch } from "./store/SearchContext";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { X } from "lucide-react";

import Sidebar from "./components/Sidebar";
import TableBoard from "./components/TableBoard";
import GuestDialog, { type GuestFormValues } from "./components/GuestDialog";
import ConfirmDialog from "./components/ConfirmDialog";
import TableDialog, { type TableFormValues } from "./components/TableDialog";
import BoardSettingsDialog, {
  type BoardSettingsFormValues,
} from "./components/BoardSettingsDialog";
import {
  createGuestRowId,
  getGuestSourceSignature,
  normalizeGuestInputRows,
  parseGuestsFromRows,
} from "./data/parseGuests";
import {
  clearPersistedAppState,
  applyTheme,
  isCompatibleState,
  isGuestInputRowLike,
  loadPersistedGuestData,
  loadPersistedZoom,
  resolvePreferredTheme,
  reconcileStateToGuestIds,
  saveGuestDataSourceSignature,
  savePersistedGuestData,
  savePersistedSeating,
  saveTheme,
  saveZoom,
  type AppTheme,
} from "./store/localStorage";
import { cn } from "./lib/utils";
import {
  createDefaultBoardState,
  EXPORT_FORMAT_VERSION,
  getDerivedTableConfigFromPresetId,
  isTablePresetId,
  MAX_ROUND_TABLE_CAPACITY,
  MIN_ROUND_TABLE_CAPACITY,
  TABLE_CAPACITY,
  TABLE_COUNT,
  getTableSeatCount,
  resolvePersistedTablePresetId,
  type BoardState,
  type GuestInputRow,
  type PersistedSeatingData,
  type RectangularSeatCounts,
  type TableState,
} from "./types";
import { createInitialState, seatingReducer } from "./store/reducer";
import { dndCollisionDetection } from "./dnd/collision";
import { parseDragIntent, parseDropTargetId, resolveDropTarget } from "./dnd/parsers";
import { routeDrop } from "./dnd/router";
import type { DragIntent, DragKind } from "./dnd/types";

// ─── Utility functions ────────────────────────────────────────────────────────

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getInitialGuestData(): {
  guestRows: GuestInputRow[];
} {
  const sourceSignature = getGuestSourceSignature();
  const persisted = loadPersistedGuestData(sourceSignature);

  return {
    guestRows: persisted?.rows ?? [],
  };
}

function clampBoardZoom(value: number): number {
  const roundedToTenth = Math.round(value * 10) / 10;
  return Math.min(1.5, Math.max(0.5, roundedToTenth));
}

function isSeatValue(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseRectangularSeatCounts(value: unknown): RectangularSeatCounts | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    top?: unknown;
    right?: unknown;
    bottom?: unknown;
    left?: unknown;
  };

  if (
    !Number.isInteger(candidate.top) ||
    !Number.isInteger(candidate.right) ||
    !Number.isInteger(candidate.bottom) ||
    !Number.isInteger(candidate.left)
  ) {
    return null;
  }

  const top = candidate.top as number;
  const right = candidate.right as number;
  const bottom = candidate.bottom as number;
  const left = candidate.left as number;

  if (top < 0 || right < 0 || bottom < 0 || left < 0) {
    return null;
  }

  if (top + right + bottom + left <= 0) {
    return null;
  }

  return { top, right, bottom, left };
}

function normalizeBoardStateForImport(value: unknown): BoardState | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    rows?: unknown;
    columns?: unknown;
    newTableDefaults?: {
      labelPrefix?: unknown;
      presetId?: unknown;
      shape?: unknown;
      roundSeatCount?: unknown;
      rectangularSideCounts?: unknown;
    };
  };

  if (!Number.isInteger(candidate.rows) || !Number.isInteger(candidate.columns)) {
    return null;
  }

  const rows = candidate.rows as number;
  const columns = candidate.columns as number;

  if (rows <= 0 || columns <= 0) {
    return null;
  }

  const defaults = candidate.newTableDefaults;
  if (!defaults || typeof defaults !== "object") return null;

  if (typeof defaults.labelPrefix !== "string") return null;
  const derivedDefaults = (() => {
    if (isTablePresetId(defaults.presetId)) {
      return getDerivedTableConfigFromPresetId(defaults.presetId);
    }

    if (defaults.shape !== "round" && defaults.shape !== "rectangular") return null;
    if (!Number.isInteger(defaults.roundSeatCount)) return null;

    const rectangularSideCounts = parseRectangularSeatCounts(defaults.rectangularSideCounts);
    if (!rectangularSideCounts) return null;

    const roundSeatCount = defaults.roundSeatCount as number;
    const seatConfig =
      defaults.shape === "rectangular"
        ? { shape: "rectangular" as const, sideCounts: rectangularSideCounts }
        : {
            shape: "round" as const,
            seatCount: Math.min(
              MAX_ROUND_TABLE_CAPACITY,
              Math.max(MIN_ROUND_TABLE_CAPACITY, roundSeatCount)
            ),
          };
    const presetId = resolvePersistedTablePresetId(defaults.presetId, defaults.shape, seatConfig);
    if (!presetId) return null;

    return getDerivedTableConfigFromPresetId(presetId);
  })();

  if (!derivedDefaults) return null;

  return {
    rows,
    columns,
    newTableDefaults: {
      labelPrefix: defaults.labelPrefix,
      presetId: derivedDefaults.presetId,
      shape: derivedDefaults.shape,
      roundSeatCount:
        derivedDefaults.seatConfig.shape === "round"
          ? derivedDefaults.seatConfig.seatCount
          : createDefaultBoardState().newTableDefaults.roundSeatCount,
      rectangularSideCounts:
        derivedDefaults.seatConfig.shape === "rectangular"
          ? derivedDefaults.seatConfig.sideCounts
          : createDefaultBoardState().newTableDefaults.rectangularSideCounts,
    },
  };
}

function normalizeTableStateForImport(
  value: unknown,
  tableIndex: number,
  board: BoardState
): TableState | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    id?: unknown;
    presetId?: unknown;
    tableNumber?: unknown;
    name?: unknown;
    shape?: unknown;
    seatConfig?: {
      shape?: unknown;
      seatCount?: unknown;
      sideCounts?: unknown;
    };
    guestIds?: unknown;
    disabledSeats?: unknown;
    gridPosition?: { row?: unknown; column?: unknown };
  };

  if (!Number.isInteger(candidate.tableNumber) || (candidate.tableNumber as number) <= 0) {
    return null;
  }

  const tableNumber = candidate.tableNumber as number;

  if (typeof candidate.name !== "string") {
    return null;
  }

  if (!Array.isArray(candidate.guestIds) || !candidate.guestIds.every(isSeatValue)) {
    return null;
  }

  const shape =
    candidate.shape === "round" || candidate.shape === "rectangular" ? candidate.shape : null;
  const derivedTableConfig = (() => {
    if (isTablePresetId(candidate.presetId)) {
      return getDerivedTableConfigFromPresetId(candidate.presetId);
    }

    if (!shape) {
      return null;
    }

    const seatConfig =
      shape === "round"
        ? (() => {
            const importedSeatCount =
              candidate.seatConfig?.shape === "round" &&
              Number.isInteger(candidate.seatConfig.seatCount)
                ? (candidate.seatConfig.seatCount as number)
                : candidate.guestIds.length;
            const seatCount = Math.min(
              MAX_ROUND_TABLE_CAPACITY,
              Math.max(MIN_ROUND_TABLE_CAPACITY, importedSeatCount)
            );
            return { shape: "round" as const, seatCount };
          })()
        : (() => {
            const sideCounts =
              candidate.seatConfig?.shape === "rectangular"
                ? parseRectangularSeatCounts(candidate.seatConfig.sideCounts)
                : null;
            if (!sideCounts) return null;
            return { shape: "rectangular" as const, sideCounts };
          })();

    if (!seatConfig) {
      return null;
    }

    const presetId = resolvePersistedTablePresetId(candidate.presetId, shape, seatConfig);
    if (!presetId) {
      return null;
    }

    return getDerivedTableConfigFromPresetId(presetId);
  })();

  if (!derivedTableConfig) {
    return null;
  }

  const expectedSeatCount = getTableSeatCount(derivedTableConfig.seatConfig);
  const guestIds = [
    ...candidate.guestIds.slice(0, expectedSeatCount),
    ...Array<string | null>(Math.max(0, expectedSeatCount - candidate.guestIds.length)).fill(null),
  ];

  const fallbackRow = Math.floor(tableIndex / board.columns);
  const fallbackColumn = tableIndex % board.columns;
  const importedRow = candidate.gridPosition?.row;
  const importedColumn = candidate.gridPosition?.column;
  const row =
    Number.isInteger(importedRow) &&
    (importedRow as number) >= 0 &&
    (importedRow as number) < board.rows
      ? (importedRow as number)
      : Math.min(Math.max(fallbackRow, 0), board.rows - 1);
  const column =
    Number.isInteger(importedColumn) &&
    (importedColumn as number) >= 0 &&
    (importedColumn as number) < board.columns
      ? (importedColumn as number)
      : Math.min(Math.max(fallbackColumn, 0), board.columns - 1);

  const disabledSeats = Array.isArray(candidate.disabledSeats)
    ? candidate.disabledSeats.filter(
        (seatIndex, index, source): seatIndex is number =>
          Number.isInteger(seatIndex) &&
          seatIndex >= 0 &&
          seatIndex < guestIds.length &&
          guestIds[seatIndex] === null &&
          source.indexOf(seatIndex) === index
      )
    : [];

  return {
    id:
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : `table-${tableNumber}`,
    tableNumber,
    name: candidate.name.trim().length > 0 ? candidate.name : `Table ${tableNumber}`,
    presetId: derivedTableConfig.presetId,
    shape: derivedTableConfig.shape,
    gridPosition: { row, column },
    seatConfig: derivedTableConfig.seatConfig,
    guestIds,
    disabledSeats,
  };
}

function parseImportPayload(value: unknown): {
  guests: GuestInputRow[];
  board: BoardState;
  tables: TableState[];
} | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    version?: unknown;
    guests?: unknown;
    board?: unknown;
    tables?: unknown;
  };

  if (candidate.version !== EXPORT_FORMAT_VERSION) return null;

  if (
    !Array.isArray(candidate.guests) ||
    !candidate.guests.every((row) => isGuestInputRowLike(row))
  ) {
    return null;
  }

  const board = normalizeBoardStateForImport(candidate.board);
  if (!board || !Array.isArray(candidate.tables)) {
    return null;
  }

  const tables = candidate.tables.map((table, tableIndex) =>
    normalizeTableStateForImport(table, tableIndex, board)
  );

  if (tables.some((table) => table === null)) {
    return null;
  }

  return {
    guests: normalizeGuestInputRows(candidate.guests),
    board,
    tables: tables as TableState[],
  };
}

function buildExportFilename(): string {
  return `seating-export-${new Date().toISOString().slice(0, 10)}.csv`;
}

function parseCsvRecord(line: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      fields.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (inQuotes) return null;

  fields.push(current);
  return fields;
}

function parseCsvLines(text: string): string[][] | null {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .filter((line, index, source) => line.length > 0 || index < source.length - 1);

  const records: string[][] = [];
  for (const line of lines) {
    const parsed = parseCsvRecord(line);
    if (!parsed) return null;
    records.push(parsed);
  }

  return records;
}

const CSV_EXPORT_HEADERS = ["Full Name", "Host", "Party", "Circle", "Table", "Seat"] as const;

function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase();
}

function parseCsvImportPayload(text: string): {
  guests: GuestInputRow[];
  board: BoardState;
  tables: TableState[];
} | null {
  const rows = parseCsvLines(text);
  if (!rows || rows.length === 0) return null;

  const [header, ...records] = rows;
  const requiredGuestHeaders = ["Full Name", "Host", "Party", "Circle"] as const;
  const normalizedHeaderIndexes = new Map<string, number>();

  for (let index = 0; index < header.length; index += 1) {
    const trimmedLabel = header[index].trim();
    const normalizedLabel = normalizeCsvHeader(trimmedLabel);
    if (!normalizedLabel) return null;
    if (normalizedHeaderIndexes.has(normalizedLabel)) return null;
    normalizedHeaderIndexes.set(normalizedLabel, index);
  }

  const lookupIndex = (label: string): number | null => {
    const normalized = normalizeCsvHeader(label);
    const matchedIndex = normalizedHeaderIndexes.get(normalized);
    return matchedIndex === undefined ? null : matchedIndex;
  };

  const fullNameIndex = lookupIndex("Full Name");
  const hostIndex = lookupIndex("Host");
  const partyIndex = lookupIndex("Party");
  const circleIndex = lookupIndex("Circle");
  const tableColumnIndex = lookupIndex("Table");
  const seatColumnIndex = lookupIndex("Seat");

  if (
    fullNameIndex === null ||
    hostIndex === null ||
    partyIndex === null ||
    circleIndex === null ||
    !requiredGuestHeaders.every((label) => lookupIndex(label) !== null)
  ) {
    return null;
  }

  const guests: GuestInputRow[] = [];
  const nextState = createInitialState([]);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length !== header.length) return null;

    const fullName = record[fullNameIndex] ?? "";
    const host = record[hostIndex] ?? "";
    const party = partyIndex === null ? "" : (record[partyIndex] ?? "");
    const circle = circleIndex === null ? "" : (record[circleIndex] ?? "");
    const tableValue = tableColumnIndex === null ? "" : (record[tableColumnIndex] ?? "");
    const seatValue = seatColumnIndex === null ? "" : (record[seatColumnIndex] ?? "");

    // Rows without a guest name are considered empty/invalid guest records and ignored.
    if (!fullName.trim()) {
      continue;
    }

    const guestId = createGuestRowId(guests);

    guests.push({
      id: guestId,
      fullName,
      host,
      party,
      circle,
    });
    const hasTableValue = tableValue.trim().length > 0;
    const hasSeatValue = seatValue.trim().length > 0;

    if (!hasTableValue && !hasSeatValue) {
      nextState.unassigned.push(guestId);
      continue;
    }

    if (!hasTableValue || !hasSeatValue) {
      nextState.unassigned.push(guestId);
      continue;
    }

    const tableNumber = Number.parseInt(tableValue, 10);
    const seatNumber = Number.parseInt(seatValue, 10);

    if (
      !Number.isInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > TABLE_COUNT ||
      !Number.isInteger(seatNumber) ||
      seatNumber < 1 ||
      seatNumber > TABLE_CAPACITY
    ) {
      nextState.unassigned.push(guestId);
      continue;
    }

    const assignedSeatIndex = seatNumber - 1;
    const table = nextState.tables[tableNumber - 1];
    if (table.guestIds[assignedSeatIndex] !== null) {
      nextState.unassigned.push(guestId);
      continue;
    }

    table.guestIds[assignedSeatIndex] = guestId;
  }

  return {
    guests,
    board: nextState.board,
    tables: nextState.tables,
  };
}

function buildCsvContent(guests: GuestInputRow[], seating: PersistedSeatingData): string {
  const { tables } = seating.state;

  // Build seat assignment map: guestId -> { tableNumber, seatIndex }
  const seatMap = new Map<string, { tableNumber: number; seatIndex: number }>();
  for (const table of tables) {
    table.guestIds.forEach((guestId, seatIndex) => {
      if (guestId !== null) {
        seatMap.set(guestId, { tableNumber: table.tableNumber, seatIndex: seatIndex + 1 });
      }
    });
  }

  function escapeCsv(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  const rows = guests.map((row) => {
    const seat = seatMap.get(row.id);
    return [
      row.fullName,
      row.host,
      row.party,
      row.circle,
      seat ? String(seat.tableNumber) : "",
      seat ? String(seat.seatIndex) : "",
    ]
      .map(escapeCsv)
      .join(",");
  });

  return [CSV_EXPORT_HEADERS.map(escapeCsv).join(","), ...rows].join("\n");
}

function getImportFileKind(file: File): "json" | "csv" | null {
  const normalizedName = file.name.toLowerCase();

  if (file.type === "application/json" || normalizedName.endsWith(".json")) {
    return "json";
  }

  if (file.type === "text/csv" || normalizedName.endsWith(".csv")) {
    return "csv";
  }

  return null;
}

function getFirstImportFile(files: FileList | null): File | null {
  if (!files || files.length === 0) return null;

  for (const file of Array.from(files)) {
    if (getImportFileKind(file)) {
      return file;
    }
  }

  return null;
}

function arePreviewTablesEqual(nextTables: TableState[], prevTables: TableState[]): boolean {
  if (nextTables.length !== prevTables.length) return false;

  for (let tableIndex = 0; tableIndex < nextTables.length; tableIndex += 1) {
    const nextTable = nextTables[tableIndex];
    const prevTable = prevTables[tableIndex];

    if (nextTable.tableNumber !== prevTable.tableNumber) return false;
    if (nextTable.guestIds.length !== prevTable.guestIds.length) return false;

    for (let seatIndex = 0; seatIndex < nextTable.guestIds.length; seatIndex += 1) {
      if (nextTable.guestIds[seatIndex] !== prevTable.guestIds[seatIndex]) return false;
    }
  }

  return true;
}

type DragOverlaySnapshot = {
  node: HTMLElement;
  width: number;
  height: number;
  left: number;
  top: number;
};

function findGuestChipById(
  guestId: string,
  predicate?: (el: HTMLElement) => boolean
): HTMLElement | null {
  const chips = document.querySelectorAll<HTMLElement>("[data-guest-chip][data-guest-id]");
  for (const chip of chips) {
    if (chip.dataset.guestId !== guestId) continue;
    if (!predicate || predicate(chip)) return chip;
  }
  return null;
}

function resolveDragOverlaySourceElement(intent: DragIntent): HTMLElement | null {
  if (intent.kind === "guest") {
    if (
      intent.source === "seated" &&
      typeof intent.tableNumber === "number" &&
      typeof intent.seatIndex === "number"
    ) {
      const seatId = `seat-${intent.tableNumber}-${intent.seatIndex}`;
      return findGuestChipById(
        intent.guestId,
        (chip) => chip.closest<HTMLElement>("[data-seat-slot]")?.dataset.seatId === seatId
      );
    }

    return findGuestChipById(intent.guestId, (chip) => !!chip.closest("[data-sidebar]"));
  }

  if (intent.kind === "party") {
    const cards = document.querySelectorAll<HTMLElement>("[data-party-card][data-party-id]");
    for (const card of cards) {
      if (card.dataset.partyId === intent.partyId) return card;
    }
    return null;
  }

  if (intent.kind === "circle") {
    const cards = document.querySelectorAll<HTMLElement>("[data-circle-card][data-circle-name]");
    for (const card of cards) {
      if (card.dataset.circleName === intent.circleName) return card;
    }
    return null;
  }

  if (intent.kind === "table") {
    const roots = document.querySelectorAll<HTMLElement>(
      "[data-table-drag-root][data-table-number]"
    );
    for (const root of roots) {
      if (root.dataset.tableNumber !== String(intent.tableNumber)) continue;
      const card = root.querySelector<HTMLElement>("[data-table-card]");
      if (card) return card;
    }
  }

  return null;
}

function sanitizeOverlayClone(node: HTMLElement): void {
  node.classList.remove("opacity-0");
  node.style.opacity = "1";
  node.style.pointerEvents = "none";

  const hiddenNodes = node.querySelectorAll<HTMLElement>(".opacity-0");
  hiddenNodes.forEach((hiddenNode) => hiddenNode.classList.remove("opacity-0"));
}

function getDragProbePoint(active: DragOverEvent["active"] | DragEndEvent["active"]): {
  x: number;
  y: number;
} | null {
  const translatedRect = active.rect.current.translated;
  if (!translatedRect) return null;

  return {
    x: translatedRect.left + translatedRect.width / 2,
    y: translatedRect.top + translatedRect.height / 2,
  };
}

function captureDragOverlaySnapshot(intent: DragIntent): DragOverlaySnapshot | null {
  const sourceNode = resolveDragOverlaySourceElement(intent);
  if (!sourceNode) return null;

  const rect = sourceNode.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const clone = sourceNode.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return null;
  sanitizeOverlayClone(clone);

  return {
    node: clone,
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
  };
}

function DragOverlayClone({ snapshot }: { snapshot: DragOverlaySnapshot }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    mountNode.replaceChildren(snapshot.node.cloneNode(true));
    const child = mountNode.firstElementChild;
    if (child instanceof HTMLElement) {
      sanitizeOverlayClone(child);
      child.style.width = `${snapshot.width}px`;
      child.style.height = `${snapshot.height}px`;
    }

    return () => {
      mountNode.replaceChildren();
    };
  }, [snapshot]);

  return <div ref={mountRef} className="pointer-events-none" />;
}

type GuestSwapPreview = {
  sourceTableNumber: number;
  sourceSeatIndex: number;
  sourceGuestId: string;
  targetTableNumber: number;
  targetSeatIndex: number;
  targetGuestId: string;
};

type TableSwapPreview = {
  draggingTableNumber: number | null;
  swapTargetTableNumber: number | null;
};

// ─── SeatingApp ───────────────────────────────────────────────────────────────

function SeatingApp({
  guestRows,
  onGuestRowsChange,
  onImportSnapshot,
  onReset,
  theme,
  onThemeToggle,
}: {
  guestRows: GuestInputRow[];
  onGuestRowsChange: (nextGuestRows: GuestInputRow[]) => void;
  onImportSnapshot: (nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) => void;
  onReset: () => void;
  theme: AppTheme;
  onThemeToggle: () => void;
}) {
  const {
    state,
    snapshot,
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    guests,
    parties,
    warnings,
    selectedGuestId,
    clearSelectedGuest,
    guestProfiles,
  } = useSeating();
  const { restoreHighlightModeAfterGuestDeselection } = useSearch();

  const deselectGuest = useCallback(() => {
    restoreHighlightModeAfterGuestDeselection();
    clearSelectedGuest();
  }, [clearSelectedGuest, restoreHighlightModeAfterGuestDeselection]);

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [activeDragIntent, setActiveDragIntent] = useState<DragIntent | null>(null);
  const [autoSeatPreview, setAutoSeatPreview] = useState<{
    tables: import("./types").TableState[];
  } | null>(null);
  const [guestSwapPreview, setGuestSwapPreview] = useState<GuestSwapPreview | null>(null);
  const guestSwapPreviewRef = useRef<GuestSwapPreview | null>(null);
  const [tableSwapPreview, setTableSwapPreview] = useState<TableSwapPreview>({
    draggingTableNumber: null,
    swapTargetTableNumber: null,
  });
  const [dragOverlaySnapshot, setDragOverlaySnapshot] = useState<DragOverlaySnapshot | null>(null);
  const [activeOverId, setActiveOverId] = useState<string | null>(null);
  const latestDropContextRef = useRef({ state, guestProfiles, parties });
  /** Tracks the latest pointer position for seat-level probe during drag-end. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const previewTargetKeyRef = useRef<string | null>(null);
  const previewLastComputedAtRef = useRef(0);
  /** Timer ID for the grace-period before clearing the swap preview. */
  const swapPreviewClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ref to the custom drag overlay portal element for direct DOM transform updates. */
  const overlayRef = useRef<HTMLDivElement | null>(null);
  /** Pointer position captured on pointerdown, used to compute overlay transform delta. */
  const dragStartPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Cached seat slot rects for O(n) hit-testing during seated-guest drags (avoids elementsFromPoint). */
  const seatRectCacheRef = useRef<Map<string, { rect: DOMRect; el: HTMLElement }> | null>(null);

  // Derived drag state passed down to child components.
  const activeDragKind: DragKind | null = activeDragIntent?.kind ?? null;
  const activeDragGuestId: string | null =
    activeDragIntent?.kind === "guest" ? activeDragIntent.guestId : null;

  // ── Other state ─────────────────────────────────────────────────────────────
  const [showWarnings, setShowWarnings] = useState(false);
  const [autoAssignWarning, setAutoAssignWarning] = useState<string | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const autoAssignWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!autoAssignWarning) return;
    if (autoAssignWarningTimerRef.current) clearTimeout(autoAssignWarningTimerRef.current);
    autoAssignWarningTimerRef.current = setTimeout(() => setAutoAssignWarning(null), 6000);
    return () => {
      if (autoAssignWarningTimerRef.current) clearTimeout(autoAssignWarningTimerRef.current);
    };
  }, [autoAssignWarning]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const updateHeaderOffset = () => {
      setHeaderOffset(header.getBoundingClientRect().height + 8);
    };

    updateHeaderOffset();

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderOffset();
    });

    resizeObserver.observe(header);
    window.addEventListener("resize", updateHeaderOffset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeaderOffset);
    };
  }, []);

  const [boardZoom, setBoardZoom] = useState(() => loadPersistedZoom());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);

  useEffect(() => {
    latestDropContextRef.current = { state, guestProfiles, parties };
  }, [state, guestProfiles, parties]);

  useEffect(() => {
    saveZoom(boardZoom);
  }, [boardZoom]);

  const handleZoomOut = useCallback(() => {
    setBoardZoom((value) => clampBoardZoom(value - 0.1));
  }, []);

  const handleZoomReset = useCallback(() => {
    setBoardZoom(1);
  }, []);

  const handleZoomIn = useCallback(() => {
    setBoardZoom((value) => clampBoardZoom(value + 0.1));
  }, []);

  const guestRowsById = useMemo(
    () => new Map(guestRows.map((row) => [row.id, row] as const)),
    [guestRows]
  );
  const [guestDialogState, setGuestDialogState] = useState<
    { mode: "create" } | { mode: "edit"; guestId: string } | null
  >(null);
  const [pendingDeleteGuestId, setPendingDeleteGuestId] = useState<string | null>(null);
  const [tableDialogState, setTableDialogState] = useState<
    { mode: "create" } | { mode: "edit"; tableNumber: number } | null
  >(null);
  const [pendingDeleteTableNumber, setPendingDeleteTableNumber] = useState<number | null>(null);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const optionCollator = useMemo(() => new Intl.Collator(undefined, { sensitivity: "base" }), []);
  const partyOptions = useMemo(
    () =>
      [...parties.values()]
        .map((party) => party.party.trim())
        .filter((value, index, source) => value.length > 0 && source.indexOf(value) === index)
        .sort((left, right) => optionCollator.compare(left, right)),
    [optionCollator, parties]
  );
  const circleOptions = useMemo(
    () =>
      [
        ...new Set(guestRows.map((row) => row.circle.trim()).filter((value) => value.length > 0)),
      ].sort((left, right) => optionCollator.compare(left, right)),
    [guestRows, optionCollator]
  );
  const hostOptions = useMemo(
    () =>
      [
        ...new Set(guestRows.map((row) => row.host.trim()).filter((value) => value.length > 0)),
      ].sort((left, right) => optionCollator.compare(left, right)),
    [guestRows, optionCollator]
  );
  const partyHostByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const party of parties.values()) {
      const partyName = party.party.trim();
      if (!partyName) continue;
      map.set(partyName.toLocaleLowerCase(), party.host);
    }
    return map;
  }, [parties]);
  const editingGuestRow = useMemo(() => {
    if (guestDialogState?.mode !== "edit") return null;
    return guestRowsById.get(guestDialogState.guestId) ?? null;
  }, [guestDialogState, guestRowsById]);
  const deleteGuestRow = useMemo(
    () => (pendingDeleteGuestId ? (guestRowsById.get(pendingDeleteGuestId) ?? null) : null),
    [guestRowsById, pendingDeleteGuestId]
  );
  const guestDialogInitialValues = useMemo<GuestFormValues>(
    () =>
      editingGuestRow
        ? {
            fullName: editingGuestRow.fullName,
            host: editingGuestRow.host,
            party: editingGuestRow.party,
            circle: editingGuestRow.circle,
          }
        : { fullName: "", host: "", party: "", circle: "" },
    [editingGuestRow]
  );

  const resolveGuestHost = useCallback(
    (party: string, fallbackHost: string) => {
      const normalizedParty = party.trim().toLocaleLowerCase();
      if (!normalizedParty) return fallbackHost;
      return partyHostByName.get(normalizedParty) ?? fallbackHost;
    },
    [partyHostByName]
  );
  const handleAddGuest = useCallback(() => {
    setGuestDialogState({ mode: "create" });
  }, []);
  const handleEditGuest = useCallback(
    (guestId: string) => {
      if (!guestRowsById.has(guestId)) return;
      setGuestDialogState({ mode: "edit", guestId });
    },
    [guestRowsById]
  );
  const handleDeleteGuest = useCallback(
    (guestId: string) => {
      if (!guestRowsById.has(guestId)) return;
      setPendingDeleteGuestId(guestId);
    },
    [guestRowsById]
  );
  const handleSubmitGuest = useCallback(
    (values: GuestFormValues) => {
      if (guestDialogState?.mode === "edit") {
        const currentRow = guestRowsById.get(guestDialogState.guestId);
        if (!currentRow) return;

        onGuestRowsChange(
          guestRows.map((row) =>
            row.id === currentRow.id
              ? {
                  ...row,
                  fullName: values.fullName,
                  party: values.party,
                  circle: values.circle,
                  host: values.host || resolveGuestHost(values.party, row.host),
                }
              : row
          )
        );
      } else {
        onGuestRowsChange([
          ...guestRows,
          {
            id: createGuestRowId(guestRows),
            fullName: values.fullName,
            party: values.party,
            circle: values.circle,
            host: values.host || resolveGuestHost(values.party, ""),
          },
        ]);
      }

      setGuestDialogState(null);
    },
    [guestDialogState, guestRowsById, onGuestRowsChange, guestRows, resolveGuestHost]
  );
  const handleConfirmDeleteGuest = useCallback(() => {
    if (!pendingDeleteGuestId) return;

    onGuestRowsChange(guestRows.filter((row) => row.id !== pendingDeleteGuestId));
    if (selectedGuestId === pendingDeleteGuestId) {
      deselectGuest();
    }
    setPendingDeleteGuestId(null);
  }, [deselectGuest, guestRows, onGuestRowsChange, pendingDeleteGuestId, selectedGuestId]);

  // ── Table management handlers ─────────────────────────────────────────────
  const handleAddTable = useCallback(() => {
    setTableDialogState({ mode: "create" });
  }, []);
  const handleEditTable = useCallback((tableNumber: number) => {
    setTableDialogState({ mode: "edit", tableNumber });
  }, []);
  const handleDeleteTable = useCallback((tableNumber: number) => {
    setPendingDeleteTableNumber(tableNumber);
  }, []);
  const handleConfirmDeleteTable = useCallback(() => {
    if (pendingDeleteTableNumber === null) return;
    dispatch({ type: "DELETE_TABLE", tableNumber: pendingDeleteTableNumber });
    setPendingDeleteTableNumber(null);
  }, [dispatch, pendingDeleteTableNumber]);
  const editingTable = useMemo(() => {
    if (tableDialogState?.mode !== "edit") return null;
    return state.tables.find((t) => t.tableNumber === tableDialogState.tableNumber) ?? null;
  }, [tableDialogState, state.tables]);
  const tableDialogInitialValues = useMemo<TableFormValues>(() => {
    if (editingTable) {
      return {
        name: editingTable.name,
        presetId: editingTable.presetId,
      };
    }
    return {
      name: "",
      presetId: state.board.newTableDefaults.presetId,
    };
  }, [editingTable, state.board]);
  const handleSubmitTable = useCallback(
    (values: TableFormValues) => {
      if (tableDialogState?.mode === "edit") {
        dispatch({
          type: "UPDATE_TABLE_CONFIG",
          tableNumber: tableDialogState.tableNumber,
          updates: { name: values.name, presetId: values.presetId },
        });
      } else {
        dispatch({
          type: "CREATE_TABLE",
          name: values.name || undefined,
          presetId: values.presetId,
        });
      }
      setTableDialogState(null);
    },
    [dispatch, tableDialogState]
  );
  const handleBoardSettings = useCallback(() => {
    setBoardSettingsOpen(true);
  }, []);
  const handleSubmitBoardSettings = useCallback(
    (values: BoardSettingsFormValues) => {
      dispatch({
        type: "UPDATE_BOARD_CONFIG",
        updates: { rows: values.rows, columns: values.columns },
        newTableDefaults: {
          labelPrefix: values.labelPrefix,
          presetId: values.presetId,
        },
      });
      setBoardSettingsOpen(false);
    },
    [dispatch]
  );
  const pendingDeleteTable = useMemo(
    () =>
      pendingDeleteTableNumber !== null
        ? (state.tables.find((t) => t.tableNumber === pendingDeleteTableNumber) ?? null)
        : null,
    [pendingDeleteTableNumber, state.tables]
  );

  // ── Capture pointer position at drag start ──────────────────────────────────
  useEffect(() => {
    const capture = (e: PointerEvent) => {
      dragStartPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", capture, { passive: true });
    return () => window.removeEventListener("pointerdown", capture);
  }, []);

  // ── Drive overlay position via direct DOM mutation (bypasses React render cycle) ──
  useEffect(() => {
    if (!dragOverlaySnapshot) return;
    const move = (clientX: number, clientY: number) => {
      const el = overlayRef.current;
      const p0 = dragStartPointerRef.current;
      if (!el || !p0) return;
      el.style.transform = `translate3d(${clientX - p0.x}px,${clientY - p0.y}px,0)`;
    };
    const onPointer = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0] ?? e.changedTouches[0];
      if (t) move(t.clientX, t.clientY);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [dragOverlaySnapshot]);

  // ── Pointer tracking for seat-level probe ────────────────────────────────────
  useEffect(() => {
    if (!activeDragIntent) return;

    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (touch) pointerRef.current = { x: touch.clientX, y: touch.clientY };
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [activeDragIntent]);

  // ── Swap preview tracking via pointermove ─────────────────────────────────
  // Drive seated-guest swap preview directly from DOM hit-testing rather than
  // from dnd-kit's collision detection, which is too coarse near seat boundaries.
  useEffect(() => {
    if (
      activeDragIntent?.kind !== "guest" ||
      activeDragIntent.source !== "seated" ||
      typeof activeDragIntent.tableNumber !== "number" ||
      typeof activeDragIntent.seatIndex !== "number"
    ) {
      return;
    }

    const sourceTableNumber = activeDragIntent.tableNumber;
    const sourceSeatIndex = activeDragIntent.seatIndex;
    const sourceGuestId = activeDragIntent.guestId;
    const CLEAR_DELAY_MS = 80;
    let animationFrameId: number | null = null;
    let queuedPoint: { x: number; y: number } | null = null;

    const cancelClearTimer = () => {
      if (swapPreviewClearTimerRef.current !== null) {
        clearTimeout(swapPreviewClearTimerRef.current);
        swapPreviewClearTimerRef.current = null;
      }
    };

    const scheduleClear = () => {
      if (swapPreviewClearTimerRef.current !== null) return;
      swapPreviewClearTimerRef.current = setTimeout(() => {
        swapPreviewClearTimerRef.current = null;
        if (guestSwapPreviewRef.current === null) return;
        guestSwapPreviewRef.current = null;
        setGuestSwapPreview((prev) => (prev === null ? prev : null));
      }, CLEAR_DELAY_MS);
    };

    const updateFromPoint = (x: number, y: number) => {
      // Prefer cached seat rects (no forced layout) over elementsFromPoint.
      const cache = seatRectCacheRef.current;
      let hitSeatId: string | null = null;
      let hitGuestId: string | null = null;

      if (cache) {
        for (const [seatId, { rect, el }] of cache) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            hitSeatId = seatId;
            hitGuestId = el.dataset.guestId || null;
            break;
          }
        }
      } else {
        // Fallback: DOM hit-test (no cache available)
        const elements =
          typeof document.elementsFromPoint === "function"
            ? document.elementsFromPoint(x, y)
            : (() => {
                const el = document.elementFromPoint(x, y);
                return el ? [el] : [];
              })();
        for (const el of elements) {
          const slotEl = el.closest<HTMLElement>("[data-seat-slot]");
          if (slotEl) {
            hitSeatId = slotEl.dataset.seatId ?? null;
            hitGuestId = slotEl.dataset.guestId || null;
            break;
          }
        }
      }

      if (hitSeatId) {
        const parsed = parseDropTargetId(hitSeatId);
        if (
          parsed?.type === "seat" &&
          hitGuestId &&
          hitGuestId !== sourceGuestId &&
          !(parsed.tableNumber === sourceTableNumber && parsed.seatIndex === sourceSeatIndex)
        ) {
          // Pointer is over an occupied non-self seat — activate swap preview.
          cancelClearTimer();
          const nextPreview: GuestSwapPreview = {
            sourceTableNumber,
            sourceSeatIndex,
            sourceGuestId,
            targetTableNumber: parsed.tableNumber,
            targetSeatIndex: parsed.seatIndex,
            targetGuestId: hitGuestId,
          };
          if (
            guestSwapPreviewRef.current?.targetTableNumber !== nextPreview.targetTableNumber ||
            guestSwapPreviewRef.current?.targetSeatIndex !== nextPreview.targetSeatIndex
          ) {
            guestSwapPreviewRef.current = nextPreview;
            setGuestSwapPreview(nextPreview);
          }
          return;
        }
        // Found a seat slot but it's empty or the source — schedule preview clear.
        scheduleClear();
        return;
      }

      // No seat slot found (gap between tables, overlay-only hit, etc.) — let
      // preview stick briefly so it doesn't flash at seat edges.
      scheduleClear();
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0] ?? e.changedTouches[0];
      if (touch) queuePoint(touch.clientX, touch.clientY);
    };

    const flushQueuedPoint = () => {
      animationFrameId = null;
      if (!queuedPoint) return;
      const { x, y } = queuedPoint;
      queuedPoint = null;
      updateFromPoint(x, y);
    };

    const queuePoint = (x: number, y: number) => {
      queuedPoint = { x, y };
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(flushQueuedPoint);
    };

    const handlePointerMove = (e: PointerEvent) => queuePoint(e.clientX, e.clientY);

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      cancelClearTimer();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      queuedPoint = null;
    };
  }, [activeDragIntent]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      const isFindShortcut =
        isModifierPressed && !event.shiftKey && event.key.toLowerCase() === "f";
      const isZKey = event.key.toLowerCase() === "z";
      const isUndoShortcut = isModifierPressed && !event.shiftKey && isZKey;
      const isRedoShortcut = isModifierPressed && event.shiftKey && isZKey;
      const isDeleteKey = event.key === "Backspace" || event.key === "Delete";

      if (isFindShortcut) {
        const searchInput = document.querySelector<HTMLInputElement>("[data-app-search='true']");
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (event.altKey || isEditableTarget(event.target)) return;

      if (isUndoShortcut && canUndo) {
        event.preventDefault();
        undo();
      }

      if (isRedoShortcut && canRedo) {
        event.preventDefault();
        redo();
      }

      if (event.key === "Escape") {
        deselectGuest();
        (document.activeElement as HTMLElement | null)?.blur();
      }

      if (isDeleteKey && selectedGuestId) {
        const isAssigned = !state.unassigned.includes(selectedGuestId);
        if (isAssigned) {
          event.preventDefault();
          dispatch({ type: "REMOVE_GUESTS", guestIds: [selectedGuestId] });
          deselectGuest();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canRedo, canUndo, deselectGuest, dispatch, redo, selectedGuestId, state.unassigned, undo]);

  // ── Click-to-deselect guest ───────────────────────────────────────────────────
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-guest-chip]")) {
        deselectGuest();
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [deselectGuest]);

  // ── dnd-kit sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const intent = parseDragIntent(event.active.data.current);
    if (!intent) return;
    if (swapPreviewClearTimerRef.current !== null) {
      clearTimeout(swapPreviewClearTimerRef.current);
      swapPreviewClearTimerRef.current = null;
    }
    previewTargetKeyRef.current = null;
    previewLastComputedAtRef.current = 0;
    guestSwapPreviewRef.current = null;
    setGuestSwapPreview(null);
    setDragOverlaySnapshot(captureDragOverlaySnapshot(intent));
    setActiveDragIntent(intent);
    // Build seat rect cache for O(n) hit-testing (avoids elementsFromPoint per frame)
    if (intent.kind === "guest" && intent.source === "seated") {
      const cache = new Map<string, { rect: DOMRect; el: HTMLElement }>();
      document.querySelectorAll<HTMLElement>("[data-seat-slot][data-seat-id]").forEach((el) => {
        const seatId = el.dataset.seatId;
        if (seatId) cache.set(seatId, { rect: el.getBoundingClientRect(), el });
      });
      seatRectCacheRef.current = cache;
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    if (swapPreviewClearTimerRef.current !== null) {
      clearTimeout(swapPreviewClearTimerRef.current);
      swapPreviewClearTimerRef.current = null;
    }
    setActiveDragIntent(null);
    setAutoSeatPreview(null);
    guestSwapPreviewRef.current = null;
    setGuestSwapPreview(null);
    setTableSwapPreview({ draggingTableNumber: null, swapTargetTableNumber: null });
    setDragOverlaySnapshot(null);
    setActiveOverId(null);
    pointerRef.current = null;
    previewTargetKeyRef.current = null;
    previewLastComputedAtRef.current = 0;
    seatRectCacheRef.current = null;
  }, []);

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      const clearAllPreview = () => {
        previewTargetKeyRef.current = null;
        setAutoSeatPreview((prev) => (prev === null ? prev : null));
      };

      const clearAutoSeatPreview = () => {
        previewTargetKeyRef.current = null;
        setAutoSeatPreview((prev) => (prev === null ? prev : null));
      };

      const intent = parseDragIntent(active.data.current) ?? activeDragIntent;
      if (!intent) {
        clearAllPreview();
        setActiveOverId(null);
        return;
      }

      if (!over) {
        if (intent.kind === "guest") {
          clearAutoSeatPreview();
        } else {
          clearAllPreview();
        }
        setActiveOverId(null);
        return;
      }

      setActiveOverId(String(over.id));

      // Swap preview for seated guests is driven entirely by the pointermove
      // useEffect (DOM hit-testing), not by dnd-kit collision events.
      if (intent.kind === "guest") {
        clearAutoSeatPreview();
        return;
      }

      // For table drags, detect swap preview
      if (intent.kind === "table") {
        const target = parseDropTargetId(over ? String(over.id) : null);
        if (target?.type === "table" && target.tableNumber !== intent.tableNumber) {
          setTableSwapPreview((prev) => {
            if (
              prev.draggingTableNumber === intent.tableNumber &&
              prev.swapTargetTableNumber === target.tableNumber
            ) {
              return prev;
            }

            return {
              draggingTableNumber: intent.tableNumber,
              swapTargetTableNumber: target.tableNumber,
            };
          });
          clearAllPreview();
          return;
        }

        setTableSwapPreview((prev) =>
          prev.draggingTableNumber === null && prev.swapTargetTableNumber === null
            ? prev
            : { draggingTableNumber: null, swapTargetTableNumber: null }
        );
        clearAllPreview();
        return;
      }

      // Only preview table-level and autoseat drops — seat drops are single-slot.
      const target = resolveDropTarget(over, pointerRef.current);
      if (!target || target.type === "seat" || target.type === "unassigned") {
        clearAllPreview();
        return;
      }

      const targetKey =
        target.type === "table"
          ? `${intent.kind}:table:${target.tableNumber}`
          : `${intent.kind}:auto-seat`;
      const now = performance.now();
      const elapsed = now - previewLastComputedAtRef.current;
      const isSameTarget = previewTargetKeyRef.current === targetKey;

      // While hovering the same drop target, recompute preview at most every 60ms.
      if (isSameTarget && elapsed < 60) {
        return;
      }

      const {
        state: latestState,
        guestProfiles: latestProfiles,
        parties: latestParties,
      } = latestDropContextRef.current;
      const action = routeDrop(intent, target, {
        state: latestState,
        guestProfiles: latestProfiles,
        parties: latestParties,
      });
      if (!action) {
        clearAllPreview();
        return;
      }

      previewTargetKeyRef.current = targetKey;
      previewLastComputedAtRef.current = now;
      const previewState = seatingReducer(latestState, action);
      setAutoSeatPreview((prev) => {
        if (prev && arePreviewTablesEqual(previewState.tables, prev.tables)) return prev;
        return { tables: previewState.tables };
      });
    },
    [activeDragIntent]
  );

  const handleDragEnd = useCallback(
    ({ active, over, collisions }: DragEndEvent) => {
      if (swapPreviewClearTimerRef.current !== null) {
        clearTimeout(swapPreviewClearTimerRef.current);
        swapPreviewClearTimerRef.current = null;
      }
      const swapPreviewAtDrop = guestSwapPreviewRef.current;
      setActiveDragIntent(null);
      setAutoSeatPreview(null);
      guestSwapPreviewRef.current = null;
      setGuestSwapPreview(null);
      setTableSwapPreview({ draggingTableNumber: null, swapTargetTableNumber: null });
      setDragOverlaySnapshot(null);
      setActiveOverId(null);
      const ptr = pointerRef.current;
      pointerRef.current = null;
      previewTargetKeyRef.current = null;
      previewLastComputedAtRef.current = 0;
      seatRectCacheRef.current = null;

      const intent = parseDragIntent(active.data.current) ?? activeDragIntent;
      if (!intent) return;

      const probePoint = ptr ?? getDragProbePoint(active);
      const collisionSeatTarget =
        collisions
          ?.map((collision) => parseDropTargetId(String(collision.id)))
          .find(
            (candidate): candidate is { type: "seat"; tableNumber: number; seatIndex: number } =>
              candidate?.type === "seat"
          ) ?? null;
      const overTarget = parseDropTargetId(over ? String(over.id) : null);
      const pointerTarget = resolveDropTarget(null, probePoint);
      const fallbackTarget =
        (pointerTarget?.type === "seat" || pointerTarget?.type === "unassigned"
          ? pointerTarget
          : overTarget) ?? collisionSeatTarget;
      let target: ReturnType<typeof parseDropTargetId> =
        overTarget && overTarget.type !== "table" ? overTarget : (fallbackTarget ?? overTarget);
      const isExplicitNonSwapTarget =
        overTarget?.type === "unassigned" || overTarget?.type === "autoseat";
      if (
        intent.kind === "guest" &&
        intent.source === "seated" &&
        swapPreviewAtDrop &&
        swapPreviewAtDrop.sourceGuestId === intent.guestId &&
        swapPreviewAtDrop.sourceTableNumber === intent.tableNumber &&
        swapPreviewAtDrop.sourceSeatIndex === intent.seatIndex &&
        !isExplicitNonSwapTarget
      ) {
        target = {
          type: "seat",
          tableNumber: swapPreviewAtDrop.targetTableNumber,
          seatIndex: swapPreviewAtDrop.targetSeatIndex,
        };
      }
      if (!target) return;

      const action = routeDrop(intent, target, { state, guestProfiles, parties });
      if (action) {
        if (action.type === "AUTO_ASSIGN_GUESTS" && action.guestIds.length > 0) {
          const nextState = seatingReducer(state, action);
          const nextUnassigned = new Set(nextState.unassigned);
          const failedIds = action.guestIds.filter((id) => nextUnassigned.has(id));
          if (failedIds.length > 0) {
            const MAX_NAMES = 3;
            const names = failedIds.slice(0, MAX_NAMES).map((id) => guests.get(id)?.fullName ?? id);
            const overflow = failedIds.length - MAX_NAMES;
            const nameStr =
              overflow > 0 ? `${names.join(", ")} and ${overflow} more` : names.join(", ");
            // For manual drag drops with allowPartialPlacementBypass, only warn about seat capacity limits.
            // For other auto-assign actions, mention the additional constraints.
            const constraintHint = action.allowPartialPlacementBypass
              ? "Try a different table or row."
              : "Try a different table, or check circle row and side constraints.";
            setAutoAssignWarning(`${nameStr} couldn't be seated. ${constraintHint}`);
          } else {
            setAutoAssignWarning(null);
          }
        } else {
          setAutoAssignWarning(null);
        }
        dispatch(action);
      }
    },
    [activeDragIntent, dispatch, guestProfiles, parties, state]
  );

  // ── File import/export ────────────────────────────────────────────────────────
  const importFromFile = useCallback(
    async (file: File) => {
      const importKind = getImportFileKind(file);
      if (!importKind) {
        window.alert("Import failed. Select a .json or export .csv file.");
        return;
      }

      try {
        const text = await file.text();
        const parsed =
          importKind === "json"
            ? parseImportPayload(JSON.parse(text) as unknown)
            : parseCsvImportPayload(text);

        if (!parsed) {
          window.alert(
            importKind === "json"
              ? "Import failed. Use v3 JSON with version, guests, board, and tables."
              : "Import failed. Use a CSV structured like the exported guest file."
          );
          return;
        }

        const { allGuestIds: importedGuestIds } = parseGuestsFromRows(parsed.guests);
        const reconciledState = reconcileStateToGuestIds(
          { board: parsed.board, tables: parsed.tables, unassigned: [] },
          importedGuestIds
        );

        if (!reconciledState || !isCompatibleState(reconciledState, importedGuestIds)) {
          window.alert("Import failed. The tables payload is invalid for the provided guests.");
          return;
        }

        const snapshotToImport: PersistedSeatingData = {
          state: reconciledState,
          history: [],
          future: [],
        };

        onImportSnapshot(parsed.guests, snapshotToImport);
      } catch {
        window.alert(
          importKind === "json"
            ? "Import failed. The selected file is not valid JSON."
            : "Import failed. The selected file is not a valid CSV export."
        );
      }
    },
    [onImportSnapshot]
  );

  const handleImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = getFirstImportFile(event.target.files);
      event.target.value = "";

      if (!file) {
        window.alert("Import failed. Select a .json or export .csv file.");
        return;
      }

      await importFromFile(file);
    },
    [importFromFile]
  );

  const handleFileDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
  }, []);

  const handleFileDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleFileDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
  }, []);

  const handleFileDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      fileDragDepthRef.current = 0;

      const file = getFirstImportFile(event.dataTransfer.files);
      if (!file) return;

      await importFromFile(file);
    },
    [importFromFile]
  );

  function handleReset() {
    if (window.confirm("Reset all seating assignments? This will clear all table placements.")) {
      onReset();
    }
  }

  function handleExport() {
    const csv = buildCsvContent(guestRows, snapshot);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExportFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      collisionDetection={dndCollisionDetection}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}>
      <SidebarProvider>
        <div
          className={cn(
            "relative flex h-screen w-full flex-1 flex-col overflow-hidden",
            activeDragKind === "guest" && "**:cursor-grabbing!"
          )}
          data-testid="file-drop-root"
          data-drag-kind={activeDragKind ?? undefined}
          onDragEnter={handleFileDragEnter}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}>
          <header
            ref={headerRef}
            className="z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
            <SidebarTrigger className="h-8 w-8" />
            <h1 className="whitespace-nowrap text-lg font-semibold text-foreground">
              Seating Assignments
            </h1>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button type="button" size="sm" onClick={handleAddTable}>
                <Plus size={14} aria-hidden="true" />
                <span className="max-sm:hidden">Add Table</span>
              </Button>
              {warnings.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-warning/30 bg-warning/10 text-warning-foreground hover:border-warning/45 hover:bg-warning/15"
                  onClick={() => setShowWarnings((v) => !v)}>
                  <AlertTriangle size={14} aria-hidden="true" />
                  {warnings.length} data {warnings.length === 1 ? "issue" : "issues"}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" aria-label="More actions">
                    <MoreHorizontal size={14} aria-hidden="true" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={handleZoomOut} disabled={boardZoom <= 0.5}>
                    <ZoomOut size={14} aria-hidden="true" />
                    Zoom Out
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleZoomReset} disabled={boardZoom === 1}>
                    <ZoomIn size={14} aria-hidden="true" />
                    Reset Zoom ({Math.round(boardZoom * 100)}%)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleZoomIn} disabled={boardZoom >= 1.5}>
                    <ZoomIn size={14} aria-hidden="true" />
                    Zoom In
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onThemeToggle}>
                    {theme === "dark" ? (
                      <Sun size={14} aria-hidden="true" />
                    ) : (
                      <Moon size={14} aria-hidden="true" />
                    )}
                    {theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleBoardSettings}>
                    <Settings size={14} aria-hidden="true" />
                    Board Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                    <Upload size={14} aria-hidden="true" />
                    Import
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExport}>
                    <Download size={14} aria-hidden="true" />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handleReset}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <RotateCcw size={14} aria-hidden="true" />
                    Reset
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sr-only"
                aria-label="Reset zoom"
                onClick={handleZoomReset}>
                {Math.round(boardZoom * 100)}%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sr-only"
                onClick={handleExport}>
                Export
              </Button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="application/json,.json,text/csv,.csv"
                aria-label="Import seating JSON or CSV file"
                onChange={handleImportChange}
              />
            </div>
          </header>

          {autoAssignWarning && (
            <div
              className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
              style={{ top: headerOffset }}>
              <div
                role="alert"
                className="auto-assign-warning pointer-events-auto grid w-full max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border border-warning/35 bg-[color-mix(in_oklab,var(--card)_84%,var(--warning)_16%)] px-4 py-3 text-warning-foreground shadow-lg backdrop-blur supports-backdrop-filter:bg-[color-mix(in_oklab,var(--card)_72%,var(--warning)_28%)]">
                <AlertTriangle
                  className="auto-assign-warning__icon h-4 w-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="auto-assign-warning__title">Auto-seat blocked</p>
                  <p className="auto-assign-warning__message">{autoAssignWarning}</p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="auto-assign-warning__dismiss"
                  onClick={() => setAutoAssignWarning(null)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {showWarnings && (
            <div className="px-4 pb-2">
              <Alert className="max-h-32 overflow-y-auto" variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Data issues</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Sidebar
              onAddGuest={handleAddGuest}
              onEditGuest={handleEditGuest}
              onDeleteGuest={handleDeleteGuest}
            />
            <SidebarInset className="min-h-0 min-w-0 w-0">
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <TableBoard
                  activeDragKind={activeDragKind}
                  activeDragGuestId={activeDragGuestId}
                  autoSeatPreview={autoSeatPreview}
                  guestSwapPreview={guestSwapPreview}
                  tableSwapPreview={tableSwapPreview}
                  zoom={boardZoom}
                  activeOverId={activeOverId}
                  onEditGuest={handleEditGuest}
                  onDeleteGuest={handleDeleteGuest}
                  onEditTable={handleEditTable}
                  onDeleteTable={handleDeleteTable}
                  onBoardSettings={handleBoardSettings}
                />
              </div>

              <GuestDialog
                open={guestDialogState !== null}
                mode={guestDialogState?.mode ?? "create"}
                initialValues={guestDialogInitialValues}
                hostOptions={hostOptions}
                partyOptions={partyOptions}
                circleOptions={circleOptions}
                onClose={() => setGuestDialogState(null)}
                onSubmit={handleSubmitGuest}
              />

              <ConfirmDialog
                open={pendingDeleteGuestId !== null}
                title="Delete Guest"
                description={
                  deleteGuestRow
                    ? `${deleteGuestRow.fullName} will be removed from any assigned seat and from the unassigned list. Empty parties or circles will disappear automatically when no members remain.`
                    : "This guest will be removed from seating and the guest list."
                }
                confirmLabel="Delete Guest"
                onClose={() => setPendingDeleteGuestId(null)}
                onConfirm={handleConfirmDeleteGuest}
              />

              <TableDialog
                open={tableDialogState !== null}
                mode={tableDialogState?.mode ?? "create"}
                initialValues={tableDialogInitialValues}
                onClose={() => setTableDialogState(null)}
                onSubmit={handleSubmitTable}
              />

              <ConfirmDialog
                open={pendingDeleteTableNumber !== null}
                title="Delete Table"
                description={
                  pendingDeleteTable
                    ? `"${pendingDeleteTable.name}" will be removed. Any seated guests will move to the unassigned list.`
                    : "This table will be removed and its guests will be unassigned."
                }
                confirmLabel="Delete Table"
                onClose={() => setPendingDeleteTableNumber(null)}
                onConfirm={handleConfirmDeleteTable}
              />

              <BoardSettingsDialog
                open={boardSettingsOpen}
                currentBoard={state.board}
                onClose={() => setBoardSettingsOpen(false)}
                onSubmit={handleSubmitBoardSettings}
              />

              {dragOverlaySnapshot &&
                createPortal(
                  <div
                    ref={overlayRef}
                    className="pointer-events-none"
                    style={{
                      position: "fixed",
                      left: dragOverlaySnapshot.left,
                      top: dragOverlaySnapshot.top,
                      width: dragOverlaySnapshot.width,
                      height: dragOverlaySnapshot.height,
                      zIndex: 9999,
                      willChange: "transform",
                    }}>
                    <DragOverlayClone snapshot={dragOverlaySnapshot} />
                  </div>,
                  document.body
                )}
            </SidebarInset>
          </div>
        </div>
      </SidebarProvider>
    </DndContext>
  );
}

// ─── App (root) ───────────────────────────────────────────────────────────────

export default function App() {
  const initialGuestData = useMemo(() => getInitialGuestData(), []);
  const [guestRows, setGuestRows] = useState<GuestInputRow[]>(initialGuestData.guestRows);
  const [providerVersion, setProviderVersion] = useState(0);
  const [theme, setTheme] = useState<AppTheme>(() => resolvePreferredTheme());
  const parsedData = useMemo(() => parseGuestsFromRows(guestRows), [guestRows]);
  const sourceSignature = getGuestSourceSignature();

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveGuestDataSourceSignature(sourceSignature);
    savePersistedGuestData(guestRows);
  }, [guestRows, sourceSignature]);

  const handleImportSnapshot = useCallback(
    (nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) => {
      saveGuestDataSourceSignature(sourceSignature);
      savePersistedGuestData(nextGuestRows);
      savePersistedSeating(snapshot.state, snapshot.history, snapshot.future);
      setGuestRows(nextGuestRows);
      setProviderVersion((value) => value + 1);
    },
    [sourceSignature]
  );

  const handleResetApp = useCallback(() => {
    clearPersistedAppState();
    setGuestRows([]);
    setProviderVersion((value) => value + 1);
  }, []);

  return (
    <SearchProvider>
      <SeatingProvider key={providerVersion} parsedData={parsedData}>
        <SeatingApp
          guestRows={guestRows}
          onGuestRowsChange={setGuestRows}
          onImportSnapshot={handleImportSnapshot}
          onReset={handleResetApp}
          theme={theme}
          onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        />
      </SeatingProvider>
    </SearchProvider>
  );
}
