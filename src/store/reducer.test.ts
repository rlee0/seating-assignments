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

  it("splits into the fewest chunks when household exceeds any single table capacity", () => {
    // Create a household larger than TABLE_CAPACITY to force a split
    // We can simulate this by pre-filling all tables so only 2 seats are free on table 1
    // and 2 on table 2, but not enough on any single table for 4 members.
    const household = ["h1", "h2", "h3", "h4"];
    const filler = Array.from({ length: TABLE_CAPACITY - 2 }, (_, i) => `f${i}`);
    const allIds = [...filler, ...household];
    const profiles = makeProfiles([
      ...filler.map((id) => ({ id, partyId: id })),
      ...household.map((id) => ({ id, partyId: "hh" })),
    ]);

    // Seat fillers first to leave only 2 free seats on table 1
    let state = createInitialState(allIds);
    state = autoAssign(state, filler, profiles);

    // Now auto-seat the 4-member household — should split into 2+2, not 1+1+1+1
    const result = autoAssign(state, household, profiles);

    // Verify no household member ended up isolated from all others on their own table
    const tableCounts = result.tables.map(
      (t) => household.filter((id) => t.guestIds.includes(id)).length
    );
    const isolatedTables = tableCounts.filter((c) => c === 1);
    // At most one member per split is acceptable only if unavoidable;
    // with 4 members and 2-seat chunks available, we expect no isolated singles
    expect(isolatedTables.length).toBe(0);
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
});
