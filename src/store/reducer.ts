import type { Host, SeatingState, TableState } from "../types";
import { TABLE_CAPACITY, TABLE_COUNT, TABLES_PER_ROW } from "../types";

import { arrayMove } from "@dnd-kit/sortable";

type AssignmentMode = "single-table" | "group-overflow";

export interface GuestProfile {
  partyId: string;
  group: string;
  host: Host;
  household: string;
}

export type SeatingAction =
  | {
      type: "ASSIGN_GUESTS";
      tableNumber: number;
      guestIds: string[];
      assignmentMode?: AssignmentMode;
      seatIndex?: number;
      guestProfiles?: Record<string, GuestProfile>;
    }
  | { type: "SET_GUEST_ANCHORED"; guestId: string; anchored: boolean }
  | {
      type: "AUTO_ASSIGN_GUESTS";
      guestIds: string[];
      guestProfiles?: Record<string, GuestProfile>;
    }
  | { type: "REMOVE_GUESTS"; guestIds: string[] }
  | { type: "CLEAR_TABLE"; tableNumber: number }
  | { type: "MOVE_TABLE"; activeTableNumber: number; overTableNumber: number };

function createEmptySeatSlots(): Array<string | null> {
  return Array<string | null>(TABLE_CAPACITY).fill(null);
}

function getUniqueGuestIds(guestIds: string[]): string[] {
  const seen = new Set<string>();

  return guestIds.filter((guestId) => {
    if (seen.has(guestId)) return false;
    seen.add(guestId);
    return true;
  });
}

function removeGuestsFromSeatSlots(
  seatSlots: Array<string | null>,
  guestIdsToRemove: Set<string>
): Array<string | null> {
  return seatSlots.map((guestId) => (guestId && guestIdsToRemove.has(guestId) ? null : guestId));
}

function getOccupiedSeatCount(seatSlots: Array<string | null>): number {
  return seatSlots.filter((guestId): guestId is string => guestId !== null).length;
}

function getAvailableSeatIndexes(seatSlots: Array<string | null>, startIndex?: number): number[] {
  if (startIndex != null) {
    if (startIndex < 0 || startIndex >= TABLE_CAPACITY || seatSlots[startIndex] !== null) {
      return [];
    }

    const indexes = [startIndex];
    for (let index = startIndex + 1; index < TABLE_CAPACITY; index += 1) {
      if (seatSlots[index] === null) indexes.push(index);
    }
    return indexes;
  }

  return seatSlots.reduce<number[]>((indexes, guestId, index) => {
    if (guestId === null) indexes.push(index);
    return indexes;
  }, []);
}

function placeGuestsIntoSeatSlots(
  seatSlots: Array<string | null>,
  guestIds: string[],
  seatIndexes: number[]
): Array<string | null> | null {
  if (guestIds.length > seatIndexes.length) return null;

  const nextSeatSlots = [...seatSlots];
  guestIds.forEach((guestId, index) => {
    nextSeatSlots[seatIndexes[index]] = guestId;
  });

  return nextSeatSlots;
}

export function createInitialState(allGuestIds: string[]): SeatingState {
  const tables: TableState[] = Array.from({ length: TABLE_COUNT }, (_, index) => ({
    tableNumber: index + 1,
    name: `Table ${index + 1}`,
    guestIds: createEmptySeatSlots(),
  }));

  return { tables, unassigned: [...allGuestIds], lockedGuestIds: [] };
}

function assignGuestsWithOverflow(
  state: SeatingState,
  tableIdx: number,
  guestIds: string[],
  seatIndex?: number
): SeatingState {
  const orderedGuestIds = getUniqueGuestIds(guestIds);
  const incomingSet = new Set(orderedGuestIds);
  const normalizedTables = state.tables.map((table) => ({
    ...table,
    guestIds: removeGuestsFromSeatSlots(table.guestIds, incomingSet),
  }));
  const remainingGuests = [...orderedGuestIds];

  if (remainingGuests.length === 0) {
    return state;
  }

  const nextTables = normalizedTables.map((table) => ({
    ...table,
    guestIds: [...table.guestIds],
  }));
  let nextGuestIndex = 0;

  for (
    let index = tableIdx;
    index < nextTables.length && nextGuestIndex < remainingGuests.length;
    index += 1
  ) {
    const availableSeatIndexes = getAvailableSeatIndexes(
      nextTables[index].guestIds,
      index === tableIdx ? seatIndex : undefined
    );
    if (availableSeatIndexes.length === 0) continue;

    const guestsForTable = remainingGuests.slice(
      nextGuestIndex,
      nextGuestIndex + availableSeatIndexes.length
    );
    const updatedSeatSlots = placeGuestsIntoSeatSlots(
      nextTables[index].guestIds,
      guestsForTable,
      availableSeatIndexes
    );
    if (!updatedSeatSlots) return state;

    nextTables[index] = {
      ...nextTables[index],
      guestIds: updatedSeatSlots,
    };
    nextGuestIndex += guestsForTable.length;
  }

  if (nextGuestIndex !== remainingGuests.length) {
    return state;
  }

  return {
    tables: nextTables,
    unassigned: state.unassigned.filter((guestId) => !incomingSet.has(guestId)),
    lockedGuestIds: state.lockedGuestIds ?? [],
  };
}

// ─── Row-surface auto-seating ────────────────────────────────────────────────
//
// Physical model:
//   Tables are ordered by their current display index (state.tables index, not tableNumber).
//   Every TABLES_PER_ROW consecutive tables form a "row", which is treated as a single
//   flat surface of (TABLES_PER_ROW × TABLE_CAPACITY) contiguous seats.
//
//   Row seat index r = (tableIndexInRow × TABLE_CAPACITY) + slotIndex
//
//   Seat layout per rectangular table (4 per side, no end seats):
//     Side A: slots 0,1,2,3
//     Side B: slots 7,6,5,4  (faces Side A; slot 4 is opposite slot 3, slot 7 opposite slot 0)
//
// Rules (in priority order):
//   1. Anchored guests are never moved.
//   2. Household members always occupy a contiguous seat block (hard).
//   3. Group members occupy a contiguous seat block within the row surface (hard).
//   4. Row capacity is never exceeded (hard).
//   5. Prefer single-group rows; mixed only when unavoidable.
//   6. Household members sit next to each other (adjacent seat slots).
//   7. Even spread across rows.
//   8. Host-side balance as final tie-breaker.
//   9. Fully deterministic: alphabetical group name → alphabetical household as tiebreak.

const ROW_SIZE = TABLES_PER_ROW * TABLE_CAPACITY; // = 40 seats per row

// ─── Row-surface helpers ──────────────────────────────────────────────────────

/** Build a flat array of ROW_SIZE seat values from a slice of tables. */
function buildRowSurface(tables: TableState[]): Array<string | null> {
  const surface: Array<string | null> = [];
  for (const table of tables) {
    for (let s = 0; s < TABLE_CAPACITY; s += 1) {
      surface.push(table.guestIds[s] ?? null);
    }
  }
  // surface.length should equal ROW_SIZE when given a full row of tables.
  console.assert(tables.length !== TABLES_PER_ROW || surface.length === ROW_SIZE);
  return surface;
}

/** Write a flat row surface back into the table slot arrays (mutates nextTables in place). */
function applyRowSurface(
  surface: Array<string | null>,
  tables: TableState[],
  nextTables: TableState[],
  rowStartTableIdx: number
): void {
  for (let t = 0; t < tables.length; t += 1) {
    const tableIdx = rowStartTableIdx + t;
    const slots = surface.slice(t * TABLE_CAPACITY, (t + 1) * TABLE_CAPACITY);
    nextTables[tableIdx] = { ...nextTables[tableIdx], guestIds: slots };
  }
}

/** Return whether a contiguous window [start, start+len) in surface is free of non-locked guests.
 * Used for future anchor-table logic. */
function windowIsFree(
  surface: Array<string | null>,
  start: number,
  len: number,
  lockedSet: Set<string>
): boolean {
  for (let i = start; i < start + len; i += 1) {
    const id = surface[i];
    if (id !== null && !lockedSet.has(id)) return false;
  }
  return true;
}
void windowIsFree; // reserved for anchor-table logic

/**
 * Find the best contiguous window of `len` seats in `surface` for a group placement.
 * Returns the start index of the window, or -1 if none found.
 *
 * Preference order:
 *   1. Window contains only nulls or same-group guests (single-group preference).
 *   2. Window contains the fewest foreign-group occupied seats (mixed-group fallback).
 *   3. Among ties, prefer earliest start index (determinism).
 *
 * Only null slots are writable. Seated guests (locked or not) are never displaced.
 */
function findCandidateWindows(
  surface: Array<string | null>,
  len: number,
  groupName: string,
  guestProfiles: Record<string, GuestProfile>
): Array<{ start: number; foreignCount: number }> {
  const capacity = surface.length;
  const candidates: Array<{ start: number; foreignCount: number }> = [];

  for (let start = 0; start <= capacity - len; start += 1) {
    let nullCount = 0;
    let foreignCount = 0;

    for (let i = start; i < start + len; i += 1) {
      const id = surface[i];
      if (id === null) {
        nullCount += 1;
        continue;
      }
      // Seated guest (locked or not) — counts as foreign if different group.
      const g = guestProfiles[id]?.group;
      if (g !== groupName) foreignCount += 1;
    }

    if (nullCount < len) continue; // not enough empty seats in this window

    candidates.push({ start, foreignCount });
  }

  candidates.sort((a, b) => {
    if (a.foreignCount !== b.foreignCount) return a.foreignCount - b.foreignCount;
    return a.start - b.start;
  });

  return candidates;
}

/**
 * Place `guestIds` into `surface` starting at `windowStart`.
 * Households are kept contiguous on the same side (Side A = slots 0-3, Side B = slots 4-7 per table).
 * Locked guests already in the window are skipped.
 * Returns a new surface array.
 */
function placeGroupIntoWindow(
  surface: Array<string | null>,
  windowStart: number,
  guestIds: string[],
  guestProfiles: Record<string, GuestProfile>
): Array<string | null> | null {
  const next = [...surface];

  // Window length equals group size; only this exact segment is writable.
  const writable: number[] = [];
  for (let i = windowStart; i < windowStart + guestIds.length; i += 1) {
    if (surface[i] === null) writable.push(i);
  }
  if (writable.length < guestIds.length) return null;

  // Sort households: largest first, then alphabetical household key.
  const householdBuckets = new Map<string, string[]>();
  for (const guestId of guestIds) {
    const hh = guestProfiles[guestId]?.partyId ?? guestId;
    const bucket = householdBuckets.get(hh) ?? [];
    bucket.push(guestId);
    householdBuckets.set(hh, bucket);
  }
  const sortedHouseholds = [...householdBuckets.values()].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const hhA = guestProfiles[a[0]]?.partyId ?? a[0];
    const hhB = guestProfiles[b[0]]?.partyId ?? b[0];
    return hhA.localeCompare(hhB);
  });

  const writableByTable = new Map<number, number[]>();
  for (const idx of writable) {
    const tableIdx = Math.floor(idx / TABLE_CAPACITY);
    const slots = writableByTable.get(tableIdx) ?? [];
    slots.push(idx);
    writableByTable.set(tableIdx, slots);
  }

  function getContiguousRun(slots: number[], len: number): number[] | null {
    if (slots.length < len) return null;
    const sorted = [...slots].sort((a, b) => a - b);

    for (let start = 0; start <= sorted.length - len; start += 1) {
      const run = sorted.slice(start, start + len);
      let contiguous = true;
      for (let i = 1; i < run.length; i += 1) {
        if (run[i] !== run[i - 1] + 1) {
          contiguous = false;
          break;
        }
      }
      if (contiguous) return run;
    }

    return null;
  }

  for (const hhGuests of sortedHouseholds) {
    const tableOptions = [...writableByTable.entries()]
      .map(([tableIdx, slots]) => {
        const run = getContiguousRun(slots, hhGuests.length);
        return run ? { tableIdx, run, spare: slots.length - hhGuests.length } : null;
      })
      .filter(
        (entry): entry is { tableIdx: number; run: number[]; spare: number } => entry !== null
      )
      .sort((a, b) => {
        if (a.spare !== b.spare) return a.spare - b.spare;
        if (a.tableIdx !== b.tableIdx) return a.tableIdx - b.tableIdx;
        return a.run[0] - b.run[0];
      });

    const selected = tableOptions[0];
    if (!selected) return null;

    const { tableIdx, run } = selected;
    for (let i = 0; i < hhGuests.length; i += 1) {
      next[run[i]] = hhGuests[i];
    }
    const remaining = writableByTable.get(tableIdx)?.filter((slot) => !run.includes(slot)) ?? [];
    writableByTable.set(tableIdx, remaining);
  }

  return next;
}

function getSplitHouseholds(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const householdToTables = new Map<string, Set<number>>();

  for (const table of tables) {
    for (const guestId of table.guestIds) {
      if (!guestId) continue;
      const householdId = guestProfiles[guestId]?.partyId;
      if (!householdId) continue;

      const tableNumbers = householdToTables.get(householdId) ?? new Set<number>();
      tableNumbers.add(table.tableNumber);
      householdToTables.set(householdId, tableNumbers);
    }
  }

  const splitHouseholds = new Set<string>();
  for (const [householdId, tableNumbers] of householdToTables.entries()) {
    if (tableNumbers.size > 1) splitHouseholds.add(householdId);
  }

  return splitHouseholds;
}

function getNonAdjacentHouseholds(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const householdToSeats = new Map<string, Array<{ tableNumber: number; seatIdx: number }>>();

  for (const table of tables) {
    table.guestIds.forEach((guestId, seatIdx) => {
      if (!guestId) return;
      const householdId = guestProfiles[guestId]?.partyId;
      if (!householdId) return;

      const seats = householdToSeats.get(householdId) ?? [];
      seats.push({ tableNumber: table.tableNumber, seatIdx });
      householdToSeats.set(householdId, seats);
    });
  }

  const nonAdjacent = new Set<string>();
  for (const [householdId, seats] of householdToSeats.entries()) {
    if (seats.length <= 1) continue;

    const tableNumbers = new Set(seats.map((s) => s.tableNumber));
    if (tableNumbers.size !== 1) continue;

    const seatIdxs = seats.map((s) => s.seatIdx).sort((a, b) => a - b);
    let contiguous = true;
    for (let i = 1; i < seatIdxs.length; i += 1) {
      if (seatIdxs[i] !== seatIdxs[i - 1] + 1) {
        contiguous = false;
        break;
      }
    }

    if (!contiguous) {
      nonAdjacent.add(householdId);
    }
  }

  return nonAdjacent;
}

function introducesNewHouseholdSplit(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;

  const previousSplits = getSplitHouseholds(previousTables, guestProfiles);
  const nextSplits = getSplitHouseholds(nextTables, guestProfiles);
  for (const householdId of nextSplits) {
    if (!previousSplits.has(householdId)) return true;
  }

  return false;
}

function introducesNewHouseholdAdjacencyViolation(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;

  const previousViolations = getNonAdjacentHouseholds(previousTables, guestProfiles);
  const nextViolations = getNonAdjacentHouseholds(nextTables, guestProfiles);
  for (const householdId of nextViolations) {
    if (!previousViolations.has(householdId)) return true;
  }

  return false;
}

/** Count how many unique FOREIGN group names (groups ≠ excludeGroup) occupy a row surface. */
function countGroupsInSurface(
  surface: Array<string | null>,
  _lockedSet: Set<string>,
  guestProfiles: Record<string, GuestProfile>,
  excludeGroup?: string
): number {
  const groups = new Set<string>();
  for (const id of surface) {
    if (!id) continue;
    const g = guestProfiles[id]?.group;
    if (g && g !== excludeGroup) groups.add(g);
  }
  return groups.size;
}

/** Count open (null) seats in a surface. */
function countOpenSeats(surface: Array<string | null>): number {
  return surface.filter((s) => s === null).length;
}

// ─── Main algorithm ───────────────────────────────────────────────────────────

function assignGuestsSmart(
  state: SeatingState,
  incomingGuestIds: string[],
  guestProfiles: Record<string, GuestProfile>
): SeatingState {
  const orderedGuestIds = getUniqueGuestIds(incomingGuestIds);
  if (orderedGuestIds.length === 0) return state;

  const lockedSet = new Set(state.lockedGuestIds ?? []);

  // Already-seated guests (locked or not) are never disturbed by auto-seating.
  // Auto-seating only fills unassigned guests into empty seats.
  const alreadySeatedSet = new Set(
    state.tables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null))
  );

  // Only seat guests who are currently unassigned and not locked.
  const toSeat = orderedGuestIds.filter((id) => !lockedSet.has(id) && !alreadySeatedSet.has(id));
  if (toSeat.length === 0) return state;

  // Build working copy of tables — no guests are removed since toSeat contains only unassigned guests.
  const nextTables = state.tables.map((table) => ({
    ...table,
    guestIds: [...table.guestIds],
  }));

  // Check global capacity.
  const totalOpen = nextTables.reduce(
    (n, t) => n + t.guestIds.filter((id) => id === null).length,
    0
  );
  if (totalOpen < toSeat.length) return state;

  // ── Phase 1: bucket incoming guests by group, then by household within group ──
  // Groups with no group name are treated as their own solo group keyed by partyId.
  const groupBuckets = new Map<string, string[]>();
  for (const guestId of toSeat) {
    const key =
      guestProfiles[guestId]?.group || `__solo_${guestProfiles[guestId]?.partyId ?? guestId}`;
    const bucket = groupBuckets.get(key) ?? [];
    bucket.push(guestId);
    groupBuckets.set(key, bucket);
  }

  // Sort groups: largest first, alphabetical name tie-break (determinism).
  const sortedGroups = [...groupBuckets.entries()].sort(([nameA, a], [nameB, b]) => {
    if (b.length !== a.length) return b.length - a.length;
    return nameA.localeCompare(nameB);
  });

  // ── Phase 2: assign each group to a row surface window ───────────────────────
  // Build row surfaces from the working tables.
  const numRows = Math.ceil(nextTables.length / TABLES_PER_ROW);

  // Helper: rebuild surfaces from current nextTables state.
  function getRowSurfaces(): Array<Array<string | null>> {
    const surfaces: Array<Array<string | null>> = [];
    for (let r = 0; r < numRows; r += 1) {
      const rowTables = nextTables.slice(r * TABLES_PER_ROW, (r + 1) * TABLES_PER_ROW);
      surfaces.push(buildRowSurface(rowTables));
    }
    return surfaces;
  }

  for (const [groupName, groupGuestIds] of sortedGroups) {
    const needed = groupGuestIds.length;
    const surfaces = getRowSurfaces();

    // Score each row: find the best VIABLE window in each row, then pick the best row.
    // Tier 1: row with only this group (or empty) + a valid window.
    // Tier 2: row with mixed groups but a valid window.
    // Within tier: prefer tightest fit (fewest open seats while still fitting), then earliest row.

    interface RowOption {
      rowIdx: number;
      windowStart: number;
      foreignGroupCount: number;
      openSeats: number;
    }
    const options: RowOption[] = [];

    for (let r = 0; r < numRows; r += 1) {
      const surface = surfaces[r];
      const open = countOpenSeats(surface);
      if (open < needed) continue; // not enough room in this row

      const windows = findCandidateWindows(surface, needed, groupName, guestProfiles);
      if (windows.length === 0) continue;

      const foreignGroupCount = countGroupsInSurface(surface, lockedSet, guestProfiles, groupName);
      const viableWindow = windows.find(
        (window) =>
          placeGroupIntoWindow(surface, window.start, groupGuestIds, guestProfiles) !== null
      );
      if (!viableWindow) continue;

      options.push({
        rowIdx: r,
        windowStart: viableWindow.start,
        foreignGroupCount,
        openSeats: open,
      });
    }

    if (options.length === 0) {
      continue;
    }

    options.sort((a, b) => {
      if (a.foreignGroupCount !== b.foreignGroupCount) {
        return a.foreignGroupCount - b.foreignGroupCount;
      }
      if (a.openSeats !== b.openSeats) {
        return a.openSeats - b.openSeats;
      }
      return a.rowIdx - b.rowIdx;
    });

    let placed = false;
    for (const option of options) {
      const surface = surfaces[option.rowIdx];
      const newSurface = placeGroupIntoWindow(
        surface,
        option.windowStart,
        groupGuestIds,
        guestProfiles
      );
      if (!newSurface) continue;

      applyRowSurface(
        newSurface,
        nextTables.slice(option.rowIdx * TABLES_PER_ROW, (option.rowIdx + 1) * TABLES_PER_ROW),
        nextTables,
        option.rowIdx * TABLES_PER_ROW
      );
      placed = true;
      break;
    }

    if (!placed) continue;
  }

  // Only remove from unassigned guests who were actually placed in nextTables.
  // Guests the algorithm couldn't place remain in unassigned (they are never lost).
  const nowSeatedSet = new Set(
    nextTables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null))
  );
  const successfullyPlaced = new Set(toSeat.filter((id) => nowSeatedSet.has(id)));

  if (introducesNewHouseholdSplit(state.tables, nextTables, guestProfiles)) {
    return state;
  }
  if (introducesNewHouseholdAdjacencyViolation(state.tables, nextTables, guestProfiles)) {
    return state;
  }

  return {
    tables: nextTables,
    unassigned: state.unassigned.filter((id) => !successfullyPlaced.has(id)),
    lockedGuestIds: state.lockedGuestIds ?? [],
  };
}

export function seatingReducer(state: SeatingState, action: SeatingAction): SeatingState {
  switch (action.type) {
    case "SET_GUEST_ANCHORED": {
      const currentlyAnchored = (state.lockedGuestIds ?? []).includes(action.guestId);
      if (action.anchored === currentlyAnchored) {
        return state;
      }

      const nextLockedGuestIds = action.anchored
        ? [...new Set([...(state.lockedGuestIds ?? []), action.guestId])]
        : (state.lockedGuestIds ?? []).filter((guestId) => guestId !== action.guestId);

      return {
        ...state,
        lockedGuestIds: nextLockedGuestIds,
      };
    }

    case "AUTO_ASSIGN_GUESTS": {
      if (!action.guestProfiles) {
        return assignGuestsWithOverflow(state, 0, action.guestIds);
      }

      return assignGuestsSmart(state, action.guestIds, action.guestProfiles);
    }

    case "ASSIGN_GUESTS": {
      const {
        tableNumber,
        guestIds,
        assignmentMode = "single-table",
        seatIndex,
        guestProfiles,
      } = action;
      const tableIdx = state.tables.findIndex(
        (tableEntry) => tableEntry.tableNumber === tableNumber
      );
      const table = state.tables[tableIdx];
      if (!table) return state;

      if (assignmentMode === "group-overflow") {
        const overflowState = assignGuestsWithOverflow(state, tableIdx, guestIds, seatIndex);
        if (introducesNewHouseholdSplit(state.tables, overflowState.tables, guestProfiles)) {
          return state;
        }
        if (
          introducesNewHouseholdAdjacencyViolation(
            state.tables,
            overflowState.tables,
            guestProfiles
          )
        ) {
          return state;
        }
        return overflowState;
      }

      const orderedGuestIds = getUniqueGuestIds(guestIds);
      const incomingSet = new Set(orderedGuestIds);
      const normalizedTables = state.tables.map((currentTable) => ({
        ...currentTable,
        guestIds: removeGuestsFromSeatSlots(currentTable.guestIds, incomingSet),
      }));
      const targetTable = normalizedTables[tableIdx];
      const availableSeatIndexes = getAvailableSeatIndexes(targetTable.guestIds, seatIndex);
      const updatedSeatSlots = placeGuestsIntoSeatSlots(
        targetTable.guestIds,
        orderedGuestIds,
        availableSeatIndexes
      );
      if (!updatedSeatSlots) return state;

      const newTables = normalizedTables.map((currentTable, index) =>
        index === tableIdx ? { ...currentTable, guestIds: updatedSeatSlots } : currentTable
      );
      if (introducesNewHouseholdSplit(state.tables, newTables, guestProfiles)) return state;
      if (introducesNewHouseholdAdjacencyViolation(state.tables, newTables, guestProfiles)) {
        return state;
      }

      const newUnassigned = state.unassigned.filter((guestId) => !incomingSet.has(guestId));
      return {
        tables: newTables,
        unassigned: newUnassigned,
        lockedGuestIds: state.lockedGuestIds ?? [],
      };
    }

    case "REMOVE_GUESTS": {
      const removedSet = new Set(action.guestIds);
      const newTables = state.tables.map((table) => ({
        ...table,
        guestIds: removeGuestsFromSeatSlots(table.guestIds, removedSet),
      }));
      const newUnassigned = [...new Set([...state.unassigned, ...action.guestIds])];
      const newLocked = (state.lockedGuestIds ?? []).filter((id) => !removedSet.has(id));
      return { tables: newTables, unassigned: newUnassigned, lockedGuestIds: newLocked };
    }

    case "CLEAR_TABLE": {
      const table = state.tables.find((entry) => entry.tableNumber === action.tableNumber);
      if (!table || getOccupiedSeatCount(table.guestIds) === 0) return state;

      const clearedGuestIds = table.guestIds.filter(
        (guestId): guestId is string => guestId !== null
      );

      const newTables = state.tables.map((entry) =>
        entry.tableNumber === action.tableNumber
          ? { ...entry, guestIds: createEmptySeatSlots() }
          : entry
      );
      const newUnassigned = [...new Set([...state.unassigned, ...clearedGuestIds])];
      const newLocked = (state.lockedGuestIds ?? []).filter((id) => !clearedGuestIds.includes(id));
      return { tables: newTables, unassigned: newUnassigned, lockedGuestIds: newLocked };
    }

    case "MOVE_TABLE": {
      if (action.activeTableNumber === action.overTableNumber) return state;

      const activeIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.activeTableNumber
      );
      const overIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.overTableNumber
      );
      if (activeIndex === -1 || overIndex === -1) return state;

      return { ...state, tables: arrayMove(state.tables, activeIndex, overIndex) };
    }

    default:
      return state;
  }
}
