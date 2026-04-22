/* @vitest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GUEST_DATA_SOURCE_KEY, GUEST_DATA_STORAGE_KEY, STORAGE_KEY } from "./types";
import { getGuestSourceSignature } from "./data/parseGuests";
import { createInitialState, seatingReducer, type GuestProfile } from "./store/reducer";
import type { GuestInputRow, SeatingState } from "./types";

let latestDndProps: {
  onDragEnd?: (event: unknown) => void;
} | null = null;

vi.mock("@dnd-kit/core", async () => {
  const ReactLib = await import("react");

  return {
    DndContext: (props: { children: React.ReactNode; onDragEnd?: (event: unknown) => void }) => {
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

  // Overwrite party IDs to reflect shared households.
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state,
        history: [],
        future: [],
      })
    );
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getTableCard(container: HTMLElement, tableNumber: number): HTMLElement {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(".table-card"));
  const card = cards.find(
    (candidate) =>
      candidate.querySelector<HTMLElement>(".table-name")?.textContent?.trim() ===
      `Table ${tableNumber}`
  );

  if (!card) {
    throw new Error(`Missing table card for table ${tableNumber}`);
  }

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
  for (let tableNumber = 1; tableNumber <= 25; tableNumber += 1) {
    if (tableContainsGuest(container, tableNumber, guestName)) {
      return tableNumber;
    }
  }

  return null;
}

function sidebarContainsGuest(container: HTMLElement, guestName: string): boolean {
  const sidebar = container.querySelector<HTMLElement>(".sidebar");
  if (!sidebar) return false;
  return sidebar.textContent?.includes(guestName) ?? false;
}

function triggerDragEnd(params: { id: string; data: unknown; overId: string | null }): void {
  if (!latestDndProps?.onDragEnd) {
    throw new Error("DndContext onDragEnd is not available");
  }

  const event = {
    active: {
      id: params.id,
      data: { current: params.data },
      rect: { current: { translated: null, initial: null } },
    },
    over: params.overId ? { id: params.overId } : null,
  };

  act(() => {
    latestDndProps?.onDragEnd?.(event);
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

describe("UI drag/drop flows", () => {
  beforeEach(() => {
    ensureLocalStorage().clear();
    latestDndProps = null;
  });

  it("1) unassigned guest to unassigned seat assigns and removes from sidebar", () => {
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

  it("2) unassigned guest to assigned seat fails (no-op)", () => {
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

  it("3) unassigned guest to table auto-seats in target/adjacent tables", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([...blockerRows, { name: "Cara" }]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 0; i < 8; i += 1) {
      state = assignSingle(state, 1, `g${i}`, i, profiles);
    }
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

  it("4) assigned guest to different unassigned seat moves", () => {
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

  it("5) assigned guest to assigned seat swaps guests", () => {
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

  it("5b) assigned guest dropped on guest chip target swaps guests", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 1, seatIndex: 0 },
      overId: "guest-g1",
    });

    expect(getSeatGuestName(container, 1, 0)).toBe("Bob");
    expect(getSeatGuestName(container, 1, 1)).toBe("Alice");
  });

  it("6) assigned guest to table auto-seats in adjacent tables", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([{ name: "Alice" }, ...blockerRows]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    state = assignSingle(state, 4, "g0", 0, profiles);
    for (let i = 1; i <= 8; i += 1) {
      state = assignSingle(state, 2, `g${i}`, i - 1, profiles);
    }
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "table", tableNumber: 4, seatIndex: 0 },
      overId: "table-2",
    });

    expect(tableContainsGuest(container, 2, "Alice")).toBe(false);
    expect(tableContainsGuest(container, 4, "Alice")).toBe(false);
    expect(findTableContainingGuest(container, "Alice")).not.toBeNull();
  });

  it("7) household from sidebar to table auto-seats household together", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Hannah", household: "House X" },
      { name: "Henry", household: "House X" },
      ...blockerRows,
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 2; i < 10; i += 1) {
      state = assignSingle(state, 1, `g${i}`, i - 2, profiles);
    }
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "party-p0",
      data: { kind: "party", partyId: "p0", origin: "sidebar" },
      overId: "table-1",
    });

    expect(tableContainsGuest(container, 2, "Hannah")).toBe(true);
    expect(tableContainsGuest(container, 2, "Henry")).toBe(true);
  });

  it("8) group from sidebar to table auto-seats all group members", () => {
    const blockerRows = Array.from({ length: 8 }, (_, i) => ({ name: `Blocker ${i + 1}` }));
    const rows = makeRows([
      { name: "Gina", group: "Friends", household: "H1" },
      { name: "Greg", group: "Friends", household: "H2" },
      { name: "Gus", group: "Friends", household: "H3" },
      ...blockerRows,
    ]);
    const profiles = makeProfiles(rows);

    let state = createInitialState(rows.map((_, i) => `g${i}`));
    for (let i = 3; i < 11; i += 1) {
      state = assignSingle(state, 1, `g${i}`, i - 3, profiles);
    }
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "group-Friends",
      data: { kind: "group", groupName: "Friends", origin: "sidebar" },
      overId: "table-1",
    });

    const assignedCount = ["Gina", "Greg", "Gus"].filter((name) =>
      [2, 3].some((tableNumber) => tableContainsGuest(container, tableNumber, name))
    ).length;
    expect(assignedCount).toBe(3);
  });

  it("9) table to table swaps seat assignments between tables", () => {
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

    expect(getSeatGuestName(container, 2, 0)).toBe("Alice");
    expect(getSeatGuestName(container, 2, 1)).toBe("Bob");
    expect(getSeatGuestName(container, 1, 0)).toBe("Blocker");
    expect(tableContainsGuest(container, 1, "Alice")).toBe(false);
    expect(tableContainsGuest(container, 1, "Bob")).toBe(false);
    expect(tableContainsGuest(container, 3, "Cara")).toBe(true);
  });

  it("10) table to unassigned list unassigns all guests at that table", () => {
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

  // ── Regression: unassigned guest → empty seat must land at the exact seat ──
  it("11) unassigned guest chip dropped on specific seat is placed exactly there", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    // g0 in sidebar (unassigned), g1 seated at table 1 seat 1
    state = assignSingle(state, 1, "g1", 1);
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g0",
      data: { kind: "guest", guestId: "g0", origin: "sidebar" },
      overId: "seat-1-2",
    });

    // g0 must land at seat 2, not auto-scattered or left unassigned
    expect(getSeatGuestName(container, 1, 2)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Alice")).toBe(false);
    // g1 must be undisturbed
    expect(getSeatGuestName(container, 1, 1)).toBe("Bob");
  });

  // ── Regression: seated guest → occupied seat must swap ──
  it("12) seated guest dropped on occupied seat at same table swaps them", () => {
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

  // ── Regression: seated guest → occupied seat cross-table swap ──
  it("13) seated guest dropped on occupied seat on different table swaps them", () => {
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

  // ── Regression: unassigned guest dropped on occupied seat must not displace occupant ──
  it("14) unassigned guest dropped on occupied seat does not displace existing guest", () => {
    const rows = makeRows([{ name: "Alice" }, { name: "Bob" }]);
    let state = createInitialState(["g0", "g1"]);
    state = assignSingle(state, 1, "g0", 0);
    // g1 remains unassigned
    seedApp(rows, state);

    const { container } = render(<App />);

    triggerDragEnd({
      id: "guest-g1",
      data: { kind: "guest", guestId: "g1", origin: "sidebar" },
      overId: "seat-1-0",
    });

    // Alice must stay; Bob must remain unassigned
    expect(getSeatGuestName(container, 1, 0)).toBe("Alice");
    expect(sidebarContainsGuest(container, "Bob")).toBe(true);
  });
});
