import type {
  BoardState,
  GridPosition,
  Host,
  NewTableDefaults,
  SeatingState,
  TablePresetId,
  TableSeatConfig,
  TableShape,
  TableState,
} from "../types";
import {
  TABLE_CAPACITY,
  createDefaultBoardState,
  getDefaultTablePresetId,
  getDerivedTableConfigFromPresetId,
  getTableSeatCount,
  inferTablePresetId,
} from "../types";

type AssignmentMode = "single-table" | "circle-overflow";
type AutoAssignTargetScope = "target-only" | "target-and-adjacent";

export interface GuestProfile {
  partyId: string;
  circle: string;
  host: Host;
  party: string;
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
  | {
      type: "AUTO_ASSIGN_GUESTS";
      guestIds: string[];
      guestProfiles?: Record<string, GuestProfile>;
      targetTableNumber?: number;
      targetScope?: AutoAssignTargetScope;
      allowReseatIncoming?: boolean;
      allowPartialPlacementBypass?: boolean;
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
      guestProfiles?: Record<string, GuestProfile>;
    }
  | {
      type: "MOVE_TABLE_POSITION";
      activeTableNumber: number;
      targetGridPosition: GridPosition;
    }
  | {
      type: "UPDATE_BOARD_CONFIG";
      updates: Partial<Pick<BoardState, "rows" | "columns">>;
      newTableDefaults?: Partial<NewTableDefaults>;
    }
  | {
      type: "CREATE_TABLE";
      presetId?: TablePresetId;
      name?: string;
      shape?: TableShape;
      gridPosition?: GridPosition;
      seatConfig?: TableSeatConfig;
    }
  | {
      type: "UPDATE_TABLE_CONFIG";
      tableNumber: number;
      updates: {
        presetId?: TablePresetId;
        name?: string;
        shape?: TableShape;
        gridPosition?: GridPosition;
        seatConfig?: TableSeatConfig;
      };
    }
  | { type: "DELETE_TABLE"; tableNumber: number }
  | { type: "TOGGLE_SEAT_DISABLED"; tableNumber: number; seatIndex: number }
  | { type: "TOGGLE_EMPTY_TABLE_SEATS"; tableNumber: number };

function createEmptySeatSlots(capacity = TABLE_CAPACITY): Array<string | null> {
  return Array<string | null>(capacity).fill(null);
}

function resolveTablePresetId(options: {
  presetId?: TablePresetId;
  shape?: TableShape;
  seatConfig?: TableSeatConfig;
  fallbackPresetId: TablePresetId;
}): TablePresetId {
  if (options.presetId) {
    return options.presetId;
  }

  if (options.seatConfig) {
    return (
      inferTablePresetId(options.shape ?? options.seatConfig.shape, options.seatConfig) ??
      getDefaultTablePresetId(options.shape ?? options.seatConfig.shape)
    );
  }

  if (options.shape) {
    return getDefaultTablePresetId(options.shape);
  }

  return options.fallbackPresetId;
}

function createTableConfigFromDefaults(
  board: BoardState,
  presetId: TablePresetId = board.newTableDefaults.presetId
): Pick<TableState, "presetId" | "shape" | "seatConfig"> {
  return getDerivedTableConfigFromPresetId(presetId);
}

function resolveBoardDefaultPresetId(
  board: BoardState,
  newTableDefaults?: Partial<NewTableDefaults>
): TablePresetId {
  if (newTableDefaults?.presetId) {
    return newTableDefaults.presetId;
  }

  const shape = newTableDefaults?.shape ?? board.newTableDefaults.shape;
  const seatConfig: TableSeatConfig =
    shape === "rectangular"
      ? {
          shape: "rectangular",
          sideCounts: {
            top:
              newTableDefaults?.rectangularSideCounts?.top ??
              board.newTableDefaults.rectangularSideCounts.top,
            right:
              newTableDefaults?.rectangularSideCounts?.right ??
              board.newTableDefaults.rectangularSideCounts.right,
            bottom:
              newTableDefaults?.rectangularSideCounts?.bottom ??
              board.newTableDefaults.rectangularSideCounts.bottom,
            left:
              newTableDefaults?.rectangularSideCounts?.left ??
              board.newTableDefaults.rectangularSideCounts.left,
          },
        }
      : {
          shape: "round",
          seatCount: newTableDefaults?.roundSeatCount ?? board.newTableDefaults.roundSeatCount,
        };

  return inferTablePresetId(shape, seatConfig) ?? getDefaultTablePresetId(shape);
}

function getDefaultTableName(board: BoardState, tableNumber: number): string {
  return `${board.newTableDefaults.labelPrefix} ${tableNumber}`;
}

function getGridPositionKey(position: GridPosition): string {
  return `${position.row}:${position.column}`;
}

function isGridPositionWithinBoard(position: GridPosition, board: BoardState): boolean {
  return (
    position.row >= 0 &&
    position.column >= 0 &&
    position.row < board.rows &&
    position.column < board.columns
  );
}

function hasGridConflict(
  tables: TableState[],
  position: GridPosition,
  ignoredTableNumber?: number
): boolean {
  return tables.some(
    (table) =>
      table.tableNumber !== ignoredTableNumber &&
      getGridPositionKey(table.gridPosition) === getGridPositionKey(position)
  );
}

function sortTablesByGridPosition(tables: TableState[]): TableState[] {
  return [...tables].sort((left, right) => {
    if (left.gridPosition.row !== right.gridPosition.row) {
      return left.gridPosition.row - right.gridPosition.row;
    }

    if (left.gridPosition.column !== right.gridPosition.column) {
      return left.gridPosition.column - right.gridPosition.column;
    }

    return left.tableNumber - right.tableNumber;
  });
}

function findFirstOpenGridPosition(board: BoardState, tables: TableState[]): GridPosition | null {
  const occupied = new Set(tables.map((table) => getGridPositionKey(table.gridPosition)));

  for (let row = 0; row < board.rows; row += 1) {
    for (let column = 0; column < board.columns; column += 1) {
      const position = { row, column };
      if (!occupied.has(getGridPositionKey(position))) {
        return position;
      }
    }
  }

  return null;
}

function reflowTablesOnBoardResize(
  tables: TableState[],
  nextBoard: BoardState
): { tables: TableState[]; overflowTables: TableState[] } {
  const sortedTables = sortTablesByGridPosition(tables);
  const repacked: TableState[] = [];
  const overflow: TableState[] = [];
  const occupied = new Set<string>();

  for (const table of sortedTables) {
    let placed = false;

    // Find the first unoccupied grid cell in row-major order (row 0→N, column 0→M)
    for (let row = 0; row < nextBoard.rows && !placed; row += 1) {
      for (let column = 0; column < nextBoard.columns && !placed; column += 1) {
        const positionKey = getGridPositionKey({ row, column });
        if (!occupied.has(positionKey)) {
          // Assign table to this cell
          repacked.push({
            ...table,
            gridPosition: { row, column },
          });
          occupied.add(positionKey);
          placed = true;
        }
      }
    }

    if (!placed) {
      overflow.push(table);
    }
  }

  return { tables: repacked, overflowTables: overflow };
}

function updateBoardState(
  board: BoardState,
  updates: Partial<Pick<BoardState, "rows" | "columns">>,
  newTableDefaults?: Partial<NewTableDefaults>
): BoardState {
  const presetId = resolveBoardDefaultPresetId(board, newTableDefaults);
  const derivedDefaults = createTableConfigFromDefaults(board, presetId);

  return {
    rows:
      Number.isInteger(updates.rows) && (updates.rows ?? 0) > 0
        ? (updates.rows as number)
        : board.rows,
    columns:
      Number.isInteger(updates.columns) && (updates.columns ?? 0) > 0
        ? (updates.columns as number)
        : board.columns,
    newTableDefaults: {
      labelPrefix:
        typeof newTableDefaults?.labelPrefix === "string" &&
        newTableDefaults.labelPrefix.trim().length > 0
          ? newTableDefaults.labelPrefix.trim()
          : board.newTableDefaults.labelPrefix,
      presetId,
      shape: derivedDefaults.shape,
      roundSeatCount:
        derivedDefaults.seatConfig.shape === "round"
          ? derivedDefaults.seatConfig.seatCount
          : board.newTableDefaults.roundSeatCount,
      rectangularSideCounts: {
        top:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.top
            : board.newTableDefaults.rectangularSideCounts.top,
        right:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.right
            : board.newTableDefaults.rectangularSideCounts.right,
        bottom:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.bottom
            : board.newTableDefaults.rectangularSideCounts.bottom,
        left:
          derivedDefaults.seatConfig.shape === "rectangular"
            ? derivedDefaults.seatConfig.sideCounts.left
            : board.newTableDefaults.rectangularSideCounts.left,
      },
    },
  };
}

function applyTableSeatConfig(
  table: TableState,
  seatConfig: TableSeatConfig
): { table: TableState; displacedGuestIds: string[] } {
  const nextSeatCount = getTableSeatCount(seatConfig);
  const displacedGuestIds: string[] = [];
  let guestIds: Array<string | null>;

  if (nextSeatCount === table.guestIds.length) {
    guestIds = [...table.guestIds];
  } else {
    const seatedGuestIds = table.guestIds.filter((guestId): guestId is string => guestId !== null);
    const keptGuestIds = seatedGuestIds.slice(0, nextSeatCount);
    +displacedGuestIds.push(...seatedGuestIds.slice(nextSeatCount));
    guestIds = createEmptySeatSlots(nextSeatCount);
    keptGuestIds.forEach((guestId, index) => {
      guestIds[index] = guestId;
    });
  }

  return {
    table: {
      ...table,
      seatConfig,
      guestIds,
      disabledSeats: (table.disabledSeats ?? []).filter(
        (seatIndex) => seatIndex >= 0 && seatIndex < guestIds.length && guestIds[seatIndex] === null
      ),
    },
    displacedGuestIds,
  };
}

function normalizeDisabledSeatsForGuestIds(
  disabledSeats: number[] | undefined,
  guestIds: Array<string | null>
): number[] {
  if (!Array.isArray(disabledSeats)) return [];

  return disabledSeats.filter(
    (seatIndex, index, source) =>
      Number.isInteger(seatIndex) &&
      seatIndex >= 0 &&
      seatIndex < guestIds.length &&
      guestIds[seatIndex] === null &&
      source.indexOf(seatIndex) === index
  );
}

function placeGuestsByPreferredIndex(
  guestIds: string[],
  preferredIndexes: number[],
  targetGuestIds: Array<string | null>,
  disabledSeatIndexes: Set<number>
): { placedGuestIds: string[]; overflowGuestIds: string[] } {
  const placedGuestIds: string[] = [];
  const overflowGuestIds: string[] = [];

  for (let index = 0; index < guestIds.length; index += 1) {
    const guestId = guestIds[index];
    const preferredSeatIndex = preferredIndexes[index];
    const canUsePreferredIndex =
      Number.isInteger(preferredSeatIndex) &&
      preferredSeatIndex >= 0 &&
      preferredSeatIndex < targetGuestIds.length &&
      targetGuestIds[preferredSeatIndex] === null &&
      !disabledSeatIndexes.has(preferredSeatIndex);

    if (canUsePreferredIndex) {
      targetGuestIds[preferredSeatIndex] = guestId;
      placedGuestIds.push(guestId);
    } else {
      overflowGuestIds.push(guestId);
    }
  }

  return { placedGuestIds, overflowGuestIds };
}

function createTableState(
  tableNumber: number,
  board: BoardState,
  options?: {
    presetId?: TablePresetId;
    shape?: TableShape;
    seatConfig?: TableSeatConfig;
    gridPosition?: GridPosition;
    name?: string;
  }
): TableState {
  const presetId = resolveTablePresetId({
    presetId: options?.presetId,
    shape: options?.shape,
    seatConfig: options?.seatConfig,
    fallbackPresetId: board.newTableDefaults.presetId,
  });
  const { shape, seatConfig } = createTableConfigFromDefaults(board, presetId);
  const tableIndex = tableNumber - 1;

  return {
    id: `table-${tableNumber}`,
    tableNumber,
    name: options?.name ?? getDefaultTableName(board, tableNumber),
    presetId,
    shape,
    gridPosition: options?.gridPosition ?? {
      row: Math.floor(tableIndex / board.columns),
      column: tableIndex % board.columns,
    },
    seatConfig,
    guestIds: createEmptySeatSlots(getTableSeatCount(seatConfig)),
    disabledSeats: [],
  };
}

function getUniqueGuestIds(guestIds: string[]): string[] {
  const seen = new Set<string>();

  return guestIds.filter((guestId) => {
    if (seen.has(guestId)) return false;
    seen.add(guestId);
    return true;
  });
}

function getSeatedPartyGuestIds(
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
      startIndex >= seatSlots.length ||
      seatSlots[startIndex] !== null ||
      disabledSet.has(startIndex)
    ) {
      return [];
    }

    const indexes = [startIndex];
    for (let index = startIndex + 1; index < seatSlots.length; index += 1) {
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
  const board = createDefaultBoardState();
  const tableCount = board.rows * board.columns;
  const tables: TableState[] = Array.from({ length: tableCount }, (_, index) =>
    createTableState(index + 1, board)
  );

  return {
    board,
    tables,
    unassigned: [...allGuestIds],
  };
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
        currentSeatIdx < nextTables[currentTableIdx].guestIds.length;
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

    const shiftedOccupants: string[] = [];

    for (const position of insertionPositions) {
      const occupantId = nextTables[position.tableIdx].guestIds[position.seatIdx];
      if (occupantId === null) continue;

      shiftedOccupants.push(occupantId);
    }

    const insertedSequence = [...remainingGuests, ...shiftedOccupants];
    if (insertedSequence.length > insertionPositions.length) return state;

    for (let index = 0; index < insertionPositions.length; index += 1) {
      const position = insertionPositions[index];
      nextTables[position.tableIdx].guestIds[position.seatIdx] = insertedSequence[index] ?? null;
    }

    return {
      board: state.board,
      tables: nextTables,
      unassigned: state.unassigned.filter((guestId) => !incomingSet.has(guestId)),
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
    board: state.board,
    tables: nextTables,
    unassigned: state.unassigned.filter((guestId) => !incomingSet.has(guestId)),
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

function getRowSideSeatIndexes(table: TableState): { A: number[]; B: number[] } {
  if (table.seatConfig.shape === "round") {
    const seatCount = table.guestIds.length;
    const half = Math.ceil(seatCount / 2);
    return {
      A: Array.from({ length: half }, (_, index) => index),
      B: Array.from({ length: seatCount - half }, (_, index) => seatCount - 1 - index),
    };
  }

  const { top, right, bottom } = table.seatConfig.sideCounts;
  const topStart = 0;
  const topEnd = topStart + top;
  const bottomStart = topEnd + right;
  const bottomEnd = bottomStart + bottom;

  return {
    A: Array.from({ length: top }, (_, index) => topStart + index),
    B: Array.from({ length: bottom }, (_, index) => bottomEnd - 1 - index),
  };
}

function getSeatRowSide(table: TableState, seatIdx: number): "A" | "B" | null {
  const sideIndexes = getRowSideSeatIndexes(table);
  if (sideIndexes.A.includes(seatIdx)) return "A";
  if (sideIndexes.B.includes(seatIdx)) return "B";
  return null;
}

function getSeatRowSideOrder(table: TableState, seatIdx: number, side: "A" | "B"): number {
  const sideIndexes = getRowSideSeatIndexes(table)[side];
  return sideIndexes.indexOf(seatIdx);
}

function areSeatsAdjacentInTable(table: TableState, a: number, b: number): boolean {
  if (a === b) return true;

  if (table.seatConfig.shape === "round") {
    const seatCount = table.guestIds.length;
    if (seatCount <= 1) return false;
    const distance = Math.abs(a - b);
    return distance === 1 || distance === seatCount - 1;
  }

  if (Math.abs(a - b) === 1) return true;

  const sideA = getSeatRowSide(table, a);
  const sideB = getSeatRowSide(table, b);
  if (!sideA || !sideB || sideA === sideB) return false;

  const orderA = getSeatRowSideOrder(table, a, sideA);
  const orderB = getSeatRowSideOrder(table, b, sideB);
  return orderA >= 0 && orderA === orderB;
}

function getRowContiguousSeatRuns(
  nextTables: TableState[],
  candidateTableIdxs: number[]
): Array<Array<{ tableIdx: number; seatIdx: number }>> {
  const sortedTableIdxs = [...candidateTableIdxs].sort((leftIdx, rightIdx) => {
    const left = nextTables[leftIdx].gridPosition;
    const right = nextTables[rightIdx].gridPosition;
    if (left.row !== right.row) return left.row - right.row;
    return left.column - right.column;
  });
  const sideARow: Array<{ tableIdx: number; seatIdx: number }> = [];
  const sideBRow: Array<{ tableIdx: number; seatIdx: number }> = [];

  for (const tableIdx of sortedTableIdxs) {
    const table = nextTables[tableIdx];
    const openSeatIndexes = new Set(getOpenSeatIndexesForTable(table));
    const sideIndexes = getRowSideSeatIndexes(table);

    for (const seatIdx of sideIndexes.A) {
      if (openSeatIndexes.has(seatIdx)) {
        sideARow.push({ tableIdx, seatIdx });
      }
    }

    for (const seatIdx of sideIndexes.B) {
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
      const previousTable = nextTables[previous.tableIdx];
      const currentTable = nextTables[current.tableIdx];
      const sameTable = previous.tableIdx === current.tableIdx;
      const sameRow = previousTable.gridPosition.row === currentTable.gridPosition.row;
      const previousSide = getSeatRowSide(previousTable, previous.seatIdx);
      const currentSide = getSeatRowSide(currentTable, current.seatIdx);
      const onSameSide = previousSide !== null && previousSide === currentSide;

      const isAdjacentWithinTable =
        sameTable &&
        previousSide !== null &&
        currentSide !== null &&
        Math.abs(
          getSeatRowSideOrder(previousTable, previous.seatIdx, previousSide) -
            getSeatRowSideOrder(currentTable, current.seatIdx, currentSide)
        ) === 1;

      const previousSideIndexes = previousSide
        ? getRowSideSeatIndexes(previousTable)[previousSide]
        : [];
      const previousOrder =
        previousSide !== null
          ? getSeatRowSideOrder(previousTable, previous.seatIdx, previousSide)
          : -1;
      const currentOrder =
        currentSide !== null ? getSeatRowSideOrder(currentTable, current.seatIdx, currentSide) : -1;
      const isAdjacentAcrossTables =
        !sameTable &&
        sameRow &&
        previousSide !== null &&
        currentSide !== null &&
        previousSide === currentSide &&
        currentTable.gridPosition.column - previousTable.gridPosition.column === 1 &&
        previousOrder === previousSideIndexes.length - 1 &&
        currentOrder === 0;

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
  candidateOrder: Map<number, number>,
  sideFilter?: "A" | "B" | null
): Array<{ tableIdx: number; seatIdx: number }> | null {
  const allRuns = getRowContiguousSeatRuns(nextTables, candidateTableIdxs).filter(
    (run) => run.length >= guestCount
  );
  const runs = (
    sideFilter
      ? allRuns.filter((run) => {
          const table = nextTables[run[0].tableIdx];
          return getSeatRowSide(table, run[0].seatIdx) === sideFilter;
        })
      : allRuns
  ).sort((a, b) => {
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

interface PlacementCircle {
  circleId: string;
  units: string[][];
}

function buildPlacementUnits(
  guestIds: string[],
  guestProfiles: Record<string, GuestProfile>
): PlacementCircle[] {
  // Group guests by their social circle first, then by party within each circle.
  // Guests without a named circle each get their own synthetic circle so they are
  // never subject to the circle home-row constraint.
  const circles = new Map<string, Map<string, string[]>>();
  const orderedCircleIds: string[] = [];

  for (const guestId of guestIds) {
    const profile = guestProfiles[guestId];
    const partyId = profile?.partyId ?? guestId;
    const circleId = profile?.circle || `\0nocircle\0${partyId}`;
    if (!circles.has(circleId)) {
      circles.set(circleId, new Map());
      orderedCircleIds.push(circleId);
    }
    const parties = circles.get(circleId)!;
    if (!parties.has(partyId)) {
      parties.set(partyId, []);
    }
    parties.get(partyId)!.push(guestId);
  }

  // Sort parties within each circle largest-first so the biggest party
  // anchors the circle's home row and side before smaller ones try to fit.
  const placementCircles: PlacementCircle[] = orderedCircleIds.map((circleId) => ({
    circleId,
    units: Array.from(circles.get(circleId)!.values()).sort((a, b) => b.length - a.length),
  }));

  // Sort circles largest-first (by total guest count) so large circles claim rows
  // before smaller circles fragment the available space.
  placementCircles.sort((a, b) => {
    const aTotal = a.units.reduce((sum, u) => sum + u.length, 0);
    const bTotal = b.units.reduce((sum, u) => sum + u.length, 0);
    return bTotal - aTotal;
  });

  return placementCircles;
}

function getCandidateTableIndexes(
  targetTableIdx: number | null,
  targetScope: AutoAssignTargetScope | undefined,
  tables: TableState[]
): number[] {
  if (targetTableIdx == null) {
    return Array.from({ length: tables.length }, (_, index) => index);
  }

  if (targetScope === "target-only") {
    return [targetTableIdx];
  }

  return getAdjacentTableIndexesInRow(targetTableIdx, tables);
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
function getSplitParties(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  // Map each party to its members' positions (display index + seat slot).
  const partyPositions = new Map<string, Array<{ tableIdx: number; seatIdx: number }>>();

  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const table = tables[tableIdx];
    table.guestIds.forEach((guestId, seatIdx) => {
      if (!guestId) return;
      const partyId = guestProfiles[guestId]?.partyId;
      if (!partyId) return;
      const positions = partyPositions.get(partyId) ?? [];
      positions.push({ tableIdx, seatIdx });
      partyPositions.set(partyId, positions);
    });
  }

  const splitParties = new Set<string>();

  for (const [partyId, positions] of partyPositions.entries()) {
    if (positions.length <= 1) continue;

    // Same table — adjacency is checked separately.
    const tableIdxSet = new Set(positions.map((p) => p.tableIdx));
    if (tableIdxSet.size === 1) continue;

    // Members span multiple tables. Check same-side + same-row + contiguous.
    const seatsWithTables = positions.map((position) => ({
      ...position,
      table: tables[position.tableIdx],
      side: getSeatRowSide(tables[position.tableIdx], position.seatIdx),
    }));
    if (seatsWithTables.some((position) => position.side === null)) {
      // Round-table and non-row-side seats are exempt from row-side split checks.
      continue;
    }

    const isAllSideA = seatsWithTables.every((p) => p.side === "A");
    const isAllSideB = seatsWithTables.every((p) => p.side === "B");

    if (!isAllSideA && !isAllSideB) {
      // Members are on different sides — always a split.
      splitParties.add(partyId);
      continue;
    }

    // All members must be in the same table row.
    const rows = new Set(seatsWithTables.map((p) => p.table.gridPosition.row));
    if (rows.size > 1) {
      splitParties.add(partyId);
      continue;
    }

    const side = isAllSideA ? "A" : "B";
    const linearPositions = seatsWithTables.map((p) => {
      const sideOrder = getSeatRowSideOrder(p.table, p.seatIdx, side);
      const sideLength = getRowSideSeatIndexes(p.table)[side].length;
      return p.table.gridPosition.column * Math.max(sideLength, 1) + sideOrder;
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
      splitParties.add(partyId);
    }
  }

  return splitParties;
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
function getNonAdjacentParties(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const partyToSeats = new Map<string, Array<{ tableNumber: number; seatIdx: number }>>();

  for (const table of tables) {
    table.guestIds.forEach((guestId, seatIdx) => {
      if (!guestId) return;
      const partyId = guestProfiles[guestId]?.partyId;
      if (!partyId) return;

      const seats = partyToSeats.get(partyId) ?? [];
      seats.push({ tableNumber: table.tableNumber, seatIdx });
      partyToSeats.set(partyId, seats);
    });
  }

  const nonAdjacent = new Set<string>();

  for (const [partyId, seats] of partyToSeats.entries()) {
    if (seats.length <= 1) continue;

    // Cross-table parties: adjacency is already guaranteed by getSplitParties.
    const tableNumbers = new Set(seats.map((s) => s.tableNumber));
    if (tableNumbers.size !== 1) continue;

    // BFS connectivity check on the single-table adjacency graph.
    const tableNumber = seats[0].tableNumber;
    const table = tables.find((entry) => entry.tableNumber === tableNumber);
    if (!table) continue;

    const seatIdxs = seats.map((s) => s.seatIdx);
    const visited = new Set<number>();
    const queue = [seatIdxs[0]];
    visited.add(seatIdxs[0]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const other of seatIdxs) {
        if (!visited.has(other) && areSeatsAdjacentInTable(table, current, other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }

    if (visited.size !== seatIdxs.length) {
      nonAdjacent.add(partyId);
    }
  }

  return nonAdjacent;
}

function introducesNewPartySplit(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;

  const previousSplits = getSplitParties(previousTables, guestProfiles);
  const nextSplits = getSplitParties(nextTables, guestProfiles);
  for (const partyId of nextSplits) {
    if (!previousSplits.has(partyId)) return true;
  }

  return false;
}

function introducesNewPartyAdjacencyViolation(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;

  const previousViolations = getNonAdjacentParties(previousTables, guestProfiles);
  const nextViolations = getNonAdjacentParties(nextTables, guestProfiles);
  for (const partyId of nextViolations) {
    if (!previousViolations.has(partyId)) return true;
  }

  return false;
}

/**
 * Returns the set of named group IDs whose members span more than one row.
 * Groups are expected to stay within a single row; cross-row splits are blocked.
 */
function getSplitCircles(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const circleRows = new Map<string, Set<number>>();
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const rowIdx = tables[tableIdx].gridPosition.row;
    tables[tableIdx].guestIds.forEach((guestId) => {
      if (!guestId) return;
      const circle = guestProfiles[guestId]?.circle;
      if (!circle) return;
      const rows = circleRows.get(circle) ?? new Set<number>();
      rows.add(rowIdx);
      circleRows.set(circle, rows);
    });
  }
  const splitCircles = new Set<string>();
  for (const [circleId, rows] of circleRows) {
    if (rows.size > 1) splitCircles.add(circleId);
  }
  return splitCircles;
}

function introducesNewCircleRowIsolation(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;
  const previousSplits = getSplitCircles(previousTables, guestProfiles);
  const nextSplits = getSplitCircles(nextTables, guestProfiles);
  for (const circleId of nextSplits) {
    if (!previousSplits.has(circleId)) return true;
  }
  return false;
}

/**
 * Returns the set of named circle IDs whose members span more than one table
 * and are NOT all on the same side (Side A: slots 0–3, Side B: slots 4–7).
 * Single-table circles are excluded because both sides are fine at one table.
 *
 * A violation requires that at least one table has the circle on ONLY side A
 * and another table has the circle on ONLY side B (pure-side conflict).
 * A table where the circle occupies both sides (e.g. a large party filling
 * the whole table) is treated as neutral and does not constitute a violation.
 */
function getNonSameSideCircles(
  tables: TableState[],
  guestProfiles: Record<string, GuestProfile>
): Set<string> {
  const circleTableSeats = new Map<string, Map<number, number[]>>();
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    tables[tableIdx].guestIds.forEach((guestId, seatIdx) => {
      if (!guestId) return;
      const circle = guestProfiles[guestId]?.circle;
      if (!circle) return;
      if (!circleTableSeats.has(circle)) circleTableSeats.set(circle, new Map());
      const tableMap = circleTableSeats.get(circle)!;
      if (!tableMap.has(tableIdx)) tableMap.set(tableIdx, []);
      tableMap.get(tableIdx)!.push(seatIdx);
    });
  }
  const violators = new Set<string>();
  for (const [circleId, tableMap] of circleTableSeats) {
    if (tableMap.size <= 1) continue; // single table — no side constraint
    let hasPureSideA = false;
    let hasPureSideB = false;
    for (const [tableIdx, seats] of tableMap.entries()) {
      const table = tables[tableIdx];
      const seatSides = seats.map((seatIdx) => getSeatRowSide(table, seatIdx));
      if (seatSides.some((side) => side === null)) continue;
      const allSideA = seatSides.every((side) => side === "A");
      const allSideB = seatSides.every((side) => side === "B");
      if (allSideA) hasPureSideA = true;
      if (allSideB) hasPureSideB = true;
    }
    // Only a violation when one table is pure-A and another is pure-B.
    // Mixed-side tables (large parties) are neutral.
    if (hasPureSideA && hasPureSideB) violators.add(circleId);
  }
  return violators;
}

function introducesNewCircleSideSplit(
  previousTables: TableState[],
  nextTables: TableState[],
  guestProfiles?: Record<string, GuestProfile>
): boolean {
  if (!guestProfiles) return false;
  const previousViolations = getNonSameSideCircles(previousTables, guestProfiles);
  const nextViolations = getNonSameSideCircles(nextTables, guestProfiles);
  for (const circleId of nextViolations) {
    if (!previousViolations.has(circleId)) return true;
  }
  return false;
}

function getAdjacentTableIndexesInRow(targetTableIdx: number, tables: TableState[]): number[] {
  const targetTable = tables[targetTableIdx];
  return tables
    .map((table, index) => ({ table, index }))
    .filter(({ table }) => table.gridPosition.row === targetTable.gridPosition.row)
    .sort((left, right) => {
      const leftDistance = Math.abs(
        left.table.gridPosition.column - targetTable.gridPosition.column
      );
      const rightDistance = Math.abs(
        right.table.gridPosition.column - targetTable.gridPosition.column
      );
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return left.table.gridPosition.column - right.table.gridPosition.column;
    })
    .map(({ index }) => index);
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
    allowPartialPlacementBypass?: boolean;
  }
): SeatingState {
  const orderedGuestIds = getUniqueGuestIds(incomingGuestIds);
  if (orderedGuestIds.length === 0) return state;

  // Already-seated guests (locked or not) are never disturbed by default.
  // Targeted table-drop auto-seat can opt-in to re-seating the incoming guests.
  const alreadySeatedSet = new Set(
    state.tables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null))
  );

  const allowReseatIncoming = options?.allowReseatIncoming ?? false;
  const allowPartialPlacementBypass = options?.allowPartialPlacementBypass ?? false;
  const targetTableNumber = options?.targetTableNumber;
  const targetScope = options?.targetScope;

  const incomingReseatSet = new Set(
    allowReseatIncoming ? orderedGuestIds.filter((id) => alreadySeatedSet.has(id)) : []
  );

  const toSeat = orderedGuestIds.filter(
    (id) => !alreadySeatedSet.has(id) || incomingReseatSet.has(id)
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

  const candidateTableIdxs = getCandidateTableIndexes(targetTableIdx, targetScope, nextTables);
  const placementCircles = buildPlacementUnits(toSeat, guestProfiles);

  for (const { circleId, units } of placementCircles) {
    const isNamedCircle = !circleId.startsWith("\0nocircle\0");
    let circleHomeRow: number | null = null;
    let circleHomeSide: "A" | "B" | null = null;

    for (const guestIds of units) {
      // Restrict to the circle's home row after the first party is placed (orphan rule).
      let effectiveCandidates = candidateTableIdxs;
      if (isNamedCircle && circleHomeRow !== null) {
        effectiveCandidates = candidateTableIdxs.filter(
          (idx) => nextTables[idx].gridPosition.row === circleHomeRow
        );
        if (effectiveCandidates.length === 0) continue; // orphan: no candidates in home row
      }

      const effectiveCandidateOrder = new Map(
        effectiveCandidates.map((tableIdx, index) => [tableIdx, index])
      );

      const singleTableRun = findBestSingleTableRun(
        nextTables,
        effectiveCandidates,
        guestIds.length
      );
      // For named circles, a run that straddles side A and B will later violate the
      // cross-table side-cohesion constraint. Prefer a side-respecting row run first.
      const singleTableRunCrossesSides =
        singleTableRun !== null &&
        singleTableRun.some(
          (seat) => getSeatRowSide(nextTables[seat.tableIdx], seat.seatIdx) === "A"
        ) &&
        singleTableRun.some(
          (seat) => getSeatRowSide(nextTables[seat.tableIdx], seat.seatIdx) === "B"
        );
      if (singleTableRun && !(isNamedCircle && singleTableRunCrossesSides)) {
        placeGuestsAtSeats(nextTables, singleTableRun, guestIds);
        if (isNamedCircle && circleHomeRow === null) {
          circleHomeRow = nextTables[singleTableRun[0].tableIdx].gridPosition.row;
        }
        continue;
      }

      // findBestRowRun is only reached when no single table fits the party,
      // so any result spans multiple tables — enforce the circle's established side.
      const rowRun = findBestRowRun(
        nextTables,
        effectiveCandidates,
        guestIds.length,
        effectiveCandidateOrder,
        isNamedCircle ? circleHomeSide : null
      );
      if (rowRun) {
        placeGuestsAtSeats(nextTables, rowRun, guestIds);
        if (isNamedCircle) {
          if (circleHomeRow === null) {
            circleHomeRow = nextTables[rowRun[0].tableIdx].gridPosition.row;
          }
          if (circleHomeSide === null) {
            circleHomeSide = getSeatRowSide(nextTables[rowRun[0].tableIdx], rowRun[0].seatIdx);
          }
        }
        continue;
      }

      // Cross-side single-table fallback: if we deferred singleTableRun above because
      // it straddled both sides, use it now that the side-aware row run also failed.
      if (singleTableRun) {
        placeGuestsAtSeats(nextTables, singleTableRun, guestIds);
        if (isNamedCircle && circleHomeRow === null) {
          circleHomeRow = nextTables[singleTableRun[0].tableIdx].gridPosition.row;
        }
        continue;
      }

      // Partial fill fallback: apply side constraint when cross-table side is known.
      let remainingSeats = effectiveCandidates.flatMap((tableIdx) =>
        getOpenSeatIndexesForTable(nextTables[tableIdx]).map((seatIdx) => ({ tableIdx, seatIdx }))
      );
      if (isNamedCircle && circleHomeSide !== null) {
        remainingSeats = remainingSeats.filter(
          (s) => getSeatRowSide(nextTables[s.tableIdx], s.seatIdx) === circleHomeSide
        );
      }

      if (remainingSeats.length === 0) continue;

      const partialGuests = guestIds.slice(0, remainingSeats.length);
      placeGuestsAtSeats(nextTables, remainingSeats.slice(0, partialGuests.length), partialGuests);
      if (isNamedCircle && partialGuests.length > 0) {
        if (circleHomeRow === null) {
          circleHomeRow = nextTables[remainingSeats[0].tableIdx].gridPosition.row;
        }
        if (circleHomeSide === null) {
          const placedTableIdxSet = new Set(
            remainingSeats.slice(0, partialGuests.length).map((s) => s.tableIdx)
          );
          if (placedTableIdxSet.size > 1) {
            circleHomeSide = getSeatRowSide(
              nextTables[remainingSeats[0].tableIdx],
              remainingSeats[0].seatIdx
            );
          }
        }
      }
    }
  }

  // Only remove from unassigned guests who were actually placed in nextTables.
  // Guests the algorithm couldn't place remain in unassigned (they are never lost).
  const nowSeatedSet = new Set(
    nextTables.flatMap((t) => t.guestIds.filter((id): id is string => id !== null))
  );
  const successfullyPlaced = new Set(toSeat.filter((id) => nowSeatedSet.has(id)));

  // For manual drag-to-table drops, bypass cohesion guard rails so any placement
  // that fits is accepted; otherwise enforce cohesion constraints to prevent splits.
  if (!allowPartialPlacementBypass) {
    if (introducesNewPartySplit(state.tables, nextTables, guestProfiles)) {
      return state;
    }
    if (introducesNewPartyAdjacencyViolation(state.tables, nextTables, guestProfiles)) {
      return state;
    }
    if (introducesNewCircleRowIsolation(state.tables, nextTables, guestProfiles)) {
      return state;
    }
    if (introducesNewCircleSideSplit(state.tables, nextTables, guestProfiles)) {
      return state;
    }
  }

  if (successfullyPlaced.size === 0) {
    return state;
  }

  return {
    board: state.board,
    tables: nextTables,
    unassigned: state.unassigned.filter((id) => !successfullyPlaced.has(id)),
  };
}

export function seatingReducer(state: SeatingState, action: SeatingAction): SeatingState {
  switch (action.type) {
    case "UPDATE_BOARD_CONFIG": {
      const nextBoard = updateBoardState(state.board, action.updates, action.newTableDefaults);
      const { tables: nextTables, overflowTables } = reflowTablesOnBoardResize(
        state.tables,
        nextBoard
      );
      const extractedGuests = overflowTables.flatMap((t) =>
        t.guestIds.filter((id): id is string => id !== null)
      );

      return {
        ...state,
        board: nextBoard,
        tables: nextTables,
        unassigned: [...state.unassigned, ...extractedGuests],
      };
    }

    case "CREATE_TABLE": {
      const gridPosition =
        action.gridPosition ?? findFirstOpenGridPosition(state.board, state.tables);
      if (!gridPosition || !isGridPositionWithinBoard(gridPosition, state.board)) {
        return state;
      }
      if (hasGridConflict(state.tables, gridPosition)) {
        return state;
      }

      const nextTableNumber =
        state.tables.reduce(
          (maxTableNumber, table) => Math.max(maxTableNumber, table.tableNumber),
          0
        ) + 1;
      const nextTable = createTableState(nextTableNumber, state.board, {
        presetId: action.presetId,
        name: action.name,
        shape: action.shape,
        gridPosition,
        seatConfig: action.seatConfig,
      });

      return {
        ...state,
        tables: sortTablesByGridPosition([...state.tables, nextTable]),
      };
    }

    case "UPDATE_TABLE_CONFIG": {
      const tableIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.tableNumber
      );
      if (tableIndex === -1) {
        return state;
      }

      const currentTable = state.tables[tableIndex];
      const nextPresetId = resolveTablePresetId({
        presetId: action.updates.presetId,
        shape: action.updates.shape,
        seatConfig: action.updates.seatConfig,
        fallbackPresetId: currentTable.presetId,
      });
      const nextDerivedConfig = createTableConfigFromDefaults(state.board, nextPresetId);
      const nextGridPosition = action.updates.gridPosition ?? currentTable.gridPosition;

      if (!isGridPositionWithinBoard(nextGridPosition, state.board)) {
        return state;
      }
      if (hasGridConflict(state.tables, nextGridPosition, currentTable.tableNumber)) {
        return state;
      }

      const resizedTable = applyTableSeatConfig(
        {
          ...currentTable,
          name: action.updates.name ?? currentTable.name,
          presetId: nextPresetId,
          shape: nextDerivedConfig.shape,
          gridPosition: nextGridPosition,
        },
        nextDerivedConfig.seatConfig
      );
      const nextTables = sortTablesByGridPosition(
        state.tables.map((table, index) => (index === tableIndex ? resizedTable.table : table))
      );

      return {
        ...state,
        tables: nextTables,
        unassigned: [...new Set([...state.unassigned, ...resizedTable.displacedGuestIds])],
      };
    }

    case "DELETE_TABLE": {
      const table = state.tables.find((entry) => entry.tableNumber === action.tableNumber);
      if (!table) {
        return state;
      }

      const displacedGuestIds = table.guestIds.filter(
        (guestId): guestId is string => guestId !== null
      );

      return {
        ...state,
        tables: state.tables.filter((entry) => entry.tableNumber !== action.tableNumber),
        unassigned: [...new Set([...state.unassigned, ...displacedGuestIds])],
      };
    }

    case "AUTO_ASSIGN_GUESTS": {
      if (!action.guestProfiles) {
        return assignGuestsWithOverflow(state, 0, action.guestIds);
      }

      return assignGuestsSmart(state, action.guestIds, action.guestProfiles, {
        targetTableNumber: action.targetTableNumber,
        targetScope: action.targetScope,
        allowReseatIncoming: action.allowReseatIncoming ?? false,
        allowPartialPlacementBypass: action.allowPartialPlacementBypass ?? false,
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

      if (assignmentMode === "circle-overflow") {
        const overflowState = assignGuestsWithOverflow(state, tableIdx, guestIds, seatIndex);
        if (introducesNewPartySplit(state.tables, overflowState.tables, guestProfiles)) {
          return state;
        }
        if (
          introducesNewPartyAdjacencyViolation(state.tables, overflowState.tables, guestProfiles)
        ) {
          return state;
        }
        if (introducesNewCircleRowIsolation(state.tables, overflowState.tables, guestProfiles)) {
          return state;
        }
        if (introducesNewCircleSideSplit(state.tables, overflowState.tables, guestProfiles)) {
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
          seatIndex < table.guestIds.length
        ) {
          const nextTables = state.tables.map((currentTable) => ({
            ...currentTable,
            guestIds: [...currentTable.guestIds],
          }));

          nextTables[tableIdx].guestIds[seatIndex] = incomingGuestId;
          nextTables[incomingSeat.tableIdx].guestIds[incomingSeat.seatIdx] = targetSeatGuestId;

          if (!isManualSeatOverride) {
            if (introducesNewPartySplit(state.tables, nextTables, guestProfiles)) {
              return state;
            }
            if (introducesNewPartyAdjacencyViolation(state.tables, nextTables, guestProfiles)) {
              return state;
            }
            if (introducesNewCircleRowIsolation(state.tables, nextTables, guestProfiles)) {
              return state;
            }
            if (introducesNewCircleSideSplit(state.tables, nextTables, guestProfiles)) {
              return state;
            }
          }

          return {
            board: state.board,
            tables: nextTables,
            unassigned: state.unassigned.filter((guestId) => guestId !== incomingGuestId),
          };
        }
      }

      if (!isManualSeatOverride && orderedGuestIds.length === 1 && guestProfiles) {
        const dragGuestId = orderedGuestIds[0];
        const partyId = guestProfiles[dragGuestId]?.partyId;
        if (partyId) {
          const seatedPartyGuestIds = getSeatedPartyGuestIds(state.tables, partyId, guestProfiles);
          if (seatedPartyGuestIds.length > 1 && seatedPartyGuestIds.includes(dragGuestId)) {
            // Preserve household integrity when manually moving one seated household member.
            orderedGuestIds = seatedPartyGuestIds;
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
        if (introducesNewPartySplit(state.tables, newTables, guestProfiles)) return state;
        if (introducesNewPartyAdjacencyViolation(state.tables, newTables, guestProfiles)) {
          return state;
        }
        if (introducesNewCircleRowIsolation(state.tables, newTables, guestProfiles)) {
          return state;
        }
        if (introducesNewCircleSideSplit(state.tables, newTables, guestProfiles)) {
          return state;
        }
      }

      const newUnassigned = state.unassigned.filter((guestId) => !incomingSet.has(guestId));
      return {
        board: state.board,
        tables: newTables,
        unassigned: newUnassigned,
      };
    }

    case "REMOVE_GUESTS": {
      const removedSet = new Set(action.guestIds);
      const newTables = state.tables.map((table) => ({
        ...table,
        guestIds: removeGuestsFromSeatSlots(table.guestIds, removedSet),
      }));
      const newUnassigned = [...new Set([...state.unassigned, ...action.guestIds])];
      return {
        ...state,
        tables: newTables,
        unassigned: newUnassigned,
      };
    }

    case "CLEAR_TABLE": {
      const table = state.tables.find((entry) => entry.tableNumber === action.tableNumber);
      if (!table || getOccupiedSeatCount(table.guestIds) === 0) return state;

      const clearedGuestIds = table.guestIds.filter(
        (guestId): guestId is string => guestId !== null
      );

      const newTables = state.tables.map((entry) =>
        entry.tableNumber === action.tableNumber
          ? { ...entry, guestIds: createEmptySeatSlots(entry.guestIds.length) }
          : entry
      );
      const newUnassigned = [...new Set([...state.unassigned, ...clearedGuestIds])];
      return {
        ...state,
        tables: newTables,
        unassigned: newUnassigned,
      };
    }

    case "TOGGLE_SEAT_DISABLED": {
      const { tableNumber, seatIndex } = action;
      const tableIdx = state.tables.findIndex((t) => t.tableNumber === tableNumber);
      if (tableIdx === -1) return state;
      const table = state.tables[tableIdx];

      const currentDisabled = table.disabledSeats ?? [];
      const isCurrentlyDisabled = currentDisabled.includes(seatIndex);

      let nextUnassigned = state.unassigned;
      let nextGuestIds = table.guestIds;

      if (!isCurrentlyDisabled) {
        // Disabling: if a guest occupies this seat, evict them
        const evictedGuestId = table.guestIds[seatIndex];
        if (evictedGuestId !== null) {
          nextGuestIds = table.guestIds.map((id, i) => (i === seatIndex ? null : id));
          nextUnassigned = [...new Set([...state.unassigned, evictedGuestId])];
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
      };
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

      const activeTable = state.tables[activeIndex];
      const overTable = state.tables[overIndex];
      const disabledOverSeats = new Set(overTable.disabledSeats ?? []);

      const nextTables = state.tables.map((t) => ({ ...t, guestIds: [...t.guestIds] }));
      const nextActiveGuestIds = nextTables[activeIndex].guestIds;
      const nextOverGuestIds = nextTables[overIndex].guestIds;

      const needsAutoseat: string[] = [];

      for (let seatIdx = 0; seatIdx < activeTable.guestIds.length; seatIdx += 1) {
        const guestId = activeTable.guestIds[seatIdx];
        if (!guestId) continue;

        nextActiveGuestIds[seatIdx] = null;

        if (nextOverGuestIds[seatIdx] === null && !disabledOverSeats.has(seatIdx)) {
          nextOverGuestIds[seatIdx] = guestId;
        } else {
          needsAutoseat.push(guestId);
        }
      }

      nextTables[activeIndex].disabledSeats = normalizeDisabledSeatsForGuestIds(
        nextTables[activeIndex].disabledSeats,
        nextActiveGuestIds
      );
      nextTables[overIndex].disabledSeats = normalizeDisabledSeatsForGuestIds(
        nextTables[overIndex].disabledSeats,
        nextOverGuestIds
      );

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

      const nextTables = state.tables.map((table) => ({
        ...table,
        guestIds: [...table.guestIds],
      }));
      const nextActiveGuestIds = nextTables[activeIndex].guestIds;
      const nextOverGuestIds = nextTables[overIndex].guestIds;
      // Swap semantics keeps each table's content and seat-disable map together.
      const disabledActiveSeats = new Set(overTable.disabledSeats ?? []);
      const disabledOverSeats = new Set(activeTable.disabledSeats ?? []);

      const transferableFromActive: string[] = [];
      const transferableFromActiveIndexes: number[] = [];
      for (let seatIdx = 0; seatIdx < activeTable.guestIds.length; seatIdx += 1) {
        const guestId = activeTable.guestIds[seatIdx];
        if (!guestId) continue;
        nextActiveGuestIds[seatIdx] = null;
        transferableFromActive.push(guestId);
        transferableFromActiveIndexes.push(seatIdx);
      }

      const transferableFromOver: string[] = [];
      const transferableFromOverIndexes: number[] = [];
      for (let seatIdx = 0; seatIdx < overTable.guestIds.length; seatIdx += 1) {
        const guestId = overTable.guestIds[seatIdx];
        if (!guestId) continue;
        nextOverGuestIds[seatIdx] = null;
        transferableFromOver.push(guestId);
        transferableFromOverIndexes.push(seatIdx);
      }

      const activeToOverPlacement = placeGuestsByPreferredIndex(
        transferableFromActive,
        transferableFromActiveIndexes,
        nextOverGuestIds,
        disabledOverSeats
      );
      const overToActivePlacement = placeGuestsByPreferredIndex(
        transferableFromOver,
        transferableFromOverIndexes,
        nextActiveGuestIds,
        disabledActiveSeats
      );

      nextTables[activeIndex].disabledSeats = normalizeDisabledSeatsForGuestIds(
        overTable.disabledSeats,
        nextActiveGuestIds
      );
      nextTables[overIndex].disabledSeats = normalizeDisabledSeatsForGuestIds(
        activeTable.disabledSeats,
        nextOverGuestIds
      );

      let nextState: SeatingState = { ...state, tables: nextTables };

      if (activeToOverPlacement.overflowGuestIds.length > 0) {
        nextState = action.guestProfiles
          ? assignGuestsSmart(
              nextState,
              activeToOverPlacement.overflowGuestIds,
              action.guestProfiles,
              {
                targetTableNumber: action.overTableNumber,
                targetScope: "target-and-adjacent",
              }
            )
          : assignGuestsWithOverflow(nextState, overIndex, activeToOverPlacement.overflowGuestIds);
      }

      if (overToActivePlacement.overflowGuestIds.length > 0) {
        nextState = action.guestProfiles
          ? assignGuestsSmart(
              nextState,
              overToActivePlacement.overflowGuestIds,
              action.guestProfiles,
              {
                targetTableNumber: action.activeTableNumber,
                targetScope: "target-and-adjacent",
              }
            )
          : assignGuestsWithOverflow(
              nextState,
              activeIndex,
              overToActivePlacement.overflowGuestIds
            );
      }

      return nextState;
    }

    case "MOVE_TABLE_POSITION": {
      const activeIndex = state.tables.findIndex(
        (table) => table.tableNumber === action.activeTableNumber
      );
      if (activeIndex === -1) return state;

      if (!isGridPositionWithinBoard(action.targetGridPosition, state.board)) {
        return state;
      }

      const activeTable = state.tables[activeIndex];
      if (
        getGridPositionKey(activeTable.gridPosition) ===
        getGridPositionKey(action.targetGridPosition)
      ) {
        return state;
      }

      const targetIndex = state.tables.findIndex(
        (table) =>
          table.tableNumber !== action.activeTableNumber &&
          getGridPositionKey(table.gridPosition) === getGridPositionKey(action.targetGridPosition)
      );

      const nextTables = state.tables.map((table) => ({ ...table }));

      if (targetIndex === -1) {
        nextTables[activeIndex] = {
          ...nextTables[activeIndex],
          gridPosition: action.targetGridPosition,
        };
      } else {
        const activePosition = nextTables[activeIndex].gridPosition;
        nextTables[activeIndex] = {
          ...nextTables[activeIndex],
          gridPosition: action.targetGridPosition,
        };
        nextTables[targetIndex] = {
          ...nextTables[targetIndex],
          gridPosition: activePosition,
        };
      }

      return {
        ...state,
        tables: sortTablesByGridPosition(nextTables),
      };
    }

    default:
      return state;
  }
}
