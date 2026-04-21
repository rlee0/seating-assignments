import { GUEST_DATA_SOURCE_KEY, GUEST_DATA_STORAGE_KEY, STORAGE_KEY, TABLE_COUNT } from "../types";
import type { GuestInputRow, PersistedSeatingData, SeatingState } from "../types";

export const MAX_UNDO_HISTORY = 100;

export function isGuestInputRow(value: unknown): value is GuestInputRow {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    host?: unknown;
    household?: unknown;
    group?: unknown;
    fullName?: unknown;
  };

  return (
    (candidate.host === "Ryan" || candidate.host === "Stella") &&
    typeof candidate.household === "string" &&
    typeof candidate.group === "string" &&
    typeof candidate.fullName === "string"
  );
}

export function isCompatibleState(state: SeatingState, allGuestIds: string[]): boolean {
  if (state.tables.length !== TABLE_COUNT) return false;

  const savedIds = [
    ...state.unassigned,
    ...state.tables.flatMap((table) =>
      table.guestIds.filter((guestId): guestId is string => guestId !== null)
    ),
  ];
  const uniqueSavedIds = new Set(savedIds);
  const currentIds = new Set(allGuestIds);

  return (
    savedIds.length === currentIds.size &&
    uniqueSavedIds.size === currentIds.size &&
    [...currentIds].every((id) => uniqueSavedIds.has(id))
  );
}

export function reconcileStateToGuestIds(
  state: SeatingState,
  allGuestIds: string[]
): SeatingState | null {
  if (state.tables.length !== TABLE_COUNT) return null;

  const allowedGuestIds = new Set(allGuestIds);
  const seenGuestIds = new Set<string>();

  const tables = state.tables.map((table) => ({
    ...table,
    guestIds: table.guestIds.map((guestId) => {
      if (guestId === null) return null;
      if (!allowedGuestIds.has(guestId) || seenGuestIds.has(guestId)) return null;

      seenGuestIds.add(guestId);
      return guestId;
    }),
  }));

  const unassigned = allGuestIds.filter((guestId) => !seenGuestIds.has(guestId));
  return {
    ...state,
    tables,
    unassigned,
  };
}

function isSeatingState(value: unknown): value is SeatingState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    tables?: unknown;
    unassigned?: unknown;
  };

  return Array.isArray(candidate.tables) && Array.isArray(candidate.unassigned);
}

export function parsePersistedSeatingData(value: unknown): PersistedSeatingData | null {
  if (isSeatingState(value)) {
    return { state: value, history: [], future: [] };
  }

  if (value && typeof value === "object") {
    const candidate = value as {
      state?: unknown;
      history?: unknown;
      future?: unknown;
    };

    if (
      isSeatingState(candidate.state) &&
      Array.isArray(candidate.history) &&
      candidate.history.every((snapshot) => isSeatingState(snapshot)) &&
      (candidate.future === undefined ||
        (Array.isArray(candidate.future) &&
          candidate.future.every((snapshot) => isSeatingState(snapshot))))
    ) {
      return {
        state: candidate.state,
        history: candidate.history.slice(-MAX_UNDO_HISTORY),
        future: Array.isArray(candidate.future) ? candidate.future.slice(-MAX_UNDO_HISTORY) : [],
      };
    }
  }

  return null;
}

export function loadPersistedGuestRows(sourceSignature: string): GuestInputRow[] | null {
  try {
    const savedSourceSignature = localStorage.getItem(GUEST_DATA_SOURCE_KEY);
    if (savedSourceSignature !== sourceSignature) {
      localStorage.removeItem(GUEST_DATA_STORAGE_KEY);
      localStorage.setItem(GUEST_DATA_SOURCE_KEY, sourceSignature);
      return null;
    }

    const raw = localStorage.getItem(GUEST_DATA_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((row) => isGuestInputRow(row))) {
      return null;
    }

    return parsed.map((row) => ({ ...row }));
  } catch {
    return null;
  }
}

export function savePersistedGuestRows(rows: GuestInputRow[]): void {
  try {
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Ignore quota errors silently
  }
}

export function saveGuestDataSourceSignature(sourceSignature: string): void {
  try {
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, sourceSignature);
  } catch {
    // Ignore quota errors silently
  }
}

export function loadPersistedSeating(): PersistedSeatingData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    return parsePersistedSeatingData(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function savePersistedSeating(
  state: SeatingState,
  history: SeatingState[],
  future: SeatingState[]
): void {
  try {
    const payload: PersistedSeatingData = {
      state,
      history: history.slice(-MAX_UNDO_HISTORY),
      future: future.slice(0, MAX_UNDO_HISTORY),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota errors silently
  }
}

export function clearPersistedAppState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GUEST_DATA_STORAGE_KEY);
    localStorage.removeItem(GUEST_DATA_SOURCE_KEY);
  } catch {
    // Ignore storage errors silently
  }
}
