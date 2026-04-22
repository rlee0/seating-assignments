import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import { TABLE_CAPACITY } from "../types";
import type { TableState } from "../types";
import { useDroppable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";
import { useSortable } from "@dnd-kit/sortable";

interface Props {
  table: TableState;
  activeDragKind: "party" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  displayGuestIds?: Array<string | null>;
  previewSeatKinds?: Array<"added" | "changed" | "deleted" | null>;
  isPreviewMode?: boolean;
  hasTablePreviewChanges?: boolean;
}

function SeatSlot({
  tableNumber,
  seatIndex,
  guestId,
  activeDragKind,
  activeDragGuestId,
  isPreviewMode,
  previewSeatKind,
  isDisabled,
  isLocked,
  onToggleDisabled,
  onToggleLock,
  onUnassign,
}: {
  tableNumber: number;
  seatIndex: number;
  guestId: string | null;
  activeDragKind: "party" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  isPreviewMode: boolean;
  previewSeatKind: "added" | "changed" | "deleted" | null;
  isDisabled: boolean;
  isLocked: boolean;
  onToggleDisabled: () => void;
  onToggleLock: () => void;
  onUnassign: () => void;
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

  const slotEl = (
    <div
      ref={droppable.setNodeRef}
      data-seat-id={`seat-${tableNumber}-${seatIndex}`}
      className={[
        "seat-slot",
        isDisabled ? "seat-disabled" : isVisuallyEmpty ? "seat-empty" : "seat-occupied",
        !isDisabled && activeDragKind === "guest" && droppable.isOver ? "is-over" : null,
        previewSeatKind ? `seat-slot--preview-${previewSeatKind}` : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      {!isDisabled && guestId ? (
        <GuestChip
          guestId={guestId}
          context="table"
          tableNumber={tableNumber}
          seatIndex={seatIndex}
          className={[
            isOriginSeat ? "guest-chip--origin-hidden" : null,
            previewSeatKind ? `guest-chip--preview-${previewSeatKind}` : null,
          ]
            .filter(Boolean)
            .join(" ")}
          suppressStateStyles={isPreviewMode}
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
          <ContextMenuItem onSelect={onToggleLock}>
            {isLocked ? "Unlock guest" : "Lock guest"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onUnassign}>Unassign guest</ContextMenuItem>
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
          {isDisabled ? "Enable seat" : "Disable seat"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function TableCard({
  table,
  activeDragKind,
  activeDragGuestId,
  displayGuestIds,
  previewSeatKinds,
  isPreviewMode = false,
  hasTablePreviewChanges = false,
}: Props) {
  const { dispatch, state } = useSeating();
  const lockedSet = new Set(state.lockedGuestIds);
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

  const cardClass = [
    "table-card",
    isOver && activeDragKind !== "table" ? "is-over" : null,
    isFull ? "is-full" : null,
    isDragging ? "is-dragging" : null,
    hasTablePreviewChanges ? "table-card--preview" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setSortableNodeRef} style={sortableStyle} className="table-card-shell">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={setDroppableNodeRef} className={cardClass}>
            {/* Top 4 seats */}
            <div className="table-seats table-seats-top">
              {topRow.map((guestId, i) => (
                <SeatSlot
                  key={i}
                  tableNumber={table.tableNumber}
                  seatIndex={i}
                  guestId={guestId}
                  activeDragKind={activeDragKind}
                  activeDragGuestId={activeDragGuestId}
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
                />
              ))}
            </div>

            {/* Table label */}
            <div className="table-label">
              <div className="table-label-main" {...listeners} {...attributes}>
                <span className="table-name">{table.name}</span>
                <span className={`table-occupancy${isFull ? " full" : ""}`}>
                  {occupancy}/{effectiveCapacity}
                </span>
              </div>
            </div>

            {/* Bottom 4 seats */}
            <div className="table-seats table-seats-bottom">
              {bottomRow.map((guestId, i) => {
                const seatIndex = i + 4;
                return (
                  <SeatSlot
                    key={seatIndex}
                    tableNumber={table.tableNumber}
                    seatIndex={seatIndex}
                    guestId={guestId}
                    activeDragKind={activeDragKind}
                    activeDragGuestId={activeDragGuestId}
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
                  />
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={occupancy === 0}
            onSelect={() => dispatch({ type: "CLEAR_TABLE", tableNumber: table.tableNumber })}>
            Unassign all guests
          </ContextMenuItem>
          <ContextMenuItem
            disabled={occupancy === 0}
            onSelect={() =>
              dispatch({ type: "TOGGLE_TABLE_GUEST_LOCKS", tableNumber: table.tableNumber })
            }>
            {allSeatedGuestsLocked ? "Unlock all guests" : "Lock all guests"}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasDisabledEmptySeats && !hasEnabledEmptySeats}
            onSelect={() =>
              dispatch({ type: "TOGGLE_EMPTY_TABLE_SEATS", tableNumber: table.tableNumber })
            }>
            {hasDisabledEmptySeats ? "Enable empty seats" : "Disable empty seats"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
