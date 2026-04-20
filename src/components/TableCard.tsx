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
}

function stopTableDrag(event: React.PointerEvent | React.MouseEvent) {
  event.stopPropagation();
}

function SeatSlot({
  tableNumber,
  seatIndex,
  guestId,
  activeDragKind,
  activeDragGuestId,
}: {
  tableNumber: number;
  seatIndex: number;
  guestId: string | null;
  activeDragKind: "party" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
}) {
  const isOriginSeat = activeDragKind === "guest" && guestId === activeDragGuestId;
  const isVisuallyEmpty = guestId === null || isOriginSeat;

  const droppable = useDroppable({
    id: `seat-${tableNumber}-${seatIndex}`,
    disabled: guestId !== null && guestId !== activeDragGuestId,
  });

  return (
    <div
      ref={droppable.setNodeRef}
      className={[
        "seat-slot",
        isVisuallyEmpty ? "seat-empty" : "seat-occupied",
        activeDragKind === "guest" && droppable.isOver ? "is-over" : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      {guestId ? (
        <GuestChip
          guestId={guestId}
          context="table"
          className={isOriginSeat ? "guest-chip--origin-hidden" : undefined}
        />
      ) : null}
    </div>
  );
}

export default function TableCard({ table, activeDragKind, activeDragGuestId }: Props) {
  const { dispatch } = useSeating();
  const {
    attributes,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `sortable-table-${table.tableNumber}`,
    data: { kind: "table", tableNumber: table.tableNumber, name: table.name },
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `table-${table.tableNumber}`,
  });

  const seated = table.guestIds;
  const seatedGuestIds = seated.filter((guestId): guestId is string => guestId !== null);
  const occupancy = seatedGuestIds.length;
  const isFull = occupancy >= TABLE_CAPACITY;

  function handleClearTable() {
    if (occupancy === 0) return;
    dispatch({ type: "CLEAR_TABLE", tableNumber: table.tableNumber });
  }

  const topRow = seated.slice(0, 4);
  const bottomRow = seated.slice(4, 8);

  const cardClass = [
    "table-card",
    isOver && activeDragKind !== "table" ? "is-over" : null,
    isFull ? "is-full" : null,
    isDragging ? "is-dragging" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setSortableNodeRef} style={sortableStyle} className="table-card-shell">
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
            />
          ))}
        </div>

        {/* Table label */}
        <div className="table-label">
          <div className="table-label-main" {...listeners} {...attributes}>
            <span className="table-name">{table.name}</span>
            <span className={`table-occupancy${isFull ? " full" : ""}`}>
              {occupancy}/{TABLE_CAPACITY}
            </span>
          </div>
          <button
            type="button"
            className={`table-action table-clear-btn${occupancy === 0 ? " is-hidden" : ""}`}
            aria-label={`Clear ${table.name}`}
            onPointerDownCapture={stopTableDrag}
            onClick={handleClearTable}
            title="Clear table"
            disabled={occupancy === 0}>
            <svg viewBox="0 0 12 12" className="table-action-icon" aria-hidden="true">
              <path d="M3 3l6 6" />
              <path d="M9 3l-6 6" />
            </svg>
          </button>
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
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
