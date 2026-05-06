import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  Eraser,
  Lock,
  LockOpen,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Trash2,
  UserMinus,
} from "lucide-react";
import type { GuestSwapPreview, TableSwapPreview } from "./TableBoard";
import { useEffect, useRef, useState } from "react";

import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import type { TableState } from "../types";
import { cn } from "../lib/utils";
import { getTableSeatCount } from "../types";
import { useDroppable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";
import { useSortable } from "@dnd-kit/sortable";

interface Props {
  table: TableState;
  activeDragKind: "party" | "guest" | "circle" | "table" | null;
  activeDragGuestId: string | null;
  activeDragTableNumber: number | null;
  guestSwapPreview: GuestSwapPreview | null;
  tableSwapPreview: TableSwapPreview;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  onEditTable: (tableNumber: number) => void;
  onDeleteTable: (tableNumber: number) => void;
  displayGuestIds?: Array<string | null>;
  previewSeatKinds?: Array<"added" | "changed" | "deleted" | null>;
  isPreviewMode?: boolean;
  hasTablePreviewChanges?: boolean;
}

type EmptySeatVacancyBucket = "high-vacancy" | "balanced" | "low-vacancy";
type EmptySeatIntensity = "faded" | "default" | "accented";

const HIGH_VACANCY_EMPTY_RATIO = 0.55;
const LOW_VACANCY_EMPTY_RATIO = 0.2;

function resolveEmptySeatVacancyBucket(
  enabledSeatCount: number,
  occupiedEnabledSeatCount: number
): EmptySeatVacancyBucket {
  if (enabledSeatCount <= 0) return "balanced";

  const emptySeatCount = Math.max(0, enabledSeatCount - occupiedEnabledSeatCount);
  const emptyRatio = emptySeatCount / enabledSeatCount;

  if (emptyRatio >= HIGH_VACANCY_EMPTY_RATIO) return "high-vacancy";
  if (emptyRatio <= LOW_VACANCY_EMPTY_RATIO) return "low-vacancy";
  return "balanced";
}

function getEmptySeatIntensity(bucket: EmptySeatVacancyBucket): EmptySeatIntensity {
  if (bucket === "high-vacancy") return "faded";
  if (bucket === "low-vacancy") return "accented";
  return "default";
}

function SeatSlot({
  tableNumber,
  seatIndex,
  guestId,
  guestFullName,
  activeDragKind,
  activeDragGuestId,
  guestSwapPreview,
  isPreviewMode,
  previewSeatKind,
  emptySeatIntensity,
  isDisabled,
  isLocked,
  onToggleDisabled,
  onToggleLock,
  onUnassign,
  onEditGuest,
  onDeleteGuest,
}: {
  tableNumber: number;
  seatIndex: number;
  guestId: string | null;
  /** Full name used in preview mode to avoid registering a duplicate useDraggable ID that kills the active drag. */
  guestFullName: string | null;
  activeDragKind: "party" | "guest" | "circle" | "table" | null;
  activeDragGuestId: string | null;
  guestSwapPreview: GuestSwapPreview | null;
  isPreviewMode: boolean;
  previewSeatKind: "added" | "changed" | "deleted" | null;
  emptySeatIntensity: EmptySeatIntensity;
  isDisabled: boolean;
  isLocked: boolean;
  onToggleDisabled: () => void;
  onToggleLock: () => void;
  onUnassign: () => void;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
}) {
  const isOriginSeat =
    !isPreviewMode &&
    activeDragKind === "guest" &&
    guestId !== null &&
    guestId === activeDragGuestId;
  const isVisuallyEmpty = guestId === null || isOriginSeat;

  // Seats stay registered as droppables as long as they are not administratively
  // disabled — the actual drop-acceptance logic lives in handleDragEnd. Gating on
  // activeDragKind here prevented seat-* ids from appearing in collision results
  // for unassigned-guest drags and cross-table swaps, causing the app to silently
  // fall back to table-level auto-seat instead of placing at the exact seat.
  const isSeatDropDisabled = isDisabled;

  const droppable = useDroppable({
    id: `seat-${tableNumber}-${seatIndex}`,
    disabled: isSeatDropDisabled,
  });

  const isSeatOver = !isDisabled && activeDragKind === "guest" && droppable.isOver;
  const shouldApplyEmptySeatIntensity =
    !isDisabled && isVisuallyEmpty && !isSeatOver && previewSeatKind === null;
  const emptySeatClass =
    emptySeatIntensity === "faded"
      ? "border border-dashed border-(--table-seat-empty-border-faded) bg-(--table-seat-empty-bg-faded)"
      : emptySeatIntensity === "accented"
        ? "border-2 border-solid border-(--table-seat-empty-border-accented) bg-(--table-seat-empty-bg-accented)"
        : "border-2 border-dashed border-(--table-seat-empty-border-default) bg-(--table-seat-empty-bg-default)";
  const isSwapTargetPreview =
    !isPreviewMode &&
    activeDragKind === "guest" &&
    !!activeDragGuestId &&
    guestId !== null &&
    guestSwapPreview?.sourceGuestId === activeDragGuestId &&
    guestSwapPreview?.targetTableNumber === tableNumber &&
    guestSwapPreview?.targetSeatIndex === seatIndex &&
    guestSwapPreview?.targetGuestId === guestId;
  const isSwapTarget = isSwapTargetPreview;
  const isSwapOriginPreview =
    isOriginSeat &&
    guestSwapPreview?.sourceTableNumber === tableNumber &&
    guestSwapPreview?.sourceSeatIndex === seatIndex &&
    guestSwapPreview?.sourceGuestId === guestId;
  const renderedGuestId = isSwapTarget
    ? activeDragGuestId
    : isSwapOriginPreview
      ? guestSwapPreview.targetGuestId
      : guestId;

  const previewChipClass =
    previewSeatKind === "added"
      ? "border-(--diff-added-border) bg-(--diff-added-chip-bg) [--guest-chip-bg:var(--diff-added-chip-bg)]"
      : previewSeatKind === "changed"
        ? "border-(--diff-changed-border) bg-(--diff-changed-chip-bg) [--guest-chip-bg:var(--diff-changed-chip-bg)]"
        : previewSeatKind === "deleted"
          ? "border-(--diff-deleted-border) bg-(--diff-deleted-chip-bg) [--guest-chip-bg:var(--diff-deleted-chip-bg)]"
          : null;

  const slotEl = (
    <div
      ref={droppable.setNodeRef}
      data-seat-id={`seat-${tableNumber}-${seatIndex}`}
      data-seat-slot
      data-guest-id={guestId ?? ""}
      data-disabled={isDisabled || undefined}
      data-empty-seat-intensity={shouldApplyEmptySeatIntensity ? emptySeatIntensity : undefined}
      className={cn(
        "relative flex h-4.75 w-16 shrink-0 items-center overflow-hidden rounded-md transition-[background-color,border-color,box-shadow] duration-100 box-border",
        isDisabled
          ? "border bg-[repeating-linear-gradient(135deg,var(--table-seat-disabled-bg-a),var(--table-seat-disabled-bg-a)_3px,var(--table-seat-disabled-bg-b)_3px,var(--table-seat-disabled-bg-b)_8px)] border-(--table-seat-disabled-border)"
          : isVisuallyEmpty
            ? emptySeatClass
            : "overflow-hidden bg-transparent",
        isSeatOver &&
          (isVisuallyEmpty
            ? "border border-solid border-(--table-drop-border) bg-(--table-drop-bg)"
            : "bg-(--table-drop-bg) outline-1 -outline-offset-1 outline-(--table-drop-border)"),
        previewSeatKind === "added" && "bg-(--diff-added-slot-bg)",
        previewSeatKind === "changed" && "bg-(--diff-changed-slot-bg)",
        previewSeatKind === "deleted" &&
          "bg-(--diff-deleted-slot-bg) shadow-[inset_0_0_0_1px_var(--diff-deleted-border)]"
      )}>
      {!isDisabled && renderedGuestId ? (
        <GuestChip
          guestId={renderedGuestId}
          context="table"
          tableNumber={tableNumber}
          seatIndex={seatIndex}
          suppressStateStyles={isPreviewMode || isSwapTarget || isSwapOriginPreview}
          suppressInteraction={isPreviewMode || isSwapTarget || isSwapOriginPreview}
          draggableDisabled={
            isSwapOriginPreview ||
            isSwapTarget ||
            (isPreviewMode && !(activeDragKind === "guest" && guestId === activeDragGuestId))
          }
          fallbackName={
            isSwapTarget || isSwapOriginPreview ? undefined : (guestFullName ?? undefined)
          }
          onEditGuest={
            isPreviewMode || isSwapTarget || isSwapOriginPreview ? undefined : onEditGuest
          }
          className={[
            "h-full w-full",
            isOriginSeat && !isSwapOriginPreview
              ? "absolute inset-0 opacity-0 pointer-events-none"
              : null,
            isSwapOriginPreview ? "opacity-60 pointer-events-none" : null,
            isSwapTarget ? "opacity-60 pointer-events-none" : null,
            previewChipClass,
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ) : null}
    </div>
  );

  if (isPreviewMode) return slotEl;

  // Occupied seat: only show lock option
  if (!isVisuallyEmpty && !isDisabled) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{slotEl}</ContextMenuTrigger>
        <ContextMenuContent>
          {guestId ? (
            <ContextMenuItem onSelect={() => onEditGuest(guestId)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit guest
            </ContextMenuItem>
          ) : null}
          {guestId ? <ContextMenuSeparator /> : null}
          <ContextMenuItem onSelect={onToggleLock}>
            {isLocked ? (
              <>
                <LockOpen className="mr-2 h-4 w-4" />
                Unlock guest
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Lock guest
              </>
            )}
          </ContextMenuItem>
          <ContextMenuItem onSelect={onUnassign}>
            <UserMinus className="mr-2 h-4 w-4" />
            Unassign guest
          </ContextMenuItem>
          {guestId ? <ContextMenuSeparator /> : null}
          {guestId ? (
            <ContextMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => onDeleteGuest(guestId)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete guest
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Empty or disabled seat: show seat enable/disable option
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{slotEl}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onToggleDisabled}>
          {isDisabled ? (
            <>
              <ToggleRight className="mr-2 h-4 w-4" />
              Enable seat
            </>
          ) : (
            <>
              <ToggleLeft className="mr-2 h-4 w-4" />
              Disable seat
            </>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function TableCard({
  table,
  activeDragKind,
  activeDragGuestId,
  activeDragTableNumber,
  guestSwapPreview,
  tableSwapPreview,
  onEditGuest,
  onDeleteGuest,
  onEditTable,
  onDeleteTable,
  displayGuestIds,
  previewSeatKinds,
  isPreviewMode = false,
  hasTablePreviewChanges = false,
}: Props) {
  const { dispatch, state, guests } = useSeating();
  const lockedSet = new Set(state.lockedGuestIds);
  const isGuestDrag = activeDragKind === "guest";
  const {
    attributes,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `sortable-table-${table.tableNumber}`,
    data: { kind: "table", tableNumber: table.tableNumber, name: table.name, origin: "table" },
    animateLayoutChanges: ({ isSorting }) => isSorting,
  });

  // Track grid position for swap animation
  const previousGridPosRef = useRef(table.gridPosition);
  const [positionTransform, setPositionTransform] = useState<{ x: number; y: number } | null>(null);

  // Constants for grid cell sizing (must match TableBoard)
  const BASE_CELL_WIDTH_REM = 26;
  const BASE_CELL_HEIGHT_REM = 10;
  const DEFAULT_GRID_GAP_REM = 0.625;
  const DENSE_GRID_GAP_REM = 0.375;
  const useDenseGap = state.board.rows > 5 || state.board.columns > 5;
  const gridGapRem = useDenseGap ? DENSE_GRID_GAP_REM : DEFAULT_GRID_GAP_REM;

  // Calculate pixel offsets for grid position changes
  useEffect(() => {
    const prev = previousGridPosRef.current;
    const curr = table.gridPosition;

    // Only animate if position actually changed and not during drag
    if (prev.row === curr.row && prev.column === curr.column) {
      setPositionTransform(null);
      return;
    }

    if (isDragging) {
      previousGridPosRef.current = curr;
      return;
    }

    // Calculate pixel offset from previous to current position
    const rowDiff = curr.row - prev.row;
    const colDiff = curr.column - prev.column;

    const pxPerRow = BASE_CELL_HEIGHT_REM * 16 + gridGapRem * 16; // 16 = rem to px
    const pxPerCol = BASE_CELL_WIDTH_REM * 16 + gridGapRem * 16;

    const offsetY = rowDiff * pxPerRow;
    const offsetX = colDiff * pxPerCol;

    // Set the initial transform to move FROM the old position (visual inversion)
    setPositionTransform({ x: -offsetX, y: -offsetY });
    previousGridPosRef.current = curr;

    // Trigger animation by clearing the transform
    const animationFrame = requestAnimationFrame(() => {
      setPositionTransform(null);
    });

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [table.gridPosition, isDragging, state.board.rows, state.board.columns, gridGapRem]);

  // Apply position transform with animation
  const positionStyle = positionTransform
    ? {
        transform: `translate(${positionTransform.x}px, ${positionTransform.y}px)`,
        transition: "none",
      }
    : {
        transition: "transform 300ms ease-out",
      };

  const containerListeners = {
    ...listeners,
    onPointerDown: (event: React.PointerEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onPointerDown?.(event);
    },
    onMouseDown: (event: React.MouseEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onMouseDown?.(event);
    },
    onTouchStart: (event: React.TouchEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onTouchStart?.(event);
    },
  };

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `table-${table.tableNumber}`,
  });

  const disabledSeatsSet = new Set(table.disabledSeats ?? []);
  const seated = displayGuestIds ?? table.guestIds;
  const seatedGuestIds = seated.filter((guestId): guestId is string => guestId !== null);
  const occupancy = seatedGuestIds.length;
  const totalCapacity = getTableSeatCount(table.seatConfig);
  const effectiveCapacity = totalCapacity - disabledSeatsSet.size;
  const occupiedEnabledSeatCount = seated.reduce(
    (count, guestId, seatIndex) =>
      guestId !== null && !disabledSeatsSet.has(seatIndex) ? count + 1 : count,
    0
  );
  const emptySeatVacancyBucket = resolveEmptySeatVacancyBucket(
    effectiveCapacity,
    occupiedEnabledSeatCount
  );
  const emptySeatIntensity = getEmptySeatIntensity(emptySeatVacancyBucket);
  const hasDisabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && disabledSeatsSet.has(seatIndex)
  );
  const hasEnabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && !disabledSeatsSet.has(seatIndex)
  );
  const allSeatedGuestsLocked = occupancy > 0 && seatedGuestIds.every((id) => lockedSet.has(id));
  const isFull = occupancy >= effectiveCapacity;
  const isLargeRoundTable = table.seatConfig.shape === "round" && totalCapacity >= 10;

  // Compute seat index ranges based on shape
  const sideCounts = table.seatConfig.shape === "rectangular" ? table.seatConfig.sideCounts : null;
  const topCount = sideCounts?.top ?? Math.ceil(seated.length / 2);
  const rightCount = sideCounts?.right ?? 0;
  const bottomCount = sideCounts?.bottom ?? Math.floor(seated.length / 2);
  const leftCount = sideCounts?.left ?? 0;

  const topSeats = seated.slice(0, topCount);
  const rightSeats = seated.slice(topCount, topCount + rightCount);
  const bottomSeats = seated.slice(topCount + rightCount, topCount + rightCount + bottomCount);
  const leftSeats = seated.slice(topCount + rightCount + bottomCount);

  // Keep side rails and top/bottom tracks on the same horizontal span for rectangular tables.
  const seatTrackRem = 4;
  const seatGapRem = 0.5;
  const horizontalSeatCount = Math.max(topCount, bottomCount, 1);
  const horizontalSpanRem =
    horizontalSeatCount * seatTrackRem + Math.max(0, horizontalSeatCount - 1) * seatGapRem;
  const centerTrackRem = Math.max(8, horizontalSpanRem - seatTrackRem * 2 - seatGapRem * 2);
  const middleRowTemplate = `${seatTrackRem}rem ${centerTrackRem}rem ${seatTrackRem}rem`;

  const isSwapTarget =
    activeDragTableNumber !== null &&
    tableSwapPreview.swapTargetTableNumber === table.tableNumber &&
    activeDragKind === "table";

  const cardClass = cn(
    "flex min-h-0 cursor-grab flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 transition-[border-color,background,box-shadow] duration-150 active:cursor-grabbing",
    "w-full",
    "hover:border-(--card-hover-border) focus-within:border-(--card-hover-border)",
    isOver &&
      activeDragKind !== "table" &&
      !isGuestDrag &&
      "border-(--table-drop-border) bg-(--table-drop-bg)",
    isFull &&
      isOver &&
      activeDragKind !== "table" &&
      !isGuestDrag &&
      "border-dashed border-muted-foreground bg-(--card-hover-bg)",
    isSwapTarget && "ring-2 ring-blue-400 ring-opacity-75",
    isDragging && !hasTablePreviewChanges && "cursor-grabbing opacity-0",
    isDragging && hasTablePreviewChanges && "cursor-grabbing opacity-60",
    hasTablePreviewChanges && "border border-(--table-preview-border) bg-(--table-preview-bg)"
  );

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setSortableNodeRef}
      style={{ ...sortableStyle, ...positionStyle }}
      className="min-w-0 w-full"
      data-table-drag-root
      data-table-number={table.tableNumber}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setDroppableNodeRef}
            className={cardClass}
            data-table-card
            {...containerListeners}
            {...attributes}>
            {(() => {
              const renderSeat = (guestId: string | null, seatIndex: number) => (
                <SeatSlot
                  key={seatIndex}
                  tableNumber={table.tableNumber}
                  seatIndex={seatIndex}
                  guestId={guestId}
                  guestFullName={guestId ? (guests.get(guestId)?.fullName ?? null) : null}
                  activeDragKind={activeDragKind}
                  activeDragGuestId={activeDragGuestId}
                  guestSwapPreview={guestSwapPreview}
                  isPreviewMode={isPreviewMode}
                  previewSeatKind={previewSeatKinds?.[seatIndex] ?? null}
                  emptySeatIntensity={emptySeatIntensity}
                  isDisabled={disabledSeatsSet.has(seatIndex)}
                  isLocked={guestId !== null && lockedSet.has(guestId)}
                  onToggleDisabled={() =>
                    dispatch({
                      type: "TOGGLE_SEAT_DISABLED",
                      tableNumber: table.tableNumber,
                      seatIndex,
                    })
                  }
                  onToggleLock={() => {
                    if (guestId)
                      dispatch({
                        type: "SET_GUEST_ANCHORED",
                        guestId,
                        anchored: !lockedSet.has(guestId),
                      });
                  }}
                  onUnassign={() => {
                    if (guestId) {
                      dispatch({ type: "REMOVE_GUESTS", guestIds: [guestId] });
                    }
                  }}
                  onEditGuest={onEditGuest}
                  onDeleteGuest={onDeleteGuest}
                />
              );

              const tableLabelContent = (
                <div className="flex min-h-8.5 select-none flex-col items-center justify-center gap-0.5 text-center">
                  <span
                    data-table-name
                    className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-muted-foreground">
                    {table.name}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-2xs text-muted-foreground",
                      isFull && "font-semibold text-foreground"
                    )}>
                    {occupancy}/{effectiveCapacity}
                  </span>
                </div>
              );

              if (table.seatConfig.shape === "round") {
                const seatCount = seated.length;
                const radiusPercent =
                  seatCount <= 4 ? 30 : seatCount <= 6 ? 34 : seatCount <= 10 ? 38 : 38;

                return (
                  <div
                    className="relative w-full h-44 px-1.5 py-1.5"
                    data-table-card-body
                    data-table-shape="round">
                    {seated.map((guestId, seatIndex) => {
                      const angle =
                        -Math.PI / 2 + (Math.PI * 2 * seatIndex) / Math.max(1, seatCount);
                      const radiusX = radiusPercent * 0.95;
                      const radiusY = radiusPercent * 0.9;
                      const x = 50 + radiusX * Math.cos(angle);
                      const y = 50 + radiusY * Math.sin(angle);

                      return (
                        <div
                          key={seatIndex}
                          className="absolute w-16"
                          style={{
                            left: `${x}%`,
                            top: `${y}%`,
                            transform: "translate(-50%, -50%)",
                          }}>
                          {renderSeat(guestId, seatIndex)}
                        </div>
                      );
                    })}

                    <div
                      data-table-center-label
                      data-table-shape="round"
                      className={cn(
                        "absolute z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-border/80 bg-background/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
                        isLargeRoundTable
                          ? "w-36 rounded-full px-5 py-3.5"
                          : "w-32 rounded-full px-4 py-3"
                      )}>
                      {tableLabelContent}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  className="grid h-44 w-full content-center grid-rows-[auto_auto_auto] gap-4 px-1.5 py-1.5"
                  data-table-card-body
                  data-table-shape="rectangular">
                  {/* Top seats */}
                  {topCount > 0 && (
                    <div
                      className="grid min-w-0 justify-center gap-2"
                      style={{ gridTemplateColumns: `repeat(${topCount}, minmax(4rem, 4rem))` }}>
                      {topSeats.map((guestId, i) => renderSeat(guestId, i))}
                    </div>
                  )}

                  {/* Middle row: balanced outer rails around a centered label shell. */}
                  <div
                    className="grid min-w-0 items-center justify-center gap-2"
                    style={{ gridTemplateColumns: middleRowTemplate }}>
                    {leftCount > 0 && (
                      <div className="grid min-w-0 content-center gap-2">
                        {leftSeats.map((guestId, i) =>
                          renderSeat(guestId, topCount + rightCount + bottomCount + i)
                        )}
                      </div>
                    )}
                    {leftCount === 0 && <div aria-hidden="true" />}
                    <div
                      data-table-center-label
                      data-table-shape="rectangular"
                      className="mx-auto flex min-h-16 w-full items-center justify-center rounded-md border border-border/80 bg-background/88 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                      {tableLabelContent}
                    </div>
                    {rightCount > 0 && (
                      <div className="grid min-w-0 content-center gap-2">
                        {rightSeats.map((guestId, i) => renderSeat(guestId, topCount + i))}
                      </div>
                    )}
                    {rightCount === 0 && <div aria-hidden="true" />}
                  </div>

                  {/* Bottom seats */}
                  {bottomCount > 0 && (
                    <div
                      className="grid min-w-0 justify-center gap-2"
                      style={{
                        gridTemplateColumns: `repeat(${bottomCount}, minmax(4rem, 4rem))`,
                      }}>
                      {bottomSeats.map((guestId, i) =>
                        renderSeat(guestId, topCount + rightCount + i)
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onEditTable(table.tableNumber)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit table
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => onDeleteTable(table.tableNumber)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete table
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={occupancy === 0}
            onSelect={() =>
              dispatch({ type: "TOGGLE_TABLE_GUEST_LOCKS", tableNumber: table.tableNumber })
            }>
            {allSeatedGuestsLocked ? (
              <>
                <LockOpen className="mr-2 h-4 w-4" />
                Unlock all guests
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Lock all guests
              </>
            )}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasDisabledEmptySeats && !hasEnabledEmptySeats}
            onSelect={() =>
              dispatch({ type: "TOGGLE_EMPTY_TABLE_SEATS", tableNumber: table.tableNumber })
            }>
            {hasDisabledEmptySeats ? (
              <>
                <ToggleRight className="mr-2 h-4 w-4" />
                Enable empty seats
              </>
            ) : (
              <>
                <ToggleLeft className="mr-2 h-4 w-4" />
                Disable empty seats
              </>
            )}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={occupancy === 0}
            onSelect={() => dispatch({ type: "CLEAR_TABLE", tableNumber: table.tableNumber })}>
            <Eraser className="mr-2 h-4 w-4" />
            Unassign all guests
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
