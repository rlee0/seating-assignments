import type { Host, SeatingState, TableState } from "../types";
import { TABLES_PER_ROW, TABLE_CAPACITY, TABLE_COUNT } from "../types";

type AssignmentMode = "single-table" | "group-overflow";
type AutoAssignTargetScope = "target-only" | "target-and-adjacent";

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
      targetTableNumber?: number;
      targetScope?: AutoAssignTargetScope;
    }
  | { type: "REMOVE_GUESTS"; guestIds: string[] }
  | { type: "CLEAR_TABLE"; tableNumber: number }
  | {
      type: "MOVE_TABLE";
      activeTableNumber: number;
      overTableNumber: number;
      guestProfiles?: Record<string, GuestProfile>;
    }
  | {
      type: "SWAP_TABLES";
      activeTableNumber: number;
      overTableNumber: number;
    }
  | { type: "TOGGLE_SEAT_DISABLED"; tableNumber: number; seatIndex: number }
  | { type: "TOGGLE_TABLE_GUEST_LOCKS"; tableNumber: number }
  | { type: "TOGGLE_EMPTY_TABLE_SEATS"; tableNumber: number };

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

function getSeatedHouseholdGuestIds(
  tables: TableState[],
  partyId: string,
  guestProfiles: Record<string, GuestProfile>
): string[] {
  const seatedIds: string[] = [];

  for (const table of tables) {
    for (const guestId of table.guestIds) {
      if (!guestId) continue;
      if (guestProfiles[guestId]?.partyId === partyId) {
        seatedIds.push(guestId);
      }
    }
  }

  return seatedIds;
}

function findGuestSeat(
  tables: TableState[],
  guestId: string
): { tableIdx: number; seatIdx: number } | null {
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const seatIdx = tables[tableIdx].guestIds.indexOf(guestId);
    if (seatIdx !== -1) {
      return { tableIdx, seatIdx };
    }
  }

  return null;
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

function getAvailableSeatIndexes(
  seatSlots: Array<string | null>,
  startIndex?: number,
  disabledSeats?: number[]
): number[] {
  const disabledSet = new Set(disabledSeats ?? []);

  if (startIndex != null) {
    if (
      startIndex < 0 ||
      startIndex >= TABLE_CAPACITY ||
      seatSlots[startIndex] !== null ||
      disabledSet.has(startIndex)
    ) {
      return [];
    }

    const indexes = [startIndex];
    for (let index = startIndex + 1; index < TABLE_CAPACITY; index += 1) {
      if (seatSlots[index] === null && !disabledSet.has(index)) indexes.push(index);
    }
    return indexes;
  }

  return seatSlots.reduce<number[]>((indexes, guestId, index) => {
    if (guestId === null && !disabledSet.has(index)) indexes.push(index);
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
    disabledSeats: [],
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

  if (seatIndex != null) {
    const insertionPositions: Array<{ tableIdx: number; seatIdx: number }> = [];

    for (
      let currentTableIdx = tableIdx;
      currentTableIdx < nextTables.length;
      currentTableIdx += 1
    ) {
      const startSeatIndex = currentTableIdx === tableIdx ? seatIndex : 0;
      const disabledSet = new Set(nextTables[currentTableIdx].disabledSeats ?? []);

      for (
        let currentSeatIdx = startSeatIndex;
        currentSeatIdx < TABLE_CAPACITY;
        currentSeatIdx += 1
      ) {
        if (disabledSet.has(currentSeatIdx)) continue;

        insertionPositions.push({
          tableIdx: currentTableIdx,
          seatIdx: currentSeatIdx,
        });
      }
    }

    if (insertionPositions.length === 0) return state;

    const lockedSet = new Set(state.lockedGuestIds ?? []);
    const shiftedOccupants: string[] = [];

    for (const position of insertionPositions) {
      const occupantId = nextTables[position.tableIdx].guestIds[position.seatIdx];
      if (occupantId === null) continue;
      if (lockedSet.has(occupantId)) return state;

      shiftedOccupants.push(occupantId);
    }

    const insertedSequence = [...remainingGuests, ...shiftedOccupants];
    if (insertedSequence.length > insertionPositions.length) return state;

    for (let index = 0; index < insertionPositions.length; index += 1) {
      const position = insertionPositions[index];
      nextTables[position.tableIdx].guestIds[position.seatIdx] = insertedSequence[index] ?? null;
    }

    return {
      tables: nextTables,
      unassigned: state.unassigned.filter((guestId) => !incomingSet.has(guestId)),
      lockedGuestIds: state.lockedGuestIds ?? [],
    };
  }

  let nextGuestIndex = 0;

  for (
    let index = tableIdx;
    index < nextTables.length && nextGuestIndex < remainingGuests.length;
    index += 1
  ) {
    const availableSeatIndexes = getAvailableSeatIndexes(
      nextTables[index].guestIds,
      index === tableIdx ? seatIndex : undefined,
      nextTables[index].disabledSeats
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
const DISABLED_SEAT_MARKER = "__disabled__";

function buildRowSurface(tables: TableState[]): Array<string | null> {
  const surface: Array<string | null> = [];
  for (const table of tables) {
    const disabledSet = new Set(table.disabledSeats ?? []);
    for (let s = 0; s < TABLE_CAPACITY; s += 1) {
      if (disabledSet.has(s)) {
        surface.push(DISABLED_SEAT_MARKER);
      } else {
        surface.push(table.guestIds[s] ?? null);
      }
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
  guestProfiles: Record<string, GuestProfile>,
  preferredTableIdx?: number
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
        const aPreferred = preferredTableIdx != null && a.tableIdx === preferredTableIdx ? 0 : 1;
        const bPreferred = preferredTableIdx != null && b.tableIdx === preferredTableIdx ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
        // Among non-preferred tables, pick the one closest to the preferred table
        // so that overflow households cluster near the target rather than jumping far.
        if (preferredTableIdx != null) {
          const aDist = Math.abs(a.tableIdx - preferredTableIdx);
          const bDist = Math.abs(b.tableIdx - preferredTableIdx);
          if (aDist !== bDist) return aDist - bDist;
        }
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

/**
 * A household is "split" if its members span multiple tables and those members
 * are NOT on the same side of the row AND physically contiguous (next to each
 * other) on that side.
 *
 * A household that spans tables is acceptable when:
 *   1. All members are on Side A (slots 0-3) OR all on Side B (slots 4-7).
 *   2. All members are in the same table row.
 *   3. Their physical positions on that side are consecutive (no gaps).
 */
function getSplitHouseholds(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  // Map each household to its members' positions (display index + seat slot).
  const householdPositions = new Map<string, Array<{ tableIdx: number; seatIdx: number }>>();

  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const table = tables[tableIdx];
    table.guestIds.forEach((guestId, seatIdx) => {
      if (!guestId) return;
      const householdId = guestProfiles[guestId]?.partyId;
      if (!householdId) return;
      const positions = householdPositions.get(householdId) ?? [];
      positions.push({ tableIdx, seatIdx });
      householdPositions.set(householdId, positions);
    });
  }

  const splitHouseholds = new Set<string>();

  for (const [householdId, positions] of householdPositions.entries()) {
    if (positions.length <= 1) continue;

    // Same table — adjacency is checked separately.
    const tableIdxSet = new Set(positions.map((p) => p.tableIdx));
    if (tableIdxSet.size === 1) continue;

    // Members span multiple tables. Check same-side + same-row + contiguous.
    const isAllSideA = positions.every((p) => p.seatIdx <= 3);
    const isAllSideB = positions.every((p) => p.seatIdx >= 4);

    if (!isAllSideA && !isAllSideB) {
      // Members are on different sides — always a split.
      splitHouseholds.add(householdId);
      continue;
    }

    // All members must be in the same table row.
    const rows = new Set(positions.map((p) => Math.floor(p.tableIdx / TABLES_PER_ROW)));
    if (rows.size > 1) {
      splitHouseholds.add(householdId);
      continue;
    }

    // Compute physical left-to-right linear position on the side.
    // Side A: slot s  → column * 4 + s         (order 0→1→2→3)
    // Side B: slot s  → column * 4 + (7 - s)   (order 7→6→5→4, i.e. slot 7 leftmost)
    const linearPositions = positions.map((p) => {
      const col = p.tableIdx % TABLES_PER_ROW;
      return isAllSideA ? col * 4 + p.seatIdx : col * 4 + (7 - p.seatIdx);
    });

    linearPositions.sort((a, b) => a - b);
    let contiguous = true;
    for (let i = 1; i < linearPositions.length; i += 1) {
      if (linearPositions[i] !== linearPositions[i - 1] + 1) {
        contiguous = false;
        break;
      }
    }

    if (!contiguous) {
      splitHouseholds.add(householdId);
    }
  }

  return splitHouseholds;
}

/**
 * Two seats within the same table are adjacent if:
 *   - They are on the same side and consecutive: (0,1), (1,2), (2,3), (4,5), (5,6), (6,7)
 *   - They are directly across from each other: slot a + slot b === 7
 *     i.e. (0,7), (1,6), (2,5), (3,4)
 *
 * For a household on a single table, all members must form a connected group
 * under this adjacency definition.
 *
 * Cross-table households that pass getSplitHouseholds are on the same side and
 * contiguous, which implies adjacency, so they are not re-checked here.
 */
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

  // Two seat slot indices are adjacent under the new rules.
  function areSlotsAdjacent(a: number, b: number): boolean {
    // Same side, consecutive
    if (Math.abs(a - b) === 1 && a <= 3 === b <= 3) return true;
    // Directly across from each other
    if (a + b === 7) return true;
    return false;
  }

  const nonAdjacent = new Set<string>();

  for (const [householdId, seats] of householdToSeats.entries()) {
    if (seats.length <= 1) continue;

    // Cross-table households: adjacency is already guaranteed by getSplitHouseholds.
    const tableNumbers = new Set(seats.map((s) => s.tableNumber));
    if (tableNumbers.size !== 1) continue;

    // BFS connectivity check on the single-table adjacency graph.
    const seatIdxs = seats.map((s) => s.seatIdx);
    const visited = new Set<number>();
    const queue = [seatIdxs[0]];
    visited.add(seatIdxs[0]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const other of seatIdxs) {
        if (!visited.has(other) && areSlotsAdjacent(current, other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }

    if (visited.size !== seatIdxs.length) {
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

function getRowBoundsForTableIndex(
  tableIdx: number,
  tableCount: number
): {
  rowStart: number;
  rowEndExclusive: number;
} {
  const rowStart = Math.floor(tableIdx / TABLES_PER_ROW) * TABLES_PER_ROW;
  return {
    rowStart,
    rowEndExclusive: Math.min(rowStart + TABLES_PER_ROW, tableCount),
  };
}

function getRowAndColumnForTableIndex(tableIdx: number): { row: number; column: number } {
  return {
    row: Math.floor(tableIdx / TABLES_PER_ROW),
    column: tableIdx % TABLES_PER_ROW,
  };
}

function getTableIndexForRowAndColumn(
  row: number,
  column: number,
  tableCount: number
): number | null {
  if (row < 0 || column < 0 || column >= TABLES_PER_ROW) return null;

  const tableIdx = row * TABLES_PER_ROW + column;
  if (tableIdx < 0 || tableIdx >= tableCount) return null;
  return tableIdx;
}

function getAdjacentTableIndexesInRow(targetTableIdx: number, tableCount: number): number[] {
  const { rowStart, rowEndExclusive } = getRowBoundsForTableIndex(targetTableIdx, tableCount);
  const indexes: number[] = [targetTableIdx];

  for (
    let distance = 1;
    rowStart <= targetTableIdx - distance || targetTableIdx + distance < rowEndExclusive;
    distance += 1
  ) {
    const left = targetTableIdx - distance;
    if (left >= rowStart) indexes.push(left);

    const right = targetTableIdx + distance;
    if (right < rowEndExclusive) indexes.push(right);
  }

  return indexes;
}

function windowUsesOnlyTables(
  windowStart: number,
  windowLength: number,
  rowStartTableIdx: number,
  allowedTableIdxs: Set<number>
): boolean {
  for (let i = windowStart; i < windowStart + windowLength; i += 1) {
    const tableIdx = rowStartTableIdx + Math.floor(i / TABLE_CAPACITY);
    if (!allowedTableIdxs.has(tableIdx)) return false;
  }

  return true;
}

function getClosestAllowedTableDistance(
  windowStart: number,
  windowLength: number,
  rowStartTableIdx: number,
  targetTableIdx: number
): number {
  let minDistance = Number.POSITIVE_INFINITY;

  for (let i = windowStart; i < windowStart + windowLength; i += 1) {
    const tableIdx = rowStartTableIdx + Math.floor(i / TABLE_CAPACITY);
    const source = getRowAndColumnForTableIndex(tableIdx);
    const target = getRowAndColumnForTableIndex(targetTableIdx);
    const manhattanDistance =
      Math.abs(source.row - target.row) + Math.abs(source.column - target.column);

    minDistance = Math.min(minDistance, manhattanDistance);
  }

  return minDistance;
}

function getTargetTablePreference(
  tableIdx: number,
  targetTableIdx: number
): { tier: number; distance: number } {
  if (tableIdx === targetTableIdx) {
    return { tier: 0, distance: 0 };
  }

  const source = getRowAndColumnForTableIndex(tableIdx);
  const target = getRowAndColumnForTableIndex(targetTableIdx);
  const rowDistance = Math.abs(source.row - target.row);
  const columnDistance = Math.abs(source.column - target.column);

  if (rowDistance === 0 && columnDistance === 1) {
    return { tier: 1, distance: 1 };
  }
  if (rowDistance === 1 && columnDistance === 0) {
    return { tier: 2, distance: 1 };
  }
  if (rowDistance === 0) {
    return { tier: 3, distance: columnDistance };
  }

  return {
    tier: 4,
    distance: rowDistance + columnDistance,
  };
}

function getRowOptionPreference(rowTier: number, distanceFromTarget: number): number {
  if (distanceFromTarget === 0) return 0;
  if (rowTier === 0 && distanceFromTarget === 1) return 1;
  if (rowTier === 1 && distanceFromTarget === 1) return 2;
  if (rowTier === 0) return 3;
  return 4;
}

function countIncomingGuestsInTable(
  surface: Array<string | null>,
  rowStartTableIdx: number,
  targetTableIdx: number,
  guestIds: string[]
): number {
  const localTableIdx = targetTableIdx - rowStartTableIdx;
  if (localTableIdx < 0) return 0;

  const start = localTableIdx * TABLE_CAPACITY;
  const end = start + TABLE_CAPACITY;
  if (start < 0 || end > surface.length) return 0;

  const guestIdSet = new Set(guestIds);
  return surface
    .slice(start, end)
    .filter((guestId): guestId is string => !!guestId)
    .filter((guestId) => guestIdSet.has(guestId)).length;
}

function getGroupsWithSingleMemberOnDifferentRow(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const groupToRowCounts = new Map<string, Map<number, number>>();

  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const row = Math.floor(tableIdx / TABLES_PER_ROW);
    for (const guestId of tables[tableIdx].guestIds) {
      if (!guestId) continue;

      const groupName = guestProfiles[guestId]?.group?.trim() ?? "";
      if (!groupName) continue;

      const rowCounts = groupToRowCounts.get(groupName) ?? new Map<number, number>();
      rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
      groupToRowCounts.set(groupName, rowCounts);
    }
  }

  const violations = new Set<string>();
  for (const [groupName, rowCounts] of groupToRowCounts.entries()) {
    if (rowCounts.size <= 1) continue;

    if ([...rowCounts.values()].some((count) => count === 1)) {
      violations.add(groupName);
    }
  }

  return violations;
}

function introducesNewGroupRowIsolation(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;

  const previousViolations = getGroupsWithSingleMemberOnDifferentRow(previousTables, guestProfiles);
  const nextViolations = getGroupsWithSingleMemberOnDifferentRow(nextTables, guestProfiles);

  for (const groupName of nextViolations) {
    if (!previousViolations.has(groupName)) return true;
  }

  return false;
}

// ─── Main algorithm ───────────────────────────────────────────────────────────

function assignGuestsSmart(
  state: SeatingState,
  incomingGuestIds: string[],
  guestProfiles: Record<string, GuestProfile>,
  options?: {
    targetTableNumber?: number;
    targetScope?: AutoAssignTargetScope;
    allowReseatIncoming?: boolean;
  }
): SeatingState {
  const orderedGuestIds = getUniqueGuestIds(incomingGuestIds);
  if (orderedGuestIds.length === 0) return state;

  const lockedSet = new Set(state.lockedGuestIds ?? []);

  // Already-seated guests (locked or not) are never disturbed by default.
  // Targeted table-drop auto-seat can opt-in to re-seating the incoming guests.
  const alreadySeatedSet = new Set(
    state.tables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null))
  );

  const allowReseatIncoming = options?.allowReseatIncoming ?? false;
  const targetTableNumber = options?.targetTableNumber;
  const targetScope = options?.targetScope;

  const incomingReseatSet = new Set(
    allowReseatIncoming
      ? orderedGuestIds.filter((id) => !lockedSet.has(id) && alreadySeatedSet.has(id))
      : []
  );

  const toSeat = orderedGuestIds.filter(
    (id) => !lockedSet.has(id) && (!alreadySeatedSet.has(id) || incomingReseatSet.has(id))
  );
  if (toSeat.length === 0) return state;

  // Build working copy of tables. Targeted guest->table can remove incoming guests first.
  const nextTables = state.tables.map((table) => ({
    ...table,
    guestIds: removeGuestsFromSeatSlots(table.guestIds, incomingReseatSet),
  }));

  const targetTableIdx =
    targetTableNumber == null
      ? -1
      : nextTables.findIndex((table) => table.tableNumber === targetTableNumber);
  if (targetTableNumber != null && targetTableIdx === -1) return state;

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
      distanceFromTarget: number;
      targetSeatCount: number;
      rowTier: number;
    }
    const options: RowOption[] = [];

    for (let r = 0; r < numRows; r += 1) {
      const surface = surfaces[r];
      const targetPosition =
        targetTableIdx === -1 ? null : getRowAndColumnForTableIndex(targetTableIdx);

      const rowStartTableIdx = r * TABLES_PER_ROW;
      let rowTier = 0;
      if (targetPosition) {
        const rowDistance = Math.abs(targetPosition.row - r);

        if (targetScope === "target-only") {
          if (targetPosition.row !== r) continue;
        } else {
          if (rowDistance > 1) continue;
        }

        rowTier = targetPosition.row === r ? 0 : 1;
      }

      const open = countOpenSeats(surface);
      if (open < needed) continue; // not enough room in this row

      let windows = findCandidateWindows(surface, needed, groupName, guestProfiles);

      if (targetPosition) {
        let allowedTableIdxs: Set<number>;
        if (targetScope === "target-only") {
          allowedTableIdxs = new Set<number>([targetTableIdx]);
        } else if (targetPosition.row === r) {
          allowedTableIdxs = new Set<number>(
            getAdjacentTableIndexesInRow(targetTableIdx, nextTables.length)
          );
        } else {
          const nearbyAdjacentRowIdx = getTableIndexForRowAndColumn(
            r,
            targetPosition.column,
            nextTables.length
          );
          if (nearbyAdjacentRowIdx == null) continue;
          allowedTableIdxs = new Set<number>([nearbyAdjacentRowIdx]);
        }

        windows = windows.filter((window) =>
          windowUsesOnlyTables(window.start, needed, rowStartTableIdx, allowedTableIdxs)
        );
      }

      if (windows.length === 0) continue;

      const preferredTableIdxInRow = !targetPosition
        ? undefined
        : (() => {
            if (targetPosition.row === r) {
              return targetTableIdx - rowStartTableIdx;
            }

            const nearbyAdjacentRowIdx = getTableIndexForRowAndColumn(
              r,
              targetPosition.column,
              nextTables.length
            );
            return nearbyAdjacentRowIdx == null
              ? undefined
              : nearbyAdjacentRowIdx - rowStartTableIdx;
          })();

      const foreignGroupCount = countGroupsInSurface(surface, lockedSet, guestProfiles, groupName);
      const viableWindows = windows
        .map((window) => {
          const placedSurface = placeGroupIntoWindow(
            surface,
            window.start,
            groupGuestIds,
            guestProfiles,
            preferredTableIdxInRow
          );
          if (!placedSurface) return null;

          const targetSeatCount = !targetPosition
            ? 0
            : countIncomingGuestsInTable(
                placedSurface,
                rowStartTableIdx,
                targetPosition.row === r
                  ? targetTableIdx
                  : (getTableIndexForRowAndColumn(r, targetPosition.column, nextTables.length) ??
                      -1),
                groupGuestIds
              );

          return {
            ...window,
            placedSurface,
            targetSeatCount,
          };
        })
        .filter(
          (
            window
          ): window is {
            start: number;
            foreignCount: number;
            placedSurface: Array<string | null>;
            targetSeatCount: number;
          } => window !== null
        );
      const viableWindow = viableWindows.sort((a, b) => {
        if (a.targetSeatCount !== b.targetSeatCount) return b.targetSeatCount - a.targetSeatCount;
        const aDistance =
          targetTableIdx === -1
            ? Number.POSITIVE_INFINITY
            : getClosestAllowedTableDistance(a.start, needed, rowStartTableIdx, targetTableIdx);
        const bDistance =
          targetTableIdx === -1
            ? Number.POSITIVE_INFINITY
            : getClosestAllowedTableDistance(b.start, needed, rowStartTableIdx, targetTableIdx);

        if (aDistance !== bDistance) return aDistance - bDistance;
        if (a.foreignCount !== b.foreignCount) return a.foreignCount - b.foreignCount;
        return a.start - b.start;
      })[0];
      if (!viableWindow) continue;

      const distanceFromTarget =
        targetTableIdx === -1
          ? Number.POSITIVE_INFINITY
          : getClosestAllowedTableDistance(
              viableWindow.start,
              needed,
              rowStartTableIdx,
              targetTableIdx
            );

      options.push({
        rowIdx: r,
        windowStart: viableWindow.start,
        foreignGroupCount,
        openSeats: open,
        distanceFromTarget,
        targetSeatCount: viableWindow.targetSeatCount,
        rowTier,
      });
    }

    if (options.length === 0) {
      // Fallback: place households one-by-one by scored proximity, and stop
      // once only far same-row spill options remain.
      if (targetTableIdx !== -1 && targetScope !== "target-only") {
        const targetPos = getRowAndColumnForTableIndex(targetTableIdx);
        const nearbyTableIdxs = [
          ...getAdjacentTableIndexesInRow(targetTableIdx, nextTables.length),
        ];
        for (const rowOffset of [-1, 1]) {
          const adjacentRowIdx = getTableIndexForRowAndColumn(
            targetPos.row + rowOffset,
            targetPos.column,
            nextTables.length
          );
          if (adjacentRowIdx != null) nearbyTableIdxs.push(adjacentRowIdx);
        }

        const householdBuckets = new Map<string, string[]>();
        for (const guestId of groupGuestIds) {
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

        const draftGuestIds = new Map<number, Array<string | null>>(
          nearbyTableIdxs.map((idx) => [idx, [...nextTables[idx].guestIds]])
        );
        let placedAnyHousehold = false;

        for (const hhGuests of sortedHouseholds) {
          const candidateTables = nearbyTableIdxs
            .map((tableIdx) => {
              const seats = draftGuestIds.get(tableIdx);
              if (!seats) return null;

              const openSlots = seats
                .map((id, i) => (id === null ? i : -1))
                .filter((i) => i !== -1);
              if (openSlots.length < hhGuests.length) return null;

              let run: number[] | null = null;
              for (let start = 0; start <= openSlots.length - hhGuests.length; start += 1) {
                const candidate = openSlots.slice(start, start + hhGuests.length);
                const isContiguous = candidate.every(
                  (slot, i) => i === 0 || slot === candidate[i - 1] + 1
                );
                if (isContiguous) {
                  run = candidate;
                  break;
                }
              }
              if (!run) return null;

              return {
                tableIdx,
                run,
                spare: openSlots.length - hhGuests.length,
                preference: getTargetTablePreference(tableIdx, targetTableIdx),
              };
            })
            .filter(
              (
                entry
              ): entry is {
                tableIdx: number;
                run: number[];
                spare: number;
                preference: { tier: number; distance: number };
              } => entry !== null
            )
            .sort((a, b) => {
              if (a.preference.tier !== b.preference.tier) {
                return a.preference.tier - b.preference.tier;
              }
              if (a.preference.distance !== b.preference.distance) {
                return a.preference.distance - b.preference.distance;
              }
              if (a.spare !== b.spare) {
                return a.spare - b.spare;
              }
              return a.tableIdx - b.tableIdx;
            });

          const selected = candidateTables[0];
          if (!selected || selected.preference.tier > 2) {
            break;
          }

          const seats = draftGuestIds.get(selected.tableIdx);
          if (!seats) continue;
          for (let i = 0; i < hhGuests.length; i += 1) {
            seats[selected.run[i]] = hhGuests[i];
          }
          placedAnyHousehold = true;
        }

        if (placedAnyHousehold) {
          for (const [tableIdx, guestIds] of draftGuestIds) {
            nextTables[tableIdx] = { ...nextTables[tableIdx], guestIds };
          }
          continue;
        }
      }
      continue;
    }

    options.sort((a, b) => {
      const aPreference = getRowOptionPreference(a.rowTier, a.distanceFromTarget);
      const bPreference = getRowOptionPreference(b.rowTier, b.distanceFromTarget);
      if (aPreference !== bPreference) {
        return aPreference - bPreference;
      }
      if (a.targetSeatCount !== b.targetSeatCount) {
        return b.targetSeatCount - a.targetSeatCount;
      }
      if (a.distanceFromTarget !== b.distanceFromTarget) {
        return a.distanceFromTarget - b.distanceFromTarget;
      }
      if (a.rowTier !== b.rowTier) {
        return a.rowTier - b.rowTier;
      }
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
      const preferredTableIdxInRow =
        targetTableIdx === -1
          ? undefined
          : (() => {
              const targetPosition = getRowAndColumnForTableIndex(targetTableIdx);
              if (targetPosition.row === option.rowIdx) {
                return targetTableIdx - option.rowIdx * TABLES_PER_ROW;
              }

              const nearbyAdjacentRowIdx = getTableIndexForRowAndColumn(
                option.rowIdx,
                targetPosition.column,
                nextTables.length
              );
              return nearbyAdjacentRowIdx == null
                ? undefined
                : nearbyAdjacentRowIdx - option.rowIdx * TABLES_PER_ROW;
            })();
      const newSurface = placeGroupIntoWindow(
        surface,
        option.windowStart,
        groupGuestIds,
        guestProfiles,
        preferredTableIdxInRow
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
  if (introducesNewGroupRowIsolation(state.tables, nextTables, guestProfiles)) {
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

      return assignGuestsSmart(state, action.guestIds, action.guestProfiles, {
        targetTableNumber: action.targetTableNumber,
        targetScope: action.targetScope,
        allowReseatIncoming: action.targetTableNumber != null,
      });
    }

    case "ASSIGN_GUESTS": {
      const {
        tableNumber,
        guestIds,
        assignmentMode = "single-table",
        seatIndex,
        guestProfiles,
      } = action;
      const isManualSeatOverride = assignmentMode === "single-table" && seatIndex != null;
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

      let orderedGuestIds = getUniqueGuestIds(guestIds);

      if (orderedGuestIds.length === 1 && seatIndex != null) {
        const incomingGuestId = orderedGuestIds[0];
        const incomingSeat = findGuestSeat(state.tables, incomingGuestId);
        const targetSeatGuestId = table.guestIds[seatIndex];

        if (
          incomingSeat &&
          targetSeatGuestId !== null &&
          targetSeatGuestId !== incomingGuestId &&
          seatIndex >= 0 &&
          seatIndex < TABLE_CAPACITY
        ) {
          const lockedSet = new Set(state.lockedGuestIds ?? []);
          if (lockedSet.has(incomingGuestId) || lockedSet.has(targetSeatGuestId)) {
            return state;
          }

          const nextTables = state.tables.map((currentTable) => ({
            ...currentTable,
            guestIds: [...currentTable.guestIds],
          }));

          nextTables[tableIdx].guestIds[seatIndex] = incomingGuestId;
          nextTables[incomingSeat.tableIdx].guestIds[incomingSeat.seatIdx] = targetSeatGuestId;

          if (!isManualSeatOverride) {
            if (introducesNewHouseholdSplit(state.tables, nextTables, guestProfiles)) {
              return state;
            }
            if (introducesNewHouseholdAdjacencyViolation(state.tables, nextTables, guestProfiles)) {
              return state;
            }
            if (introducesNewGroupRowIsolation(state.tables, nextTables, guestProfiles)) {
              return state;
            }
          }

          return {
            tables: nextTables,
            unassigned: state.unassigned.filter((guestId) => guestId !== incomingGuestId),
            lockedGuestIds: state.lockedGuestIds ?? [],
          };
        }
      }

      if (!isManualSeatOverride && orderedGuestIds.length === 1 && guestProfiles) {
        const dragGuestId = orderedGuestIds[0];
        const partyId = guestProfiles[dragGuestId]?.partyId;
        if (partyId) {
          const seatedHouseholdGuestIds = getSeatedHouseholdGuestIds(
            state.tables,
            partyId,
            guestProfiles
          );
          if (seatedHouseholdGuestIds.length > 1 && seatedHouseholdGuestIds.includes(dragGuestId)) {
            // Preserve household integrity when manually moving one seated household member.
            orderedGuestIds = seatedHouseholdGuestIds;
          }
        }
      }

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
      if (!isManualSeatOverride) {
        if (introducesNewHouseholdSplit(state.tables, newTables, guestProfiles)) return state;
        if (introducesNewHouseholdAdjacencyViolation(state.tables, newTables, guestProfiles)) {
          return state;
        }
        if (introducesNewGroupRowIsolation(state.tables, newTables, guestProfiles)) {
          return state;
        }
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

    case "TOGGLE_SEAT_DISABLED": {
      const { tableNumber, seatIndex } = action;
      const tableIdx = state.tables.findIndex((t) => t.tableNumber === tableNumber);
      if (tableIdx === -1) return state;
      const table = state.tables[tableIdx];

      const currentDisabled = table.disabledSeats ?? [];
      const isCurrentlyDisabled = currentDisabled.includes(seatIndex);

      let nextUnassigned = state.unassigned;
      let nextLockedGuestIds = state.lockedGuestIds ?? [];
      let nextGuestIds = table.guestIds;

      if (!isCurrentlyDisabled) {
        // Disabling: if a guest occupies this seat, evict them
        const evictedGuestId = table.guestIds[seatIndex];
        if (evictedGuestId !== null) {
          nextGuestIds = table.guestIds.map((id, i) => (i === seatIndex ? null : id));
          nextUnassigned = [...new Set([...state.unassigned, evictedGuestId])];
          nextLockedGuestIds = nextLockedGuestIds.filter((id) => id !== evictedGuestId);
        }
      }

      const nextDisabled = isCurrentlyDisabled
        ? currentDisabled.filter((i) => i !== seatIndex)
        : [...currentDisabled, seatIndex];

      const nextTables = state.tables.map((t, i) =>
        i === tableIdx ? { ...t, guestIds: nextGuestIds, disabledSeats: nextDisabled } : t
      );

      return {
        ...state,
        tables: nextTables,
        unassigned: nextUnassigned,
        lockedGuestIds: nextLockedGuestIds,
      };
    }

    case "TOGGLE_TABLE_GUEST_LOCKS": {
      const table = state.tables.find((t) => t.tableNumber === action.tableNumber);
      if (!table) return state;
      const seatedGuestIds = table.guestIds.filter((id): id is string => id !== null);
      if (seatedGuestIds.length === 0) return state;
      const currentLocked = new Set(state.lockedGuestIds ?? []);
      const allLocked = seatedGuestIds.every((id) => currentLocked.has(id));
      const nextLockedGuestIds = allLocked
        ? (state.lockedGuestIds ?? []).filter((id) => !seatedGuestIds.includes(id))
        : [...new Set([...(state.lockedGuestIds ?? []), ...seatedGuestIds])];
      return { ...state, lockedGuestIds: nextLockedGuestIds };
    }

    case "TOGGLE_EMPTY_TABLE_SEATS": {
      const tableIdx = state.tables.findIndex((t) => t.tableNumber === action.tableNumber);
      if (tableIdx === -1) return state;
      const table = state.tables[tableIdx];
      const currentDisabled = new Set(table.disabledSeats ?? []);
      const disabledEmptyIndexes = table.guestIds
        .map((id, i) => (id === null && currentDisabled.has(i) ? i : -1))
        .filter((i) => i !== -1);

      // If there are disabled empty seats, enable them; otherwise disable current empty seats.
      const nextDisabled =
        disabledEmptyIndexes.length > 0
          ? [...currentDisabled].filter((index) => !disabledEmptyIndexes.includes(index))
          : [
              ...currentDisabled,
              ...table.guestIds
                .map((id, i) => (id === null && !currentDisabled.has(i) ? i : -1))
                .filter((i) => i !== -1),
            ];

      if (nextDisabled.length === (table.disabledSeats ?? []).length) {
        return state;
      }

      const nextTables = state.tables.map((t, i) =>
        i === tableIdx ? { ...t, disabledSeats: nextDisabled } : t
      );
      return { ...state, tables: nextTables };
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

      const lockedSet = new Set(state.lockedGuestIds ?? []);
      const activeTable = state.tables[activeIndex];
      const overTable = state.tables[overIndex];
      const disabledOverSeats = new Set(overTable.disabledSeats ?? []);

      const nextTables = state.tables.map((t) => ({ ...t, guestIds: [...t.guestIds] }));
      const nextActiveGuestIds = nextTables[activeIndex].guestIds;
      const nextOverGuestIds = nextTables[overIndex].guestIds;

      const needsAutoseat: string[] = [];

      for (let seatIdx = 0; seatIdx < TABLE_CAPACITY; seatIdx += 1) {
        const guestId = activeTable.guestIds[seatIdx];
        if (!guestId || lockedSet.has(guestId)) continue;

        nextActiveGuestIds[seatIdx] = null;

        if (nextOverGuestIds[seatIdx] === null && !disabledOverSeats.has(seatIdx)) {
          nextOverGuestIds[seatIdx] = guestId;
        } else {
          needsAutoseat.push(guestId);
        }
      }

      const intermediateState: SeatingState = { ...state, tables: nextTables };

      if (needsAutoseat.length === 0) return intermediateState;

      if (action.guestProfiles) {
        return assignGuestsSmart(intermediateState, needsAutoseat, action.guestProfiles, {
          targetTableNumber: action.overTableNumber,
          targetScope: "target-and-adjacent",
        });
      }

      return assignGuestsWithOverflow(intermediateState, overIndex, needsAutoseat);
    }

    case "SWAP_TABLES": {
      if (action.activeTableNumber === action.overTableNumber) return state;

      const activeIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.activeTableNumber
      );
      const overIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.overTableNumber
      );
      if (activeIndex === -1 || overIndex === -1) return state;

      const activeTable = state.tables[activeIndex];
      const overTable = state.tables[overIndex];

      const nextTables = state.tables.map((table, index) => {
        if (index === activeIndex) {
          return {
            ...table,
            guestIds: [...overTable.guestIds],
            disabledSeats: overTable.disabledSeats ? [...overTable.disabledSeats] : [],
          };
        }

        if (index === overIndex) {
          return {
            ...table,
            guestIds: [...activeTable.guestIds],
            disabledSeats: activeTable.disabledSeats ? [...activeTable.disabledSeats] : [],
          };
        }

        return table;
      });

      return { ...state, tables: nextTables };
    }

    default:
      return state;
  }
}
