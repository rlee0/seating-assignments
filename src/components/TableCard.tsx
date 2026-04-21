import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import { TABLE_CAPACITY } from "../types";
import type { TableState } from "../types";
import { useDroppable } from "@dnd-kit/core";
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
  realGuestId,
  activeDragKind,
  activeDragGuestId,
  isPreviewMode,
  previewSeatKind,
}: {
  tableNumber: number;
  seatIndex: number;
  guestId: string | null;
  realGuestId: string | null;
  activeDragKind: "party" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  isPreviewMode: boolean;
  previewSeatKind: "added" | "changed" | "deleted" | null;
}) {
  const isOriginSeat =
    !isPreviewMode &&
    activeDragKind === "guest" &&
    guestId !== null &&
    guestId === activeDragGuestId;
  const isVisuallyEmpty = guestId === null || isOriginSeat;

  const droppable = useDroppable({
    id: `seat-${tableNumber}-${seatIndex}`,
    disabled: realGuestId !== null && realGuestId !== activeDragGuestId,
  });

  return (
    <div
      ref={droppable.setNodeRef}
      className={[
        "seat-slot",
        isVisuallyEmpty ? "seat-empty" : "seat-occupied",
        activeDragKind === "guest" && droppable.isOver ? "is-over" : null,
        previewSeatKind ? `seat-slot--preview-${previewSeatKind}` : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      {guestId ? (
        <GuestChip
          guestId={guestId}
          context="table"
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
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `table-${table.tableNumber}`,
  });

  const seated = displayGuestIds ?? table.guestIds;
  const seatedGuestIds = seated.filter((guestId): guestId is string => guestId !== null);
  const occupancy = seatedGuestIds.length;
  const isFull = occupancy >= TABLE_CAPACITY;

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
      <div ref={setDroppableNodeRef} className={cardClass}>
        {/* Top 4 seats */}
        <div className="table-seats table-seats-top">
          {topRow.map((guestId, i) => (
            <SeatSlot
              key={i}
              tableNumber={table.tableNumber}
              seatIndex={i}
              guestId={guestId}
              realGuestId={table.guestIds[i]}
              activeDragKind={activeDragKind}
              activeDragGuestId={activeDragGuestId}
              isPreviewMode={isPreviewMode}
              previewSeatKind={previewSeatKinds?.[i] ?? null}
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
                realGuestId={table.guestIds[seatIndex]}
                activeDragKind={activeDragKind}
                activeDragGuestId={activeDragGuestId}
                isPreviewMode={isPreviewMode}
                previewSeatKind={previewSeatKinds?.[seatIndex] ?? null}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
