/* @vitest-environment jsdom */

import {
  GUEST_DATA_SOURCE_KEY,
  GUEST_DATA_STORAGE_KEY,
  STORAGE_KEY,
  TABLE_PRESETS,
} from "../src/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import App from "../src/App";
import { BOARD_ZOOM_STORAGE_KEY } from "../src/store/localStorage";
import React from "react";
import { getGuestSourceSignature } from "../src/data/parseGuests";

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

function selectPreset(dialog: HTMLElement, label: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: /table size/i }));
  const option = screen
    .getAllByRole("option")
    .find((item) => item.textContent?.trim().startsWith(label));
  expect(option).toBeDefined();
  fireEvent.click(option!);
}

function selectBoardPreset(dialog: HTMLElement, label: string) {
  fireEvent.click(within(dialog).getByRole("combobox", { name: /default table size/i }));
  const option = screen
    .getAllByRole("option")
    .find((item) => item.textContent?.trim().startsWith(label));
  expect(option).toBeDefined();
  fireEvent.click(option!);
}

describe("table management dialog flows", () => {
  it("renders empty seat slots for sparse round and rectangular tables", async () => {
    const { container } = render(<App />);

    const sparseRoundEmptySeat = container.querySelector<HTMLElement>(
      "[data-table-number='2'] [data-seat-slot][data-guest-id='']"
    );
    expect(sparseRoundEmptySeat).not.toBeNull();

    const table1Card = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-card]"
    );
    expect(table1Card).not.toBeNull();
    fireEvent.contextMenu(table1Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^edit table$/i }));

    const dialog = screen.getByRole("dialog", { name: /edit table/i });
    selectPreset(dialog, "6' Rectangle (30\" wide)");
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit table/i })).toBeNull();
    });

    const sparseRectEmptySeat = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-seat-slot][data-guest-id='']"
    );
    expect(sparseRectEmptySeat).not.toBeNull();
  });

  it("hides grid coordinate fields and saves table metadata updates", async () => {
    const { container } = render(<App />);

    const getTableCard = (tableNumber: number) =>
      container.querySelector<HTMLElement>(
        `[data-table-number='${tableNumber}'] [data-table-card]`
      );

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
    expect(within(dialog).getByRole("combobox", { name: /table size/i })).not.toBeNull();

    fireEvent.change(within(dialog).getByLabelText(/name/i), { target: { value: "VIP Table" } });
    selectPreset(dialog, "72\" Round (6')");
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit table/i })).toBeNull();
    });

    expect(screen.getByText("VIP Table")).not.toBeNull();

    fireEvent.contextMenu(table1Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^edit table$/i }));
    const reopenedDialog = screen.getByRole("dialog", { name: /edit table/i });
    expect(
      within(reopenedDialog).getByRole("combobox", { name: /table size/i }).textContent
    ).toContain("72\" Round (6')");
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: /cancel/i }));

    const addTableButton = screen.getByRole("button", { name: /add table/i });
    fireEvent.click(addTableButton);
    const createDialog = screen.getByRole("dialog", { name: /add table/i });
    expect(within(createDialog).queryByLabelText(/grid row/i)).toBeNull();
    expect(within(createDialog).queryByLabelText(/grid column/i)).toBeNull();

    fireEvent.click(within(createDialog).getByRole("combobox", { name: /table size/i }));
    expect(screen.getAllByRole("option")).toHaveLength(TABLE_PRESETS.length);
    TABLE_PRESETS.forEach((preset) => {
      expect(
        screen
          .getAllByRole("option")
          .some((option) => option.textContent?.trim().startsWith(preset.label))
      ).toBe(true);
    });
    fireEvent.click(
      screen
        .getAllByRole("option")
        .find((option) => option.textContent?.trim().startsWith("8' King (42–48\" wide)"))!
    );

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
    selectPreset(dialog, "6' Rectangle (30\" wide)");
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
    expect(rectangularBody?.classList.contains("content-center")).toBe(true);
    expect(roundBody?.classList.contains("w-full")).toBe(true);
    expect(roundBody?.classList.contains("h-44")).toBe(true);

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

  it("shows updated king preset summaries and renders a 16-seat king table", async () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /add table/i }));
    const addTableDialog = screen.getByRole("dialog", { name: /add table/i });
    selectPreset(addTableDialog, "8' King (42–48\" wide)");
    expect(addTableDialog.textContent).toContain(
      '16 seats max. Head tables or "feasting" style layouts'
    );
    fireEvent.click(within(addTableDialog).getByRole("button", { name: /cancel/i }));

    const table1Card = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-card]"
    );
    expect(table1Card).not.toBeNull();
    fireEvent.contextMenu(table1Card!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^edit table$/i }));

    const editDialog = screen.getByRole("dialog", { name: /edit table/i });
    selectPreset(editDialog, "8' King (42–48\" wide)");
    expect(editDialog.textContent).toContain(
      '16 seats max. Head tables or "feasting" style layouts'
    );
    fireEvent.click(within(editDialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit table/i })).toBeNull();
    });

    const updatedTableCard = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-card]"
    );
    expect(updatedTableCard?.querySelectorAll("[data-seat-slot]")).toHaveLength(16);

    const updatedTableLabel = container.querySelector<HTMLElement>(
      "[data-table-number='1'] [data-table-center-label][data-table-shape='rectangular']"
    );
    expect(updatedTableLabel).not.toBeNull();
    expect(updatedTableLabel?.textContent).toContain("0/16");

    const viewport = container.querySelector<HTMLElement>("[data-board-viewport]");
    expect(viewport).not.toBeNull();
    fireEvent.contextMenu(viewport!);
    fireEvent.click(screen.getByRole("menuitem", { name: /board settings/i }));

    const boardSettingsDialog = screen.getByRole("dialog", { name: /board settings/i });
    selectBoardPreset(boardSettingsDialog, "8' King (42–48\" wide)");
    expect(boardSettingsDialog.textContent).toContain(
      '16 seats max. Head tables or "feasting" style layouts'
    );
  });

  it("supports zoom controls, persists zoom, and scales board content after board resize", async () => {
    localStorage.setItem(BOARD_ZOOM_STORAGE_KEY, "1.3");

    const { container } = render(<App />);
    const moreActionsButton = screen.getByRole("button", { name: /more actions/i });

    const getMenuItem = async (name: RegExp) => {
      fireEvent.pointerDown(moreActionsButton, { button: 0, ctrlKey: false });
      return screen.findByRole("menuitem", { name });
    };

    const closeMenu = () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    };

    const zoomInUntilDisabled = async () => {
      while (true) {
        const zoomInMenuItem = await getMenuItem(/zoom in/i);
        if (zoomInMenuItem.hasAttribute("data-disabled")) {
          closeMenu();
          return;
        }
        fireEvent.click(zoomInMenuItem);
      }
    };

    const zoomOutUntilDisabled = async () => {
      while (true) {
        const zoomOutMenuItem = await getMenuItem(/zoom out/i);
        if (zoomOutMenuItem.hasAttribute("data-disabled")) {
          closeMenu();
          return;
        }
        fireEvent.click(zoomOutMenuItem);
      }
    };

    const resetZoomMenuItem = () => getMenuItem(/reset zoom/i);

    expect((await resetZoomMenuItem()).textContent).toContain("130%");
    closeMenu();

    await zoomInUntilDisabled();

    expect((await resetZoomMenuItem()).textContent).toContain("150%");
    closeMenu();
    expect(localStorage.getItem(BOARD_ZOOM_STORAGE_KEY)).toBe("1.5");

    await zoomOutUntilDisabled();

    expect((await resetZoomMenuItem()).textContent).toContain("50%");
    closeMenu();
    expect(localStorage.getItem(BOARD_ZOOM_STORAGE_KEY)).toBe("0.5");

    fireEvent.click(await resetZoomMenuItem());
    expect((await resetZoomMenuItem()).textContent).toContain("100%");
    closeMenu();
    expect(localStorage.getItem(BOARD_ZOOM_STORAGE_KEY)).toBe("1");

    const contentSize = container.querySelector<HTMLElement>("[data-board-content-size]");
    expect(contentSize).not.toBeNull();

    const initialMinWidth = Number.parseFloat(contentSize?.style.minWidth ?? "0");
    fireEvent.click(await getMenuItem(/board settings/i));

    const dialog = screen.getByRole("dialog", { name: /board settings/i });
    fireEvent.change(within(dialog).getByLabelText(/rows/i), { target: { value: "8" } });
    fireEvent.change(within(dialog).getByLabelText(/columns/i), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /board settings/i })).toBeNull();
    });

    const resizedContent = container.querySelector<HTMLElement>("[data-board-content-size]");
    const resizedMinWidth = Number.parseFloat(resizedContent?.style.minWidth ?? "0");
    expect(resizedMinWidth).toBeGreaterThan(initialMinWidth);
  });

  it("deletes overflow tables when resizing board to smaller dimensions", async () => {
    const { container } = render(<App />);

    // Initial state should have 25 tables (5×5 grid)
    let tableCells = container.querySelectorAll("[data-table-card]");
    expect(tableCells).toHaveLength(25);

    // Open board settings and resize to 2×2 (4 tables max)
    const viewport = container.querySelector<HTMLElement>("[data-board-viewport]");
    expect(viewport).not.toBeNull();
    fireEvent.contextMenu(viewport!);
    fireEvent.click(screen.getByRole("menuitem", { name: /board settings/i }));

    const dialog = screen.getByRole("dialog", { name: /board settings/i });
    fireEvent.change(within(dialog).getByLabelText(/rows/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/columns/i), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save settings/i }));

    // After resize, dialog should close
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /board settings/i })).toBeNull();
    });

    // Only 4 tables should remain in the grid
    tableCells = container.querySelectorAll("[data-table-card]");
    expect(tableCells).toHaveLength(4);

    // Verify the remaining tables are the first 4 (Table 1, 2, 3, 4) by checking they exist
    expect(container.querySelector("[data-table-number='1'] [data-table-card]")).not.toBeNull();
    expect(container.querySelector("[data-table-number='2'] [data-table-card]")).not.toBeNull();
    expect(container.querySelector("[data-table-number='3'] [data-table-card]")).not.toBeNull();
    expect(container.querySelector("[data-table-number='4'] [data-table-card]")).not.toBeNull();
    // And verify that table 5 (first overflow table) is gone
    expect(container.querySelector("[data-table-number='5'] [data-table-card]")).toBeNull();
  });
});
