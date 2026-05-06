/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";
import { getGuestSourceSignature } from "../src/data/parseGuests";
import {
  EXPORT_FORMAT_VERSION,
  GUEST_DATA_SOURCE_KEY,
  GUEST_DATA_STORAGE_KEY,
  STORAGE_KEY,
  type GuestInputRow,
} from "../src/types";

vi.mock("@dnd-kit/core", async () => {
  const ReactLib = await import("react");

  return {
    DndContext: (props: { children: React.ReactNode }) =>
      ReactLib.createElement("div", { "data-testid": "dnd-context" }, props.children),
    DragOverlay: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({
      setNodeRef: () => {},
      isOver: false,
    }),
    useSensor: () => ({}),
    useSensors: (...sensors: unknown[]) => sensors,
    pointerWithin: () => [],
    closestCenter: () => [],
    PointerSensor: function PointerSensor() {},
    TouchSensor: function TouchSensor() {},
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const ReactLib = await import("react");

  return {
    SortableContext: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

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

function makeRows(names: string[]): GuestInputRow[] {
  return names.map((name, index) => ({
    id: `g${index}`,
    fullName: name,
    host: "Host",
    party: `Party ${index + 1}`,
    circle: "",
  }));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("import and persistence normalization", () => {
  it("normalizes malformed table payloads during JSON import", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify([]));

    render(<App />);

    const payload = {
      version: EXPORT_FORMAT_VERSION,
      guests: makeRows(["Alex", "Blair"]),
      board: {
        rows: 5,
        columns: 5,
        newTableDefaults: {
          labelPrefix: "Table",
          shape: "round",
          roundSeatCount: 10,
          rectangularSideCounts: { top: 3, right: 1, bottom: 3, left: 1 },
        },
      },
      tables: [
        {
          id: "table-1",
          tableNumber: 1,
          name: "Table 1",
          shape: "round",
          gridPosition: { row: 99, column: 99 },
          seatConfig: { shape: "round", seatCount: 4 },
          guestIds: ["g0", null, null, null, "g1", null],
          disabledSeats: [0, 5, 99],
        },
      ],
    };

    const input = screen.getByLabelText(/import seating json or csv file/i);
    const file = new File([JSON.stringify(payload)], "seating.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const storedGuests = localStorage.getItem(GUEST_DATA_STORAGE_KEY);
      expect(storedGuests).toContain("Alex");
    });

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as {
        state: {
          tables: Array<{
            tableNumber: number;
            presetId: string;
            gridPosition: { row: number; column: number };
            guestIds: Array<string | null>;
            disabledSeats?: number[];
          }>;
        };
      };

      const importedTable = persisted.state.tables.find((table) => table.tableNumber === 1);
      expect(importedTable).toBeDefined();
      expect(importedTable?.gridPosition).toEqual({ row: 0, column: 0 });
      expect(importedTable?.guestIds).toHaveLength(4);
      expect(importedTable?.disabledSeats ?? []).toEqual([]);
      expect(importedTable?.presetId).toBe("round-36");
    });

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("rejects non-preset table payloads during JSON import", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify([]));

    render(<App />);

    const payload = {
      version: EXPORT_FORMAT_VERSION,
      guests: makeRows(["Alex"]),
      board: {
        rows: 5,
        columns: 5,
        newTableDefaults: {
          labelPrefix: "Table",
          shape: "round",
          roundSeatCount: 10,
          rectangularSideCounts: { top: 3, right: 1, bottom: 3, left: 1 },
        },
      },
      tables: [
        {
          id: "table-1",
          tableNumber: 1,
          name: "Table 1",
          shape: "round",
          gridPosition: { row: 0, column: 0 },
          seatConfig: { shape: "round", seatCount: 5 },
          guestIds: [null, null, null, null, null],
          disabledSeats: [],
        },
      ],
    };

    const input = screen.getByLabelText(/import seating json or csv file/i);
    const file = new File([JSON.stringify(payload)], "seating.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("loads and preserves custom board plus mixed-shape tables on reload", async () => {
    const guestRows = makeRows(["Alex", "Blair", "Casey"]);
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(guestRows));

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          board: {
            rows: 3,
            columns: 3,
            newTableDefaults: {
              labelPrefix: "Table",
              presetId: "round-60",
              shape: "round",
              roundSeatCount: 10,
              rectangularSideCounts: { top: 3, right: 1, bottom: 3, left: 1 },
            },
          },
          tables: [
            {
              id: "table-1",
              tableNumber: 1,
              name: "Table 1",
              presetId: "round-48",
              shape: "round",
              gridPosition: { row: 0, column: 0 },
              seatConfig: { shape: "round", seatCount: 6 },
              guestIds: ["g0", null, null, null, null, null],
              disabledSeats: [],
            },
            {
              id: "table-2",
              tableNumber: 2,
              name: "Table 2",
              presetId: "rect-6",
              shape: "rectangular",
              gridPosition: { row: 0, column: 1 },
              seatConfig: {
                shape: "rectangular",
                sideCounts: { top: 3, right: 1, bottom: 3, left: 1 },
              },
              guestIds: ["g1", "g2", null, null, null, null, null, null],
              disabledSeats: [],
            },
          ],
          unassigned: [],
          lockedGuestIds: [],
        },
        history: [],
        future: [],
      })
    );

    render(<App />);

    await screen.findByText("Table 1");
    await screen.findByText("Table 2");

    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      const persisted = JSON.parse(stored as string) as {
        state: {
          board: { rows: number; columns: number; newTableDefaults: { presetId: string } };
          tables: Array<{ shape: string; presetId: string }>;
        };
      };
      expect(persisted.state.board.rows).toBe(3);
      expect(persisted.state.board.columns).toBe(3);
      expect(persisted.state.board.newTableDefaults.presetId).toBe("round-60");
      expect(persisted.state.tables.some((table) => table.shape === "round")).toBe(true);
      expect(persisted.state.tables.some((table) => table.shape === "rectangular")).toBe(true);
      expect(persisted.state.tables.some((table) => table.presetId === "round-48")).toBe(true);
      expect(persisted.state.tables.some((table) => table.presetId === "rect-6")).toBe(true);
    });
  });
});
