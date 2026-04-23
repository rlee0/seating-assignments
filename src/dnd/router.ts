import type { DragIntent, DropTarget } from "./types";
import type { GuestProfile, SeatingAction } from "../store/reducer";
import type { Party, SeatingState, TableState } from "../types";

export interface RouterContext {
  state: SeatingState;
  guestProfiles: Record<string, GuestProfile>;
  parties: Map<string, Party>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSeatedGuestIds(tableNumber: number, tables: TableState[]): string[] {
  const table = tables.find((t) => t.tableNumber === tableNumber);
  if (!table) return [];
  return table.guestIds.filter((id): id is string => id !== null);
}

function getHouseholdGuestIds(
  partyId: string,
  parties: Map<string, Party>,
  includeAssigned: boolean,
  unassignedSet: Set<string>
): string[] {
  const party = parties.get(partyId);
  if (!party) return [];
  return includeAssigned ? party.guestIds : party.guestIds.filter((id) => unassignedSet.has(id));
}

function getGroupGuestIds(
  groupName: string,
  parties: Map<string, Party>,
  includeAssigned: boolean,
  unassignedSet: Set<string>
): string[] {
  const ids: string[] = [];
  for (const party of parties.values()) {
    const partyGroup = party.group || "No Group";
    if (partyGroup !== groupName) continue;
    if (includeAssigned) {
      ids.push(...party.guestIds);
    } else {
      ids.push(...party.guestIds.filter((id) => unassignedSet.has(id)));
    }
  }
  return ids;
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Routing matrix: (DragIntent × DropTarget) → SeatingAction | null
 *
 * Returns null when the combination is invalid or produces no state change.
 * The returned action is dispatched directly to the seating reducer.
 */
export function routeDrop(
  intent: DragIntent,
  target: DropTarget,
  ctx: RouterContext
): SeatingAction | null {
  const { state, guestProfiles, parties } = ctx;
  const unassignedSet = new Set(state.unassigned);

  // ── Table drag ──────────────────────────────────────────────────────────────
  if (intent.kind === "table") {
    if (target.type === "unassigned") {
      return { type: "CLEAR_TABLE", tableNumber: intent.tableNumber };
    }

    if (target.type === "autoseat") {
      const guestIds = getSeatedGuestIds(intent.tableNumber, state.tables);
      if (guestIds.length === 0) return null;
      return { type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles, allowReseatIncoming: true };
    }

    if (target.type === "table" || target.type === "seat") {
      // seat target is treated as a table-level drop for table drags
      const overTableNumber = target.type === "table" ? target.tableNumber : target.tableNumber;
      if (overTableNumber === intent.tableNumber) return null;
      return {
        type: "SWAP_TABLES",
        activeTableNumber: intent.tableNumber,
        overTableNumber,
      };
    }

    return null;
  }

  // ── Guest drag ───────────────────────────────────────────────────────────────
  if (intent.kind === "guest") {
    const { guestId, source } = intent;

    if (target.type === "unassigned") {
      // Only remove if the guest is currently seated; unassigned → unassigned is a no-op.
      return source === "seated" ? { type: "REMOVE_GUESTS", guestIds: [guestId] } : null;
    }

    if (target.type === "autoseat") {
      return { type: "AUTO_ASSIGN_GUESTS", guestIds: [guestId], guestProfiles };
    }

    if (target.type === "seat") {
      // Flow 1: unassigned → empty seat (assign)
      // Flow 2: unassigned → occupied seat (reducer no-ops the displacement)
      // Flow 4: seated → different empty seat (move)
      // Flow 5: seated → different occupied seat (swap)
      return {
        type: "ASSIGN_GUESTS",
        tableNumber: target.tableNumber,
        seatIndex: target.seatIndex,
        guestIds: [guestId],
        assignmentMode: "single-table",
        guestProfiles,
      };
    }

    if (target.type === "table") {
      // Flow 3: unassigned guest → table (autoseat in target/adjacent)
      // Flow 6: seated guest → table (autoseat; reducer handles remove-from-source via allowReseat)
      return {
        type: "AUTO_ASSIGN_GUESTS",
        guestIds: [guestId],
        guestProfiles,
        targetTableNumber: target.tableNumber,
        targetScope: "target-and-adjacent",
        allowReseatIncoming: source === "seated",
      };
    }

    return null;
  }

  // ── Household drag ────────────────────────────────────────────────────────────
  if (intent.kind === "household") {
    if (target.type === "seat") return null; // households cannot drop on individual seats

    // When targeting a table, include already-assigned members so they move together.
    const includeAssigned = target.type === "table";
    const guestIds = getHouseholdGuestIds(intent.partyId, parties, includeAssigned, unassignedSet);
    if (guestIds.length === 0) return null;

    if (target.type === "unassigned") {
      return { type: "REMOVE_GUESTS", guestIds };
    }

    if (target.type === "autoseat") {
      return { type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles };
    }

    if (target.type === "table") {
      return {
        type: "AUTO_ASSIGN_GUESTS",
        guestIds,
        guestProfiles,
        targetTableNumber: target.tableNumber,
        targetScope: "target-and-adjacent",
        allowReseatIncoming: false,
        allowPartialPlacementBypass: true,
      };
    }

    return null;
  }

  // ── Group drag ────────────────────────────────────────────────────────────────
  if (intent.kind === "group") {
    if (target.type === "seat") return null;

    const includeAssigned = target.type === "table";
    const guestIds = getGroupGuestIds(intent.groupName, parties, includeAssigned, unassignedSet);
    if (guestIds.length === 0) return null;

    if (target.type === "unassigned") {
      return { type: "REMOVE_GUESTS", guestIds };
    }

    if (target.type === "autoseat") {
      return { type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles };
    }

    if (target.type === "table") {
      return {
        type: "AUTO_ASSIGN_GUESTS",
        guestIds,
        guestProfiles,
        targetTableNumber: target.tableNumber,
        targetScope: "target-and-adjacent",
        allowReseatIncoming: false,
        allowPartialPlacementBypass: true,
      };
    }

    return null;
  }

  return null;
}
