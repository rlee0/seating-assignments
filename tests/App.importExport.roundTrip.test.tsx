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
    useDndContext: () => ({ over: null }),
    useSensor: () => ({}),
    useSensors: (...sensors: unknown[]) => sensors,
    pointerWithin: () => [],
    closestCenter: () => [],
    PointerSensor: function PointerSensor() {},
    TouchSensor: function TouchSensor() {},
    MeasuringStrategy: { Always: 0, BeforeDragging: 1, WhileDragging: 2 },
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

describe("CSV round-trip: table position and name", () => {
  it("preserves gridPosition and custom name through export → import", async () => {
    const guestRows = makeRows(["Alice"]);
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(guestRows));

    // Seed state: table 2 at a non-default position with a custom name, Alice seated at seat 0.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          board: {
            rows: 5,
            columns: 5,
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
              presetId: "round-60",
              shape: "round",
              gridPosition: { row: 0, column: 0 },
              seatConfig: { shape: "round", seatCount: 10 },
              guestIds: Array(10).fill(null),
              disabledSeats: [],
            },
            {
              id: "table-2",
              tableNumber: 2,
              name: "Head Table",
              presetId: "round-60",
              shape: "round",
              gridPosition: { row: 0, column: 4 },
              seatConfig: { shape: "round", seatCount: 10 },
              guestIds: ["g0", ...Array(9).fill(null)],
              disabledSeats: [],
            },
          ],
          unassigned: [],
        },
        history: [],
        future: [],
      })
    );

    // --- Export ---
    let exportedBlob: Blob | null = null;
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return "blob:mock";
    });
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { unmount } = render(<App />);
    await screen.findByText("Head Table");

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    // Wait for the blob to be captured
    await waitFor(() => expect(exportedBlob).not.toBeNull());

    const csvText = await exportedBlob!.text();
    const lines = csvText.split("\n");
    // Verify header contains new columns
    expect(lines[0]).toContain("Table Name");
    expect(lines[0]).toContain("Table Row");
    expect(lines[0]).toContain("Table Column");
    // Alice is at table 2, which is named "Head Table" at row 0, col 4
    const aliceLine = lines.find((l) => l.startsWith("Alice"));
    expect(aliceLine).toBeDefined();
    expect(aliceLine).toContain("Head Table");
    expect(aliceLine).toContain(",0,4");

    unmount();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();

    // --- Import the exported CSV back ---
    localStorage.clear();
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(guestRows));

    render(<App />);

    const importInput = screen.getByLabelText(/import seating json or csv file/i);
    const csvFile = new File([csvText], "seating-export.csv", { type: "text/csv" });
    fireEvent.change(importInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      const persisted = JSON.parse(stored as string) as {
        state: {
          tables: Array<{
            tableNumber: number;
            name: string;
            gridPosition: { row: number; column: number };
          }>;
        };
      };
      const table2 = persisted.state.tables.find((t) => t.tableNumber === 2);
      expect(table2).toBeDefined();
      expect(table2?.name).toBe("Head Table");
      expect(table2?.gridPosition).toEqual({ row: 0, column: 4 });
    });
  });
});

describe("CSV round-trip: extra columns", () => {
  it("preserves unknown columns through import then re-exports them", async () => {
    localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
    localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify([]));

    render(<App />);

    // A CSV with two extra columns: "Dietary Restrictions" and "Notes".
    const csvInput = [
      "Full Name,Host,Party,Circle,Dietary Restrictions,Notes",
      "Alice,Bob,Party A,Friends,Vegan,Seat near window",
      "Charlie,Bob,Party A,Friends,None,",
    ].join("\n");

    const importInput = screen.getByLabelText(/import seating json or csv file/i);
    const csvFile = new File([csvInput], "guests.csv", { type: "text/csv" });
    fireEvent.change(importInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      const storedGuests = localStorage.getItem(GUEST_DATA_STORAGE_KEY);
      expect(storedGuests).toContain("Alice");
    });

    // Verify extra fields are persisted in localStorage.
    const storedRaw = JSON.parse(localStorage.getItem(GUEST_DATA_STORAGE_KEY) as string) as {
      rows: Array<{ fullName: string; extraFields?: Record<string, string> }>;
    };
    const storedGuests = storedRaw.rows;
    const alice = storedGuests.find((g) => g.fullName === "Alice");
    expect(alice?.extraFields).toEqual({ "Dietary Restrictions": "Vegan", Notes: "Seat near window" });
    const charlie = storedGuests.find((g) => g.fullName === "Charlie");
    expect(charlie?.extraFields).toEqual({ "Dietary Restrictions": "None", Notes: "" });

    // Export and verify extra columns appear in the CSV.
    let exportedBlob: Blob | null = null;
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportedBlob).not.toBeNull());

    const exportedCsv = await exportedBlob!.text();
    const lines = exportedCsv.split("\n");

    // Header must include both extra columns after the standard ones.
    expect(lines[0]).toContain("Dietary Restrictions");
    expect(lines[0]).toContain("Notes");

    const aliceLine = lines.find((l) => l.startsWith("Alice"));
    expect(aliceLine).toContain("Vegan");
    expect(aliceLine).toContain("Seat near window");

    const charlieLine = lines.find((l) => l.startsWith("Charlie"));
    expect(charlieLine).toContain("None");

    createObjectURLSpy.mockRestore();
  });
});
