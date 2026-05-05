import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GUEST_DATA_SOURCE_KEY,
  GUEST_DATA_STORAGE_KEY,
  TABLE_COUNT,
  type SeatingState,
} from "../../src/types";
import { getGuestSourceSignature } from "../../src/data/parseGuests";
import { createInitialState } from "../../src/store/reducer";
import { loadPersistedGuestData, reconcileStateToGuestIds } from "../../src/store/localStorage";

function createStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
});

describe("reconcileStateToGuestIds", () => {
  it("enables occupied disabled seats during reconciliation", () => {
    const allGuestIds = ["g0", "g1"];
    const baseState = createInitialState(allGuestIds);

    const tables = baseState.tables.map((table) => ({ ...table, guestIds: [...table.guestIds] }));
    tables[0].guestIds[5] = "g0";
    tables[0].disabledSeats = [5, 7];

    const state: SeatingState = {
      board: baseState.board,
      tables,
      unassigned: [],
      lockedGuestIds: [],
    };

    const reconciled = reconcileStateToGuestIds(state, allGuestIds);

    expect(reconciled).not.toBeNull();
    expect(reconciled?.tables).toHaveLength(TABLE_COUNT);
    expect(reconciled?.tables[0].guestIds[5]).toBe("g0");
    expect(reconciled?.tables[0].disabledSeats).toEqual([7]);
    expect(reconciled?.unassigned).toEqual(["g1"]);
  });
});

describe("loadPersistedGuestData", () => {
  it("upgrades legacy guest rows without ids while preserving legacy g-index ids", () => {
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(
      GUEST_DATA_STORAGE_KEY,
      JSON.stringify([
        {
          fullName: "Alice",
          party: "Alpha",
          circle: "Ceremony",
          host: "Ryan",
        },
        {
          fullName: "Bob",
          party: "Beta",
          circle: "Reception",
          host: "Ryan",
        },
      ])
    );

    const loaded = loadPersistedGuestData(getGuestSourceSignature());

    expect(loaded?.rows.map((row) => row.id)).toEqual(["g0", "g1"]);
  });
});
