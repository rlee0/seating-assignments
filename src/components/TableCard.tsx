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

import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import type { GuestSwapPreview } from "./TableBoard";
import { TABLE_CAPACITY } from "../types";
import type { TableState } from "../types";
import { cn } from "../lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";
import { useSortable } from "@dnd-kit/sortable";

interface Props {
  table: TableState;
  activeDragKind: "household" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  guestSwapPreview: GuestSwapPreview | null;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  displayGuestIds?: Array<string | null>;
  previewSeatKinds?: Array<"added" | "changed" | "deleted" | null>;
  isPreviewMode?: boolean;
  hasTablePreviewChanges?: boolean;
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
  activeDragKind: "household" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  guestSwapPreview: GuestSwapPreview | null;
  isPreviewMode: boolean;
  previewSeatKind: "added" | "changed" | "deleted" | null;
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
        "relative flex h-4.75 min-h-4.75 min-w-0 items-center overflow-hidden rounded-sm transition-[background-color,border-color,box-shadow] duration-100 box-border",
        isDisabled
          ? "border bg-[repeating-linear-gradient(135deg,var(--table-seat-disabled-bg-a),var(--table-seat-disabled-bg-a)_3px,var(--table-seat-disabled-bg-b)_3px,var(--table-seat-disabled-bg-b)_8px)] border-(--table-seat-disabled-border)"
          : isVisuallyEmpty
            ? "border border-dashed border-(--table-seat-empty-border) bg-(--table-seat-empty-bg)"
            : "min-w-0 overflow-visible bg-transparent",
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
  guestSwapPreview,
  onEditGuest,
  onDeleteGuest,
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
  const effectiveCapacity = TABLE_CAPACITY - disabledSeatsSet.size;
  const hasDisabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && disabledSeatsSet.has(seatIndex)
  );
  const hasEnabledEmptySeats = table.guestIds.some(
    (guestId, seatIndex) => guestId === null && !disabledSeatsSet.has(seatIndex)
  );
  const allSeatedGuestsLocked = occupancy > 0 && seatedGuestIds.every((id) => lockedSet.has(id));
  const isFull = occupancy >= effectiveCapacity;

  const topRow = seated.slice(0, 4);
  const bottomRow = seated.slice(4, 8);

  const cardClass = cn(
    "flex min-h-0 cursor-grab flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 transition-[border-color,background,box-shadow] duration-150 active:cursor-grabbing",
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
      style={sortableStyle}
      className="min-w-0"
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
            {/* Top 4 seats */}
            <div className="grid min-w-0 grid-cols-4 gap-1">
              {topRow.map((guestId, i) => (
                <SeatSlot
                  key={i}
                  tableNumber={table.tableNumber}
                  seatIndex={i}
                  guestId={guestId}
                  guestFullName={guestId ? (guests.get(guestId)?.fullName ?? null) : null}
                  activeDragKind={activeDragKind}
                  activeDragGuestId={activeDragGuestId}
                  guestSwapPreview={guestSwapPreview}
                  isPreviewMode={isPreviewMode}
                  previewSeatKind={previewSeatKinds?.[i] ?? null}
                  isDisabled={disabledSeatsSet.has(i)}
                  isLocked={guestId !== null && lockedSet.has(guestId)}
                  onToggleDisabled={() =>
                    dispatch({
                      type: "TOGGLE_SEAT_DISABLED",
                      tableNumber: table.tableNumber,
                      seatIndex: i,
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
              ))}
            </div>

            {/* Table label */}
            <div className="relative flex min-h-8.5 items-center justify-center px-7 py-1">
              <div className="flex w-full flex-1 select-none flex-col items-center justify-center gap-0.5 text-center">
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
            </div>

            {/* Bottom 4 seats */}
            <div className="grid min-w-0 grid-cols-4 gap-1">
              {bottomRow.map((guestId, i) => {
                const seatIndex = i + 4;
                return (
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
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
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
