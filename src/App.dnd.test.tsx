/* @vitest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GUEST_DATA_SOURCE_KEY, GUEST_DATA_STORAGE_KEY, STORAGE_KEY } from "./types";
import { getGuestSourceSignature } from "./data/parseGuests";
import { createInitialState, seatingReducer, type GuestProfile } from "./store/reducer";
import type { GuestInputRow, SeatingState } from "./types";

// ─── dnd-kit mock ─────────────────────────────────────────────────────────────

let latestDndProps: {
  onDragEnd?: (event: unknown) => void;
  onDragMove?: (event: unknown) => void;
  onDragStart?: (event: unknown) => void;
  onDragCancel?: () => void;
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
  specs: Array<{ name: string; household?: string; group?: string; host?: string }>
): GuestInputRow[] {
  return specs.map((spec, index) => ({
    fullName: spec.name,
    household: spec.household ?? `Household ${index + 1}`,
    group: spec.group ?? "Group A",
    host: spec.host ?? "Ryan",
  }));
}

function makeProfiles(rows: GuestInputRow[]): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};

  rows.forEach((row, index) => {
    profiles[`g${index}`] = {
      partyId: `p${index}`,
      group: row.group,
      host: row.host,
      household: row.household,
    };
  });

  const householdToPartyId = new Map<string, string>();
  rows.forEach((row, index) => {
    if (!householdToPartyId.has(row.household)) {
      householdToPartyId.set(row.household, `p${householdToPartyId.size}`);
    }
    const guestId = `g${index}`;
    profiles[guestId].partyId = householdToPartyId.get(row.household)!;
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
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".table-card"));
  const card = cards.find(
    (c) =>
      c.querySelector<HTMLElement>(".table-name")?.textContent?.trim() === `Table ${tableNumber}`
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
  const slots = Array.from(card.querySelectorAll<HTMLElement>(".seat-slot"));
  const seat = slots[seatIndex];
  if (!seat) return null;
  return seat.querySelector<HTMLElement>(".guest-name")?.textContent?.trim() ?? null;
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
  const sidebar = container.querySelector<HTMLElement>(".sidebar");
  if (!sidebar) return false;
  return sidebar.textContent?.includes(guestName) ?? false;
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
    const seat1 = getTableCard(container, 1).querySelectorAll<HTMLElement>(".seat-slot")[1];
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

describe("Flow 7 — household → table (autoseat all members)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("seats all household members together in adjacent table when target full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Hannah", household: "House X" },
      { name: "Henry", household: "House X" },
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

describe("Flow 8 — group → table (autoseat all members)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("seats all group members in adjacent tables when target full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Gina", group: "Friends", household: "H1" },
      { name: "Greg", group: "Friends", household: "H2" },
      { name: "Gus", group: "Friends", household: "H3" },
      ...blockerRows,
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 3; i < 11; i++) state = assignSingle(state, 1, `g${i}`, i - 3, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "group-Friends",
      data: { kind: "group", groupName: "Friends", origin: "sidebar" },
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
});

describe("Flow 9 — table → table (move/preserve seat/autoseat overflow)", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("moves guests preserving seat index; autoseats conflicts", () => {
    const rows = makeRows([
      { name: "Alice" },
      { name: "Bob" },
      { name: "Blocker" },
      { name: "Cara" },
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(["g0", "g1", "g2", "g3"]);
    state = assignSingle(state, 1, "g0", 0, profiles);
    state = assignSingle(state, 1, "g1", 1, profiles);
    state = assignSingle(state, 2, "g2", 0, profiles);
    state = assignSingle(state, 3, "g3", 0, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-1",
      data: { kind: "table", tableNumber: 1, name: "Table 1", origin: "table" },
      overId: "table-2",
    });

    // Bob was at seat 1; destination seat 1 open → preserved
    expect(getSeatGuestName(container, 2, 1)).toBe("Bob");
    // Alice couldn't take seat 0 (Blocker is there); autoseated elsewhere
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Bob")).toBe(false);
    expect(findTableContainingGuest(container, "Alice")).not.toBeNull();
    expect(tableContainsGuest(container, 1, "Alice")).toBe(false);
    expect(tableContainsGuest(container, 1, "Bob")).toBe(false);
    // Cara in table 3 undisturbed
    expect(tableContainsGuest(container, 3, "Cara")).toBe(true);
  });

  it("autoseats to adjacent table when target is full", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }, ...blockerRows]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    state = assignSingle(state, 4, "g0", 0, profiles);
    state = assignSingle(state, 4, "g1", 1, profiles);
    for (let i = 2; i < 10; i++) state = assignSingle(state, 2, `g${i}`, i - 2, profiles);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-4",
      data: { kind: "table", tableNumber: 4, name: "Table 4", origin: "table" },
      overId: "table-2",
    });

    const aliceTable = findTableContainingGuest(container, "Alice");
    const bobTable = findTableContainingGuest(container, "Bob");

    expect(tableContainsGuest(container, 4, "Alice")).toBe(false);
    expect(tableContainsGuest(container, 4, "Bob")).toBe(false);
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Bob")).toBe(false);
    expect(aliceTable === 1 || aliceTable === 2 || aliceTable === 3).toBe(true);
    expect(bobTable === 1 || bobTable === 2 || bobTable === 3).toBe(true);
  });

  it("does not place into disabled destination seats", () => {
    const rows = makeRows([{ name: "Alice" }]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(["g0"]);
    state = assignSingle(state, 4, "g0", 0, profiles);
    state = {
      ...state,
      tables: state.tables.map((t) => (t.tableNumber === 2 ? { ...t, disabledSeats: [0] } : t)),
    };
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "sortable-table-4",
      data: { kind: "table", tableNumber: 4, name: "Table 4", origin: "table" },
      overId: "table-2",
    });

    expect(getSeatGuestName(container, 2, 0)).toBeNull();
    expect(tableContainsGuest(container, 4, "Alice")).toBe(false);
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);

    const aliceTable = findTableContainingGuest(container, "Alice");
    expect(aliceTable === 1 || aliceTable === 2 || aliceTable === 3).toBe(true);
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

    expect(container.querySelector(".app--guest-dragging")).not.toBeNull();
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

    expect(container.querySelector(".app--guest-dragging")).not.toBeNull();
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

    expect(container.querySelector(".app--guest-dragging")).toBeNull();
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
  });
});
