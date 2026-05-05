/* @vitest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { BOARD_ZOOM_STORAGE_KEY } from "../src/store/localStorage";
import { GUEST_DATA_SOURCE_KEY, GUEST_DATA_STORAGE_KEY, STORAGE_KEY } from "../src/types";
import { getGuestSourceSignature } from "../src/data/parseGuests";
import { createInitialState, seatingReducer, type GuestProfile } from "../src/store/reducer";
import type { GuestInputRow, SeatingState } from "../src/types";

// ─── dnd-kit mock ─────────────────────────────────────────────────────────────

let latestDndProps: {
  onDragEnd?: (event: unknown) => void;
  onDragMove?: (event: unknown) => void;
  onDragStart?: (event: unknown) => void;
  onDragCancel?: () => void;
  onDragOver?: (event: unknown) => void;
} | null = null;

vi.mock("@dnd-kit/core", async () => {
  const ReactLib = await import("react");

  return {
    DndContext: (props: {
      children: React.ReactNode;
      onDragEnd?: (event: unknown) => void;
      onDragMove?: (event: unknown) => void;
      onDragStart?: (event: unknown) => void;
      onDragCancel?: () => void;
      onDragOver?: (event: unknown) => void;
    }) => {
      latestDndProps = props;
      return ReactLib.createElement("div", { "data-testid": "dnd-context" }, props.children);
    },
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

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRows(
  specs: Array<{ name: string; party?: string; circle?: string; host?: string }>
): GuestInputRow[] {
  return specs.map((spec, index) => ({
    id: `g${index}`,
    fullName: spec.name,
    party: spec.party ?? `Party ${index + 1}`,
    circle: spec.circle ?? "",
    host: spec.host ?? "Ryan",
  }));
}

function makeProfiles(rows: GuestInputRow[]): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};

  rows.forEach((row) => {
    profiles[row.id] = {
      partyId: "",
      circle: row.circle,
      host: row.host,
      party: row.party,
    };
  });

  const partyNameToPartyId = new Map<string, string>();
  rows.forEach((row) => {
    if (!partyNameToPartyId.has(row.party)) {
      partyNameToPartyId.set(row.party, `p${partyNameToPartyId.size}`);
    }
    profiles[row.id].partyId = partyNameToPartyId.get(row.party)!;
  });

  return profiles;
}

function seedApp(guestRows: GuestInputRow[], state?: SeatingState): void {
  localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
  localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(guestRows));

  if (state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, history: [], future: [] }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getTableCard(container: HTMLElement, tableNumber: number): HTMLElement {
  const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-table-card]"));
  const card = cards.find(
    (c) =>
      c.querySelector<HTMLElement>("[data-table-name]")?.textContent?.trim() ===
      `Table ${tableNumber}`
  );
  if (!card) throw new Error(`Missing table card for table ${tableNumber}`);
  return card;
}

function getSeatGuestName(
  container: HTMLElement,
  tableNumber: number,
  seatIndex: number
): string | null {
  const card = getTableCard(container, tableNumber);
  const slots = Array.from(card.querySelectorAll<HTMLElement>("[data-seat-slot]"));
  const seat = slots[seatIndex];
  if (!seat) return null;
  return seat.querySelector<HTMLElement>("[data-guest-name]")?.textContent?.trim() ?? null;
}

function tableContainsGuest(
  container: HTMLElement,
  tableNumber: number,
  guestName: string
): boolean {
  return getTableCard(container, tableNumber).textContent?.includes(guestName) ?? false;
}

function findTableContainingGuest(container: HTMLElement, guestName: string): number | null {
  for (let n = 1; n <= 25; n++) {
    if (tableContainsGuest(container, n, guestName)) return n;
  }
  return null;
}

function sidebarContainsGuest(container: HTMLElement, guestName: string): boolean {
  const sidebar = container.querySelector<HTMLElement>("[data-sidebar]");
  if (!sidebar) return false;
  return sidebar.textContent?.includes(guestName) ?? false;
}

function getTableNameAtCell(container: HTMLElement, row: number, column: number): string | null {
  const cell = container.querySelector<HTMLElement>(`[data-board-cell-id='cell-${row}-${column}']`);
  if (!cell) return null;
  return cell.querySelector<HTMLElement>("[data-table-name]")?.textContent?.trim() ?? null;
}

function triggerDragStart(params: { id: string; data: unknown }): void {
  if (!latestDndProps?.onDragStart) throw new Error("DndContext onDragStart not available");
  act(() => {
    latestDndProps?.onDragStart?.({
      active: {
        id: params.id,
        data: { current: params.data },
        rect: { current: { translated: null, initial: null } },
      },
      activatorEvent: null,
    });
  });
}

function triggerDragCancel(): void {
  act(() => {
    latestDndProps?.onDragCancel?.();
  });
}

function triggerDragMove(params: {
  id: string;
  data: unknown;
  clientX: number;
  clientY: number;
}): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: params.clientX,
        clientY: params.clientY,
        bubbles: true,
      })
    );
  });
}

function triggerDragEnd(params: { id: string; data: unknown; overId: string | null }): void {
  if (!latestDndProps?.onDragEnd) throw new Error("DndContext onDragEnd not available");
  act(() => {
    latestDndProps?.onDragEnd?.({
      active: {
        id: params.id,
        data: { current: params.data },
        rect: { current: { translated: null, initial: null } },
      },
      over: params.overId ? { id: params.overId } : null,
    });
  });
}

function triggerDragOver(params: { id: string; data: unknown; overId: string | null }): void {
  if (!latestDndProps?.onDragOver) throw new Error("DndContext onDragOver not available");
  act(() => {
    latestDndProps?.onDragOver?.({
      active: {
        id: params.id,
        data: { current: params.data },
        rect: { current: { translated: null, initial: null } },
      },
      over: params.overId ? { id: params.overId } : null,
    });
  });
}

function assignSingle(
  state: SeatingState,
  tableNumber: number,
  guestId: string,
  seatIndex: number,
  profiles?: Record<string, GuestProfile>
): SeatingState {
  return seatingReducer(state, {
    type: "ASSIGN_GUESTS",
    tableNumber,
    guestIds: [guestId],
    seatIndex,
    assignmentMode: "single-table",
    guestProfiles: profiles,
  });
}

function ensureLocalStorage(): Storage {
  // Shim document.elementFromPoint if jsdom hasn't implemented it (needed for pointer-probe tests).
  if (!("elementFromPoint" in document)) {
    Object.defineProperty(document, "elementFromPoint", {
      value: () => null,
      configurable: true,
      writable: true,
    });
  }

  const existing = globalThis.localStorage as Storage | undefined;
  if (
    existing &&
    typeof existing.getItem === "function" &&
    typeof existing.setItem === "function" &&
    typeof existing.removeItem === "function" &&
    typeof existing.clear === "function"
  ) {
    return existing;
  }

  const backing = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => {
      backing.clear();
    },
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    removeItem: (key: string) => {
      backing.delete(key);
    },
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });

  return shim;
}

// ─── Flow tests ───────────────────────────────────────────────────────────────

describe("Flow 1 — unassigned guest → unassigned seat", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("assigns guest to seat and removes from sidebar", () => {
    const rows = makeRows([{ name: "Alice" }]);
    seedApp(rows);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
      overId: "seat-1-0",
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
  });

  it("places guest at the exact seat index specified", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
      overId: "seat-1-2",
    });

    expect(getSeatGuestName(container, 1, 2)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    // Bob undisturbed
    expect(getSeatGuestName(container, 1, 1)).toBe("Bob");
  });

  it("uses pointer probe to prefer seat over table-level fallback", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);
    const seat = getTableCard(container, 1).querySelector<HTMLElement>('[data-seat-id="seat-1-2"]');
    expect(seat).not.toBeNull();

    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(seat);

    triggerDragStart({ id: "guest-g0", data: { kind: "guest", guestId: "g0", origin: "sidebar" } });
    triggerDragMove({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
      clientX: 120,
      clientY: 80,
    });
    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
      overId: "table-1",
    });

    spy.mockRestore();

    expect(getSeatGuestName(container, 1, 2)).toBe("Alice");
    expect(getSeatGuestName(container, 1, 1)).toBe("Bob");
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
  });
});

describe("Flow 2 — unassigned guest → assigned seat (fails)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("does not displace the existing occupant", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g1",
      data: { kind: "guest", guestId: "g1", origin: "sidebar" },
      overId: "seat-1-0",
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
  });
});

describe("Flow 3 — unassigned guest → table (autoseat)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("auto-seats in adjacent table when target is full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([...blockerRows, { name: "Cara" }]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 0; i < 8; i++) state = assignSingle(state, 1, `g${i}`, i, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g8",
      data: { kind: "guest", guestId: "g8", origin: "sidebar" },
      overId: "table-1",
    });

    expect(tableContainsGuest(container, 1, "Cara")).toBe(false);
    expect(tableContainsGuest(container, 2, "Cara")).toBe(true);
  });
});

describe("Flow 4 — assigned guest → unassigned seat (move)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("moves guest to new seat and vacates original", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "seat-1-1",
    });

    expect(getSeatGuestName(container, 1, 0)).toBeNull();
    expect(getSeatGuestName(container, 1, 1)).toBe("Alice");
  });

  it("still allows seat drop after hovering over a table", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragStart({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
    });
    triggerDragOver({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "table-2",
    });
    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "seat-2-1",
    });

    expect(getSeatGuestName(container, 1, 0)).toBeNull();
    expect(getSeatGuestName(container, 2, 1)).toBe("Alice");
  });
});

describe("Flow 5 — assigned guest → assigned seat (swap)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("swaps guests in the two seats (same table)", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "seat-1-1",
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Bob");
    expect(getSeatGuestName(container, 1, 1)).toBe("Alice");
  });

  it("swaps when drop target is a guest chip ID", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);
    const seat1 = getTableCard(container, 1).querySelectorAll<HTMLElement>("[data-seat-slot]")[1];
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(seat1);

    triggerDragStart({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
    });
    triggerDragMove({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      clientX: 0,
      clientY: 0,
    });
    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "guest-g1",
    });

    spy.mockRestore();

    expect(getSeatGuestName(container, 1, 0)).toBe("Bob");
    expect(getSeatGuestName(container, 1, 1)).toBe("Alice");
  });

  it("swaps guests cross-table", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 2, "g1", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "seat-2-0",
    });

    expect(getSeatGuestName(container, 2, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 1, 0)).toBe("Bob");
  });
});

describe("Flow 6 — assigned guest → table (autoseat in adjacent)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("moves guest to adjacent table when target is full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([{ name: "Alice" }, ...blockerRows]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    state = assignSingle(state, 4, "g0", 0, profiles);
    for (let i = 1; i <= 8; i++) state = assignSingle(state, 2, `g${i}`, i - 1, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 4, seatIndex: 0 },
      overId: "table-2",
    });

    const aliceTable = findTableContainingGuest(container, "Alice");
    expect(tableContainsGuest(container, 4, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(aliceTable === 1 || aliceTable === 2 || aliceTable === 3).toBe(true);
  });
});

describe("Flow 7 — party → table (autoseat all members)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("seats all party members together in adjacent table when target full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Hannah", party: "House X" },
      { name: "Henry", party: "House X" },
      ...blockerRows,
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 2; i < 10; i++) state = assignSingle(state, 1, `g${i}`, i - 2, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "party-p0",
      data: { kind: "party", partyId: "p0", origin: "sidebar" },
      overId: "table-1",
    });

    expect(tableContainsGuest(container, 2, "Hannah")).toBe(true);
    expect(tableContainsGuest(container, 2, "Henry")).toBe(true);
    expect(sidebarContainsGuest(container, "Hannah")).toBe(false);
    expect(sidebarContainsGuest(container, "Henry")).toBe(false);
  });
});

describe("File import", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("imports export-structured csv via drag and drop", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = [
      "Full Name,Host,Party,Circle,Table,Seat",
      "Alice,Ryan,Party 1,Family,1,1",
      "Bob,Ryan,Party 2,Friends,,",
    ].join("\n");
    const file = new File([csv], "seating-export.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it("imports export-structured csv when circle is blank", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = [
      "Full Name,Host,Party,Circle,Table,Seat",
      "Alice,Ryan,Party 1,,1,1",
      "Bob,Ryan,Party 2,,,",
    ].join("\n");
    const file = new File([csv], "seating-export-blank-circle.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it("imports shuffled csv columns and ignores extra fields", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = [
      "circle,host,party,full name,notes,seat,table",
      "Family,Ryan,Party 1,Alice,VIP,1,1",
      "Friends,Ryan,Party 2,Bob,Wheelchair,not-a-seat,1",
    ].join("\n");
    const file = new File([csv], "shuffled.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("imports csv with only required guest headers", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = [
      "Host,Party,Circle,Full Name",
      "Ryan,Party 1,Family,Alice",
      "Ryan,Party 2,Friends,Bob",
    ].join("\n");
    const file = new File([csv], "required-only.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(sidebarContainsGuest(container, "Alice")).toBe(true);
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("ignores rows without full name", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = [
      "Full Name,Host,Party,Circle,Table,Seat",
      "Alice,Ryan,Party 1,Family,1,1",
      ",Ryan,Party 2,Friends,1,2",
      "   ,Ryan,Party 3,Friends,,",
      "Bob,Ryan,Party 4,Friends,,",
    ].join("\n");
    const file = new File([csv], "missing-name.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 1, 1)).toBeNull();
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("rejects duplicate headers ignoring case", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const csv = ["Full Name,Host,host,Party,Circle", "Alice,Ryan,Ryan,Party 1,Family"].join("\n");
    const file = new File([csv], "duplicate-header.csv", { type: "text/csv" });

    const { container } = render(<App />);
    const dndRoot = container.querySelector<HTMLElement>("[data-testid='dnd-context'] > div");
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "Import failed. Use a CSV structured like the exported guest file."
    );
    alertSpy.mockRestore();
  });

  it("exports canonical columns only", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    let exportedBlob: Blob | null = null;
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return "blob:mock-export";
    });
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const csv = [
      "Full Name,Party,Email/Phone Number,Status,Host,Circle,Table,Seat",
      "Alice,Party 1,alice@example.com,Attending,Ryan,Family,1,1",
      "Bob,Party 2,bob@example.com,Attending,Ryan,Friends,,",
    ].join("\n");
    const file = new File([csv], "rich-export.csv", { type: "text/csv" });

    const firstRender = render(<App />);
    const dndRoot = firstRender.container.querySelector<HTMLElement>(
      "[data-testid='dnd-context'] > div"
    );
    expect(dndRoot).not.toBeNull();

    await act(async () => {
      fireEvent.drop(dndRoot!, {
        dataTransfer: {
          files: [file],
          types: ["Files"],
        },
      });
    });

    expect(alertSpy).not.toHaveBeenCalled();
    firstRender.unmount();

    const secondRender = render(<App />);

    await act(async () => {
      fireEvent.click(within(secondRender.container).getByRole("button", { name: /export/i }));
    });

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalled();
    expect(exportedBlob).not.toBeNull();

    const exportedText = await exportedBlob!.text();
    const lines = exportedText.split("\n");
    expect(lines[0]).toBe("Full Name,Host,Party,Circle,Table,Seat");
    expect(lines[1]).toBe("Alice,Ryan,Party 1,Family,1,1");
    expect(lines[2]).toBe("Bob,Ryan,Party 2,Friends,,");

    secondRender.unmount();
    alertSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe("Flow 8 — circle → table (autoseat all members)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("seats all circle members in adjacent tables when target full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Gina", circle: "Friends", party: "P1" },
      { name: "Greg", circle: "Friends", party: "P2" },
      { name: "Gus", circle: "Friends", party: "P3" },
      ...blockerRows,
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 3; i < 11; i++) state = assignSingle(state, 1, `g${i}`, i - 3, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "circle-Friends",
      data: { kind: "circle", circleName: "Friends", origin: "sidebar" },
      overId: "table-1",
    });

    const assignedCount = ["Gina", "Greg", "Gus"].filter((name) =>
      [2, 3].some((t) => tableContainsGuest(container, t, name))
    ).length;
    expect(assignedCount).toBe(3);
    expect(sidebarContainsGuest(container, "Gina")).toBe(false);
    expect(sidebarContainsGuest(container, "Greg")).toBe(false);
    expect(sidebarContainsGuest(container, "Gus")).toBe(false);
  });

  it("does not unseat already seated circle members when target table is full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Gina", circle: "Friends", party: "P1" },
      { name: "Greg", circle: "Friends", party: "P2" },
      ...blockerRows,
      { name: "Anchor", circle: "Friends", party: "P3" },
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 2; i < 10; i++) state = assignSingle(state, 1, `g${i}`, i - 2, profiles);
    state = assignSingle(state, 4, "g10", 0, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "circle-Friends",
      data: { kind: "circle", circleName: "Friends", origin: "sidebar" },
      overId: "table-1",
    });

    expect(tableContainsGuest(container, 4, "Anchor")).toBe(true);
  });
});

describe("Flow 9 — table drag updates table positions", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("swaps table positions while preserving seated guests per table", () => {
    const rows = makeRows([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Blocker" },
      { name: "Cara" },
    ]);

    let state = createInitialState(["g0", "g1", "g2", "g3"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    state = assignSingle(state, 2, "g2", 0);
    state = assignSingle(state, 3, "g3", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-1",
      data: { kind: "table", tableNumber: 1, name: "Table 1", origin: "table" },
      overId: "table-2",
    });

    // Table identity keeps guest ownership.
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 1, 1)).toBe("Bob");
    expect(getSeatGuestName(container, 2, 0)).toBe("Blocker");
    // Grid positions are swapped.
    expect(getTableNameAtCell(container, 0, 0)).toBe("Table 2");
    expect(getTableNameAtCell(container, 0, 1)).toBe("Table 1");
    // Table 3 remains unchanged.
    expect(tableContainsGuest(container, 3, "Cara")).toBe(true);
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Bob")).toBe(false);
    expect(sidebarContainsGuest(container, "Blocker")).toBe(false);
  });

  it("swaps positions even when destination table is full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }, ...blockerRows]);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    state = assignSingle(state, 4, "g0", 0);
    state = assignSingle(state, 4, "g1", 1);
    for (let i = 2; i < 10; i++) state = assignSingle(state, 2, `g${i}`, i - 2);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-4",
      data: { kind: "table", tableNumber: 4, name: "Table 4", origin: "table" },
      overId: "table-2",
    });

    expect(getSeatGuestName(container, 4, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 4, 1)).toBe("Bob");
    expect(getSeatGuestName(container, 2, 0)).toBe("Blocker 1");
    expect(getSeatGuestName(container, 2, 7)).toBe("Blocker 8");
    expect(getTableNameAtCell(container, 0, 1)).toBe("Table 4");
    expect(getTableNameAtCell(container, 0, 3)).toBe("Table 2");
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Bob")).toBe(false);
  });

  it("keeps disabled seat maps with their table identity during position swap", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Blocker" }]);

    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 4, "g0", 0);
    state = assignSingle(state, 2, "g1", 1);
    state = {
      ...state,
      tables: state.tables.map((t) => {
        if (t.tableNumber === 2) return { ...t, disabledSeats: [0] };
        if (t.tableNumber === 4) return { ...t, disabledSeats: [3] };
        return t;
      }),
    };
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-4",
      data: { kind: "table", tableNumber: 4, name: "Table 4", origin: "table" },
      overId: "table-2",
    });

    expect(getSeatGuestName(container, 4, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 2, 1)).toBe("Blocker");

    const table2 = getTableCard(container, 2);
    const table4 = getTableCard(container, 4);
    const table2Seat0 = table2.querySelector<HTMLElement>('[data-seat-id="seat-2-0"]');
    const table4Seat3 = table4.querySelector<HTMLElement>('[data-seat-id="seat-4-3"]');
    expect(table2Seat0?.dataset.disabled).toBe("true");
    expect(table4Seat3?.dataset.disabled).toBe("true");
  });

  it("moves table into an empty cell", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    state = {
      ...state,
      tables: state.tables.filter((table) => table.tableNumber !== 25),
    };
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-1",
      data: { kind: "table", tableNumber: 1, name: "Table 1", origin: "table" },
      overId: "cell-4-4",
    });

    expect(getTableNameAtCell(container, 4, 4)).toBe("Table 1");
    expect(getTableNameAtCell(container, 0, 0)).toBeNull();
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
  });

  it("keeps table drag targets stable when board starts at non-default zoom", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    state = {
      ...state,
      tables: state.tables.filter((table) => table.tableNumber !== 25),
    };
    seedApp(rows, state);
    localStorage.setItem(BOARD_ZOOM_STORAGE_KEY, "1.4");

    const { container } = render(<App />);
    const resetZoomButton = screen.getByRole("button", { name: /reset zoom/i });
    expect(resetZoomButton.textContent).toContain("140%");

    triggerDragEnd({
      id: "sortable-table-1",
      data: { kind: "table", tableNumber: 1, name: "Table 1", origin: "table" },
      overId: "cell-4-4",
    });

    expect(getTableNameAtCell(container, 4, 4)).toBe("Table 1");
    expect(getTableNameAtCell(container, 0, 0)).toBeNull();
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
  });
});

describe("Flow 10 — table → unassigned (clear all)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("unassigns all guests at the table and returns them to sidebar", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-1",
      data: { kind: "table", tableNumber: 1, name: "Table 1", origin: "table" },
      overId: "unassigned",
    });

    expect(tableContainsGuest(container, 1, "Alice")).toBe(false);
    expect(tableContainsGuest(container, 1, "Bob")).toBe(false);
    expect(sidebarContainsGuest(container, "Alice")).toBe(true);
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
  });
});

// ─── Group cohesion rules (reducer-level) ─────────────────────────────────────

describe("Flow 11 — circle home-row cohesion", () => {
  // Helpers that build state purely through the reducer, no React render needed.

  function makeCircleProfiles(
    specs: Array<{ guestId: string; partyId: string; circle: string }>
  ): Record<string, GuestProfile> {
    return Object.fromEntries(
      specs.map(({ guestId, partyId, circle }) => [
        guestId,
        { partyId, circle, host: "h", party: partyId },
      ])
    );
  }

  it("seats all parties of a circle in the same row", () => {
    // 3 parties in circle "Alpha", one guest each.
    // Table 1 (row 0, tableIdx 0) is completely blocked.
    // Tables 2-5 (row 0) and tables 6-10 (row 1) are empty.
    // All 3 Alpha parties should land in row 0 (tables 2-5), not row 1.
    const blockerProfiles: Record<string, GuestProfile> = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `b${i}`,
        { partyId: `pb${i}`, circle: "", host: "h", party: `HB${i}` },
      ])
    );
    const alphaProfiles = makeCircleProfiles([
      { guestId: "g0", partyId: "p0", circle: "Alpha" },
      { guestId: "g1", partyId: "p1", circle: "Alpha" },
      { guestId: "g2", partyId: "p2", circle: "Alpha" },
    ]);
    const profiles = { ...blockerProfiles, ...alphaProfiles };

    let state = createInitialState([
      "g0",
      "g1",
      "g2",
      ...Array.from({ length: 8 }, (_, i) => `b${i}`),
    ]);
    for (let i = 0; i < 8; i += 1) {
      state = assignSingle(state, 1, `b${i}`, i, profiles);
    }

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g0", "g1", "g2"],
      guestProfiles: profiles,
    });

    function tableFor(guestId: string): number | null {
      for (const table of result.tables) {
        if (table.guestIds.includes(guestId)) return table.tableNumber;
      }
      return null;
    }

    const t0 = tableFor("g0")!;
    const t1 = tableFor("g1")!;
    const t2 = tableFor("g2")!;

    // All placed (not unassigned)
    expect(result.unassigned).not.toContain("g0");
    expect(result.unassigned).not.toContain("g1");
    expect(result.unassigned).not.toContain("g2");

    // All in row 0 (tables 1-5)
    expect(t0).toBeGreaterThanOrEqual(1);
    expect(t0).toBeLessThanOrEqual(5);
    expect(t1).toBeGreaterThanOrEqual(1);
    expect(t1).toBeLessThanOrEqual(5);
    expect(t2).toBeGreaterThanOrEqual(1);
    expect(t2).toBeLessThanOrEqual(5);
  });

  it("leaves a party unassigned when its circle's home row is full (orphan rule)", () => {
    // Row 0 = tables 1-5 (tableIdx 0-4), 40 total seats.
    // Fill 39 of those seats with blockers.
    // Circle "Alpha" has 2 parties (1 guest each).
    // g0 fills the last seat in row 0 → groupHomeRow = 0.
    // g1 cannot fit in row 0 → stays unassigned.
    const blockerCount = 39;
    const blockerProfiles: Record<string, GuestProfile> = Object.fromEntries(
      Array.from({ length: blockerCount }, (_, i) => [
        `b${i}`,
        { partyId: `pb${i}`, circle: "", host: "h", party: `HB${i}` },
      ])
    );
    const alphaProfiles = makeCircleProfiles([
      { guestId: "g0", partyId: "p0", circle: "Alpha" },
      { guestId: "g1", partyId: "p1", circle: "Alpha" },
    ]);
    const profiles = { ...blockerProfiles, ...alphaProfiles };

    let state = createInitialState([
      "g0",
      "g1",
      ...Array.from({ length: blockerCount }, (_, i) => `b${i}`),
    ]);

    // Fill tables 1-4 completely (32 seats), then 7 seats of table 5.
    let bIdx = 0;
    for (let t = 1; t <= 4; t += 1) {
      for (let s = 0; s < 8; s += 1) {
        state = assignSingle(state, t, `b${bIdx}`, s, profiles);
        bIdx += 1;
      }
    }
    for (let s = 0; s < 7; s += 1) {
      state = assignSingle(state, 5, `b${bIdx}`, s, profiles);
      bIdx += 1;
    }
    // Table 5 seat 7 is the only open seat in row 0.

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g0", "g1"],
      guestProfiles: profiles,
    });

    // g0 fills the last row-0 seat
    expect(result.unassigned).not.toContain("g0");
    // g1 has nowhere to go in row 0 — orphan rule keeps it unassigned
    expect(result.unassigned).toContain("g1");
  });
});

describe("Flow 12 — circle cross-table side cohesion (guard rail)", () => {
  // Tests the introducesNewCircleSideSplit guard: placing a circle member at a
  // second table on the opposite side from existing circle members is blocked.

  function betaProfiles(guestCount: number): Record<string, GuestProfile> {
    return Object.fromEntries(
      Array.from({ length: guestCount }, (_, i) => [
        `g${i}`,
        {
          partyId: i === 0 ? "pA" : "pB",
          circle: "Beta",
          host: "h",
          party: i === 0 ? "HA" : "HB",
        },
      ])
    );
  }

  it("blocks overflow to the opposite side when circle has a pure-side anchor", () => {
    // g0 (Beta) is anchored at table 1 slot 0 — pure side A.
    // Table 2 only has side B open (slots 0-3 blocked by non-Beta guests).
    // Auto-assigning g1 (Beta) with target=table2 / scope=target-only should
    // leave g1 unassigned because placing it on side B would create a
    // pure-A/pure-B cross-table split for the Beta circle.
    const blockers: Record<string, GuestProfile> = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [
        `b${i}`,
        { partyId: `pb${i}`, circle: "", host: "h", party: `HB${i}` },
      ])
    );
    const profiles = { ...betaProfiles(2), ...blockers };

    let state = createInitialState(["g0", "g1", "b0", "b1", "b2", "b3"]);
    state = assignSingle(state, 1, "g0", 0, profiles);
    for (let i = 0; i < 4; i += 1) {
      state = assignSingle(state, 2, `b${i}`, i, profiles); // blocks table 2 side A [0-3]
    }

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-only",
    });

    // g1 must stay unassigned — side B of table 2 would violate side cohesion
    expect(result.unassigned).toContain("g1");
  });

  it("allows overflow to the same side as the circle anchor", () => {
    // Same setup but only 3 blockers on table 2 side A, leaving slot 0 open.
    // g1 can take table 2 slot 0 (side A) — same side as g0 at table 1 slot 0.
    const blockers: Record<string, GuestProfile> = Object.fromEntries(
      Array.from({ length: 3 }, (_, i) => [
        `b${i}`,
        { partyId: `pb${i}`, circle: "", host: "h", party: `HB${i}` },
      ])
    );
    const profiles = { ...betaProfiles(2), ...blockers };

    let state = createInitialState(["g0", "g1", "b0", "b1", "b2"]);
    state = assignSingle(state, 1, "g0", 0, profiles);
    for (let i = 0; i < 3; i += 1) {
      state = assignSingle(state, 2, `b${i}`, i + 1, profiles); // blocks slots 1,2,3 on side A
    }
    // Table 2 now has slot 0 (side A) and slots 4-7 (side B) open.

    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-only",
    });

    expect(result.unassigned).not.toContain("g1");

    // g1 should be on side A (slot 0), not side B
    const g1Table = result.tables.find((t) => t.guestIds.includes("g1"));
    const g1SeatIdx = g1Table?.guestIds.indexOf("g1") ?? -1;
    expect(g1SeatIdx).toBeLessThanOrEqual(3); // side A
  });
});

// ─── Drag lifecycle ────────────────────────────────────────────────────────────

describe("drag lifecycle", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("starting a guest drag marks the app as dragging", () => {
    const rows = makeRows([{ name: "Alice" }]);
    seedApp(rows);

    const { container } = render(<App />);

    triggerDragStart({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
    });

    expect(container.querySelector('[data-drag-kind="guest"]')).not.toBeNull();
  });

  it("starting a seated guest drag marks the app as dragging", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragStart({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
    });

    expect(container.querySelector('[data-drag-kind="guest"]')).not.toBeNull();
  });

  it("cancelling a drag clears dragging state without changing assignments", () => {
    const rows = makeRows([{ name: "Alice" }]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragStart({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
    });
    triggerDragCancel();

    expect(container.querySelector("[data-drag-kind]")).toBeNull();
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
  });
});

describe("manual drag partial placement (allowPartialPlacementBypass)", () => {
  it("places a party partially when allowPartialPlacementBypass=true, despite party split constraints", () => {
    // Create a party with 2 members (g0, g1).
    // Fill tables so there's only 1 seat left in row 0.
    // A normal drop would block the party split; with the flag, it should place g0 and leave g1 unassigned.
    const profiles: Record<string, GuestProfile> = {
      g0: { partyId: "p0", circle: "", host: "h", party: "Alpha" },
      g1: { partyId: "p0", circle: "", host: "h", party: "Alpha" },
      ...Object.fromEntries(
        Array.from({ length: 39 }, (_, i) => [
          `b${i}`,
          { partyId: `pb${i}`, circle: "", host: "h", party: `B${i}` },
        ])
      ),
    };

    let state = createInitialState(["g0", "g1", ...Array.from({ length: 39 }, (_, i) => `b${i}`)]);

    // Fill tables 1-4 completely (32 seats) and 7 seats of table 5, leaving 1 seat in row 0
    let bIdx = 0;
    for (let t = 1; t <= 4; t += 1) {
      for (let s = 0; s < 8; s += 1) {
        state = assignSingle(state, t, `b${bIdx}`, s, profiles);
        bIdx += 1;
      }
    }
    for (let s = 0; s < 7; s += 1) {
      state = assignSingle(state, 5, `b${bIdx}`, s, profiles);
      bIdx += 1;
    }

    // Without the flag, this would leave both unassigned due to party split.
    // With the flag, g0 should be placed and g1 should remain unassigned.
    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g0", "g1"],
      guestProfiles: profiles,
      targetTableNumber: 5,
      targetScope: "target-and-adjacent",
      allowPartialPlacementBypass: true,
    });

    expect(result.unassigned).not.toContain("g0");
    expect(result.unassigned).toContain("g1");
  });

  it("places a circle partially when allowPartialPlacementBypass=true, despite circle side split constraints", () => {
    // Create a circle with 2 parties on different sides.
    // Set up tables so only one side is available at a target table.
    // Without the flag, this would block the placement.
    // With the flag, it should place g0 and leave g1 unassigned.
    const profiles: Record<string, GuestProfile> = {
      g0: { partyId: "p0", circle: "Beta", host: "h", party: "HA" },
      g1: { partyId: "p1", circle: "Beta", host: "h", party: "HB" },
      b0: { partyId: "pb0", circle: "", host: "h", party: "Blocker0" },
      b1: { partyId: "pb1", circle: "", host: "h", party: "Blocker1" },
      b2: { partyId: "pb2", circle: "", host: "h", party: "Blocker2" },
      b3: { partyId: "pb3", circle: "", host: "h", party: "Blocker3" },
    };

    let state = createInitialState(["g0", "g1", "b0", "b1", "b2", "b3"]);
    state = assignSingle(state, 1, "g0", 0, profiles); // g0 at table 1, side A

    // Block table 2 side A (slots 0-3) with blockers
    for (let i = 0; i < 4; i += 1) {
      state = assignSingle(state, 2, `b${i}`, i, profiles);
    }

    // Without the flag, g1 cannot be placed because it would create a pure-side split.
    // With the flag, g1 should be placed on the available side B.
    const result = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: ["g1"],
      guestProfiles: profiles,
      targetTableNumber: 2,
      targetScope: "target-only",
      allowPartialPlacementBypass: true,
    });

    // g1 should be placed (at least attempted), not left completely unassigned
    // if seats are available on side B
    const nowSeated = result.tables.flatMap((t) =>
      t.guestIds.filter((id): id is string => id !== null)
    );
    expect(nowSeated).toContain("g1");
  });
});

describe("guest hovercards", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("restarts the full delay when moving between seated guests", () => {
    const rows = makeRows([
      { name: "Alice", party: "Alpha Party", circle: "Ceremony", host: "Ryan" },
      { name: "Bob", party: "Beta Party", circle: "Reception", host: "Ryan" },
    ]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);
    const allChips = container.querySelectorAll("[data-guest-chip]");
    const aliceChip = Array.from(allChips).find(
      (el) => el.querySelector("[data-guest-name]")?.textContent === "Alice"
    );
    const bobChip = Array.from(allChips).find(
      (el) => el.querySelector("[data-guest-name]")?.textContent === "Bob"
    );

    expect(aliceChip).not.toBeNull();
    expect(bobChip).not.toBeNull();

    fireEvent.pointerEnter(aliceChip!);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByText("Alpha Party")).not.toBeNull();

    fireEvent.pointerLeave(aliceChip!);
    fireEvent.pointerEnter(bobChip!);

    expect(screen.queryByText("Alpha Party")).toBeNull();
    expect(screen.queryByText("Beta Party")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(screen.queryByText("Beta Party")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Beta Party")).not.toBeNull();
  });

  it("does not open hovercard on click", () => {
    const rows = makeRows([
      { name: "Alice", party: "Alpha Party", circle: "Ceremony", host: "Ryan" },
    ]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);
    // Find the guest chip by looking for a [data-guest-chip] with "Alice" text
    const allChips = container.querySelectorAll("[data-guest-chip]");
    const aliceChip = Array.from(allChips).find(
      (el) => el.querySelector("[data-guest-name]")?.textContent === "Alice"
    );

    expect(aliceChip).not.toBeNull();

    // Click on the chip
    fireEvent.click(aliceChip!);

    // Hovercard content should NOT appear
    expect(screen.queryByText("Alpha Party")).toBeNull();
  });

  it("does not open hovercard on focus", () => {
    const rows = makeRows([
      { name: "Alice", party: "Alpha Party", circle: "Ceremony", host: "Ryan" },
    ]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);
    const allChips = container.querySelectorAll("[data-guest-chip]");
    const aliceChip = Array.from(allChips).find(
      (el) => el.querySelector("[data-guest-name]")?.textContent === "Alice"
    );

    expect(aliceChip).not.toBeNull();

    // Focus on the chip
    fireEvent.focus(aliceChip!);

    // Hovercard content should NOT appear (no delay needed)
    expect(screen.queryByText("Alpha Party")).toBeNull();
  });

  it("still opens hovercard on pointer hover with delay", () => {
    const rows = makeRows([
      { name: "Alice", party: "Alpha Party", circle: "Ceremony", host: "Ryan" },
    ]);
    let state = createInitialState(["g0"]);
    state = assignSingle(state, 1, "g0", 0);
    seedApp(rows, state);

    const { container } = render(<App />);
    const allChips = container.querySelectorAll("[data-guest-chip]");
    const aliceChip = Array.from(allChips).find(
      (el) => el.querySelector("[data-guest-name]")?.textContent === "Alice"
    );

    expect(aliceChip).not.toBeNull();

    // Pointer enter should trigger the delay
    fireEvent.pointerEnter(aliceChip!);
    expect(screen.queryByText("Alpha Party")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    // After the delay, hovercard should appear
    expect(screen.queryByText("Alpha Party")).not.toBeNull();
  });
});
