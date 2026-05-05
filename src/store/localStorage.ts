import {
  GUEST_DATA_SOURCE_KEY,
  GUEST_DATA_STORAGE_KEY,
  STORAGE_KEY,
  getTableSeatCount,
} from "../types";
import type {
  GuestInputRow,
  PersistedGuestData,
  PersistedSeatingData,
  SeatingState,
} from "../types";

import { normalizeGuestInputRows } from "../data/parseGuests";

export const MAX_UNDO_HISTORY = 100;
export const THEME_STORAGE_KEY = "seating-theme";
export const BOARD_ZOOM_STORAGE_KEY = "seating-board-zoom-v1";
export type AppTheme = "light" | "dark";

export function resolvePreferredTheme(): AppTheme {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Ignore storage errors and fall back to system preference.
  }

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors silently
  }
}

export function loadPersistedZoom(): number {
  try {
    const raw = localStorage.getItem(BOARD_ZOOM_STORAGE_KEY);
    if (!raw) return 1;

    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 1;
    if (parsed < 0.5 || parsed > 1.5) return 1;

    return parsed;
  } catch {
    return 1;
  }
}

export function saveZoom(zoom: number): void {
  try {
    localStorage.setItem(BOARD_ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // Ignore storage errors silently
  }
}

export function isGuestInputRow(value: unknown): value is GuestInputRow {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    id?: unknown;
    host?: unknown;
    party?: unknown;
    circle?: unknown;
    fullName?: unknown;
  };

  return (
    typeof candidate.id === "string" &&
    typeof candidate.host === "string" &&
    typeof candidate.party === "string" &&
    typeof candidate.circle === "string" &&
    typeof candidate.fullName === "string"
  );
}

export function isGuestInputRowLike(
  value: unknown
): value is Omit<GuestInputRow, "id"> & { id?: string } {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    id?: unknown;
    host?: unknown;
    party?: unknown;
    circle?: unknown;
    fullName?: unknown;
  };

  return (
    (candidate.id === undefined || typeof candidate.id === "string") &&
    typeof candidate.host === "string" &&
    typeof candidate.party === "string" &&
    typeof candidate.circle === "string" &&
    typeof candidate.fullName === "string"
  );
}

export function isCompatibleState(state: SeatingState, allGuestIds: string[]): boolean {
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
  const allowedGuestIds = new Set(allGuestIds);
  const seenGuestIds = new Set<string>();

  const tables = state.tables.map((table) => {
    const expectedSeatCount = getTableSeatCount(table.seatConfig);
    const normalizedGuestIds = [
      ...table.guestIds.slice(0, expectedSeatCount),
      ...Array<string | null>(Math.max(0, expectedSeatCount - table.guestIds.length)).fill(null),
    ];

    const guestIds = normalizedGuestIds.map((guestId) => {
      if (guestId === null) return null;
      if (!allowedGuestIds.has(guestId) || seenGuestIds.has(guestId)) return null;

      seenGuestIds.add(guestId);
      return guestId;
    });

    // Imported snapshots can contain disabled seats that still hold guests.
    // Normalize to keep occupied seats enabled so those guests stay visible.
    const disabledSeats = Array.isArray(table.disabledSeats)
      ? table.disabledSeats.filter(
          (seatIndex, index, source): seatIndex is number =>
            Number.isInteger(seatIndex) &&
            seatIndex >= 0 &&
            seatIndex < guestIds.length &&
            guestIds[seatIndex] === null &&
            source.indexOf(seatIndex) === index
        )
      : [];

    return {
      ...table,
      guestIds,
      disabledSeats,
    };
  });

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

export function loadPersistedGuestData(sourceSignature: string): PersistedGuestData | null {
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
    if (Array.isArray(parsed) && parsed.every((row) => isGuestInputRowLike(row))) {
      return {
        rows: normalizeGuestInputRows(parsed),
      };
    }

    const persistedRows =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
        ? (parsed as { rows: unknown[] }).rows
        : null;

    if (!persistedRows || !persistedRows.every((row) => isGuestInputRowLike(row))) {
      return null;
    }

    return {
      rows: normalizeGuestInputRows(persistedRows),
    };
  } catch {
    return null;
  }
}

export function savePersistedGuestData(rows: GuestInputRow[]): void {
  try {
    const payload: PersistedGuestData = {
      rows,
    };

    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(payload));
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
    localStorage.removeItem(BOARD_ZOOM_STORAGE_KEY);
  } catch {
    // Ignore storage errors silently
  }
}
