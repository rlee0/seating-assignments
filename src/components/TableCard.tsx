import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Eraser, Pencil, ToggleLeft, ToggleRight, Trash2, UserMinus } from "lucide-react";
import type { GuestSwapPreview, TableSwapPreviewOffset } from "./TableBoard";

import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import type { TableState } from "../types";
import { cn } from "../lib/utils";
import { getTableSeatCount } from "../types";
import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";
import { useSortable } from "@dnd-kit/sortable";

interface Props {
  table: TableState;
  activeDragKind: "party" | "guest" | "circle" | "table" | null;
  activeDragGuestId: string | null;
  guestSwapPreview: GuestSwapPreview | null;
  tableSwapPreviewOffset: TableSwapPreviewOffset | null;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  onEditTable: (tableNumber: number) => void;
  onDeleteTable: (tableNumber: number) => void;
  displayGuestIds?: Array<string | null>;
  previewSeatKinds?: Array<"added" | "changed" | "deleted" | null>;
  isPreviewMode?: boolean;
  hasTablePreviewChanges?: boolean;
  /** The dnd-kit over.id during a drag, passed from App to avoid useDndContext subscription in every TableCard. */
  activeOverId?: string | null;
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
  isDisabled,
  onToggleDisabled,
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
  isDisabled: boolean;
  onToggleDisabled: () => void;
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
  const emptySeatClass =
    "border border-dashed border-(--table-seat-empty-border-default) bg-(--table-seat-empty-bg-default)";
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
      className={cn(
        "relative flex h-4.75 w-16 shrink-0 items-center overflow-hidden rounded-md box-border",
        activeDragKind === "guest"
          ? "transition-none"
          : "transition-[background-color,border-color,box-shadow] duration-100",
        isDisabled
          ? "border border-dashed border-(--table-seat-disabled-border) bg-(--table-seat-disabled-bg-a) opacity-30"
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

  // Occupied seat: show guest actions
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

export default memo(function TableCard({
  table,
  activeDragKind,
  activeDragGuestId,
  guestSwapPreview,
  tableSwapPreviewOffset,
  onEditGuest,
  onDeleteGuest,
  onEditTable,
  onDeleteTable,
  displayGuestIds,
  previewSeatKinds,
  isPreviewMode = false,
  hasTablePreviewChanges = false,
  activeOverId = null,
}: Props) {
  const { dispatch, guests } = useSeating();
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
    animateLayoutChanges: () => false,
  });

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

  // For guest drags, collision detection prefers seat-* containers over the table container,
  // so isOver on the table droppable is false whenever the pointer is directly over a seat.
  // Extend the signal: also treat any seat belonging to this table being hovered as isOver.
  const isAnyOver =
    isOver ||
    (activeDragKind === "guest" &&
      activeOverId !== null &&
      activeOverId.startsWith(`seat-${table.tableNumber}-`));

  const disabledSeatsSet = new Set(table.disabledSeats ?? []);
  const seated = displayGuestIds ?? table.guestIds;
  const seatedGuestIds = seated.filter((guestId): guestId is string => guestId !== null);
  const occupancy = seatedGuestIds.length;
  const totalCapacity = getTableSeatCount(table.seatConfig);
  const effectiveCapacity = totalCapacity - disabledSeatsSet.size;
  const hasDisabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && disabledSeatsSet.has(seatIndex)
  );
  const hasEnabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && !disabledSeatsSet.has(seatIndex)
  );
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

  const cardClass = cn(
    "flex min-h-0 cursor-grab flex-col gap-1.5 rounded-lg bg-card p-2.5 transition-[border-color,background,box-shadow] duration-150 active:cursor-grabbing",
    "w-full",
    "hover:border-(--card-hover-border) focus-within:border-(--card-hover-border)",
    isAnyOver && activeDragKind !== "table" && "border-(--table-drop-border) bg-(--table-drop-bg)",
    isFull &&
      isAnyOver &&
      activeDragKind !== "table" &&
      "border-dashed border-muted-foreground bg-(--card-hover-bg)",
    isDragging && !hasTablePreviewChanges && "cursor-grabbing opacity-0",
    isDragging && hasTablePreviewChanges && "cursor-grabbing opacity-60",
    hasTablePreviewChanges && "border border-(--table-preview-border) bg-(--table-preview-bg)"
  );

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? transition : undefined,
  };
  const previewStyle = tableSwapPreviewOffset
    ? {
        transform: `translate(${tableSwapPreviewOffset.xPx}px, ${tableSwapPreviewOffset.yPx}px)`,
      }
    : undefined;

  return (
    <div
      ref={setSortableNodeRef}
      style={sortableStyle}
      className="min-w-0 w-full"
      data-table-drag-root
      data-table-number={table.tableNumber}>
      <div className="min-w-0 w-full" data-table-motion-root data-table-number={table.tableNumber}>
        <div
          className={`min-w-0 w-full will-change-transform${activeDragKind === "table" ? " transition-transform duration-150 ease-out" : ""}`}
          style={previewStyle}
          data-table-preview-root>
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
                      isDisabled={disabledSeatsSet.has(seatIndex)}
                      onToggleDisabled={() =>
                        dispatch({
                          type: "TOGGLE_SEAT_DISABLED",
                          tableNumber: table.tableNumber,
                          seatIndex,
                        })
                      }
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
                      seatCount <= 4 ? 31 : seatCount <= 6 ? 35 : seatCount <= 10 ? 40 : 41;

                    return (
                      <div
                        className="relative w-full h-44 px-1.5 py-1.5"
                        data-table-card-body
                        data-table-shape="round">
                        {seated.map((guestId, seatIndex) => {
                          const angle =
                            -Math.PI / 2 + (Math.PI * 2 * seatIndex) / Math.max(1, seatCount);
                          const sidePullStrength = Math.abs(Math.cos(angle));
                          const sideInwardFactor = 1 - sidePullStrength * 0.04;
                          const radiusX = radiusPercent * 0.97 * sideInwardFactor;
                          const radiusY = radiusPercent * 0.95;
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
                          style={{
                            gridTemplateColumns: `repeat(${topCount}, minmax(4rem, 4rem))`,
                          }}>
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
      </div>
    </div>
  );
});
