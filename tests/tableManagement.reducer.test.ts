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

  it("blocks shrinking the board when existing tables would fall out of bounds", () => {
    const state = createInitialState([]);

    const nextState = seatingReducer(state, {
      type: "UPDATE_BOARD_CONFIG",
      updates: { columns: 4 },
    });

    expect(nextState).toBe(state);
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
              guestIds: ["g1", "g2", "g3", null, null, null, null, null],
            }
          : table
      ),
      lockedGuestIds: ["g3"],
    };

    const nextState = seatingReducer(seededState, {
      type: "UPDATE_TABLE_CONFIG",
      tableNumber: 1,
      updates: {
        shape: "rectangular",
        seatConfig: {
          shape: "rectangular",
          sideCounts: { top: 1, right: 0, bottom: 1, left: 0 },
        },
      },
    });

    const updatedTable = nextState.tables.find((table) => table.tableNumber === 1);

    expect(updatedTable).toBeDefined();
    expect(updatedTable?.shape).toBe("rectangular");
    expect(updatedTable?.guestIds).toEqual(["g1", "g2"]);
    expect(getTableSeatCount(updatedTable!.seatConfig)).toBe(2);
    expect(nextState.unassigned).toContain("g3");
    expect(nextState.lockedGuestIds).not.toContain("g3");
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
