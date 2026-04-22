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
 * - Household/group drags: pointer-within on non-seat containers only.
 */
export const dndCollisionDetection: CollisionDetection = (args) => {
  const data = args.active.data.current;
  const kind = getDragKind(data);

  // ── Table drags ────────────────────────────────────────────────────────────
  if (kind === "table") {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => {
        const id = String(c.id);
        return (
          id.startsWith("sortable-table-") ||
          id === "auto-seat" ||
          id === "unassigned" ||
          id === "unassigned-panel"
        );
      }),
    });
  }

  // For all other drags, exclude sortable-table-* so the board never reorders.
  const baseContainers = args.droppableContainers.filter(
    (c) => !String(c.id).startsWith("sortable-table-")
  );

  // ── Guest drags ────────────────────────────────────────────────────────────
  if (kind === "guest") {
    const seatContainers = baseContainers.filter((c) => String(c.id).startsWith("seat-"));
    const seatHits = pointerWithin({ ...args, droppableContainers: seatContainers });
    if (seatHits.length > 0) return seatHits;

    const nonSeatContainers = baseContainers.filter((c) => !String(c.id).startsWith("seat-"));
    const sidebarContainers = nonSeatContainers.filter(
      (c) => String(c.id) === "unassigned" || String(c.id) === "unassigned-panel"
    );

    // Seated guests: give sidebar containers extra pointer-within priority.
    if (getDragOrigin(data) === "table") {
      const sidebarHits = pointerWithin({ ...args, droppableContainers: sidebarContainers });
      if (sidebarHits.length > 0) return sidebarHits;
    }

    const hits = pointerWithin({ ...args, droppableContainers: nonSeatContainers });
    if (hits.length > 0) return hits;

    // Fallback to closestCenter for sidebar when pointer is far away.
    if (sidebarContainers.length > 0) {
      return closestCenter({ ...args, droppableContainers: sidebarContainers });
    }

    return [];
  }

  // ── Household/group drags ──────────────────────────────────────────────────
  return pointerWithin({
    ...args,
    droppableContainers: baseContainers.filter((c) => !String(c.id).startsWith("seat-")),
  });
};
