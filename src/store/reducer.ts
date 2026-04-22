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

function getOpenSeatIndexesForTable(table: TableState): number[] {
  return getAvailableSeatIndexes(table.guestIds, undefined, table.disabledSeats);
}

function getContiguousRuns(indexes: number[], minimumLength: number): number[][] {
  if (indexes.length < minimumLength) return [];

  const sorted = [...indexes].sort((a, b) => a - b);
  const runs: number[][] = [];
  let runStart = 0;

  for (let i = 1; i <= sorted.length; i += 1) {
    if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) {
      continue;
    }

    const run = sorted.slice(runStart, i);
    if (run.length >= minimumLength) {
      runs.push(run);
    }
    runStart = i;
  }

  return runs;
}

function getRowContiguousSeatRuns(
  nextTables: TableState[],
  candidateTableIdxs: number[]
): Array<Array<{ tableIdx: number; seatIdx: number }>> {
  const sortedTableIdxs = [...candidateTableIdxs].sort((a, b) => a - b);
  const sideARow: Array<{ tableIdx: number; seatIdx: number }> = [];
  const sideBRow: Array<{ tableIdx: number; seatIdx: number }> = [];

  for (const tableIdx of sortedTableIdxs) {
    const table = nextTables[tableIdx];
    const openSeatIndexes = new Set(getOpenSeatIndexesForTable(table));

    for (const seatIdx of [0, 1, 2, 3]) {
      if (openSeatIndexes.has(seatIdx)) {
        sideARow.push({ tableIdx, seatIdx });
      }
    }

    for (const seatIdx of [7, 6, 5, 4]) {
      if (openSeatIndexes.has(seatIdx)) {
        sideBRow.push({ tableIdx, seatIdx });
      }
    }
  }

  function splitIntoRuns(
    seats: Array<{ tableIdx: number; seatIdx: number }>
  ): Array<Array<{ tableIdx: number; seatIdx: number }>> {
    if (seats.length === 0) return [];

    const runs: Array<Array<{ tableIdx: number; seatIdx: number }>> = [];
    let currentRun = [seats[0]];

    for (let i = 1; i < seats.length; i += 1) {
      const previous = seats[i - 1];
      const current = seats[i];
      const sameTable = previous.tableIdx === current.tableIdx;
      const tableDelta = current.tableIdx - previous.tableIdx;
      const onSameSide =
        (previous.seatIdx <= 3 && current.seatIdx <= 3) ||
        (previous.seatIdx >= 4 && current.seatIdx >= 4);
      const isAdjacentWithinTable = sameTable && Math.abs(previous.seatIdx - current.seatIdx) === 1;
      const isAdjacentAcrossTables =
        tableDelta === 1 &&
        ((previous.seatIdx === 3 && current.seatIdx === 0) ||
          (previous.seatIdx === 4 && current.seatIdx === 7));

      if (onSameSide && (isAdjacentWithinTable || isAdjacentAcrossTables)) {
        currentRun.push(current);
        continue;
      }

      runs.push(currentRun);
      currentRun = [current];
    }

    runs.push(currentRun);
    return runs;
  }

  return [...splitIntoRuns(sideARow), ...splitIntoRuns(sideBRow)];
}

function findBestSingleTableRun(
  nextTables: TableState[],
  candidateTableIdxs: number[],
  guestCount: number
): Array<{ tableIdx: number; seatIdx: number }> | null {
  for (const tableIdx of candidateTableIdxs) {
    const runs = getContiguousRuns(getOpenSeatIndexesForTable(nextTables[tableIdx]), guestCount);
    if (runs.length === 0) continue;

    return runs[0].slice(0, guestCount).map((seatIdx) => ({ tableIdx, seatIdx }));
  }

  return null;
}

function findBestRowRun(
  nextTables: TableState[],
  candidateTableIdxs: number[],
  guestCount: number,
  candidateOrder: Map<number, number>
): Array<{ tableIdx: number; seatIdx: number }> | null {
  const runs = getRowContiguousSeatRuns(nextTables, candidateTableIdxs)
    .filter((run) => run.length >= guestCount)
    .sort((a, b) => {
      const aPriority = Math.min(...a.map((seat) => candidateOrder.get(seat.tableIdx) ?? 999));
      const bPriority = Math.min(...b.map((seat) => candidateOrder.get(seat.tableIdx) ?? 999));
      if (aPriority !== bPriority) return aPriority - bPriority;

      const aSpan = a[a.length - 1].tableIdx - a[0].tableIdx;
      const bSpan = b[b.length - 1].tableIdx - b[0].tableIdx;
      if (aSpan !== bSpan) return aSpan - bSpan;

      return a[0].tableIdx - b[0].tableIdx;
    });

  return runs[0]?.slice(0, guestCount) ?? null;
}

function placeGuestsAtSeats(
  nextTables: TableState[],
  seats: Array<{ tableIdx: number; seatIdx: number }>,
  guestIds: string[]
): void {
  for (let i = 0; i < guestIds.length; i += 1) {
    const { tableIdx, seatIdx } = seats[i];
    nextTables[tableIdx].guestIds[seatIdx] = guestIds[i];
  }
}

function buildPlacementUnits(
  guestIds: string[],
  guestProfiles: Record<string, GuestProfile>
): string[][] {
  const households = new Map<string, string[]>();
  const orderedHouseholdIds: string[] = [];

  for (const guestId of guestIds) {
    const householdId = guestProfiles[guestId]?.partyId ?? guestId;
    if (!households.has(householdId)) {
      households.set(householdId, []);
      orderedHouseholdIds.push(householdId);
    }
    households.get(householdId)?.push(guestId);
  }

  return orderedHouseholdIds.map((householdId) => households.get(householdId) ?? []);
}

function getCandidateTableIndexes(
  targetTableIdx: number | null,
  targetScope: AutoAssignTargetScope | undefined,
  tableCount: number
): number[] {
  if (targetTableIdx == null) {
    return Array.from({ length: tableCount }, (_, index) => index);
  }

  if (targetScope === "target-only") {
    return [targetTableIdx];
  }

  return getAdjacentTableIndexesInRow(targetTableIdx, tableCount);
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

/**
 * Returns true if the proposed table layout introduces a new situation where a
 * guest group is represented on a row surface but has only a single isolated
 * member there (surrounded by members of other groups).
 *
 * Currently implemented as a permissive stub — always returns false so that
 * group-row isolation is not enforced during swaps or manual assignments. A
 * full constraint implementation can be added here without changing callers.
 */
function introducesNewGroupRowIsolation(
  _previousTables: TableState[],
  _nextTables: TableState[],
  _guestProfiles?: Record<string, GuestProfile>
): boolean {
  return false;
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
      ? null
      : nextTables.findIndex((table) => table.tableNumber === targetTableNumber);
  if (targetTableNumber != null && targetTableIdx === -1) return state;

  const candidateTableIdxs = getCandidateTableIndexes(
    targetTableIdx,
    targetScope,
    nextTables.length
  );
  const candidateOrder = new Map(candidateTableIdxs.map((tableIdx, index) => [tableIdx, index]));
  const placementUnits = buildPlacementUnits(toSeat, guestProfiles);

  for (const guestIds of placementUnits) {
    const singleTableRun = findBestSingleTableRun(nextTables, candidateTableIdxs, guestIds.length);
    if (singleTableRun) {
      placeGuestsAtSeats(nextTables, singleTableRun, guestIds);
      continue;
    }

    const rowRun = findBestRowRun(nextTables, candidateTableIdxs, guestIds.length, candidateOrder);
    if (rowRun) {
      placeGuestsAtSeats(nextTables, rowRun, guestIds);
      continue;
    }

    const remainingSeats = candidateTableIdxs.flatMap((tableIdx) =>
      getOpenSeatIndexesForTable(nextTables[tableIdx]).map((seatIdx) => ({ tableIdx, seatIdx }))
    );

    if (remainingSeats.length === 0) {
      continue;
    }

    const partialGuests = guestIds.slice(0, remainingSeats.length);
    placeGuestsAtSeats(nextTables, remainingSeats.slice(0, partialGuests.length), partialGuests);
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

  if (successfullyPlaced.size === 0) {
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
