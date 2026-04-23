/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";
import { getGuestSourceSignature } from "../src/data/parseGuests";
import { createInitialState, seatingReducer, type GuestProfile } from "../src/store/reducer";
import {
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

function makeRows(
  specs: Array<{ name: string; household?: string; group?: string; host?: string }>
): GuestInputRow[] {
  return specs.map((spec, index) => ({
    id: `g${index}`,
    fullName: spec.name,
    household: spec.household ?? `Household ${index + 1}`,
    group: spec.group ?? "",
    host: spec.host ?? "Ryan",
  }));
}

function makeGuestProfile(row: GuestInputRow): GuestProfile {
  return {
    partyId: "p0",
    group: row.group,
    host: row.host,
    household: row.household,
  };
}

function seedApp(guestRows: GuestInputRow[], seatingJson?: unknown): void {
  localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
  localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify(guestRows));

  if (seatingJson) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seatingJson));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

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

describe("guest CRUD flows", () => {
  it("adds a guest from the Add Guest button", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /add guest/i }));
    const dialog = screen.getByRole("dialog", { name: /add guest/i });
    fireEvent.change(within(dialog).getByLabelText(/full name/i), {
      target: { value: "Jordan Lee" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^household$/i), {
      target: { value: "Lee Family" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^group$/i), {
      target: { value: "Friends" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add guest$/i }));

    await screen.findByText("Jordan Lee");
    expect(screen.getByText("Lee Family")).not.toBeNull();

    await waitFor(() => {
      const stored = localStorage.getItem(GUEST_DATA_STORAGE_KEY);
      expect(stored).toContain("Jordan Lee");
      expect(stored).toContain('"id":"g0"');
    });
  });

  it("edits an unassigned guest from the sidebar context menu", async () => {
    seedApp(makeRows([{ name: "Alice", household: "Alpha", group: "Ceremony" }]));
    render(<App />);

    const aliceChip = document.querySelector<HTMLElement>(
      "[data-sidebar] [data-guest-chip][data-guest-id='g0']"
    );
    expect(aliceChip).not.toBeNull();
    fireEvent.contextMenu(aliceChip!);
    fireEvent.click(await screen.findByText(/edit guest/i));
    const dialog = screen.getByRole("dialog", { name: /edit guest/i });
    fireEvent.change(within(dialog).getByLabelText(/full name/i), { target: { value: "Alicia" } });
    fireEvent.change(within(dialog).getByLabelText(/^household$/i), { target: { value: "Beta" } });
    fireEvent.change(within(dialog).getByLabelText(/^group$/i), { target: { value: "Family" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await screen.findByText("Alicia");
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Beta")).not.toBeNull();
  });

  it("deletes a seated guest from the seat context menu", async () => {
    const rows = makeRows([{ name: "Alice", household: "Alpha", group: "Ceremony" }]);
    let state = createInitialState([rows[0].id]);
    state = seatingReducer(state, {
      type: "ASSIGN_GUESTS",
      tableNumber: 1,
      guestIds: [rows[0].id],
      seatIndex: 0,
      guestProfiles: { [rows[0].id]: makeGuestProfile(rows[0]) },
    });

    seedApp(rows, { state, history: [], future: [] });
    const { container } = render(<App />);

    const tableCard = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-card]"
    );
    expect(tableCard).not.toBeNull();

    fireEvent.contextMenu(within(tableCard!).getByText("Alice"));
    fireEvent.click(await screen.findByText(/delete guest/i));
    fireEvent.click(screen.getByRole("button", { name: /delete guest/i }));

    await waitFor(() => {
      expect(screen.queryByText("Alice")).toBeNull();
    });

    await waitFor(() => {
      expect(localStorage.getItem(GUEST_DATA_STORAGE_KEY)).toContain('"rows":[]');
    });
  });

  it("shows all existing groups when opening group suggestions in edit mode", async () => {
    seedApp(
      makeRows([
        { name: "Alice", household: "Alpha", group: "Ceremony" },
        { name: "Bob", household: "Beta", group: "Friends" },
      ])
    );
    render(<App />);

    const aliceChip = document.querySelector<HTMLElement>(
      "[data-sidebar] [data-guest-chip][data-guest-id='g0']"
    );
    expect(aliceChip).not.toBeNull();
    fireEvent.contextMenu(aliceChip!);
    fireEvent.click(await screen.findByText(/edit guest/i));

    const dialog = screen.getByRole("dialog", { name: /edit guest/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /toggle group suggestions/i }));

    const listbox = await screen.findByRole("listbox", { name: "Suggestions" });
    expect(within(listbox).getByRole("option", { name: "Ceremony" })).not.toBeNull();
    expect(within(listbox).getByRole("option", { name: "Friends" })).not.toBeNull();
  });

  it("keeps household suggestions open when clicking the household input", async () => {
    seedApp(
      makeRows([
        { name: "Alice", household: "Alpha", group: "Ceremony" },
        { name: "Bob", household: "Beta", group: "Friends" },
      ])
    );
    render(<App />);

    const aliceChip = document.querySelector<HTMLElement>(
      "[data-sidebar] [data-guest-chip][data-guest-id='g0']"
    );
    expect(aliceChip).not.toBeNull();
    fireEvent.contextMenu(aliceChip!);
    fireEvent.click(await screen.findByText(/edit guest/i));

    const dialog = screen.getByRole("dialog", { name: /edit guest/i });
    fireEvent.click(within(dialog).getByLabelText(/^household$/i));

    expect(await screen.findByText("Alpha")).not.toBeNull();
    expect(screen.getByText("Beta")).not.toBeNull();
  });
});
