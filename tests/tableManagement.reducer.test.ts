import { describe, expect, it } from "vitest";

import { createInitialState, seatingReducer } from "../src/store/reducer";
import { getTableSeatCount } from "../src/types";

describe("table management reducer", () => {
  it("creates initial state with board metadata and positioned tables", () => {
    const state = createInitialState(["g1", "g2"]);

    expect(state.board.rows).toBe(5);
    expect(state.board.columns).toBe(5);
    expect(state.tables).toHaveLength(25);
    expect(state.tables[0]).toMatchObject({
      id: "table-1",
      tableNumber: 1,
      name: "Table 1",
      shape: "round",
      gridPosition: { row: 0, column: 0 },
    });
    expect(state.tables[24]).toMatchObject({
      id: "table-25",
      tableNumber: 25,
      gridPosition: { row: 4, column: 4 },
    });
    expect(state.unassigned).toEqual(["g1", "g2"]);
  });

  it("repacks tables and deletes overflow when shrinking the board", () => {
    const state = createInitialState([]);

    // Resize from 5×5 (25 tables) to 2×2 (4 tables)
    // Only the first 4 tables should remain, the other 21 should be deleted
    const nextState = seatingReducer(state, {
      type: "UPDATE_BOARD_CONFIG",
      updates: { rows: 2, columns: 2 },
    });

    expect(nextState.board.rows).toBe(2);
    expect(nextState.board.columns).toBe(2);
    expect(nextState.tables).toHaveLength(4);
    // Verify the remaining tables are the first 4 (in row-major order)
    expect(nextState.tables[0]).toMatchObject({
      tableNumber: 1,
      gridPosition: { row: 0, column: 0 },
    });
    expect(nextState.tables[1]).toMatchObject({
      tableNumber: 2,
      gridPosition: { row: 0, column: 1 },
    });
    expect(nextState.tables[2]).toMatchObject({
      tableNumber: 3,
      gridPosition: { row: 1, column: 0 },
    });
    expect(nextState.tables[3]).toMatchObject({
      tableNumber: 4,
      gridPosition: { row: 1, column: 1 },
    });
  });

  it("recovers seated guests from deleted overflow tables to unassigned", () => {
    const state = createInitialState(["g1", "g2", "g3", "g4"]);

    // Seat some guests at tables that will be deleted
    let seatedState = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 5,
      seatIndex: 0,
      guestIds: ["g1", "g2"],
      assignmentMode: "single-table",
      guestProfiles: {
        g1: { partyId: "p1", circle: "", host: "", party: "Party 1" },
        g2: { partyId: "p1", circle: "", host: "", party: "Party 1" },
        g3: { partyId: "p2", circle: "", host: "", party: "Party 2" },
        g4: { partyId: "p2", circle: "", host: "", party: "Party 2" },
      },
    });

    // Resize from 5×5 to 2×2
    // Table 5 should be deleted and g1, g2 should be returned to unassigned
    const nextState = seatingReducer(seatedState, {
      type: "UPDATE_BOARD_CONFIG",
      updates: { rows: 2, columns: 2 },
    });

    expect(nextState.tables).toHaveLength(4);
    expect(nextState.unassigned).toContain("g1");
    expect(nextState.unassigned).toContain("g2");
  });

  it("deletes a table and recreates one in the first open grid cell", () => {
    const initialState = createInitialState([]);
    const deletedState = seatingReducer(initialState, {
      type: "DELETE_TABLE",
      tableNumber: 1,
    });

    expect(deletedState.tables).toHaveLength(24);

    const recreatedState = seatingReducer(deletedState, {
      type: "CREATE_TABLE",
    });
    const createdTable = recreatedState.tables.find((table) => table.tableNumber === 26);

    expect(recreatedState.tables).toHaveLength(25);
    expect(createdTable).toMatchObject({
      tableNumber: 26,
      gridPosition: { row: 0, column: 0 },
      name: "Table 26",
      shape: "round",
    });
  });

  it("updates table seat configuration and moves displaced guests to unassigned", () => {
    const state = createInitialState([]);
    const seededState = {
      ...state,
      tables: state.tables.map((table) =>
        table.tableNumber === 1
          ? {
              ...table,
              guestIds: ["g1", "g2", "g3", "g4", "g5", "g6", null, null, null, null],
            }
          : table
      ),
      lockedGuestIds: ["g5"],
    };

    const nextState = seatingReducer(seededState, {
      type: "UPDATE_TABLE_CONFIG",
      tableNumber: 1,
      updates: {
        presetId: "round-36",
      },
    });

    const updatedTable = nextState.tables.find((table) => table.tableNumber === 1);

    expect(updatedTable).toBeDefined();
    expect(updatedTable?.presetId).toBe("round-36");
    expect(updatedTable?.shape).toBe("round");
    expect(updatedTable?.guestIds).toEqual(["g1", "g2", "g3", "g4"]);
    expect(getTableSeatCount(updatedTable!.seatConfig)).toBe(4);
    expect(nextState.unassigned).toEqual(expect.arrayContaining(["g5", "g6"]));
    expect(nextState.lockedGuestIds).not.toContain("g5");
  });

  it("applies updated king preset capacities as rectangular seat counts", () => {
    const state = createInitialState([]);

    const king6State = seatingReducer(state, {
      type: "UPDATE_TABLE_CONFIG",
      tableNumber: 1,
      updates: {
        presetId: "king-6",
      },
    });
    const king6Table = king6State.tables.find((table) => table.tableNumber === 1);

    expect(king6Table?.presetId).toBe("king-6");
    expect(king6Table?.shape).toBe("rectangular");
    expect(getTableSeatCount(king6Table!.seatConfig)).toBe(12);

    const king8State = seatingReducer(king6State, {
      type: "UPDATE_TABLE_CONFIG",
      tableNumber: 1,
      updates: {
        presetId: "king-8",
      },
    });
    const king8Table = king8State.tables.find((table) => table.tableNumber === 1);

    expect(king8Table?.presetId).toBe("king-8");
    expect(king8Table?.shape).toBe("rectangular");
    expect(getTableSeatCount(king8Table!.seatConfig)).toBe(16);
  });

  it("deleting a populated table unassigns its guests and unlocks them", () => {
    const state = createInitialState([]);
    const seededState = {
      ...state,
      tables: state.tables.map((table) =>
        table.tableNumber === 2
          ? {
              ...table,
              guestIds: ["g1", "g2", null, null, null, null, null, null],
            }
          : table
      ),
      lockedGuestIds: ["g1"],
    };

    const nextState = seatingReducer(seededState, {
      type: "DELETE_TABLE",
      tableNumber: 2,
    });

    expect(nextState.tables.some((table) => table.tableNumber === 2)).toBe(false);
    expect(nextState.unassigned).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(nextState.lockedGuestIds).toEqual([]);
  });

  it("moves a table to an empty grid cell", () => {
    const state = createInitialState([]);

    const nextState = seatingReducer(state, {
      type: "MOVE_TABLE_POSITION",
      activeTableNumber: 1,
      targetGridPosition: { row: 4, column: 4 },
    });

    const moved = nextState.tables.find((table) => table.tableNumber === 1);
    expect(moved?.gridPosition).toEqual({ row: 4, column: 4 });
  });

  it("swaps table positions when moving to an occupied cell", () => {
    const state = createInitialState([]);

    const nextState = seatingReducer(state, {
      type: "MOVE_TABLE_POSITION",
      activeTableNumber: 1,
      targetGridPosition: { row: 0, column: 1 },
    });

    const table1 = nextState.tables.find((table) => table.tableNumber === 1);
    const table2 = nextState.tables.find((table) => table.tableNumber === 2);
    expect(table1?.gridPosition).toEqual({ row: 0, column: 1 });
    expect(table2?.gridPosition).toEqual({ row: 0, column: 0 });
  });

  it("is a no-op when moving table to its current position", () => {
    const state = createInitialState([]);

    const nextState = seatingReducer(state, {
      type: "MOVE_TABLE_POSITION",
      activeTableNumber: 1,
      targetGridPosition: { row: 0, column: 0 },
    });

    expect(nextState).toBe(state);
  });

  it("rejects out-of-bounds target positions", () => {
    const state = createInitialState([]);

    const nextState = seatingReducer(state, {
      type: "MOVE_TABLE_POSITION",
      activeTableNumber: 1,
      targetGridPosition: { row: 99, column: 99 },
    });

    expect(nextState).toBe(state);
  });
});
