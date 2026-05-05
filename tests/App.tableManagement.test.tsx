/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";
import { getGuestSourceSignature } from "../src/data/parseGuests";
import { GUEST_DATA_SOURCE_KEY, GUEST_DATA_STORAGE_KEY, STORAGE_KEY } from "../src/types";

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

  localStorage.setItem(GUEST_DATA_SOURCE_KEY, getGuestSourceSignature());
  localStorage.setItem(GUEST_DATA_STORAGE_KEY, JSON.stringify([]));
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  cleanup();
});

describe("table management dialog flows", () => {
  it("hides grid coordinate fields and saves table metadata updates", async () => {
    const { container } = render(<App />);

    const getTableCard = (tableNumber: number) =>
      container.querySelector<HTMLElement>(
        `[data-table-number='${tableNumber}'] [data-table-card]`
      );

    const tablesButtons = screen.getAllByRole("button", { name: /tables/i });
    fireEvent.click(tablesButtons[0]);
    const table25Card = getTableCard(25);
    expect(table25Card).not.toBeNull();
    fireEvent.contextMenu(table25Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete table$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete table$/i }));

    const table1Card = getTableCard(1);
    expect(table1Card).not.toBeNull();
    fireEvent.contextMenu(table1Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^edit table$/i }));
    const dialog = screen.getByRole("dialog", { name: /edit table/i });

    expect(within(dialog).queryByLabelText(/grid row/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/grid column/i)).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(/name/i), { target: { value: "VIP Table" } });
    fireEvent.change(within(dialog).getByLabelText(/seat count/i), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit table/i })).toBeNull();
    });

    expect(screen.getByText("VIP Table")).not.toBeNull();

    const addTableButton = screen.getByRole("button", { name: /add table/i });
    fireEvent.click(addTableButton);
    const createDialog = screen.getByRole("dialog", { name: /add table/i });
    expect(within(createDialog).queryByLabelText(/grid row/i)).toBeNull();
    expect(within(createDialog).queryByLabelText(/grid column/i)).toBeNull();

    fireEvent.change(within(createDialog).getByLabelText(/name/i), {
      target: { value: "New Corner Table" },
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: /^add table$/i }));

    await screen.findByText("New Corner Table");
  });

  it("renders consistent center-label shells across round and rectangular tables", async () => {
    const { container } = render(<App />);

    const getTableCard = (tableNumber: number) =>
      container.querySelector<HTMLElement>(
        `[data-table-number='${tableNumber}'] [data-table-card]`
      );

    const table1Card = getTableCard(1);
    expect(table1Card).not.toBeNull();
    fireEvent.contextMenu(table1Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^edit table$/i }));

    const dialog = screen.getByRole("dialog", { name: /edit table/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^rectangular$/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit table/i })).toBeNull();
    });

    const rectangularBody = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-card-body][data-table-shape='rectangular']"
    );
    const roundBody = container.querySelector<HTMLElement>(
      "[data-table-number='2'] [data-table-card-body][data-table-shape='round']"
    );
    const rectangularCenterLabel = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-center-label][data-table-shape='rectangular']"
    );
    const roundCenterLabel = container.querySelector<HTMLElement>(
      "[data-table-number='2'] [data-table-center-label][data-table-shape='round']"
    );

    expect(rectangularBody).not.toBeNull();
    expect(roundBody).not.toBeNull();
    expect(rectangularCenterLabel).not.toBeNull();
    expect(roundCenterLabel).not.toBeNull();
    expect(rectangularBody?.classList.contains("min-h-44")).toBe(true);
    expect(roundBody?.classList.contains("min-h-44")).toBe(true);

    const rectangularName = rectangularCenterLabel?.querySelector("[data-table-name]");
    const roundName = roundCenterLabel?.querySelector("[data-table-name]");
    expect(rectangularName?.textContent?.trim().length).toBeGreaterThan(0);
    expect(roundName?.textContent?.trim().length).toBeGreaterThan(0);
    expect(rectangularCenterLabel?.textContent).toMatch(/\d+\/\d+/);
    expect(roundCenterLabel?.textContent).toMatch(/\d+\/\d+/);

    const table2Card = getTableCard(2);
    expect(table2Card).not.toBeNull();
    fireEvent.contextMenu(table2Card!);
    expect(screen.getByRole("menuitem", { name: /^edit table$/i })).not.toBeNull();
  });
});
