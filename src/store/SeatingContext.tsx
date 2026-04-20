import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import type { PersistedSeatingData, SeatingState } from "../types";
import { TABLE_CAPACITY, TABLE_COUNT } from "../types";
import { seatingReducer, createInitialState, type SeatingAction } from "./reducer";
import { loadPersistedSeating, MAX_UNDO_HISTORY, savePersistedSeating } from "./localStorage";
import type { ParsedData } from "../data/parseGuests";

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
  });
}

function isCompatibleState(state: SeatingState, allGuestIds: string[]): boolean {
  const savedIds = [
    ...state.unassigned,
    ...state.tables.flatMap((table) =>
      table.guestIds.filter((guestId): guestId is string => guestId !== null)
    ),
  ];
  const uniqueSavedIds = new Set(savedIds);
  const currentIds = new Set(allGuestIds);

  return (
    state.tables.length === TABLE_COUNT &&
    savedIds.length === currentIds.size &&
    uniqueSavedIds.size === currentIds.size &&
    [...currentIds].every((id) => uniqueSavedIds.has(id))
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
  const defaultState = createInitialState(allGuestIds);

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

  const dispatch: React.Dispatch<SeatingAction> = useCallback((action) => {
    historyDispatch({ type: "APPLY_ACTION", action });
  }, []);

  const undo = useCallback(() => {
    historyDispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    historyDispatch({ type: "REDO" });
  }, []);

  useEffect(() => {
    savePersistedSeating(historyState.present, historyState.history, historyState.future);
  }, [historyState.future, historyState.history, historyState.present]);

  return (
    <SeatingContext.Provider
      value={{
        state: historyState.present,
        snapshot: {
          state: historyState.present,
          history: historyState.history,
          future: historyState.future,
        },
        dispatch,
        undo,
        redo,
        canUndo: historyState.history.length > 0,
        canRedo: historyState.future.length > 0,
        guests,
        parties,
        allGuestIds,
        warnings,
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
