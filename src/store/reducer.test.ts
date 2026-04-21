import { describe, it, expect } from "vitest";
import { seatingReducer, createInitialState, type GuestProfile } from "./reducer";
import { TABLE_CAPACITY, TABLE_COUNT } from "../types";
import type { SeatingState } from "../types";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeProfiles(
  guests: Array<{
    id: string;
    partyId: string;
    group?: string;
    host?: "Ryan" | "Stella";
    household?: string;
  }>
): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};
  for (const g of guests) {
    profiles[g.id] = {
      partyId: g.partyId,
      group: g.group ?? "Group A",
      host: g.host ?? "Ryan",
      household: g.household ?? g.partyId,
    };
  }
  return profiles;
}

function autoAssign(
  state: SeatingState,
  guestIds: string[],
  profiles: Record<string, GuestProfile>
): SeatingState {
  return seatingReducer(state, { type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles: profiles });
}

function seatedIds(state: SeatingState): string[] {
  return state.tables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null));
}

function seatsAt(state: SeatingState, tableNumber: number): Array<string | null> {
  return state.tables.find((t) => t.tableNumber === tableNumber)?.guestIds ?? [];
}

// ─── Invariants ───────────────────────────────────────────────────────────────

describe("invariants", () => {
  it("never seats more than TABLE_CAPACITY guests per table", () => {
    const guestIds = Array.from({ length: TABLE_CAPACITY + 1 }, (_, i) => `g${i}`);
    const profiles = makeProfiles(guestIds.map((id) => ({ id, partyId: id })));
    const state = createInitialState(guestIds);
    const result = autoAssign(state, guestIds, profiles);

    for (const table of result.tables) {
      const count = table.guestIds.filter(Boolean).length;
      expect(count).toBeLessThanOrEqual(TABLE_CAPACITY);
    }
  });

  it("never seats the same guest twice", () => {
    const guestIds = ["g1", "g2", "g3", "g4"];
    const profiles = makeProfiles(guestIds.map((id) => ({ id, partyId: id })));
    const state = createInitialState(guestIds);
    const result = autoAssign(state, guestIds, profiles);

    const seated = seatedIds(result);
    expect(new Set(seated).size).toBe(seated.length);
  });

  it("removes auto-assigned guests from the unassigned list", () => {
    const guestIds = ["g1", "g2", "g3"];
    const profiles = makeProfiles(guestIds.map((id) => ({ id, partyId: id })));
    const state = createInitialState(guestIds);
    const result = autoAssign(state, guestIds, profiles);

    for (const id of guestIds) {
      expect(result.unassigned).not.toContain(id);
    }
  });

  it("returns original state unchanged when there are no open seats", () => {
    // Fill every seat across all tables
    const totalSeats = TABLE_COUNT * TABLE_CAPACITY;
    const guestIds = Array.from({ length: totalSeats }, (_, i) => `g${i}`);
    const profiles = makeProfiles(guestIds.map((id) => ({ id, partyId: id, group: id })));
    const state = createInitialState(guestIds);
    const filled = autoAssign(state, guestIds, profiles);

    // Verify all seats are occupied before the extra guest attempt
    const openSeats = filled.tables.reduce(
      (n, t) => n + t.guestIds.filter((id) => id === null).length,
      0
    );
    expect(openSeats).toBe(0);

    // Trying to add one more guest must be a no-op
    const extra = "gExtra";
    const extraProfiles = {
      ...profiles,
      [extra]: { partyId: "pExtra", group: "G", host: "Ryan" as const, household: "pExtra" },
    };
    const result = autoAssign(filled, [extra], extraProfiles);
    expect(result.tables).toEqual(filled.tables);
  });
});

// ─── Household hard constraint ────────────────────────────────────────────────

describe("household hard constraint", () => {
  it("keeps all household members on the same table when seats are available", () => {
    const household = ["g1", "g2", "g3"];
    const solo = ["g4", "g5"];
    const allIds = [...household, ...solo];
    const profiles = makeProfiles([
      ...household.map((id) => ({ id, partyId: "p1" })),
      ...solo.map((id) => ({ id, partyId: id })),
    ]);

    const state = createInitialState(allIds);
    const result = autoAssign(state, allIds, profiles);

    // Find which table g1 landed on
    const homeTable = result.tables.find((t) => t.guestIds.includes("g1"))!;
    expect(homeTable.guestIds).toContain("g2");
    expect(homeTable.guestIds).toContain("g3");
  });

  it("does not scatter household members as singles when the whole party fits on one table", () => {
    const household = ["g1", "g2", "g3", "g4", "g5"];
    const profiles = makeProfiles(household.map((id) => ({ id, partyId: "p1" })));
    const state = createInitialState(household);
    const result = autoAssign(state, household, profiles);

    // All 5 should be on the same table (capacity is 8)
    const tableWithG1 = result.tables.find((t) => t.guestIds.includes("g1"))!;
    for (const id of household) {
      expect(tableWithG1.guestIds).toContain(id);
    }
  });

  it("leaves an oversized household unassigned rather than splitting across tables", () => {
    const household = Array.from({ length: TABLE_CAPACITY + 1 }, (_, i) => `h${i + 1}`);
    const profiles = makeProfiles(household.map((id) => ({ id, partyId: "hh" })));
    const state = createInitialState(household);
    const result = autoAssign(state, household, profiles);

    const seatedHousehold = seatedIds(result).filter((id) => household.includes(id));
    expect(seatedHousehold.length).toBe(0);
    expect(result.unassigned).toEqual(expect.arrayContaining(household));
  });

  it("keeps household members adjacent when auto-seating", () => {
    const pair = ["h1", "h2"];
    const blockers = ["b1", "b2"];
    const all = [...pair, ...blockers];

    const profiles = makeProfiles([
      ...pair.map((id) => ({ id, partyId: "hh1", group: "Group A" })),
      ...blockers.map((id) => ({ id, partyId: id, group: "Group B" })),
    ]);

    let state = createInitialState(all);
    // Occupy seats 0 and 2 on table 1, leaving non-adjacent openings there.
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["b1"],
      seatIndex: 0,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["b2"],
      seatIndex: 2,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = autoAssign(state, pair, profiles);
    const homeTable = result.tables.find((t) => t.guestIds.includes("h1"))!;
    const h1Idx = homeTable.guestIds.indexOf("h1");
    const h2Idx = homeTable.guestIds.indexOf("h2");

    expect(homeTable.guestIds).toContain("h2");
    expect(Math.abs(h1Idx - h2Idx)).toBe(1);
  });
});

// ─── Host ratio targeting ─────────────────────────────────────────────────────

describe("host ratio targeting", () => {
  it("prefers a table that improves host balance when scores are otherwise equal", () => {
    // Table 1 has only Stella guests; Table 2 is empty.
    // Placing a Ryan guest should prefer Table 1 (improves ratio there).
    const stellaGuests = ["s1", "s2", "s3"];
    const allIds = [...stellaGuests, "r1"];
    const profiles = makeProfiles([
      ...stellaGuests.map((id) => ({ id, partyId: id, host: "Stella" as const, group: "G" })),
      { id: "r1", partyId: "r1", host: "Ryan", group: "G" },
    ]);

    // Manually seat Stella guests on table 1 so they exist as context
    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: stellaGuests,
      assignmentMode: "single-table",
    });

    // Auto-seat r1 — it should prefer table 1 (makes it less Stella-skewed) over empty tables
    const result = autoAssign(state, ["r1"], profiles);
    const table1Ids = seatsAt(result, 1).filter(Boolean);
    expect(table1Ids).toContain("r1");
  });
});

// ─── Regression: groups must not fragment unnecessarily ───────────────────────

describe("group cohesion regression", () => {
  it("seats a two-person same-group pair on the same table as existing group members", () => {
    // Three group-A guests already seated on table 1. Seat two more group-A guests.
    const seated = ["a1", "a2", "a3"];
    const incoming = ["a4", "a5"];
    const allIds = [...seated, ...incoming];
    const profiles = makeProfiles(allIds.map((id) => ({ id, partyId: id, group: "Group A" })));

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: seated,
      assignmentMode: "single-table",
    });

    const result = autoAssign(state, incoming, profiles);
    const table1Ids = seatsAt(result, 1).filter(Boolean);
    // Both incoming group-A members should prefer table 1 due to group affinity
    expect(table1Ids).toContain("a4");
    expect(table1Ids).toContain("a5");
  });

  it("does not split a same-household pair across different tables when one table has room", () => {
    const pair = ["p1", "p2"];
    const profiles = makeProfiles(pair.map((id) => ({ id, partyId: "household1" })));
    const state = createInitialState(pair);
    const result = autoAssign(state, pair, profiles);

    const homeTable = result.tables.find((t) => t.guestIds.includes("p1"))!;
    expect(homeTable.guestIds).toContain("p2");
  });

  it("moves the seated household together when manually reassigning one member", () => {
    const household = ["g1", "g2"];
    const profiles = makeProfiles(household.map((id) => ({ id, partyId: "hh1" })));

    let state = createInitialState(household);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: household,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["g1"],
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    expect(seatsAt(result, 1)).toEqual(Array(TABLE_CAPACITY).fill(null));
    expect(seatsAt(result, 2).slice(0, 2)).toEqual(["g1", "g2"]);
  });

  it("allows manual seat-specific override even when household adjacency would be violated", () => {
    const allIds = ["g1", "g2", "x1"];
    const profiles = makeProfiles([
      { id: "g1", partyId: "hh2" },
      { id: "g2", partyId: "hh2" },
      { id: "x1", partyId: "x1" },
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["x1"],
      seatIndex: 1,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g1"],
      seatIndex: 0,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g2"],
      seatIndex: 2,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    expect(seatsAt(result, 1).slice(0, 3)).toEqual(["g1", "x1", "g2"]);
  });
});

describe("anchoring behavior", () => {
  it("does not anchor guests automatically when manually assigned", () => {
    const state = createInitialState(["g1"]);

    const result = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g1"],
      assignmentMode: "single-table",
    });

    expect(result.lockedGuestIds).not.toContain("g1");
  });

  it("anchors and unanchors a guest explicitly", () => {
    const state = createInitialState(["g1"]);

    const anchored = seatingReducer(state, {
      type: "SET_GUEST_ANCHORED",
      guestId: "g1",
      anchored: true,
    });

    expect(anchored.lockedGuestIds).toContain("g1");

    const unanchored = seatingReducer(anchored, {
      type: "SET_GUEST_ANCHORED",
      guestId: "g1",
      anchored: false,
    });

    expect(unanchored.lockedGuestIds).not.toContain("g1");
  });
});

describe("targeted auto-assign", () => {
  it("seats a guest in the dropped table when target-only mode has space", () => {
    const profiles = makeProfiles([{ id: "g1", partyId: "p1" }]);
    const state = createInitialState(["g1"]);

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 3,
      targetScope: "target-only",
    });

    expect(seatsAt(result, 3).filter(Boolean)).toEqual(["g1"]);
    expect(result.unassigned).not.toContain("g1");
  });

  it("does nothing when target-only table has no available seat", () => {
    const blockers = Array.from({ length: TABLE_CAPACITY }, (_, i) => `b${i + 1}`);
    const allIds = [...blockers, "g1"];
    const profiles = makeProfiles([
      ...blockers.map((id) => ({ id, partyId: id })),
      { id: "g1", partyId: "p1" },
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: blockers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 1,
      targetScope: "target-only",
    });

    expect(result).toEqual(state);
  });

  it("can re-seat a dragged guest into a new target-only table", () => {
    const profiles = makeProfiles([{ id: "g1", partyId: "p1" }]);

    let state = createInitialState(["g1"]);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g1"],
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-only",
    });

    expect(seatsAt(result, 1).filter(Boolean)).toEqual([]);
    expect(seatsAt(result, 2).filter(Boolean)).toEqual(["g1"]);
  });

  it("uses adjacent tables in the same visual row for household placement", () => {
    const household = ["h1", "h2"];
    const blockers1 = Array.from({ length: TABLE_CAPACITY }, (_, i) => `l${i + 1}`);
    const blockers2 = Array.from({ length: TABLE_CAPACITY }, (_, i) => `t${i + 1}`);
    const allIds = [...household, ...blockers1, ...blockers2];
    const profiles = makeProfiles([
      ...household.map((id) => ({ id, partyId: "hh1", group: "Group HH" })),
      ...blockers1.map((id) => ({ id, partyId: id, group: "Blockers" })),
      ...blockers2.map((id) => ({ id, partyId: id, group: "Blockers" })),
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: blockers1,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: blockers2,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: household,
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 3).filter((id): id is string => id !== null)).toEqual(["h1", "h2"]);
  });

  it("uses adjacent tables in the same visual row for group placement", () => {
    const groupGuests = ["g1", "g2", "g3"];
    const blockers = Array.from({ length: TABLE_CAPACITY }, (_, i) => `x${i + 1}`);
    const allIds = [...groupGuests, ...blockers];
    const profiles = makeProfiles([
      ...groupGuests.map((id) => ({ id, partyId: id, group: "My Group" })),
      ...blockers.map((id) => ({ id, partyId: id, group: "Blockers" })),
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: blockers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: groupGuests,
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 1).filter((id): id is string => id !== null)).toEqual([
      "g1",
      "g2",
      "g3",
    ]);
  });

  it("prioritizes the hovered target table for group placement when it has space", () => {
    const groupGuests = ["g1", "g2", "g3"];
    const allIds = [...groupGuests, "b1", "b2", "b3", "b4", "b5"];
    const profiles = makeProfiles([
      ...groupGuests.map((id) => ({ id, partyId: id, group: "My Group" })),
      { id: "b1", partyId: "b1", group: "Blockers" },
      { id: "b2", partyId: "b2", group: "Blockers" },
      { id: "b3", partyId: "b3", group: "Blockers" },
      { id: "b4", partyId: "b4", group: "Blockers" },
      { id: "b5", partyId: "b5", group: "Blockers" },
    ]);

    let state = createInitialState(allIds);
    // Occupy tail seats so both table 1 and table 2 still have a viable 3-seat contiguous run.
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["b1", "b2"],
      seatIndex: 6,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["b3", "b4", "b5"],
      seatIndex: 5,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: groupGuests,
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 2).slice(0, 3)).toEqual(["g1", "g2", "g3"]);
  });

  it("fills the hovered table first before spilling a group into adjacent tables", () => {
    const groupGuests = ["a1", "a2", "a3", "b1", "b2"];
    const profiles = makeProfiles([
      { id: "a1", partyId: "hh-a", group: "My Group" },
      { id: "a2", partyId: "hh-a", group: "My Group" },
      { id: "a3", partyId: "hh-a", group: "My Group" },
      { id: "b1", partyId: "hh-b", group: "My Group" },
      { id: "b2", partyId: "hh-b", group: "My Group" },
      { id: "x1", partyId: "x1", group: "Blockers" },
      { id: "x2", partyId: "x2", group: "Blockers" },
      { id: "x3", partyId: "x3", group: "Blockers" },
    ]);

    let state = createInitialState([...groupGuests, "x1", "x2", "x3"]);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["x1", "x2", "x3"],
      seatIndex: 5,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: groupGuests,
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 2).slice(0, 5)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
    expect(seatsAt(result, 1).filter((id): id is string => id !== null)).toEqual([
      "x1",
      "x2",
      "x3",
    ]);
  });

  it("falls back to adjacent-row same-column tables when same-row placement is unavailable", () => {
    const household = ["h1", "h2"];
    const rowBlockers = Array.from({ length: TABLE_CAPACITY * 5 }, (_, i) => `r${i + 1}`);
    const allIds = [...household, ...rowBlockers];
    const profiles = makeProfiles([
      ...household.map((id) => ({ id, partyId: "hh1", group: "HH" })),
      ...rowBlockers.map((id) => ({ id, partyId: id, group: "Blockers" })),
    ]);

    let state = createInitialState(allIds);
    for (let tableNumber = 1; tableNumber <= 5; tableNumber += 1) {
      const start = (tableNumber - 1) * TABLE_CAPACITY;
      const blockers = rowBlockers.slice(start, start + TABLE_CAPACITY);
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber,
        guestIds: blockers,
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: household,
      guestProfiles: profiles,
      targetTableNumber: 3,
      targetScope: "target-and-adjacent",
    });

    // Table 8 is row 2, same column as table 3.
    expect(seatsAt(result, 8).filter((id): id is string => id !== null)).toEqual(["h1", "h2"]);
  });

  it("rejects introducing a lone group member on a different row", () => {
    const groupGuests = ["g1", "g2", "g3"];
    const blockers = Array.from({ length: 6 }, (_, i) => `b${i + 1}`);
    const allIds = [...groupGuests, ...blockers];
    const profiles = makeProfiles([
      ...groupGuests.map((id) => ({ id, partyId: id, group: "Group A" })),
      ...blockers.map((id) => ({ id, partyId: id, group: "Blockers" })),
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["g1", "g2", ...blockers],
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g3"],
      guestProfiles: profiles,
      targetTableNumber: 7,
      targetScope: "target-and-adjacent",
    });

    expect(result).toEqual(state);
    expect(result.unassigned).toContain("g3");
  });

  it("places a large group across corner target + adjacent-row table when no single row window fits", () => {
    // Target: table 5 (tableNumber=5, index=4, row=0, col=4 — rightmost corner of row 0)
    // Adjacent-row same-column: table 10 (tableNumber=10, index=9, row=1, col=4)
    //
    // Tables 1-4 are full and table 5 is half-full (4 open).
    // Tables 6-9 are full and table 10 is half-full (4 open).
    // Each row has only 4 contiguous open seats — below the group size of 8 —
    // so the fallback must spread across table 5 AND table 10.

    const hhA = ["a1", "a2", "a3", "a4"]; // household A → target table 5
    const hhB = ["b1", "b2", "b3", "b4"]; // household B → adjacent-row table 10

    const row0FullFillers = Array.from({ length: 4 * TABLE_CAPACITY }, (_, i) => `fr0_${i}`);
    const table5Fillers = ["t5f1", "t5f2", "t5f3", "t5f4"];
    const row1FullFillers = Array.from({ length: 4 * TABLE_CAPACITY }, (_, i) => `fr1_${i}`);
    const table10Fillers = ["t10f1", "t10f2", "t10f3", "t10f4"];

    const allFillers = [
      ...row0FullFillers,
      ...table5Fillers,
      ...row1FullFillers,
      ...table10Fillers,
    ];
    const allIds = [...hhA, ...hhB, ...allFillers];
    const profiles = makeProfiles([
      ...hhA.map((id) => ({ id, partyId: "hhA", group: "BigGroup" })),
      ...hhB.map((id) => ({ id, partyId: "hhB", group: "BigGroup" })),
      ...allFillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
    ]);

    let state = createInitialState(allIds);

    // Fill tables 1–4 completely.
    for (let col = 0; col < 4; col += 1) {
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber: col + 1,
        guestIds: row0FullFillers.slice(col * TABLE_CAPACITY, (col + 1) * TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }
    // Half-fill table 5 (4 open slots remain).
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 5,
      guestIds: table5Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    // Fill tables 6–9 completely.
    for (let col = 0; col < 4; col += 1) {
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber: col + 6,
        guestIds: row1FullFillers.slice(col * TABLE_CAPACITY, (col + 1) * TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }
    // Half-fill table 10 (4 open slots remain).
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 10,
      guestIds: table10Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    // Row 0: 4 open seats (table 5 only). Row 1: 4 open seats (table 10 only).
    // Both < 8 (group size) → main loop finds no options → fallback activates.
    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: [...hhA, ...hhB],
      guestProfiles: profiles,
      targetTableNumber: 5,
      targetScope: "target-and-adjacent",
    });

    // All BigGroup members must be placed.
    const placedSet = new Set(seatedIds(result));
    for (const id of [...hhA, ...hhB]) {
      expect(placedSet.has(id)).toBe(true);
    }
    expect(result.unassigned.filter((id) => [...hhA, ...hhB].includes(id))).toHaveLength(0);

    // Each household must land in its own table: hhA in table 5, hhB in table 10.
    const table5Seats = seatsAt(result, 5).filter((id): id is string => id !== null);
    const table10Seats = seatsAt(result, 10).filter((id): id is string => id !== null);
    for (const id of hhA) expect(table5Seats).toContain(id);
    for (const id of hhB) expect(table10Seats).toContain(id);
  });

  it("prefers adjacent-row same-column spill over a far same-row split", () => {
    const coreHousehold = ["c1", "c2", "c3", "c4"];
    const spillHousehold = ["v1", "v2"];
    const row0FullFillers = Array.from({ length: 3 * TABLE_CAPACITY }, (_, i) => `r0f_${i}`);
    const table2Fillers = ["t2f1", "t2f2", "t2f3", "t2f4", "t2f5", "t2f6"];
    const table4Fillers = ["t4f1", "t4f2", "t4f3", "t4f4"];
    const row1FullFillers = Array.from({ length: 4 * TABLE_CAPACITY }, (_, i) => `r1f_${i}`);
    const table9Fillers = ["t9f1", "t9f2", "t9f3", "t9f4", "t9f5", "t9f6"];

    const allIds = [
      ...coreHousehold,
      ...spillHousehold,
      ...row0FullFillers,
      ...table2Fillers,
      ...table4Fillers,
      ...row1FullFillers,
      ...table9Fillers,
    ];
    const profiles = makeProfiles([
      ...coreHousehold.map((id) => ({ id, partyId: "core", group: "Cathy Family" })),
      ...spillHousehold.map((id) => ({ id, partyId: "victor", group: "Cathy Family" })),
      ...row0FullFillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...table2Fillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...table4Fillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...row1FullFillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...table9Fillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
    ]);

    let state = createInitialState(allIds);

    // Row 0: tables 1, 3, and 5 are full. Table 2 has only 2 open seats.
    for (const tableNumber of [1, 3, 5]) {
      const start = [1, 3, 5].indexOf(tableNumber) * TABLE_CAPACITY;
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber,
        guestIds: row0FullFillers.slice(start, start + TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: table2Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 4,
      guestIds: table4Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    // Row 1: table 9 has 2 open seats in the same column as target table 4.
    for (const tableNumber of [6, 7, 8, 10]) {
      const start = [6, 7, 8, 10].indexOf(tableNumber) * TABLE_CAPACITY;
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber,
        guestIds: row1FullFillers.slice(start, start + TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 9,
      guestIds: table9Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: [...coreHousehold, ...spillHousehold],
      guestProfiles: profiles,
      targetTableNumber: 4,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 4).filter((id): id is string => id !== null)).toEqual([
      ...table4Fillers,
      ...coreHousehold,
    ]);
    expect(seatsAt(result, 9).filter((id): id is string => id !== null)).toEqual([
      ...table9Fillers,
      ...spillHousehold,
    ]);
    expect(seatsAt(result, 2)).not.toContain("v1");
    expect(seatsAt(result, 2)).not.toContain("v2");
  });

  it("leaves spill guests unassigned when only far same-row seats remain", () => {
    const coreHousehold = ["c1", "c2", "c3", "c4"];
    const spillHousehold = ["v1", "v2"];
    const row0FullFillers = Array.from({ length: 3 * TABLE_CAPACITY }, (_, i) => `r0only_${i}`);
    const table2Fillers = ["t2only1", "t2only2", "t2only3", "t2only4", "t2only5", "t2only6"];
    const table4Fillers = ["t4only1", "t4only2", "t4only3", "t4only4"];
    const row1FullFillers = Array.from({ length: 5 * TABLE_CAPACITY }, (_, i) => `r1only_${i}`);

    const allIds = [
      ...coreHousehold,
      ...spillHousehold,
      ...row0FullFillers,
      ...table2Fillers,
      ...table4Fillers,
      ...row1FullFillers,
    ];
    const profiles = makeProfiles([
      ...coreHousehold.map((id) => ({ id, partyId: "coreOnly", group: "Cathy Family" })),
      ...spillHousehold.map((id) => ({ id, partyId: "victorOnly", group: "Cathy Family" })),
      ...row0FullFillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...table2Fillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...table4Fillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
      ...row1FullFillers.map((id) => ({ id, partyId: id, group: "Fillers" })),
    ]);

    let state = createInitialState(allIds);

    for (const tableNumber of [1, 3, 5]) {
      const start = [1, 3, 5].indexOf(tableNumber) * TABLE_CAPACITY;
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber,
        guestIds: row0FullFillers.slice(start, start + TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: table2Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 4,
      guestIds: table4Fillers,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    for (let tableNumber = 6; tableNumber <= 10; tableNumber += 1) {
      const start = (tableNumber - 6) * TABLE_CAPACITY;
      state = seatingReducer(state, {
        type: "ASSIGN_GUESTS",
        tableNumber,
        guestIds: row1FullFillers.slice(start, start + TABLE_CAPACITY),
        assignmentMode: "single-table",
        guestProfiles: profiles,
      });
    }

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: [...coreHousehold, ...spillHousehold],
      guestProfiles: profiles,
      targetTableNumber: 4,
      targetScope: "target-and-adjacent",
    });

    expect(seatsAt(result, 4).filter((id): id is string => id !== null)).toEqual([
      ...table4Fillers,
      ...coreHousehold,
    ]);
    expect(seatsAt(result, 2)).not.toContain("v1");
    expect(seatsAt(result, 2)).not.toContain("v2");
    expect(result.unassigned).toEqual(expect.arrayContaining(spillHousehold));
  });
});

describe("group-overflow insertion", () => {
  it("inserts at the hovered seat instead of keeping the gap at a later empty seat", () => {
    const allIds = ["david", "brandon", "jarmin", "cameron", "newGuest"];
    const profiles = makeProfiles([
      { id: "david", partyId: "david", group: "Existing" },
      { id: "brandon", partyId: "brandon", group: "Existing" },
      { id: "jarmin", partyId: "jarmin", group: "Existing" },
      { id: "cameron", partyId: "cameron", group: "Existing" },
      { id: "newGuest", partyId: "newGuest", group: "Incoming" },
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["david", "brandon", "jarmin"],
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["cameron"],
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      seatIndex: 1,
      guestIds: ["newGuest"],
      assignmentMode: "group-overflow",
      guestProfiles: profiles,
    });

    expect(seatsAt(result, 1).slice(0, 5)).toEqual([
      "david",
      "newGuest",
      "brandon",
      "jarmin",
      "cameron",
    ]);
    expect(seatsAt(result, 2)[0]).toBe(null);
  });
});

describe("single-seat drag swap", () => {
  it("swaps two seated guests when dropping onto an occupied seat", () => {
    const allIds = ["g1", "g2"];
    const profiles = makeProfiles([
      { id: "g1", partyId: "p1", group: "Group A" },
      { id: "g2", partyId: "p2", group: "Group B" },
    ]);

    let state = createInitialState(allIds);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g1"],
      seatIndex: 0,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["g2"],
      seatIndex: 0,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    const result = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 2,
      guestIds: ["g1"],
      seatIndex: 0,
      assignmentMode: "single-table",
      guestProfiles: profiles,
    });

    expect(seatsAt(result, 2)[0]).toBe("g1");
    expect(seatsAt(result, 1)[0]).toBe("g2");
    expect(result.unassigned).toEqual([]);
  });
});

// ─── MOVE_TABLE (swap) ────────────────────────────────────────────────────────

describe("MOVE_TABLE swap semantics", () => {
  it("exchanges positions of exactly the two involved tables, leaving all others unchanged", () => {
    const guestIds = ["g1", "g2", "g3"];
    const state = createInitialState(guestIds);

    // Manually seat guests so we can distinguish table contents.
    const seatedState = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: ["g1"],
      assignmentMode: "single-table",
    });
    const seatedState2 = seatingReducer(seatedState, {
      type: "ASSIGN_GUESTS",
      tableNumber: 3,
      guestIds: ["g2"],
      assignmentMode: "single-table",
    });

    const before1 = seatedState2.tables.find((t) => t.tableNumber === 1)!.guestIds;
    const before3 = seatedState2.tables.find((t) => t.tableNumber === 3)!.guestIds;
    const before2 = seatedState2.tables.find((t) => t.tableNumber === 2)!.guestIds;

    const result = seatingReducer(seatedState2, {
      type: "MOVE_TABLE",
      activeTableNumber: 1,
      overTableNumber: 3,
    });

    // Table 1 and 3 swap grid positions (their entry moves in the array).
    const indexOfOriginal1 = result.tables.findIndex((t) => t.tableNumber === 1);
    const indexOfOriginal3 = result.tables.findIndex((t) => t.tableNumber === 3);
    const originalIndex1 = seatedState2.tables.findIndex((t) => t.tableNumber === 1);
    const originalIndex3 = seatedState2.tables.findIndex((t) => t.tableNumber === 3);

    expect(indexOfOriginal1).toBe(originalIndex3);
    expect(indexOfOriginal3).toBe(originalIndex1);

    // Table 2 (bystander) stays in its original array slot.
    const indexOfOriginal2 = result.tables.findIndex((t) => t.tableNumber === 2);
    const originalIndex2 = seatedState2.tables.findIndex((t) => t.tableNumber === 2);
    expect(indexOfOriginal2).toBe(originalIndex2);

    // Guest seating is preserved and travels with each table.
    expect(result.tables[indexOfOriginal1].guestIds).toEqual(before1);
    expect(result.tables[indexOfOriginal3].guestIds).toEqual(before3);
    expect(result.tables[indexOfOriginal2].guestIds).toEqual(before2);
  });

  it("is a no-op when the active and over table are the same", () => {
    const state = createInitialState(["g1"]);
    const result = seatingReducer(state, {
      type: "MOVE_TABLE",
      activeTableNumber: 2,
      overTableNumber: 2,
    });
    expect(result).toBe(state);
  });

  it("is symmetrical: swapping A→B then B→A returns the original order", () => {
    const state = createInitialState(["g1", "g2"]);
    const after = seatingReducer(state, {
      type: "MOVE_TABLE",
      activeTableNumber: 1,
      overTableNumber: 5,
    });
    const restored = seatingReducer(after, {
      type: "MOVE_TABLE",
      activeTableNumber: 1,
      overTableNumber: 5,
    });
    expect(restored.tables.map((t) => t.tableNumber)).toEqual(
      state.tables.map((t) => t.tableNumber)
    );
  });
});
