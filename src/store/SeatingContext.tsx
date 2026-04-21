import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type { PersistedSeatingData, SeatingState } from "../types";
import { TABLE_CAPACITY } from "../types";
import { seatingReducer, createInitialState, type SeatingAction } from "./reducer";
import {
  isCompatibleState,
  loadPersistedSeating,
  MAX_UNDO_HISTORY,
  savePersistedSeating,
} from "./localStorage";
import type { GuestProfile } from "./reducer";
import type { ParsedData } from "../data/parseGuests";

function buildGuestProfiles(
  guests: ParsedData["guests"],
  parties: ParsedData["parties"]
): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};

  for (const [guestId, guest] of guests) {
    const party = parties.get(guest.partyId);

    profiles[guestId] = {
      partyId: guest.partyId,
      group: guest.group || "",
      host: guest.host,
      household: party?.household ?? "",
    };
  }

  return profiles;
}

interface SeatingContextValue {
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
  selectedGuestId: string | null;
  selectGuest: (guestId: string) => void;
  clearSelectedGuest: () => void;
  relatedHouseholdGuestIds: Set<string>;
  relatedGroupGuestIds: Set<string>;
  autoAssignGuestIds: (guestIds: string[]) => void;
}

interface HistoryState {
  present: SeatingState;
  history: SeatingState[];
  future: SeatingState[];
}

type HistoryAction =
  | { type: "APPLY_ACTION"; action: SeatingAction }
  | { type: "UNDO" }
  | { type: "REDO" };

function areSeatArraysEqual(left: Array<string | null>, right: Array<string | null>): boolean {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function isSeatValue(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function normalizeSeatSlots(values: unknown): Array<string | null> | null {
  if (!Array.isArray(values) || values.length > TABLE_CAPACITY) return null;
  if (!values.every(isSeatValue)) return null;

  const seatSlots = values.slice(0, TABLE_CAPACITY) as Array<string | null>;
  return [
    ...seatSlots,
    ...Array<string | null>(Math.max(0, TABLE_CAPACITY - seatSlots.length)).fill(null),
  ];
}

function normalizeSeatingState(state: SeatingState): SeatingState | null {
  if (!Array.isArray(state.tables) || !Array.isArray(state.unassigned)) return null;

  const normalizedTables = state.tables.map((table) => {
    const seatSlots = normalizeSeatSlots(table.guestIds);
    if (!seatSlots) return null;

    return {
      ...table,
      guestIds: seatSlots,
    };
  });

  if (normalizedTables.some((table) => table === null)) {
    return null;
  }

  return {
    ...state,
    tables: normalizedTables as SeatingState["tables"],
    lockedGuestIds: Array.isArray(state.lockedGuestIds)
      ? (state.lockedGuestIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  };
}

function areSeatingStatesEqual(left: SeatingState, right: SeatingState): boolean {
  if (left === right) return true;

  if (left.tables.length !== right.tables.length) return false;
  if (!areSeatArraysEqual(left.unassigned, right.unassigned)) return false;

  return left.tables.every((table, index) => {
    const other = right.tables[index];

    return (
      table.tableNumber === other.tableNumber &&
      table.name === other.name &&
      areSeatArraysEqual(table.guestIds, other.guestIds)
    );
  }) && areSeatArraysEqual(
    [...(left.lockedGuestIds ?? [])].sort(),
    [...(right.lockedGuestIds ?? [])].sort()
  );
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

const SeatingContext = createContext<SeatingContextValue | null>(null);

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

  useEffect(() => {
    savePersistedSeating(historyState.present, historyState.history, historyState.future);
  }, [historyState.future, historyState.history, historyState.present]);

  useEffect(() => {
    if (selectedGuestId && !guests.has(selectedGuestId)) {
      setSelectedGuestId(null);
    }
  }, [guests, selectedGuestId]);

  const selectedGuest = useMemo(
    () => (selectedGuestId ? (guests.get(selectedGuestId) ?? null) : null),
    [guests, selectedGuestId]
  );

  const relatedHouseholdGuestIds = useMemo(() => {
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

  const relatedGroupGuestIds = useMemo(() => {
    if (!selectedGuest) return new Set<string>();

    const relatedIds = new Set<string>();
    for (const guest of guests.values()) {
      if (guest.id === selectedGuest.id) continue;
      if (guest.group === selectedGuest.group) {
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

  return (
    <SeatingContext.Provider
      value={{
        state: historyState.present,
        snapshot,
        dispatch,
        undo,
        redo,
        canUndo: historyState.history.length > 0,
        canRedo: historyState.future.length > 0,
        guests,
        parties,
        allGuestIds,
        warnings,
        selectedGuestId,
        selectGuest,
        clearSelectedGuest,
        relatedHouseholdGuestIds,
        relatedGroupGuestIds,
        autoAssignGuestIds,
      }}>
      {children}
    </SeatingContext.Provider>
  );
}

export function useSeating(): SeatingContextValue {
  const ctx = useContext(SeatingContext);
  if (!ctx) throw new Error("useSeating must be used within SeatingProvider");
  return ctx;
}
