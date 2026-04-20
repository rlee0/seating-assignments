import { STORAGE_KEY } from "../types";
import type { SeatingState } from "../types";

export const MAX_UNDO_HISTORY = 30;

export interface PersistedSeatingData {
  state: SeatingState;
  history: SeatingState[];
  future: SeatingState[];
}

function isSeatingState(value: unknown): value is SeatingState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    tables?: unknown;
    unassigned?: unknown;
  };

  return Array.isArray(candidate.tables) && Array.isArray(candidate.unassigned);
}

export function loadPersistedSeating(): PersistedSeatingData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;

    if (isSeatingState(parsed)) {
      return { state: parsed, history: [], future: [] };
    }

    if (parsed && typeof parsed === "object") {
      const candidate = parsed as {
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
