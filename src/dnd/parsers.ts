import type { DragIntent, DropTarget } from "./types";

// ─── Drop target parsing ──────────────────────────────────────────────────────

/** Parse a dnd-kit droppable ID into a typed DropTarget. Returns null for unknown IDs. */
export function parseDropTargetId(id: string | null): DropTarget | null {
  if (!id) return null;

  if (id === "unassigned" || id === "unassigned-panel") {
    return { type: "unassigned" };
  }

  if (id === "auto-seat") {
    return { type: "autoseat" };
  }

  if (id.startsWith("seat-")) {
    const [, tableToken, seatToken] = id.split("-");
    const tableNumber = parseInt(tableToken, 10);
    const seatIndex = parseInt(seatToken, 10);
    if (!isNaN(tableNumber) && !isNaN(seatIndex)) {
      return { type: "seat", tableNumber, seatIndex };
    }
  }

  if (id.startsWith("table-")) {
    const tableNumber = parseInt(id.slice("table-".length), 10);
    if (!isNaN(tableNumber)) return { type: "table", tableNumber };
  }

  // sortable-table-N is used for table-drag reordering; treat as a table drop target
  if (id.startsWith("sortable-table-")) {
    const tableNumber = parseInt(id.slice("sortable-table-".length), 10);
    if (!isNaN(tableNumber)) return { type: "table", tableNumber };
  }

  return null;
}

// ─── Drag intent parsing ──────────────────────────────────────────────────────

/**
 * Parse dnd-kit `active.data.current` into a typed DragIntent.
 * Uses the `origin` field from component drag data when available.
 */
export function parseDragIntent(data: unknown): DragIntent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (d.kind === "guest" && typeof d.guestId === "string") {
    const origin = d.origin as string | undefined;
    const source: "unassigned" | "seated" = origin === "table" ? "seated" : "unassigned";
    return {
      kind: "guest",
      guestId: d.guestId,
      source,
      tableNumber: typeof d.tableNumber === "number" ? d.tableNumber : undefined,
      seatIndex: typeof d.seatIndex === "number" ? d.seatIndex : undefined,
    };
  }

  if (d.kind === "party" && typeof d.partyId === "string") {
    return { kind: "household", partyId: d.partyId };
  }

  if (d.kind === "group" && typeof d.groupName === "string") {
    return { kind: "group", groupName: d.groupName };
  }

  if (d.kind === "table" && typeof d.tableNumber === "number" && typeof d.name === "string") {
    return { kind: "table", tableNumber: d.tableNumber, name: d.name };
  }

  return null;
}

// ─── Drop target resolution ───────────────────────────────────────────────────

/**
 * Resolve the final DropTarget from the dnd-kit `over` object plus an optional
 * pointer position. The pointer is used to detect a specific seat when dnd-kit
 * only resolved to the table level (e.g. pointer is at a seat boundary).
 */
export function resolveDropTarget(
  over: { id: string | number } | null,
  pointer: { x: number; y: number } | null
): DropTarget | null {
  // Probe the element at pointer position first for precise seat detection.
  if (pointer) {
    const el = document.elementFromPoint(pointer.x, pointer.y);
    const seatId = el?.closest<HTMLElement>(".seat-slot")?.dataset.seatId ?? null;
    if (seatId) {
      const seat = parseDropTargetId(seatId);
      if (seat) return seat;
    }
    // If the pointer is over the sidebar, treat as unassigned drop.
    if (el?.closest(".sidebar")) {
      return { type: "unassigned" };
    }
  }

  // Fall back to the droppable ID resolved by dnd-kit's collision detection.
  return parseDropTargetId(over ? String(over.id) : null);
}
