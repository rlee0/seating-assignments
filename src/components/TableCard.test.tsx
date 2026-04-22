/* @vitest-environment jsdom */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import TableCard from "./TableCard";
import type { TableState } from "../types";

// Capture every useDroppable invocation so we can assert disabled states.
const useDroppableCalls: Array<{ id: string; disabled?: boolean }> = [];

vi.mock("@dnd-kit/core", () => ({
  useDroppable: (args: { id: string; disabled?: boolean }) => {
    useDroppableCalls.push({ id: args.id, disabled: args.disabled });
    return { setNodeRef: () => {}, isOver: false };
  },
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("../store/SeatingContext", () => ({
  useSeating: () => ({
    dispatch: vi.fn(),
    state: { lockedGuestIds: [] },
  }),
}));

// Thin passthrough wrappers so TableCard renders without Radix portal errors.
vi.mock("./ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
  ContextMenuSeparator: () => <hr />,
}));

/** Return the last recorded disabled value for a given droppable id. */
function lastDisabledFor(id: string): boolean | undefined {
  const calls = useDroppableCalls.filter((c) => c.id === id);
  return calls.at(-1)?.disabled;
}

const baseTable: TableState = {
  tableNumber: 1,
  name: "Table 1",
  guestIds: Array(8).fill(null) as Array<string | null>,
  disabledSeats: [2],
};

describe("TableCard seat droppable gating regression", () => {
  beforeEach(() => {
    useDroppableCalls.length = 0;
  });

  it("enabled seats are droppable regardless of activeDragKind", () => {
    const { rerender } = render(
      <TableCard table={baseTable} activeDragKind={null} activeDragGuestId={null} />
    );

    // With no active drag: seat 0 (enabled) must be droppable, seat 2 (disabled) must not.
    expect(lastDisabledFor("seat-1-0")).toBe(false);
    expect(lastDisabledFor("seat-1-2")).toBe(true);

    // During a table drag (not a guest drag): seat 0 must still be droppable.
    rerender(<TableCard table={baseTable} activeDragKind="table" activeDragGuestId={null} />);
    expect(lastDisabledFor("seat-1-0")).toBe(false);

    // During a guest drag: seat 0 remains droppable.
    rerender(<TableCard table={baseTable} activeDragKind="guest" activeDragGuestId={null} />);
    expect(lastDisabledFor("seat-1-0")).toBe(false);
  });

  it("administratively disabled seats remain non-droppable even during a guest drag", () => {
    render(<TableCard table={baseTable} activeDragKind="guest" activeDragGuestId={null} />);
    expect(lastDisabledFor("seat-1-2")).toBe(true);
  });
});
