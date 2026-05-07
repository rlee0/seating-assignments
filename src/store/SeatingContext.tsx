import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { BoardState, PersistedSeatingData, SeatingState, TableState } from "../types";
import {
  createDefaultBoardState,
  getDerivedTableConfigFromPresetId,
  getTableSeatCount,
  isTablePresetId,
  resolvePersistedTablePresetId,
} from "../types";
import { seatingReducer, createInitialState, type SeatingAction } from "./reducer";
import {
  isCompatibleState,
  loadPersistedSeating,
  MAX_UNDO_HISTORY,
  reconcileStateToGuestIds,
  savePersistedSeating,
} from "./localStorage";
import type { GuestProfile } from "./reducer";
import type { ParsedData } from "../data/parseGuests";
import {
  assignTokenSlots,
  createHighlightPalettes,
  type HighlightDomain,
  type PaletteSlot,
} from "../lib/palette";

function buildGuestProfiles(
  guests: ParsedData["guests"],
  parties: ParsedData["parties"]
): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};

  for (const [guestId, guest] of guests) {
    const party = parties.get(guest.partyId);

    profiles[guestId] = {
      partyId: guest.partyId,
      circle: guest.circle || "",
      host: guest.host,
      party: party?.party ?? "",
    };
  }

  return profiles;
}

interface SeatingDataValue {
  state: SeatingState;
  snapshot: PersistedSeatingData;
  dispatch: React.Dispatch<SeatingAction>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  guests: ParsedData["guests"];
  parties: ParsedData["parties"];
  allGuestIds: string[];
  warnings: string[];
  autoAssignGuestIds: (guestIds: string[]) => void;
  slotAssignments: Record<HighlightDomain, Map<string, PaletteSlot>>;
  guestProfiles: Record<string, GuestProfile>;
}

interface SeatingSelectionValue {
  selectedGuestId: string | null;
  selectGuest: (guestId: string) => void;
  clearSelectedGuest: () => void;
  relatedPartyGuestIds: Set<string>;
  relatedCircleGuestIds: Set<string>;
}

// Merged type kept for backward-compat (useSeating() consumers).
type SeatingContextValue = SeatingDataValue & SeatingSelectionValue;

interface HistoryState {
  present: SeatingState;
  history: SeatingState[];
  future: SeatingState[];
}

type HistoryAction =
  | { type: "APPLY_ACTION"; action: SeatingAction }
  | { type: "SYNC_GUEST_IDS"; allGuestIds: string[] }
  | { type: "UNDO" }
  | { type: "REDO" };

function areSeatArraysEqual(left: Array<string | null>, right: Array<string | null>): boolean {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function isSeatValue(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function normalizeBoardState(board: SeatingState["board"] | undefined): BoardState | null {
  const fallback = createDefaultBoardState();

  if (!board) return null;

  const rows = Number.isInteger(board.rows) && board.rows > 0 ? board.rows : fallback.rows;
  const columns =
    Number.isInteger(board.columns) && board.columns > 0 ? board.columns : fallback.columns;
  const labelPrefix =
    typeof board.newTableDefaults?.labelPrefix === "string" &&
    board.newTableDefaults.labelPrefix.trim().length > 0
      ? board.newTableDefaults.labelPrefix.trim()
      : fallback.newTableDefaults.labelPrefix;
  const derivedDefaults = (() => {
    if (isTablePresetId(board.newTableDefaults?.presetId)) {
      return getDerivedTableConfigFromPresetId(board.newTableDefaults.presetId);
    }

    const shape =
      board.newTableDefaults?.shape === "rectangular"
        ? "rectangular"
        : board.newTableDefaults?.shape === "round"
          ? "round"
          : null;
    if (!shape) return null;

    const roundSeatCount =
      Number.isInteger(board.newTableDefaults?.roundSeatCount) &&
      (board.newTableDefaults?.roundSeatCount ?? 0) > 0
        ? (board.newTableDefaults.roundSeatCount as number)
        : null;
    const rectangularSideCounts = board.newTableDefaults?.rectangularSideCounts;
    const seatConfig =
      shape === "rectangular"
        ? rectangularSideCounts &&
          Number.isInteger(rectangularSideCounts.top) &&
          Number.isInteger(rectangularSideCounts.right) &&
          Number.isInteger(rectangularSideCounts.bottom) &&
          Number.isInteger(rectangularSideCounts.left)
          ? {
              shape: "rectangular" as const,
              sideCounts: {
                top: rectangularSideCounts.top,
                right: rectangularSideCounts.right,
                bottom: rectangularSideCounts.bottom,
                left: rectangularSideCounts.left,
              },
            }
          : null
        : roundSeatCount !== null
          ? { shape: "round" as const, seatCount: roundSeatCount }
          : null;
    if (!seatConfig) return null;

    const presetId = resolvePersistedTablePresetId(
      board.newTableDefaults?.presetId,
      shape,
      seatConfig
    );
    return presetId ? getDerivedTableConfigFromPresetId(presetId) : null;
  })();

  if (!derivedDefaults) return null;

  return {
    rows,
    columns,
    newTableDefaults: {
      labelPrefix,
      presetId: derivedDefaults.presetId,
      shape: derivedDefaults.shape,
      roundSeatCount:
        derivedDefaults.seatConfig.shape === "round"
          ? derivedDefaults.seatConfig.seatCount
          : fallback.newTableDefaults.roundSeatCount,
      rectangularSideCounts: {
        top:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.top
            : fallback.newTableDefaults.rectangularSideCounts.top,
        right:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.right
            : fallback.newTableDefaults.rectangularSideCounts.right,
        bottom:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.bottom
            : fallback.newTableDefaults.rectangularSideCounts.bottom,
        left:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.left
            : fallback.newTableDefaults.rectangularSideCounts.left,
      },
    },
  };
}

function normalizeTableState(
  table: TableState,
  tableIndex: number,
  board: BoardState
): TableState | null {
  const shape = table.shape === "rectangular" ? "rectangular" : "round";
  const rawSeatConfig =
    table.seatConfig?.shape === "rectangular"
      ? Number.isInteger(table.seatConfig.sideCounts?.top) &&
        Number.isInteger(table.seatConfig.sideCounts?.right) &&
        Number.isInteger(table.seatConfig.sideCounts?.bottom) &&
        Number.isInteger(table.seatConfig.sideCounts?.left)
        ? {
            shape: "rectangular" as const,
            sideCounts: {
              top: table.seatConfig.sideCounts.top,
              right: table.seatConfig.sideCounts.right,
              bottom: table.seatConfig.sideCounts.bottom,
              left: table.seatConfig.sideCounts.left,
            },
          }
        : null
      : Number.isInteger(table.seatConfig?.shape === "round" ? table.seatConfig.seatCount : null) &&
          (table.seatConfig?.shape === "round" ? table.seatConfig.seatCount : 0) > 0
        ? { shape: "round" as const, seatCount: table.seatConfig.seatCount }
        : null;
  if (!rawSeatConfig) {
    return null;
  }

  const presetId = resolvePersistedTablePresetId(table.presetId, shape, rawSeatConfig);
  if (!presetId) {
    return null;
  }

  const derivedTableConfig = getDerivedTableConfigFromPresetId(presetId);
  const expectedSeatCount = getTableSeatCount(derivedTableConfig.seatConfig);

  if (!Array.isArray(table.guestIds) || !table.guestIds.every(isSeatValue)) {
    return null;
  }

  const guestIds = [
    ...(table.guestIds.slice(0, expectedSeatCount) as Array<string | null>),
    ...Array<string | null>(Math.max(0, expectedSeatCount - table.guestIds.length)).fill(null),
  ];
  const row =
    Number.isInteger(table.gridPosition?.row) && (table.gridPosition?.row ?? -1) >= 0
      ? table.gridPosition.row
      : Math.floor(tableIndex / board.columns);
  const column =
    Number.isInteger(table.gridPosition?.column) && (table.gridPosition?.column ?? -1) >= 0
      ? table.gridPosition.column
      : tableIndex % board.columns;

  return {
    ...table,
    id:
      typeof table.id === "string" && table.id.length > 0 ? table.id : `table-${table.tableNumber}`,
    tableNumber: table.tableNumber,
    name:
      typeof table.name === "string" && table.name.length > 0
        ? table.name
        : `Table ${table.tableNumber}`,
    presetId: derivedTableConfig.presetId,
    shape: derivedTableConfig.shape,
    gridPosition: { row, column },
    seatConfig: derivedTableConfig.seatConfig,
    guestIds,
    disabledSeats: Array.isArray(table.disabledSeats)
      ? table.disabledSeats.filter(
          (seatIndex, index, source): seatIndex is number =>
            Number.isInteger(seatIndex) &&
            seatIndex >= 0 &&
            seatIndex < guestIds.length &&
            guestIds[seatIndex] === null &&
            source.indexOf(seatIndex) === index
        )
      : [],
  };
}

function normalizeSeatingState(state: SeatingState): SeatingState | null {
  if (!Array.isArray(state.tables) || !Array.isArray(state.unassigned)) return null;
  const board = normalizeBoardState(state.board);
  if (!board) return null;

  const normalizedTables = state.tables.map((table, tableIndex) =>
    normalizeTableState(table, tableIndex, board)
  );

  if (normalizedTables.some((table) => table === null)) {
    return null;
  }

  return {
    ...state,
    board,
    tables: normalizedTables as SeatingState["tables"],
  };
}

function areSeatingStatesEqual(left: SeatingState, right: SeatingState): boolean {
  if (left === right) return true;

  if (left.board.rows !== right.board.rows || left.board.columns !== right.board.columns) {
    return false;
  }

  if (
    left.board.newTableDefaults.labelPrefix !== right.board.newTableDefaults.labelPrefix ||
    left.board.newTableDefaults.presetId !== right.board.newTableDefaults.presetId ||
    left.board.newTableDefaults.shape !== right.board.newTableDefaults.shape ||
    left.board.newTableDefaults.roundSeatCount !== right.board.newTableDefaults.roundSeatCount
  ) {
    return false;
  }

  if (left.tables.length !== right.tables.length) return false;
  if (!areSeatArraysEqual(left.unassigned, right.unassigned)) return false;

  return left.tables.every((table, index) => {
    const other = right.tables[index];

    const leftDisabled = [...(table.disabledSeats ?? [])].sort((a, b) => a - b);
    const rightDisabled = [...(other.disabledSeats ?? [])].sort((a, b) => a - b);

    return (
      table.id === other.id &&
      table.tableNumber === other.tableNumber &&
      table.name === other.name &&
      table.presetId === other.presetId &&
      table.shape === other.shape &&
      table.gridPosition.row === other.gridPosition.row &&
      table.gridPosition.column === other.gridPosition.column &&
      JSON.stringify(table.seatConfig) === JSON.stringify(other.seatConfig) &&
      areSeatArraysEqual(table.guestIds, other.guestIds) &&
      leftDisabled.length === rightDisabled.length &&
      leftDisabled.every((v, i) => v === rightDisabled[i])
    );
  });
}

function seatingHistoryReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "APPLY_ACTION": {
      const nextPresent = seatingReducer(state.present, action.action);

      if (areSeatingStatesEqual(state.present, nextPresent)) {
        return state;
      }

      return {
        present: nextPresent,
        history: [...state.history, state.present].slice(-MAX_UNDO_HISTORY),
        future: [],
      };
    }

    case "SYNC_GUEST_IDS": {
      const nextPresent = reconcileStateToGuestIds(state.present, action.allGuestIds);
      if (!nextPresent) {
        return state;
      }

      const nextHistory = state.history
        .map((snapshot) => reconcileStateToGuestIds(snapshot, action.allGuestIds))
        .filter((snapshot): snapshot is SeatingState => snapshot !== null);
      const nextFuture = state.future
        .map((snapshot) => reconcileStateToGuestIds(snapshot, action.allGuestIds))
        .filter((snapshot): snapshot is SeatingState => snapshot !== null);

      if (
        areSeatingStatesEqual(state.present, nextPresent) &&
        nextHistory.length === state.history.length &&
        nextHistory.every((snapshot, index) =>
          areSeatingStatesEqual(snapshot, state.history[index])
        ) &&
        nextFuture.length === state.future.length &&
        nextFuture.every((snapshot, index) => areSeatingStatesEqual(snapshot, state.future[index]))
      ) {
        return state;
      }

      return {
        present: nextPresent,
        history: nextHistory,
        future: nextFuture,
      };
    }

    case "UNDO": {
      if (state.history.length === 0) return state;

      return {
        present: state.history[state.history.length - 1],
        history: state.history.slice(0, -1),
        future: [state.present, ...state.future].slice(0, MAX_UNDO_HISTORY),
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;

      return {
        present: state.future[0],
        history: [...state.history, state.present].slice(-MAX_UNDO_HISTORY),
        future: state.future.slice(1),
      };
    }

    default:
      return state;
  }
}

const SeatingDataContext = createContext<SeatingDataValue | null>(null);
const SeatingSelectionContext = createContext<SeatingSelectionValue | null>(null);

export function SeatingProvider({
  children,
  parsedData,
}: {
  children: React.ReactNode;
  parsedData: ParsedData;
}) {
  const { guests, parties, allGuestIds, warnings } = parsedData;
  const defaultState = useMemo(() => createInitialState(allGuestIds), [allGuestIds]);
  const guestProfiles = useMemo(() => buildGuestProfiles(guests, parties), [guests, parties]);

  const domainCounts = useMemo(() => {
    const circleLabels = new Set<string>();
    const partyIds = new Set<string>();
    const hostLabels = new Set<string>();

    for (const profile of Object.values(guestProfiles)) {
      circleLabels.add(profile.circle || "No Circle");
      partyIds.add(profile.partyId);
      hostLabels.add(profile.host || "Unknown");
    }

    return {
      circle: Math.max(1, circleLabels.size),
      party: Math.max(1, partyIds.size),
      host: Math.max(1, hostLabels.size),
    };
  }, [guestProfiles]);

  const palettes = useMemo(
    () => createHighlightPalettes(domainCounts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domainCounts.circle, domainCounts.party, domainCounts.host]
  );

  const slotAssignments = useMemo(() => {
    const circleTokens: string[] = [];
    const partyTokens: string[] = [];
    const hostTokens: string[] = [];

    for (const profile of Object.values(guestProfiles)) {
      circleTokens.push(`circle:${profile.circle || "No Circle"}`);
      partyTokens.push(`party:${profile.partyId}`);
      hostTokens.push(`host:${profile.host || "Unknown"}`);
    }

    const circleAssignments = assignTokenSlots(circleTokens, palettes.circle);
    const partyAssignments = assignTokenSlots(partyTokens, palettes.party);
    const hostAssignments = assignTokenSlots(hostTokens, palettes.host);

    return {
      circle: circleAssignments,
      party: partyAssignments,
      host: hostAssignments,
      default: circleAssignments,
    } as Record<HighlightDomain, Map<string, PaletteSlot>>;
  }, [guestProfiles, palettes.circle, palettes.party, palettes.host]);

  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);

  const [historyState, historyDispatch] = useReducer(
    seatingHistoryReducer,
    { defaultState, allGuestIds },
    ({
      defaultState,
      allGuestIds,
    }: {
      defaultState: SeatingState;
      allGuestIds: string[];
    }): HistoryState => {
      const persisted = loadPersistedSeating();
      const normalizedState = persisted ? normalizeSeatingState(persisted.state) : null;
      const normalizedHistory =
        persisted?.history
          .map((snapshot) => normalizeSeatingState(snapshot))
          .filter((snapshot): snapshot is SeatingState => snapshot !== null) ?? [];

      if (!normalizedState || !isCompatibleState(normalizedState, allGuestIds)) {
        return { present: defaultState, history: [], future: [] };
      }

      const normalizedFuture =
        persisted?.future
          .map((snapshot) => normalizeSeatingState(snapshot))
          .filter((snapshot): snapshot is SeatingState => snapshot !== null) ?? [];

      return {
        present: normalizedState,
        history: normalizedHistory.filter((snapshot) => isCompatibleState(snapshot, allGuestIds)),
        future: normalizedFuture.filter((snapshot) => isCompatibleState(snapshot, allGuestIds)),
      };
    }
  );

  const snapshot = useMemo<PersistedSeatingData>(
    () => ({
      state: historyState.present,
      history: historyState.history,
      future: historyState.future,
    }),
    [historyState.present, historyState.history, historyState.future]
  );

  const dispatch: React.Dispatch<SeatingAction> = useCallback((action) => {
    historyDispatch({ type: "APPLY_ACTION", action });
  }, []);

  const autoAssignGuestIds = useCallback(
    (guestIds: string[]) => {
      dispatch({ type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles });
    },
    [dispatch, guestProfiles]
  );

  const undo = useCallback(() => {
    historyDispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    historyDispatch({ type: "REDO" });
  }, []);

  const saveTimerRef = useRef<number | null>(null);
  const historyRef = useRef(historyState);
  historyRef.current = historyState;

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      savePersistedSeating(historyState.present, historyState.history, historyState.future);
    }, 400);
  }, [historyState.future, historyState.history, historyState.present]);

  // Flush any pending save synchronously when the provider unmounts.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      const h = historyRef.current;
      savePersistedSeating(h.present, h.history, h.future);
    };
  }, []);

  useEffect(() => {
    historyDispatch({ type: "SYNC_GUEST_IDS", allGuestIds });
  }, [allGuestIds]);

  useEffect(() => {
    if (selectedGuestId && !guests.has(selectedGuestId)) {
      setSelectedGuestId(null);
    }
  }, [guests, selectedGuestId]);

  const selectedGuest = useMemo(
    () => (selectedGuestId ? (guests.get(selectedGuestId) ?? null) : null),
    [guests, selectedGuestId]
  );

  const relatedPartyGuestIds = useMemo(() => {
    if (!selectedGuest) return new Set<string>();

    const relatedIds = new Set<string>();
    for (const guest of guests.values()) {
      if (guest.id === selectedGuest.id) continue;
      if (guest.partyId === selectedGuest.partyId) {
        relatedIds.add(guest.id);
      }
    }

    return relatedIds;
  }, [guests, selectedGuest]);

  const relatedCircleGuestIds = useMemo(() => {
    if (!selectedGuest) return new Set<string>();

    const relatedIds = new Set<string>();
    for (const guest of guests.values()) {
      if (guest.id === selectedGuest.id) continue;
      if (guest.circle === selectedGuest.circle) {
        relatedIds.add(guest.id);
      }
    }

    return relatedIds;
  }, [guests, selectedGuest]);

  const selectGuest = useCallback((guestId: string) => {
    setSelectedGuestId(guestId);
  }, []);

  const clearSelectedGuest = useCallback(() => {
    setSelectedGuestId(null);
  }, []);

  const canUndo = historyState.history.length > 0;
  const canRedo = historyState.future.length > 0;

  const dataValue = useMemo<SeatingDataValue>(
    () => ({
      state: historyState.present,
      snapshot,
      dispatch,
      undo,
      redo,
      canUndo,
      canRedo,
      guests,
      parties,
      allGuestIds,
      warnings,
      autoAssignGuestIds,
      slotAssignments,
      guestProfiles,
    }),
    [
      historyState.present,
      snapshot,
      dispatch,
      undo,
      redo,
      canUndo,
      canRedo,
      guests,
      parties,
      allGuestIds,
      warnings,
      autoAssignGuestIds,
      slotAssignments,
      guestProfiles,
    ]
  );

  const selectionValue = useMemo<SeatingSelectionValue>(
    () => ({
      selectedGuestId,
      selectGuest,
      clearSelectedGuest,
      relatedPartyGuestIds,
      relatedCircleGuestIds,
    }),
    [selectedGuestId, selectGuest, clearSelectedGuest, relatedPartyGuestIds, relatedCircleGuestIds]
  );

  return (
    <SeatingDataContext.Provider value={dataValue}>
      <SeatingSelectionContext.Provider value={selectionValue}>
        {children}
      </SeatingSelectionContext.Provider>
    </SeatingDataContext.Provider>
  );
}

export function useSeatingData(): SeatingDataValue {
  const ctx = useContext(SeatingDataContext);
  if (!ctx) throw new Error("useSeatingData must be used within SeatingProvider");
  return ctx;
}

export function useSeatingSelection(): SeatingSelectionValue {
  const ctx = useContext(SeatingSelectionContext);
  if (!ctx) throw new Error("useSeatingSelection must be used within SeatingProvider");
  return ctx;
}

/** Merged hook — subscribes to both contexts. Use for components that need selection state. */
export function useSeating(): SeatingContextValue {
  const data = useSeatingData();
  const selection = useSeatingSelection();
  return { ...data, ...selection };
}
