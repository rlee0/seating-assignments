import { SortableContext } from "@dnd-kit/sortable";
import TableCard from "./TableCard";
import type { TableState } from "../types";
import type { Transform } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Settings } from "lucide-react";
import { cn } from "../lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { type ReactNode, useMemo } from "react";
import { useSeating } from "../store/SeatingContext";

// Tables no longer reorder on drop — disable all sortable position animations.
function swapSortingStrategy(): Transform | null {
  return null;
}

export interface AutoSeatPreview {
  tables: TableState[];
}

export interface GuestSwapPreview {
  sourceTableNumber: number;
  sourceSeatIndex: number;
  sourceGuestId: string;
  targetTableNumber: number;
  targetSeatIndex: number;
  targetGuestId: string;
}

interface Props {
  activeDragKind: "party" | "guest" | "circle" | "table" | null;
  activeDragGuestId: string | null;
  autoSeatPreview: AutoSeatPreview | null;
  guestSwapPreview: GuestSwapPreview | null;
  zoom: number;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  onEditTable: (tableNumber: number) => void;
  onDeleteTable: (tableNumber: number) => void;
  onBoardSettings: () => void;
}

const BASE_BOARD_CELL_WIDTH_REM = 20;
const BASE_BOARD_CELL_HEIGHT_REM = 12;
const DEFAULT_GRID_GAP_REM = 0.625;
const DENSE_GRID_GAP_REM = 0.375;

function getPositionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function BoardCell({
  row,
  column,
  activeDragKind,
  children,
}: {
  row: number;
  column: number;
  activeDragKind: "party" | "guest" | "circle" | "table" | null;
  children?: ReactNode;
}) {
  const cellId = `cell-${row}-${column}`;
  const { setNodeRef, isOver } = useDroppable({
    id: cellId,
    disabled: activeDragKind !== "table",
  });

  return (
    <div
      ref={setNodeRef}
      data-board-cell-id={cellId}
      data-board-cell
      className={cn(
        "relative min-h-48 rounded-md border border-dashed border-border/70 p-1",
        isOver && "border-(--table-drop-border) bg-(--table-drop-bg)"
      )}>
      {children}
    </div>
  );
}

function computePreviewSeatKinds(
  realGuestIds: Array<string | null>,
  previewGuestIds: Array<string | null>
): Array<"added" | "changed" | "deleted" | null> {
  return realGuestIds.map((realId, i) => {
    const previewId = previewGuestIds[i] ?? null;
    if (realId === previewId) return null;
    if (realId === null) return "added";
    if (previewId === null) return "deleted";
    return "changed";
  });
}

export default function TableBoard({
  activeDragKind,
  activeDragGuestId,
  autoSeatPreview,
  guestSwapPreview,
  zoom,
  onEditGuest,
  onDeleteGuest,
  onEditTable,
  onDeleteTable,
  onBoardSettings,
}: Props) {
  const { state } = useSeating();

  const tableIds = state.tables.map((table) => `sortable-table-${table.tableNumber}`);
  const showPreview = autoSeatPreview !== null;

  const previewTablesByNumber = useMemo(() => {
    if (!autoSeatPreview) return null;
    const map = new Map<number, TableState>();
    for (const t of autoSeatPreview.tables) map.set(t.tableNumber, t);
    return map;
  }, [autoSeatPreview]);

  const tablesByPosition = useMemo(() => {
    const map = new Map<string, TableState>();
    for (const table of state.tables) {
      map.set(getPositionKey(table.gridPosition.row, table.gridPosition.column), table);
    }
    return map;
  }, [state.tables]);

  const rowIndexes = useMemo(
    () => Array.from({ length: state.board.rows }, (_, i) => i),
    [state.board.rows]
  );
  const columnIndexes = useMemo(
    () => Array.from({ length: state.board.columns }, (_, i) => i),
    [state.board.columns]
  );
  const useDenseGap = state.board.rows > 5 || state.board.columns > 5;
  const gridGapRem = useDenseGap ? DENSE_GRID_GAP_REM : DEFAULT_GRID_GAP_REM;
  const boardWidthRem =
    state.board.columns * BASE_BOARD_CELL_WIDTH_REM +
    Math.max(0, state.board.columns - 1) * gridGapRem;
  const boardHeightRem =
    state.board.rows * BASE_BOARD_CELL_HEIGHT_REM + Math.max(0, state.board.rows - 1) * gridGapRem;
  const scaledBoardWidthRem = boardWidthRem * zoom;
  const scaledBoardHeightRem = boardHeightRem * zoom;

  return (
    <SortableContext items={tableIds} strategy={swapSortingStrategy}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="min-h-0 flex-1 overflow-auto p-3" data-board-viewport>
              <div
                data-board-content-size
                style={{
                  minWidth: `${scaledBoardWidthRem}rem`,
                  minHeight: `${scaledBoardHeightRem}rem`,
                }}>
                <div
                  data-board-scale
                  style={{
                    width: `${boardWidthRem}rem`,
                    minHeight: `${boardHeightRem}rem`,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}>
                  <div
                    className={cn("grid content-start", useDenseGap ? "gap-1.5" : "gap-2.5")}
                    style={{
                      gridTemplateColumns: `repeat(${state.board.columns}, minmax(${BASE_BOARD_CELL_WIDTH_REM}rem, 1fr))`,
                    }}>
                    {rowIndexes.flatMap((row) =>
                      columnIndexes.map((column) => {
                        const table = tablesByPosition.get(getPositionKey(row, column)) ?? null;

                        if (!table) {
                          return (
                            <BoardCell
                              key={getPositionKey(row, column)}
                              row={row}
                              column={column}
                              activeDragKind={activeDragKind}
                            />
                          );
                        }

                        const previewTable = previewTablesByNumber?.get(table.tableNumber) ?? null;
                        const displayGuestIds = previewTable
                          ? previewTable.guestIds
                          : table.guestIds;
                        const previewSeatKinds = previewTable
                          ? computePreviewSeatKinds(table.guestIds, previewTable.guestIds)
                          : table.guestIds.map(() => null);
                        const hasTablePreviewChanges =
                          previewTable !== null && previewSeatKinds.some((k) => k !== null);

                        return (
                          <BoardCell
                            key={getPositionKey(row, column)}
                            row={row}
                            column={column}
                            activeDragKind={activeDragKind}>
                            <TableCard
                              table={table}
                              activeDragKind={activeDragKind}
                              activeDragGuestId={activeDragGuestId}
                              guestSwapPreview={guestSwapPreview}
                              onEditGuest={onEditGuest}
                              onDeleteGuest={onDeleteGuest}
                              onEditTable={onEditTable}
                              onDeleteTable={onDeleteTable}
                              displayGuestIds={displayGuestIds}
                              previewSeatKinds={previewSeatKinds}
                              isPreviewMode={showPreview}
                              hasTablePreviewChanges={hasTablePreviewChanges}
                            />
                          </BoardCell>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onBoardSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Board settings
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SortableContext>
  );
}
