import { closestCenter, type CollisionDetection, pointerWithin } from "@dnd-kit/core";

function getDragKind(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const val = (data as Record<string, unknown>).kind;
  return typeof val === "string" ? val : null;
}

function getDragOrigin(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const val = (data as Record<string, unknown>).origin;
  return typeof val === "string" ? val : null;
}

/**
 * Unified collision detection strategy:
 *
 * - Table drags: resolve only to other sortable-table-*, auto-seat, or unassigned targets
 *   so that table reorder and table-level drops don't collide with seat droppables.
 *
 * - Guest drags: prefer the exact seat under the pointer (pointerWithin on seat-* containers),
 *   then fall back to table-level or sidebar targets. Seated-guest drags give sidebar
 *   targets extra priority to make "unassign" intent feel natural.
 *
 * - Party/circle drags: pointer-within on non-seat containers only.
 */
export const dndCollisionDetection: CollisionDetection = (args) => {
  const data = args.active.data.current;
  const kind = getDragKind(data);

  // Single-pass categorisation: bucket each container exactly once.
  const seatContainers: typeof args.droppableContainers = [];
  const tableContainers: typeof args.droppableContainers = [];
  const sortableTableContainers: typeof args.droppableContainers = [];
  const cellContainers: typeof args.droppableContainers = [];
  const sidebarContainers: typeof args.droppableContainers = [];
  const autoSeatContainers: typeof args.droppableContainers = [];

  for (const c of args.droppableContainers) {
    const id = String(c.id);
    if (id.startsWith("seat-")) {
      seatContainers.push(c);
      continue;
    }
    if (id.startsWith("cell-")) {
      cellContainers.push(c);
      continue;
    }
    if (id.startsWith("sortable-table-")) {
      sortableTableContainers.push(c);
      continue;
    }
    if (id.startsWith("table-")) {
      tableContainers.push(c);
      continue;
    }
    if (id === "unassigned" || id === "unassigned-panel") {
      sidebarContainers.push(c);
      continue;
    }
    if (id === "auto-seat") {
      autoSeatContainers.push(c);
    }
  }

  // ── Table drags ────────────────────────────────────────────────────────────
  if (kind === "table") {
    const tableDragContainers = [
      ...sortableTableContainers,
      ...cellContainers,
      ...autoSeatContainers,
      ...sidebarContainers,
    ];
    const sidebarHits = pointerWithin({ ...args, droppableContainers: sidebarContainers });
    if (sidebarHits.length > 0) return sidebarHits;
    return closestCenter({ ...args, droppableContainers: tableDragContainers });
  }

  // ── Guest drags ────────────────────────────────────────────────────────────
  if (kind === "guest") {
    const seatHits = pointerWithin({ ...args, droppableContainers: seatContainers });
    if (seatHits.length > 0) return seatHits;

    if (getDragOrigin(data) === "table") {
      const sidebarHits = pointerWithin({ ...args, droppableContainers: sidebarContainers });
      if (sidebarHits.length > 0) return sidebarHits;
    }

    const nonSeatNonSortable = [...tableContainers, ...sidebarContainers, ...autoSeatContainers];
    const hits = pointerWithin({ ...args, droppableContainers: nonSeatNonSortable });
    if (hits.length > 0) return hits;

    if (tableContainers.length > 0) {
      return closestCenter({ ...args, droppableContainers: tableContainers });
    }
    return [];
  }

  // ── Party/circle drags ──────────────────────────────────────────────────
  const nonSeatNonSortable = [...tableContainers, ...sidebarContainers, ...autoSeatContainers];
  return pointerWithin({ ...args, droppableContainers: nonSeatNonSortable });
};
