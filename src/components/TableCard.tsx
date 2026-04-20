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
}

function stopTableDrag(event: React.PointerEvent | React.MouseEvent) {
  event.stopPropagation();
}

function SeatSlot({
  tableNumber,
  seatIndex,
  guestId,
  activeDragKind,
}: {
  tableNumber: number;
  seatIndex: number;
  guestId: string | null;
  activeDragKind: "party" | "guest" | "group" | "table" | null;
}) {
  const droppable = useDroppable({
    id: `seat-${tableNumber}-${seatIndex}`,
    disabled: guestId !== null,
  });

  return (
    <div
      ref={droppable.setNodeRef}
      className={[
        "seat-slot",
        guestId ? "seat-occupied" : "seat-empty",
        activeDragKind === "guest" && droppable.isOver ? "is-over" : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      {guestId ? <GuestChip guestId={guestId} context="table" /> : null}
    </div>
  );
}

export default function TableCard({ table, activeDragKind }: Props) {
  const { dispatch, guests, parties } = useSeating();
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

  // Flag if any seated guest has party members elsewhere
  const hasSplitParty = seatedGuestIds.some((guestId) => {
    const guest = guests.get(guestId);
    if (!guest) return false;
    const party = parties.get(guest.partyId);
    if (!party || party.guestIds.length === 1) return false;
    return party.guestIds.some((id) => id !== guestId && !seatedGuestIds.includes(id));
  });

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
    hasSplitParty ? "has-split" : null,
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
            />
          ))}
        </div>

        {/* Table label */}
        <div className="table-label">
          <div
            className="table-label-main"
            title="Drag to move table"
            {...listeners}
            {...attributes}>
            <span className="table-name">{table.name}</span>
            <span className={`table-occupancy${isFull ? " full" : ""}`}>
              {occupancy}/{TABLE_CAPACITY}
            </span>
          </div>
          {hasSplitParty && (
            <span className="split-indicator" title="Household split across tables">
              <svg viewBox="0 0 16 16" className="split-indicator-icon" aria-hidden="true">
                <path
                  d="M8 2.2L14 13H2L8 2.2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M8 5.6v3.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
              </svg>
            </span>
          )}
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
          {bottomRow.map((guestId, i) => (
            <SeatSlot
              key={i + 4}
              tableNumber={table.tableNumber}
              seatIndex={i + 4}
              guestId={guestId}
              activeDragKind={activeDragKind}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
